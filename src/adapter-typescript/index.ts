import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import ts from '@typescript/typescript6';
import { SecureTypeScriptSystem, type WorkspacePathViolation } from './secure-system.js';
import { relocateFunctionFragments } from '../adapter-api/relocation.js';
import type {
  AdapterCallContext,
  AdapterHealth,
  AdapterHost,
  AdapterIndexSnapshot,
  AdapterSession,
  DetectionEvidence,
  DetectionResult,
  IndexEvent,
  IndexEventSink,
  IndexProgress,
  IndexRequest,
  IndexSummary,
  LanguageAdapter,
  LanguageAdapterManifest,
  OpenSessionRequest,
  RelocateRequest,
  RelocationMatch,
  SourceFragmentRequest,
  SourceFragmentResult,
} from '../adapter-api/index.js';
import {
  loopRegionId,
  projectId,
  relationId,
  sourceFileId,
  symbolId,
  type BranchContext,
  type Diagnostic,
  type FunctionFragment,
  type IterationEstimate,
  type LoopControlEdge,
  type LoopExitEdge,
  type LoopRegion,
  type RelationBridge,
  type RelationCandidate,
  type ReferenceResolution,
  type SourceAnchor,
  type SourceFile,
  type TextRange,
} from '../model/index.js';

const CORE_API_VERSION = '1.0.0';

export const typescriptAdapterManifest: LanguageAdapterManifest = {
  adapterId: 'xanadu.typescript',
  displayName: 'TypeScript',
  adapterVersion: '0.1.0',
  compilerVersion: ts.version,
  coreApiRange: '^1.0.0',
  dtoSchemaVersion: 1,
  languages: [{
    languageId: 'typescript',
    displayName: 'TypeScript',
    filePatterns: ['**/*.ts', '**/*.tsx'],
  }],
  detection: {
    projectFiles: ['tsconfig.json'],
    filePatterns: ['**/*.ts', '**/*.tsx'],
  },
  capabilities: {
    symbols: 'semantic',
    references: 'semantic',
    controlFlow: true,
    loops: true,
    stableIds: 'relocatable',
    incrementalUpdate: false,
    externalEndpoints: true,
  },
  runtime: { kind: 'bundled-node', entrypoint: 'adapter-typescript/index.js' },
};

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const normalizeRelativePath = (value: string): string => value.split(sep).join('/');

const rangeOf = (node: ts.Node, sourceFile: ts.SourceFile): TextRange => ({
  start: node.getStart(sourceFile),
  end: node.getEnd(),
});

const lineStarts = (content: string): readonly number[] => {
  const result = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) result.push(index + 1);
  }
  return result;
};

const isPathInside = (rootPath: string, candidate: string): boolean => {
  const relativePath = relative(rootPath, candidate);
  return relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath));
};

const resolveInside = (rootPath: string, projectRelativePath: string): string => {
  const candidate = resolve(rootPath, projectRelativePath);
  if (!isPathInside(rootPath, candidate)) throw new Error('Workspace path escape rejected');
  return candidate;
};

const collectFiles = async (
  system: SecureTypeScriptSystem,
  signal: AbortSignal,
  onProgress: (progress: IndexProgress) => void,
): Promise<readonly string[]> => {
  const heavyDirectories = new Set(['node_modules', 'vendor', 'build', 'generated', 'dist', 'dist-electron', 'out', 'coverage']);
  await system.prepareProjectFileIndex(signal, (completed) => onProgress({ phase: 'detect', completed, message: `检测项目文件 ${completed}` }), heavyDirectories);
  return system.enumeratedProjectRelativePaths
    .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('tsconfig.json'))
    .sort();
};

const hostSystems = new WeakMap<AdapterHost, SecureTypeScriptSystem>();

export const createFileSystemAdapterHost = (
  rootPath: string,
  onProgress: (progress: IndexProgress) => void = () => undefined,
  signal: AbortSignal = new AbortController().signal,
): AdapterHost => {
  const secureSystem = new SecureTypeScriptSystem(rootPath);
  const host: AdapterHost = {
  listFiles: () => secureSystem.fileExists(resolve(secureSystem.rootPath, 'tsconfig.json'))
    ? Promise.resolve(['tsconfig.json'])
    : collectFiles(secureSystem, signal, onProgress),
  readFile: (projectRelativePath, expectedRevision) => {
    let candidate: string;
    try {
      candidate = resolveInside(secureSystem.rootPath, projectRelativePath);
    } catch {
      return Promise.reject(new Error('Workspace file access rejected'));
    }
    const content = secureSystem.readFile(candidate);
    if (content === undefined) return Promise.reject(new Error('Workspace file access rejected'));
    const revision = sha256(content);
    if (expectedRevision !== undefined && expectedRevision !== revision) return Promise.reject(new Error('Source revision changed'));
    return Promise.resolve({ content, revision });
  },
  now: () => new Date().toISOString(),
  hash: sha256,
  reportProgress: onProgress,
  };
  hostSystems.set(host, secureSystem);
  return host;
};

const securityDiagnostic = (violation: WorkspacePathViolation, index: number): Diagnostic => ({
  id: `diagnostic:security:${violation.code}:${index}`,
  code: violation.code,
  severity: 'error',
  phase: 'read',
  scope: 'project',
  recoverability: 'requires-user-action',
  message: `Rejected unauthorized workspace entry: ${violation.entryName}`,
});

const yieldToEventLoop = (): Promise<void> => new Promise((resolvePromise) => setImmediate(resolvePromise));

interface FragmentRecord {
  readonly fragment: FunctionFragment;
  readonly sourceFile: ts.SourceFile;
  readonly node: ts.Node;
}

interface FileRecord {
  readonly model: SourceFile;
  readonly compiler: ts.SourceFile;
  readonly content: string;
}

const sourceAnchor = (file: SourceFile, range: TextRange): SourceAnchor => ({
  sourceFileId: file.id,
  revision: file.revision,
  range,
});

