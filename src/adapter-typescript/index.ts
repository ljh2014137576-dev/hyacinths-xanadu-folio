import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import ts from '@typescript/typescript6';
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
    incrementalUpdate: true,
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

const collectFiles = async (rootPath: string): Promise<readonly string[]> => {
  const collected: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name === 'tsconfig.json')) {
        collected.push(normalizeRelativePath(relative(rootPath, absolutePath)));
      }
    }
  };
  await visit(rootPath);
  return collected.sort();
};

export const createFileSystemAdapterHost = (rootPath: string): AdapterHost => ({
  listFiles: () => collectFiles(rootPath),
  readFile: async (projectRelativePath, expectedRevision) => {
    const content = await fs.readFile(resolveInside(rootPath, projectRelativePath), 'utf8');
    const revision = sha256(content);
    if (expectedRevision !== undefined && expectedRevision !== revision) throw new Error('Source revision changed');
    return { content, revision };
  },
  now: () => new Date().toISOString(),
  hash: sha256,
  reportProgress: () => undefined,
});

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
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent)) {
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

const qualifiedName = (node: ts.Node, name: string): string => {
  const containers: string[] = [];
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isClassDeclaration(current) && current.name !== undefined) containers.unshift(current.name.text);
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
        const fullNode = (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent)
          ? node.parent
          : node;
        const fullRange = rangeOf(fullNode, file.compiler);
        const body = 'body' in node && node.body !== undefined ? rangeOf(node.body, file.compiler) : undefined;
        const qualified = qualifiedName(node, named.name);
        const idInput = `${projectLogicalId}:${file.model.projectRelativePath}:${qualified}:${node.parameters.length}:${fullRange.start}`;
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
  if (
    ts.isForStatement(node) &&
    node.initializer !== undefined &&
    ts.isVariableDeclarationList(node.initializer) &&
    node.initializer.declarations.length === 1 &&
    node.condition !== undefined &&
    ts.isBinaryExpression(node.condition) &&
    (node.condition.operatorToken.kind === ts.SyntaxKind.LessThanToken || node.condition.operatorToken.kind === ts.SyntaxKind.LessThanEqualsToken) &&
    ts.isNumericLiteral(node.condition.right)
  ) {
    const declaration = node.initializer.declarations[0];
    const initial = declaration?.initializer;
    if (initial !== undefined && ts.isNumericLiteral(initial)) {
      const inclusive = node.condition.operatorToken.kind === ts.SyntaxKind.LessThanEqualsToken ? 1 : 0;
      const value = Math.max(0, Number(node.condition.right.text) - Number(initial.text) + inclusive);
      return { kind: 'upper-bound', value, proofRange: sourceAnchor(file.model, rangeOf(node, file.compiler)) };
    }
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
  conditionAnchor: SourceAnchor,
): { readonly continueEdges: readonly LoopControlEdge[]; readonly exitEdges: readonly LoopExitEdge[] } => {
  const continueEdges: LoopControlEdge[] = [];
  const exitEdges: LoopExitEdge[] = [];
  const visit = (current: ts.Node): void => {
    if (current !== node.statement && ts.isFunctionLike(current)) return;
    if (current !== node.statement && ts.isIterationStatement(current, false)) return;
    const currentAnchor = sourceAnchor(file.model, rangeOf(current, file.compiler));
    if (ts.isContinueStatement(current)) {
      continueEdges.push({ id: `${loopId}:continue:${current.pos}`, kind: 'continue', source: currentAnchor, target: conditionAnchor });
      return;
    }
    if (ts.isBreakStatement(current)) {
      exitEdges.push({ id: `${loopId}:break:${current.pos}`, reason: 'break', source: currentAnchor });
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
    ts.forEachChild(current, visit);
  };
  visit(node.statement);
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
          const control = extractLoopControl(node, file, id, conditionAnchor);
          const source = sourceAnchor(file.model, rangeOf(node, file.compiler));
          loops.push({
            id: loopRegionId(id),
            ownerFragmentId: owner.fragment.id,
            kind: loopKind(node),
            source,
            ...(condition === undefined ? {} : { condition: conditionAnchor }),
            body: bodyAnchor,
            bodyFunctionIds: [],
            entryEdges: [{ id: `${id}:entry`, kind: 'entry', source, target: conditionAnchor }],
            backEdges: [{ id: `${id}:back`, kind: 'back', source: bodyAnchor, target: conditionAnchor }],
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
    evidence.push({ kind: 'call-signature', detail: signatureDeclaration.getSourceFile().fileName });
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
          const idInput = `${projectLogicalId}:${file.model.projectRelativePath}:${callRange.start}:${node.kind}`;
          relations.push({
            id: relationId(`relation:${sha256(idInput).slice(0, 24)}`),
            projectId: projectId(projectLogicalId),
            sourceFragmentId: owner.fragment.id,
            callSite: sourceAnchor(file.model, callRange),
            kind: ts.isNewExpression(node) ? 'construct' : 'call',
            resolution: resolved.resolution,
            ...(branchContext === undefined ? {} : { branchContext }),
            ...(containingLoop === undefined ? {} : { loopRegionId: containingLoop.id }),
            evidence: resolved.evidence,
            adapter: {
              adapterId: typescriptAdapterManifest.adapterId,
              adapterVersion: typescriptAdapterManifest.adapterVersion,
              coreApiVersion: CORE_API_VERSION,
            },
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
  ) {}

  async index(_request: IndexRequest, sink: IndexEventSink, context: AdapterCallContext): Promise<IndexSummary> {
    if (context.signal.aborted) return { status: 'cancelled', filesIndexed: 0, diagnostics: [] };
    this.host.reportProgress({ phase: 'read', completed: 0, message: '读取 tsconfig.json' });
    await this.host.readFile(this.configuration);
    const configPath = resolveInside(this.rootPath, this.configuration);
    const config = ts.readConfigFile(configPath, (fileName) => ts.sys.readFile(fileName));
    const diagnostics: Diagnostic[] = [];
    if (config.error !== undefined) {
      diagnostics.push(diagnosticFromCompiler(config.error, new Map()));
      sink.emit({ type: 'diagnostics', diagnostics });
      return { status: 'failed', filesIndexed: 0, diagnostics };
    }
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath), undefined, configPath);
    const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
    const compilerFiles = program.getSourceFiles().filter((file) =>
      !file.isDeclarationFile && isPathInside(this.rootPath, file.fileName) && (file.fileName.endsWith('.ts') || file.fileName.endsWith('.tsx')));

    const rawDiagnostics = [...program.getConfigFileParsingDiagnostics(), ...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];
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
    const initialLoops = extractLoops(fileRecords, this.fragments);
    const relations = extractRelations(fileRecords, this.fragments, initialLoops, program.getTypeChecker(), this.rootPath, this.projectLogicalId);
    const loops = attachLoopFunctions(initialLoops, relations);
    const filesByCompilerPath = new Map(fileRecords.map((file) => [file.compiler.fileName, file]));
    diagnostics.push(...rawDiagnostics.map((item) => diagnosticFromCompiler(item, filesByCompilerPath)));

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
    const currentIds = new Set(this.fragments.map((record) => record.fragment.id));
    return Promise.resolve(request.previous.map((previous) => currentIds.has(symbolId(previous.symbolId))
      ? { status: 'matched', previousId: previous.symbolId, currentId: previous.symbolId, certainty: 'exact', evidence: ['stable declaration fingerprint'] }
      : { status: 'missing', previousId: previous.symbolId }));
  }

  dispose(): Promise<void> {
    this.files.clear();
    this.fragments = [];
    return Promise.resolve();
  }
}

export class TypeScriptLanguageAdapter implements LanguageAdapter {
  readonly manifest = typescriptAdapterManifest;

  constructor(private readonly rootPath: string) {}

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
    const evidence: DetectionEvidence[] = request.candidateFiles
      .filter((file) => file === 'tsconfig.json' || file.endsWith('.ts') || file.endsWith('.tsx'))
      .map((file) => ({ kind: file === 'tsconfig.json' ? 'configuration' : 'extension', projectRelativePath: file }));
    if (request.candidateFiles.includes('tsconfig.json')) {
      return Promise.resolve({ status: 'matched', confidence: 'exact', evidence, configurations: ['tsconfig.json'] });
    }
    if (evidence.length > 0) {
      return Promise.resolve({ status: 'limited', reason: 'TypeScript files found without tsconfig.json', evidence });
    }
    return Promise.resolve({ status: 'not-matched', evidence });
  }

  openSession(request: OpenSessionRequest, host: AdapterHost): Promise<AdapterSession> {
    return Promise.resolve(new TypeScriptSession(this.rootPath, request.projectId, request.configuration ?? 'tsconfig.json', host));
  }
}

export const indexTypeScriptProject = async (rootPath: string, signal = new AbortController().signal): Promise<AdapterIndexSnapshot> => {
  const host = createFileSystemAdapterHost(rootPath);
  const adapter = new TypeScriptLanguageAdapter(rootPath);
  const candidateFiles = await host.listFiles(typescriptAdapterManifest.detection.filePatterns);
  const context: AdapterCallContext = { requestId: `index:${basename(rootPath)}`, generation: 1, signal };
  const detection = await adapter.detectProject({ candidateFiles }, context);
  const sourceFiles: SourceFile[] = [];
  const sourceContents: Record<string, string> = {};
  const fragments: FunctionFragment[] = [];
  const relations: RelationBridge[] = [];
  const loops: LoopRegion[] = [];
  const diagnostics: Diagnostic[] = [];
  if (detection.status !== 'matched') {
    return { manifest: adapter.manifest, health: adapter.getHealth(), detection, sourceFiles, sourceContents, fragments, relations, loops, diagnostics };
  }
  const configuration = detection.configurations[0];
  const session = await adapter.openSession({
    projectId: `project:${sha256(resolve(rootPath)).slice(0, 20)}`,
    ...(configuration === undefined ? {} : { configuration }),
  }, host);
  const events: IndexEvent[] = [];
  try {
    await session.index({}, { emit: (event) => events.push(event) }, context);
  } finally {
    await session.dispose();
  }
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
  return { manifest: adapter.manifest, health, detection, sourceFiles, sourceContents, fragments, relations, loops, diagnostics };
};
