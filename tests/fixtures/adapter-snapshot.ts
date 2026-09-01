import type { AdapterIndexSnapshot } from '../../src/adapter-api/index.js';
import {
  projectId,
  relationId,
  sourceFileId,
  symbolId,
  type FunctionFragment,
  type RelationBridge,
  type SourceFile,
} from '../../src/model/index.js';

const content = `export function createOrder() {
  shipOrder();
  requestPayment();
}

export function shipOrder() {
  return 'shipped';
}

export function requestPayment() {
  return 'payment';
}
`;

const fileId = sourceFileId('file:test');
const project = projectId('project:test');
const revision = 'revision:test';
const createId = symbolId('symbol:createOrder');
const shipId = symbolId('symbol:shipOrder');
const requestId = symbolId('symbol:requestPayment');

const fragment = (id: typeof createId, name: string): FunctionFragment => {
  const signatureStart = content.indexOf(`function ${name}`);
  const declarationStart = signatureStart + 'function '.length;
  const fullStart = content.lastIndexOf('export function', declarationStart);
  const closing = content.indexOf('\n}', declarationStart);
  const fullEnd = closing + 2;
  return {
    id,
    sourceFileId: fileId,
    languageId: 'typescript',
    symbolKind: 'function',
    displayName: name,
    qualifiedName: name,
    fullRange: { start: fullStart, end: fullEnd },
    definitionRange: { start: declarationStart, end: declarationStart + name.length },
    bodyRange: { start: content.indexOf('{', declarationStart), end: fullEnd },
    identity: { recipeVersion: 1, signatureHash: `signature:${name}`, declarationFingerprint: `fingerprint:${name}` },
    provenance: {
      source: 'adapter', projectRelativePath: 'src/order.ts', revision,
      range: { start: fullStart, end: fullEnd },
      adapterId: 'xanadu.typescript', adapterVersion: '0.1.0', coreApiVersion: '1.0.0', generatedAt: '2026-09-01T00:00:00.000Z',
    },
  };
};

const fragments = [fragment(createId, 'createOrder'), fragment(shipId, 'shipOrder'), fragment(requestId, 'requestPayment')];
const sourceFile: SourceFile = {
  id: fileId, projectId: project, projectRelativePath: 'src/order.ts', languageId: 'typescript', revision,
  contentHash: revision, lineStarts: [0], indexState: 'indexed',
};

const relation = (id: string, call: string, targetId: typeof createId, arm: 'A' | 'B'): RelationBridge => {
  const target = fragments.find((item) => item.id === targetId);
  if (target === undefined) throw new Error('target missing');
  const callStart = content.indexOf(call);
  return {
    id: relationId(id), projectId: project, sourceFragmentId: createId,
    callSite: { sourceFileId: fileId, revision, range: { start: callStart, end: callStart + call.length } },
    kind: 'call',
    resolution: { status: 'resolved', targetId, targetDefinition: { sourceFileId: fileId, revision, range: target.definitionRange }, certainty: 'exact' },
    branchContext: { branchId: 'branch:paid', condition: 'order.paid', arm, label: arm === 'A' ? 'order.paid = true' : 'order.paid = false' },
    evidence: [{ kind: 'type-checker', detail: target.displayName }],
    adapter: { adapterId: 'xanadu.typescript', adapterVersion: '0.1.0', coreApiVersion: '1.0.0' },
    identity: { recipeVersion: 1, callFingerprint: `call:${call}`, occurrence: 0 },
  };
};

export const testSnapshot: AdapterIndexSnapshot = {
  manifest: {
    adapterId: 'xanadu.typescript', displayName: 'TypeScript', adapterVersion: '0.1.0', compilerVersion: '6.0.3', coreApiRange: '^1.0.0', dtoSchemaVersion: 1,
    languages: [{ languageId: 'typescript', displayName: 'TypeScript', filePatterns: ['**/*.ts'] }],
    detection: { projectFiles: ['tsconfig.json'], filePatterns: ['**/*.ts'] },
    capabilities: { symbols: 'semantic', references: 'semantic', controlFlow: true, loops: true, stableIds: 'relocatable', incrementalUpdate: false, externalEndpoints: true },
    runtime: { kind: 'bundled-node', entrypoint: 'adapter-typescript/index.js' },
  },
  health: { status: 'healthy', checkedAt: '2026-09-01T00:00:00.000Z' },
  detection: { status: 'matched', confidence: 'exact', evidence: [{ kind: 'configuration', projectRelativePath: 'tsconfig.json' }], configurations: ['tsconfig.json'] },
  sourceFiles: [sourceFile], sourceContents: { [fileId]: content }, fragments,
  relations: [relation('relation:ship', 'shipOrder', shipId, 'A'), relation('relation:payment', 'requestPayment', requestId, 'B')],
  loops: [], diagnostics: [],
};