const declarationName = (node: ts.Node, sourceFile: ts.SourceFile): { readonly name: string; readonly range: TextRange } | null => {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    if (node.name === undefined) return null;
    return { name: node.name.getText(sourceFile), range: rangeOf(node.name, sourceFile) };
  }
  if (ts.isConstructorDeclaration(node)) {
    const token = node.getFirstToken(sourceFile);
    return token === undefined ? null : { name: 'constructor', range: rangeOf(token, sourceFile) };
  }
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    (ts.isVariableDeclaration(node.parent) || ts.isPropertyDeclaration(node.parent) || ts.isPropertyAssignment(node.parent))) {
    return { name: node.parent.name.getText(sourceFile), range: rangeOf(node.parent.name, sourceFile) };
  }
  return null;
};

const symbolKindOf = (node: ts.Node): FunctionFragment['symbolKind'] => {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (ts.isMethodDeclaration(node)) return 'method';
  if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) return 'accessor';
  return 'function';
};

const structuralOrdinal = (node: ts.Node, parent: ts.Node, predicate: (candidate: ts.Node) => boolean): number => {
  const siblings: ts.Node[] = [];
  ts.forEachChild(parent, (child) => { if (predicate(child)) siblings.push(child); });
  return Math.max(0, siblings.indexOf(node));
};

const normalizedSyntax = (value: string): string => value.replace(/\s+/g, ' ').trim();

const structuralFingerprint = (node: ts.Node): string => {
  const value = ts.isIdentifier(node) || ts.isPrivateIdentifier(node) ? node.text
    : ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text
      : '';
  const children: string[] = [];
  ts.forEachChild(node, (child) => children.push(structuralFingerprint(child)));
  return `${node.kind}${value.length > 0 ? `:${normalizedSyntax(value)}` : ''}[${children.join(',')}]`;
};

const lexicalCallPath = (node: ts.Node, owner: ts.Node): string => {
  const segments: number[] = [];
  let current = node;
  while (current !== owner && current.parent !== undefined) {
    const parent = current.parent;
    let index = 0;
    let found = false;
    ts.forEachChild(parent, (child) => {
      if (child === current) found = true;
      else if (!found) index += 1;
    });
    segments.unshift(index);
    current = parent;
  }
  return segments.join('.');
};

const blockDiscriminator = (block: ts.Block, sourceFile: ts.SourceFile): string | undefined => {
  const parent = block.parent;
  if (ts.isFunctionLike(parent) && 'body' in parent && parent.body === block) return undefined;
  if (ts.isIfStatement(parent)) {
    const arm = parent.thenStatement === block ? 'then' : 'else';
    const ordinal = structuralOrdinal(parent, parent.parent, ts.isIfStatement);
    return `if:${ordinal}:${sha256(normalizedSyntax(parent.expression.getText(sourceFile))).slice(0, 10)}:${arm}`;
  }
  if (ts.isIterationStatement(parent, false)) {
    const kind = loopKind(parent);
    const condition = conditionForLoop(parent)?.getText(sourceFile) ?? kind;
    return `loop:${structuralOrdinal(parent, parent.parent, (candidate) => ts.isIterationStatement(candidate, false))}:${sha256(normalizedSyntax(condition)).slice(0, 10)}:${kind}`;
  }
  if (ts.isCatchClause(parent)) {
    const tryStatement = parent.parent;
    const ordinal = ts.isTryStatement(tryStatement)
      ? structuralOrdinal(tryStatement, tryStatement.parent, ts.isTryStatement)
      : 0;
    const variable = parent.variableDeclaration?.name.getText(sourceFile) ?? 'anonymous';
    const tryShape = ts.isTryStatement(tryStatement)
      ? `${structuralFingerprint(tryStatement.tryBlock)}|${structuralFingerprint(parent.block)}|${tryStatement.finallyBlock === undefined ? 'none' : structuralFingerprint(tryStatement.finallyBlock)}`
      : `catch:${variable}`;
    return `try:${ordinal}:${sha256(tryShape).slice(0, 16)}:catch:${variable}`;
  }
  if (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) {
    const clauseIndex = structuralOrdinal(parent, parent.parent, (candidate) => ts.isCaseClause(candidate) || ts.isDefaultClause(candidate));
    return `case:${clauseIndex}:${ts.isCaseClause(parent) ? normalizedSyntax(parent.expression.getText(sourceFile)) : 'default'}`;
  }
  const blocks: ts.Block[] = [];
  ts.forEachChild(parent, (child) => { if (ts.isBlock(child)) blocks.push(child); });
  const index = blocks.indexOf(block);
  return `block:${Math.max(0, index)}`;
};

const qualifiedName = (node: ts.Node, name: string, sourceFile: ts.SourceFile): string => {
  const containers: string[] = [];
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    let container: string | undefined;
    if (ts.isModuleDeclaration(current)) container = current.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
    if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) {
      container = current.name?.text;
      if (container === undefined) {
        const owner = current.parent;
        if (ts.isVariableDeclaration(owner) || ts.isPropertyDeclaration(owner) || ts.isPropertyAssignment(owner)) container = owner.name.getText(sourceFile);
        else container = `anonymous-class:${structuralOrdinal(current, owner, (candidate) => ts.isClassExpression(candidate) || ts.isClassDeclaration(candidate))}`;
      }
    }
    if (ts.isObjectLiteralExpression(current)) {
      const owner = current.parent;
      if (ts.isVariableDeclaration(owner) || ts.isPropertyDeclaration(owner) || ts.isPropertyAssignment(owner)) container = `object:${owner.name.getText(sourceFile)}`;
    }
    if (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current) || ts.isGetAccessorDeclaration(current) || ts.isSetAccessorDeclaration(current) || ts.isConstructorDeclaration(current) || ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      container = declarationName(current, sourceFile)?.name;
    }
    if (ts.isBlock(current)) container = blockDiscriminator(current, sourceFile);
    const currentDeclaresNode = (ts.isVariableDeclaration(current) || ts.isPropertyDeclaration(current) || ts.isPropertyAssignment(current)) && current.initializer === node;
    if (!currentDeclaresNode && container !== undefined && containers[0] !== container) containers.unshift(container);
    current = current.parent;
  }
  return [...containers, name].join('.');
};

const extractFragments = (
  file: FileRecord,
  projectLogicalId: string,
  now: string,
): readonly FragmentRecord[] => {
  const result: FragmentRecord[] = [];
  const visit = (node: ts.Node): void => {
    const isSupported =
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node);
    if (isSupported) {
      const named = declarationName(node, file.compiler);
      if (named !== null) {
        const fullNode = (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
          (ts.isVariableDeclaration(node.parent) || ts.isPropertyDeclaration(node.parent) || ts.isPropertyAssignment(node.parent))
          ? node.parent
          : node;
        const fullRange = rangeOf(fullNode, file.compiler);
        const body = 'body' in node && node.body !== undefined ? rangeOf(node.body, file.compiler) : undefined;
        const qualified = qualifiedName(node, named.name, file.compiler);
        const signatureText = `${node.typeParameters?.map((parameter) => parameter.getText(file.compiler)).join(',') ?? ''}(${node.parameters.map((parameter) => `${parameter.dotDotDotToken === undefined ? '' : '...'}${parameter.name.getText(file.compiler)}${parameter.questionToken === undefined ? '' : '?'}:${parameter.type?.getText(file.compiler) ?? 'inferred'}`).join(',')}):${node.type?.getText(file.compiler) ?? 'inferred'}`;
        const signatureHash = sha256(signatureText).slice(0, 24);
        const bodyText = 'body' in node && node.body !== undefined ? node.body.getText(file.compiler).replace(/\s+/g, ' ').trim() : '';
        const declarationFingerprint = sha256(`${symbolKindOf(node)}:${signatureHash}:${bodyText}`).slice(0, 24);
        const lexicalFingerprint = sha256(qualified.split('.').slice(0, -1).join('.')).slice(0, 24);
        const containerFingerprint = sha256(qualified.split('.').slice(0, -1).join('|')).slice(0, 24);
        const idInput = `v2:${projectLogicalId}:${file.model.projectRelativePath}:${qualified}:${lexicalFingerprint}:${containerFingerprint}:${signatureHash}:${declarationFingerprint}`;
        const fragment: FunctionFragment = {
          id: symbolId(`symbol:${sha256(idInput).slice(0, 24)}`),
          sourceFileId: file.model.id,
          languageId: 'typescript',
          symbolKind: symbolKindOf(node),
          displayName: named.name,
          qualifiedName: qualified,
          fullRange,
          definitionRange: named.range,
          ...(body === undefined ? {} : { bodyRange: body }),
          identity: { recipeVersion: 2, signatureHash, declarationFingerprint, lexicalFingerprint, containerFingerprint },
          provenance: {
            source: 'adapter',
            projectRelativePath: file.model.projectRelativePath,
            revision: file.model.revision,
            range: fullRange,
            adapterId: typescriptAdapterManifest.adapterId,
            adapterVersion: typescriptAdapterManifest.adapterVersion,
            coreApiVersion: CORE_API_VERSION,
            generatedAt: now,
          },
        };
        result.push({ fragment, sourceFile: file.compiler, node: fullNode });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file.compiler);
  return result;
};

const innermostFragment = (records: readonly FragmentRecord[], sourceFile: ts.SourceFile, position: number): FragmentRecord | undefined =>
  records
    .filter((record) => record.sourceFile === sourceFile && record.fragment.fullRange.start <= position && record.fragment.fullRange.end >= position)
    .sort((left, right) => (left.fragment.fullRange.end - left.fragment.fullRange.start) - (right.fragment.fullRange.end - right.fragment.fullRange.start))[0];

const fragmentForDeclaration = (records: readonly FragmentRecord[], declaration: ts.Declaration): FragmentRecord | undefined => {
  const sourceFile = declaration.getSourceFile();
  const start = declaration.getStart(sourceFile);
  return innermostFragment(records, sourceFile, start);
};

const conditionForLoop = (node: ts.IterationStatement): ts.Expression | undefined => {
  if (ts.isForStatement(node)) return node.condition;
  if (ts.isWhileStatement(node) || ts.isDoStatement(node)) return node.expression;
  if (ts.isForOfStatement(node) || ts.isForInStatement(node)) return node.expression;
  return undefined;
};

const estimateForLoop = (node: ts.IterationStatement, file: FileRecord): IterationEstimate => {
  if (ts.isForOfStatement(node)) {
    const expression = node.expression.getText(file.compiler);
    return { kind: 'expression', expression: `${expression}.length`, source: sourceAnchor(file.model, rangeOf(node.expression, file.compiler)) };
  }
  if (ts.isForInStatement(node)) {
    const expression = node.expression.getText(file.compiler);
    return { kind: 'expression', expression: `Object.keys(${expression}).length`, source: sourceAnchor(file.model, rangeOf(node.expression, file.compiler)) };
  }
  if (!ts.isForStatement(node) || node.initializer === undefined || !ts.isVariableDeclarationList(node.initializer) ||
    node.initializer.declarations.length !== 1 || node.condition === undefined || !ts.isBinaryExpression(node.condition) ||
    node.incrementor === undefined) return { kind: 'unknown' };
  const declaration = node.initializer.declarations[0];
  if (declaration === undefined || !ts.isIdentifier(declaration.name) || declaration.initializer === undefined || !ts.isNumericLiteral(declaration.initializer) ||
    !ts.isIdentifier(node.condition.left) || node.condition.left.text !== declaration.name.text || !ts.isNumericLiteral(node.condition.right)) return { kind: 'unknown' };
  const variable = declaration.name.text;
  let step = 0;
  if ((ts.isPrefixUnaryExpression(node.incrementor) || ts.isPostfixUnaryExpression(node.incrementor)) && ts.isIdentifier(node.incrementor.operand) && node.incrementor.operand.text === variable) {
    if (node.incrementor.operator === ts.SyntaxKind.PlusPlusToken) step = 1;
    if (node.incrementor.operator === ts.SyntaxKind.MinusMinusToken) step = -1;
  } else if (ts.isBinaryExpression(node.incrementor) && ts.isIdentifier(node.incrementor.left) && node.incrementor.left.text === variable && ts.isNumericLiteral(node.incrementor.right)) {
    if (node.incrementor.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) step = Number(node.incrementor.right.text);
    if (node.incrementor.operatorToken.kind === ts.SyntaxKind.MinusEqualsToken) step = -Number(node.incrementor.right.text);
  }
  if (step === 0) return { kind: 'unknown' };
  const start = Number(declaration.initializer.text);
  const bound = Number(node.condition.right.text);
  const operator = node.condition.operatorToken.kind;
  let value: number | undefined;
  if (step > 0 && (operator === ts.SyntaxKind.LessThanToken || operator === ts.SyntaxKind.LessThanEqualsToken)) {
    const distance = bound - start;
    value = operator === ts.SyntaxKind.LessThanToken
      ? Math.max(0, Math.ceil(distance / step))
      : distance < 0 ? 0 : Math.floor(distance / step) + 1;
  }
  if (step < 0 && (operator === ts.SyntaxKind.GreaterThanToken || operator === ts.SyntaxKind.GreaterThanEqualsToken)) {
    const distance = start - bound;
    const magnitude = Math.abs(step);
    value = operator === ts.SyntaxKind.GreaterThanToken
      ? Math.max(0, Math.ceil(distance / magnitude))
      : distance < 0 ? 0 : Math.floor(distance / magnitude) + 1;
  }
  if (value !== undefined && Number.isFinite(value)) {
    return { kind: 'upper-bound', value, proofRange: sourceAnchor(file.model, rangeOf(node, file.compiler)) };
  }
  return { kind: 'unknown' };
};

const loopKind = (node: ts.IterationStatement): LoopRegion['kind'] => {
  if (ts.isForStatement(node)) return 'for';
  if (ts.isWhileStatement(node)) return 'while';
  if (ts.isDoStatement(node)) return 'do-while';
  if (ts.isForOfStatement(node)) return 'for-of';
  return 'for-in';
};

const extractLoopControl = (
  node: ts.IterationStatement,
  file: FileRecord,
  loopId: string,
  continueTarget: SourceAnchor,
): { readonly continueEdges: readonly LoopControlEdge[]; readonly exitEdges: readonly LoopExitEdge[] } => {
  const continueEdges: LoopControlEdge[] = [];
  const exitEdges: LoopExitEdge[] = [];
  const loopLabel = ts.isLabeledStatement(node.parent) && node.parent.statement === node ? node.parent.label.text : undefined;
  const visit = (current: ts.Node, nestedLoopDepth: number): void => {
    if (current !== node.statement && ts.isFunctionLike(current)) return;
    const currentAnchor = sourceAnchor(file.model, rangeOf(current, file.compiler));
    if (ts.isContinueStatement(current)) {
      const targetsCurrent = current.label === undefined ? nestedLoopDepth === 0 : current.label.text === loopLabel;
      if (targetsCurrent) continueEdges.push({ id: `${loopId}:continue:${current.pos}`, kind: 'continue', source: currentAnchor, target: continueTarget });
      return;
    }
    if (ts.isBreakStatement(current)) {
      const exitsCurrent = current.label === undefined ? nestedLoopDepth === 0 : current.label.text === loopLabel;
      if (exitsCurrent) exitEdges.push({ id: `${loopId}:break:${current.pos}`, reason: 'break', source: currentAnchor });
      return;
    }
    if (ts.isReturnStatement(current)) {
      exitEdges.push({ id: `${loopId}:return:${current.pos}`, reason: 'return', source: currentAnchor });
      return;
    }
    if (ts.isThrowStatement(current)) {
      exitEdges.push({ id: `${loopId}:throw:${current.pos}`, reason: 'throw', source: currentAnchor });
      return;
    }
    const nextDepth = current !== node.statement && ts.isIterationStatement(current, false) ? nestedLoopDepth + 1 : nestedLoopDepth;
    ts.forEachChild(current, (child) => visit(child, nextDepth));
  };
  visit(node.statement, 0);
  return { continueEdges, exitEdges };
};

const extractLoops = (files: readonly FileRecord[], fragments: readonly FragmentRecord[]): readonly LoopRegion[] => {
  const loops: LoopRegion[] = [];
  for (const file of files) {
    const visit = (node: ts.Node): void => {
      if (ts.isIterationStatement(node, false)) {
        const owner = innermostFragment(fragments, file.compiler, node.getStart(file.compiler));
        if (owner !== undefined) {
          const id = `loop:${sha256(`${file.model.id}:${node.getStart(file.compiler)}`).slice(0, 24)}`;
          const condition = conditionForLoop(node);
          const conditionAnchor = sourceAnchor(file.model, condition === undefined ? rangeOf(node, file.compiler) : rangeOf(condition, file.compiler));
          const bodyAnchor = sourceAnchor(file.model, rangeOf(node.statement, file.compiler));
          const continueTarget = ts.isForStatement(node) && node.incrementor !== undefined
            ? sourceAnchor(file.model, rangeOf(node.incrementor, file.compiler))
            : conditionAnchor;
          const entryTarget = ts.isDoStatement(node) ? bodyAnchor : conditionAnchor;
          const control = extractLoopControl(node, file, id, continueTarget);
          const source = sourceAnchor(file.model, rangeOf(node, file.compiler));
          loops.push({
            id: loopRegionId(id),
            ownerFragmentId: owner.fragment.id,
            kind: loopKind(node),
            source,
            ...(condition === undefined ? {} : { condition: conditionAnchor }),
            body: bodyAnchor,
            bodyFunctionIds: [],
            entryEdges: [{ id: `${id}:entry`, kind: 'entry', source, target: entryTarget }],
            backEdges: [{ id: `${id}:back`, kind: 'back', source: bodyAnchor, target: continueTarget }],
            continueEdges: control.continueEdges,
            exitEdges: [
              { id: `${id}:condition-false`, reason: 'condition-false', source: conditionAnchor },
              ...control.exitEdges,
            ],
            iterationEstimate: estimateForLoop(node, file),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file.compiler);
  }
  return loops;
};

const nearestBranch = (node: ts.Node, sourceFile: ts.SourceFile): BranchContext | undefined => {
  let child: ts.Node = node;
  let current = node.parent;
  while (current !== undefined) {
    if (ts.isIfStatement(current)) {
      const inThen = child === current.thenStatement || (child.pos >= current.thenStatement.pos && child.end <= current.thenStatement.end);
      const inElse = current.elseStatement !== undefined && (child === current.elseStatement || (child.pos >= current.elseStatement.pos && child.end <= current.elseStatement.end));
      if (inThen || inElse) {
        const condition = current.expression.getText(sourceFile);
        const arm = inThen ? 'A' : 'B';
        return {
          branchId: `branch:${sha256(`${normalizeRelativePath(sourceFile.fileName)}:${current.getStart(sourceFile)}`).slice(0, 16)}`,
          condition,
          arm,
          label: arm === 'A' ? `${condition} = true` : `${condition} = false`,
        };
      }
    }
    child = current;
    current = current.parent;
  }
  return undefined;
};

const conditionalCandidates = (expression: ts.Expression, checker: ts.TypeChecker): readonly ts.Declaration[] => {
  if (!ts.isIdentifier(expression)) return [];
  const symbol = checker.getSymbolAtLocation(expression);
  const variable = symbol?.declarations?.find(ts.isVariableDeclaration);
  if (variable?.initializer === undefined || !ts.isConditionalExpression(variable.initializer)) return [];
  return [variable.initializer.whenTrue, variable.initializer.whenFalse].flatMap((candidate) => {
    const candidateSymbol = checker.getSymbolAtLocation(candidate);
    return candidateSymbol?.declarations === undefined ? [] : [...candidateSymbol.declarations];
  });
};

const resolutionForCall = (
  node: ts.CallExpression | ts.NewExpression,
  checker: ts.TypeChecker,
  fragments: readonly FragmentRecord[],
  rootPath: string,
  filesByCompilerPath: ReadonlyMap<string, FileRecord>,
): { readonly resolution: ReferenceResolution; readonly evidence: RelationBridge['evidence'] } => {
  const expression = node.expression;
  const lookup = ts.isPropertyAccessExpression(expression) ? expression.name : expression;
  let resolvedSymbol = checker.getSymbolAtLocation(lookup);
  const evidence: { kind: 'type-checker' | 'alias' | 'call-signature'; detail: string }[] = [];
  if (resolvedSymbol !== undefined) {
    evidence.push({ kind: 'type-checker', detail: checker.symbolToString(resolvedSymbol) });
    if ((resolvedSymbol.flags & ts.SymbolFlags.Alias) !== 0) {
      resolvedSymbol = checker.getAliasedSymbol(resolvedSymbol);
      evidence.push({ kind: 'alias', detail: checker.symbolToString(resolvedSymbol) });
    }
  }

  const declarations = [
    ...(resolvedSymbol?.declarations ?? []),
    ...conditionalCandidates(expression, checker),
  ];
  const signatureDeclaration = checker.getResolvedSignature(node)?.getDeclaration();
  if (signatureDeclaration !== undefined) {
    declarations.push(signatureDeclaration);
    const signaturePath = signatureDeclaration.getSourceFile().fileName;
    evidence.push({
      kind: 'call-signature',
      detail: isPathInside(rootPath, signaturePath)
        ? normalizeRelativePath(relative(rootPath, signaturePath))
        : 'external declaration',
    });
  }

  const targetRecords = [...new Set(declarations.map((declaration) => fragmentForDeclaration(fragments, declaration)).filter((value): value is FragmentRecord => value !== undefined))];
  const candidates: RelationCandidate[] = targetRecords.map((record) => ({
    targetId: record.fragment.id,
    targetDefinition: {
      sourceFileId: record.fragment.sourceFileId,
      revision: record.fragment.provenance.revision,
      range: record.fragment.definitionRange,
    },
    label: record.fragment.qualifiedName,
  }));
  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.targetId, candidate])).values()];
  if (uniqueCandidates.length === 1) {
    const target = uniqueCandidates[0];
    if (target !== undefined) {
      return { resolution: { status: 'resolved', targetId: target.targetId, targetDefinition: target.targetDefinition, certainty: 'exact' }, evidence };
    }
  }
  if (uniqueCandidates.length > 1) {
    return { resolution: { status: 'ambiguous', candidates: uniqueCandidates, reason: 'TypeChecker exposed multiple callable declarations' }, evidence };
  }

  const externalDeclaration = declarations.find((declaration) => !isPathInside(rootPath, declaration.getSourceFile().fileName));
  if (externalDeclaration !== undefined || (resolvedSymbol !== undefined && declarations.length === 0)) {
    return {
      resolution: { status: 'external', endpoint: { kind: 'package', name: expression.getText() } },
      evidence,
    };
  }

  const sourceFileKnown = filesByCompilerPath.has(node.getSourceFile().fileName);
  const type = checker.getTypeAtLocation(expression);
  const reason = (type.flags & ts.TypeFlags.Any) !== 0 ? 'dynamic-dispatch' : sourceFileKnown ? 'unknown' : 'incomplete-project';
  return {
    resolution: { status: 'unresolved', reason, detail: `No project declaration for ${expression.getText()}` },
    evidence,
  };
};

const extractRelations = (
  files: readonly FileRecord[],
  fragments: readonly FragmentRecord[],
  loops: readonly LoopRegion[],
  checker: ts.TypeChecker,
  rootPath: string,
  projectLogicalId: string,
): readonly RelationBridge[] => {
  const relations: RelationBridge[] = [];
  const occurrences = new Map<string, number>();
  const filesByCompilerPath = new Map(files.map((file) => [file.compiler.fileName, file]));
  for (const file of files) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const owner = innermostFragment(fragments, file.compiler, node.getStart(file.compiler));
        if (owner !== undefined) {
          const callRange = rangeOf(node.expression, file.compiler);
          const resolved = resolutionForCall(node, checker, fragments, rootPath, filesByCompilerPath);
          const containingLoop = loops
            .filter((loop) => loop.body.sourceFileId === file.model.id && loop.body.range.start <= callRange.start && loop.body.range.end >= callRange.end)
            .sort((left, right) => (left.body.range.end - left.body.range.start) - (right.body.range.end - right.body.range.start))[0];
          const branchContext = nearestBranch(node, file.compiler);
          const kind = ts.isNewExpression(node) ? 'construct' : 'call';
          const callExpressionText = normalizedSyntax(node.getText(file.compiler));
          const callFingerprint = sha256(`${kind}:${callExpressionText}`).slice(0, 24);
          const lexicalPath = lexicalCallPath(node, owner.node);
          const occurrenceKey = `${owner.fragment.id}:${callFingerprint}`;
          const occurrence = occurrences.get(occurrenceKey) ?? 0;
          occurrences.set(occurrenceKey, occurrence + 1);
          const idInput = `v2:${projectLogicalId}:${owner.fragment.id}:${kind}:${callFingerprint}:${lexicalPath}`;
          relations.push({
            id: relationId(`relation:${sha256(idInput).slice(0, 24)}`),
            projectId: projectId(projectLogicalId),
            sourceFragmentId: owner.fragment.id,
            callSite: sourceAnchor(file.model, callRange),
            kind,
            resolution: resolved.resolution,
            ...(branchContext === undefined ? {} : { branchContext }),
            ...(containingLoop === undefined ? {} : { loopRegionId: containingLoop.id }),
            evidence: resolved.evidence,
            adapter: {
              adapterId: typescriptAdapterManifest.adapterId,
              adapterVersion: typescriptAdapterManifest.adapterVersion,
              coreApiVersion: CORE_API_VERSION,
            },
            identity: { recipeVersion: 2, callFingerprint, callExpressionText, occurrence, lexicalPath },
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file.compiler);
  }
  return relations;
};

const attachLoopFunctions = (loops: readonly LoopRegion[], relations: readonly RelationBridge[]): readonly LoopRegion[] =>
  loops.map((loop) => ({
    ...loop,
    bodyFunctionIds: [...new Set(relations
      .filter((relation) =>
        relation.callSite.sourceFileId === loop.body.sourceFileId &&
        relation.callSite.range.start >= loop.body.range.start &&
        relation.callSite.range.end <= loop.body.range.end &&
        relation.resolution.status === 'resolved')
      .map((relation) => relation.resolution.status === 'resolved' ? relation.resolution.targetId : undefined)
      .filter((value): value is FunctionFragment['id'] => value !== undefined))],
  }));

const diagnosticFromCompiler = (
  diagnostic: ts.Diagnostic,
  filesByCompilerPath: ReadonlyMap<string, FileRecord>,
): Diagnostic => {
  const file = diagnostic.file === undefined ? undefined : filesByCompilerPath.get(diagnostic.file.fileName);
  const start = diagnostic.start ?? 0;
  const length = diagnostic.length ?? 0;
  return {
    id: `diagnostic:ts:${diagnostic.code}:${file?.model.id ?? 'project'}:${start}`,
    code: `TS${diagnostic.code}`,
    severity: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
    phase: 'parse',
    scope: file === undefined ? 'project' : 'file',
    recoverability: 'skipped',
    ...(file === undefined ? {} : { source: sourceAnchor(file.model, { start, end: start + length }) }),
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  };
};

class TypeScriptSession implements AdapterSession {
  private files = new Map<string, FileRecord>();
  private fragments: readonly FragmentRecord[] = [];

  constructor(
    private readonly rootPath: string,
    private readonly projectLogicalId: string,
    private readonly configuration: string,
    private readonly host: AdapterHost,
    private readonly sessionSystem?: SecureTypeScriptSystem,
  ) {}

  async index(request: IndexRequest, sink: IndexEventSink, context: AdapterCallContext): Promise<IndexSummary> {
    if (context.signal.aborted) return { status: 'cancelled', filesIndexed: 0, diagnostics: [] };
    this.host.reportProgress({ phase: 'read', completed: 0, message: '读取 tsconfig.json' });
    await this.host.readFile(this.configuration);
    await yieldToEventLoop();
    if (context.signal.aborted) return { status: 'cancelled', filesIndexed: 0, diagnostics: [] };
    const secureSystem = this.sessionSystem ?? new SecureTypeScriptSystem(this.rootPath);
    const configPath = resolveInside(secureSystem.rootPath, this.configuration);
    const config = ts.readConfigFile(configPath, secureSystem.readFile);
    const configObject = typeof config.config === 'object' && config.config !== null ? config.config as Record<string, unknown> : {};
    const compilerOptionsObject = typeof configObject['compilerOptions'] === 'object' && configObject['compilerOptions'] !== null
      ? configObject['compilerOptions'] as Record<string, unknown>
      : {};
    const excludedCandidates = [
      ...(Array.isArray(configObject['exclude']) ? configObject['exclude'].filter((value): value is string => typeof value === 'string') : []),
      ...(typeof compilerOptionsObject['outDir'] === 'string' ? [compilerOptionsObject['outDir']] : []),
    ];
    const configuredExcludedDirectories = new Set(excludedCandidates.flatMap((candidate) => {
      const normalized = candidate.replaceAll('\\', '/').replace(/^\.\//, '');
      if (normalized.includes('*') || normalized.includes('?') || normalized.startsWith('../')) return [];
      const segments = normalized.split('/').filter((segment) => segment.length > 0);
      return segments.length === 1 && segments[0] !== undefined ? [segments[0]] : [];
    }));
    try {
      await secureSystem.prepareProjectFileIndex(context.signal, (completed) => this.host.reportProgress({
        phase: 'read',
        completed,
        message: `枚举受控项目文件 ${completed}`,
      }), configuredExcludedDirectories);
    } catch (error: unknown) {
      if (context.signal.aborted) return { status: 'cancelled', filesIndexed: 0, diagnostics: [] };
      throw error;
    }
    const diagnostics: Diagnostic[] = [];
    if (request.changedFiles !== undefined && request.changedFiles.length > 0) {
      diagnostics.push({
        id: 'diagnostic:incremental-unavailable',
        code: 'INCREMENTAL_UNAVAILABLE',
        severity: 'info',
        phase: 'read',
        scope: 'adapter',
        recoverability: 'retryable',
        message: 'This adapter reports incrementalUpdate=false; a full authorized re-index was used.',
      });
    }
    if (config.error !== undefined) {
      diagnostics.push(diagnosticFromCompiler(config.error, new Map()));
      sink.emit({ type: 'diagnostics', diagnostics });
      return { status: 'failed', filesIndexed: 0, diagnostics };
    }
    const parsed = ts.parseJsonConfigFileContent(config.config, secureSystem.createParseConfigHost(), dirname(configPath), undefined, configPath);
    await yieldToEventLoop();
    if (context.signal.aborted) return { status: 'cancelled', filesIndexed: 0, diagnostics };
    const program = ts.createProgram({
      rootNames: parsed.fileNames,
      options: parsed.options,
      host: secureSystem.createCompilerHost(parsed.options),
    });
    await yieldToEventLoop();
    if (context.signal.aborted) return { status: 'cancelled', filesIndexed: 0, diagnostics };
    const canonicalSourceFiles = new Set<string>();
    const compilerFiles = program.getSourceFiles().filter((file) => {
      if (file.isDeclarationFile || !isPathInside(this.rootPath, file.fileName) || (!file.fileName.endsWith('.ts') && !file.fileName.endsWith('.tsx'))) return false;
      const canonical = secureSystem.canonicalIdentity(file.fileName);
      if (canonical === undefined || canonicalSourceFiles.has(canonical)) return false;
      canonicalSourceFiles.add(canonical);
      return true;
    });

    const rawDiagnostics = [...parsed.errors, ...program.getConfigFileParsingDiagnostics(), ...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];
    const rawErrorFiles = new Set(rawDiagnostics.filter((item) => item.category === ts.DiagnosticCategory.Error).map((item) => item.file?.fileName).filter((value): value is string => value !== undefined));
    const now = this.host.now();
    const fileRecords = compilerFiles.map((compiler): FileRecord => {
      const content = compiler.getFullText();
      const projectRelativePath = normalizeRelativePath(relative(this.rootPath, compiler.fileName));
      const revision = this.host.hash(content);
      const model: SourceFile = {
        id: sourceFileId(`file:${this.host.hash(projectRelativePath).slice(0, 24)}`),
        projectId: projectId(this.projectLogicalId),
        projectRelativePath,
        languageId: 'typescript',
        revision,
        contentHash: revision,
        lineStarts: lineStarts(content),
        indexState: rawErrorFiles.has(compiler.fileName) ? 'partial' : 'indexed',
      };
      return { model, compiler, content };
    });
    this.files = new Map(fileRecords.map((file) => [file.model.id, file]));
    this.fragments = fileRecords.flatMap((file) => extractFragments(file, this.projectLogicalId, now));
    const symbolCounts = new Map<string, number>();
    this.fragments.forEach((record) => symbolCounts.set(record.fragment.id, (symbolCounts.get(record.fragment.id) ?? 0) + 1));
    const collisions = [...symbolCounts.entries()].filter(([, count]) => count > 1);
    if (collisions.length > 0) {
      const collisionDiagnostics: Diagnostic[] = collisions.map(([id], index) => ({
        id: `diagnostic:symbol-collision:${index}`,
        code: 'SYMBOL_ID_COLLISION',
        severity: 'error',
        phase: 'bind',
        scope: 'symbol',
        recoverability: 'fatal',
        message: `Stable symbol identity collision rejected: ${id}`,
      }));
      diagnostics.push(...collisionDiagnostics);
      sink.emit({ type: 'diagnostics', diagnostics: collisionDiagnostics });
      return { status: 'failed', filesIndexed: 0, diagnostics };
    }
    const initialLoops = extractLoops(fileRecords, this.fragments);
    const relations = extractRelations(fileRecords, this.fragments, initialLoops, program.getTypeChecker(), this.rootPath, this.projectLogicalId);
    const loops = attachLoopFunctions(initialLoops, relations);
    const filesByCompilerPath = new Map(fileRecords.map((file) => [file.compiler.fileName, file]));
    diagnostics.push(...rawDiagnostics.map((item) => diagnosticFromCompiler(item, filesByCompilerPath)));
    diagnostics.push(...secureSystem.violations.map(securityDiagnostic));

    for (const [index, file] of fileRecords.entries()) {
      if (context.signal.aborted) return { status: 'cancelled', filesIndexed: index, diagnostics };
      sink.emit({ type: 'file', file: file.model, content: file.content });
      sink.emit({ type: 'symbols', fileId: file.model.id, revision: file.model.revision, symbols: this.fragments.filter((record) => record.fragment.sourceFileId === file.model.id).map((record) => record.fragment) });
      sink.emit({ type: 'relations', fileId: file.model.id, revision: file.model.revision, relations: relations.filter((relation) => relation.callSite.sourceFileId === file.model.id) });
      sink.emit({ type: 'loops', fileId: file.model.id, revision: file.model.revision, loops: loops.filter((loop) => loop.source.sourceFileId === file.model.id) });
      sink.emit({ type: 'progress', progress: { phase: 'persist', completed: index + 1, total: fileRecords.length, message: `已索引 ${file.model.projectRelativePath}` } });
    }
    if (diagnostics.length > 0) sink.emit({ type: 'diagnostics', diagnostics });
    return {
      status: diagnostics.some((item) => item.severity === 'error') ? 'partial' : 'completed',
      filesIndexed: fileRecords.length,
      diagnostics,
    };
  }

  getSourceFragment(request: SourceFragmentRequest): Promise<SourceFragmentResult> {
    const file = this.files.get(request.anchor.sourceFileId);
    if (file === undefined) return Promise.resolve({ status: 'missing' });
    if (file.model.revision !== request.anchor.revision) return Promise.resolve({ status: 'stale', currentRevision: file.model.revision });
    const contextCharacters = request.contextCharacters ?? 160;
    const contextRange = {
      start: Math.max(0, request.anchor.range.start - contextCharacters),
      end: Math.min(file.content.length, request.anchor.range.end + contextCharacters),
    };
    return Promise.resolve({
      status: 'ok',
      projectRelativePath: file.model.projectRelativePath,
      revision: file.model.revision,
      requestedRange: request.anchor.range,
      contextRange,
      content: file.content.slice(contextRange.start, contextRange.end),
    });
  }

  relocateSymbols(request: RelocateRequest): Promise<readonly RelocationMatch[]> {
    return Promise.resolve(relocateFunctionFragments(request.previous, this.fragments.map((record) => record.fragment)));
  }

  dispose(): Promise<void> {
    this.files.clear();
    this.fragments = [];
    return Promise.resolve();
  }
}

export class TypeScriptLanguageAdapter implements LanguageAdapter {
  readonly manifest = typescriptAdapterManifest;
  private readonly rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = new SecureTypeScriptSystem(rootPath).rootPath;
  }

  getHealth(): AdapterHealth {
    return { status: 'healthy', checkedAt: new Date().toISOString() };
  }

  detectProject(request: { readonly candidateFiles: readonly string[] }, context: AdapterCallContext): Promise<DetectionResult> {
    if (context.signal.aborted) {
      return Promise.resolve({ status: 'failed', diagnostic: {
        id: 'diagnostic:detect:cancelled',
        code: 'ADAPTER_CANCELLED',
        severity: 'info',
        phase: 'detect',
        scope: 'adapter',
        recoverability: 'retryable',
        message: 'TypeScript project detection was cancelled',
      } });
    }
    const configurations = request.candidateFiles.filter((file) => file === 'tsconfig.json' || file.endsWith('/tsconfig.json'));
    const evidence: DetectionEvidence[] = request.candidateFiles
      .filter((file) => configurations.includes(file) || file.endsWith('.ts') || file.endsWith('.tsx'))
      .map((file) => ({ kind: configurations.includes(file) ? 'configuration' : 'extension', projectRelativePath: file }));
    if (configurations.length > 0) {
      return Promise.resolve({
        status: 'matched',
        confidence: configurations.includes('tsconfig.json') ? 'exact' : 'probable',
        evidence,
        configurations,
      });
    }
    if (evidence.length > 0) {
      return Promise.resolve({ status: 'limited', reason: 'TypeScript files found without tsconfig.json', evidence });
    }
    return Promise.resolve({ status: 'not-matched', evidence });
  }

  openSession(request: OpenSessionRequest, host: AdapterHost): Promise<AdapterSession> {
    return Promise.resolve(new TypeScriptSession(this.rootPath, request.projectId, request.configuration ?? 'tsconfig.json', host, hostSystems.get(host)));
  }
}

export type ProjectIndexOperationResult =
  | { readonly status: 'completed' | 'partial'; readonly snapshot: AdapterIndexSnapshot }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly message: string };

export const indexTypeScriptProjectOperation = async (
  rootPath: string,
  signal = new AbortController().signal,
  onProgress: (progress: IndexProgress) => void = () => undefined,
  changedFiles?: readonly string[],
): Promise<ProjectIndexOperationResult> => {
  if (signal.aborted) return { status: 'cancelled' };
  const host = createFileSystemAdapterHost(rootPath, onProgress, signal);
  const adapter = new TypeScriptLanguageAdapter(rootPath);
  const candidateFiles = await host.listFiles(typescriptAdapterManifest.detection.filePatterns);
  if (signal.aborted) return { status: 'cancelled' };
  const context: AdapterCallContext = { requestId: `index:${basename(rootPath)}`, generation: 1, signal };
  const detection = await adapter.detectProject({ candidateFiles }, context);
  const sourceFiles: SourceFile[] = [];
  const sourceContents: Record<string, string> = {};
  const fragments: FunctionFragment[] = [];
  const relations: RelationBridge[] = [];
  const loops: LoopRegion[] = [];
  const diagnostics: Diagnostic[] = [];
  if (detection.status !== 'matched') {
    return { status: 'failed', message: detection.status === 'limited' ? detection.reason : 'TypeScript project was not matched' };
  }
  const configuration = detection.configurations[0];
  const session = await adapter.openSession({
    projectId: `project:${sha256(resolve(rootPath)).slice(0, 20)}`,
    ...(configuration === undefined ? {} : { configuration }),
  }, host);
  const events: IndexEvent[] = [];
  let summary: IndexSummary;
  try {
    summary = await session.index(changedFiles === undefined ? {} : { changedFiles }, { emit: (event) => events.push(event) }, context);
  } finally {
    await session.dispose();
  }
  if (summary.status === 'cancelled') return { status: 'cancelled' };
  if (summary.status === 'failed') return { status: 'failed', message: summary.diagnostics[0]?.message ?? 'TypeScript indexing failed' };
  for (const event of events) {
    switch (event.type) {
      case 'file':
        sourceFiles.push(event.file);
        sourceContents[event.file.id] = event.content;
        break;
      case 'symbols':
        fragments.push(...event.symbols);
        break;
      case 'relations':
        relations.push(...event.relations);
        break;
      case 'loops':
        loops.push(...event.loops);
        break;
      case 'diagnostics':
        diagnostics.push(...event.diagnostics);
        break;
      case 'progress':
        break;
    }
  }
  const health: AdapterHealth = diagnostics.some((item) => item.severity === 'error')
    ? { status: 'degraded', checkedAt: host.now(), diagnostics }
    : adapter.getHealth();
  const snapshot = { manifest: adapter.manifest, health, detection, sourceFiles, sourceContents, fragments, relations, loops, diagnostics };
  return { status: summary.status, snapshot };
};

export const indexTypeScriptProject = async (
  rootPath: string,
  signal = new AbortController().signal,
  onProgress: (progress: IndexProgress) => void = () => undefined,
): Promise<AdapterIndexSnapshot> => {
  const result = await indexTypeScriptProjectOperation(rootPath, signal, onProgress);
  if (result.status === 'completed' || result.status === 'partial') return result.snapshot;
  throw new Error(result.status === 'failed' ? result.message : 'TypeScript indexing was cancelled');
};
