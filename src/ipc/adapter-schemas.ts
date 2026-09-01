import { z } from 'zod';
import type { AdapterIndexSnapshot } from '../adapter-api/index.js';

export const isSafeProjectRelativePath = (value: string): boolean => {
  if (value.length === 0 || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\')) return false;
  return !value.split(/[\\/]+/).some((segment) => segment === '..');
};

const idSchema = z.string().min(1).max(300);
const revisionSchema = z.string().min(1).max(300);
const relativePathSchema = z.string().min(1).refine(isSafeProjectRelativePath, 'Path must stay inside the workspace');
const rangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
}).superRefine((range, context) => {
  if (range.end < range.start) context.addIssue({ code: 'custom', message: 'Invalid half-open range' });
});
const anchorSchema = z.object({ sourceFileId: idSchema, revision: revisionSchema, range: rangeSchema });
const adapterProvenanceSchema = z.object({ adapterId: idSchema, adapterVersion: idSchema, coreApiVersion: idSchema });
const provenanceSchema = adapterProvenanceSchema.extend({
  source: z.enum(['adapter', 'user']),
  projectRelativePath: relativePathSchema,
  revision: revisionSchema,
  range: rangeSchema,
  generatedAt: z.string().datetime(),
});
const sourceFileSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  projectRelativePath: relativePathSchema,
  languageId: idSchema,
  revision: revisionSchema,
  contentHash: idSchema,
  lineStarts: z.array(z.number().int().nonnegative()),
  indexState: z.enum(['pending', 'indexed', 'partial', 'failed', 'stale']),
});
const fragmentSchema = z.object({
  id: idSchema,
  sourceFileId: idSchema,
  languageId: idSchema,
  symbolKind: z.enum(['function', 'method', 'constructor', 'accessor']),
  displayName: z.string().min(1),
  qualifiedName: z.string().min(1),
  fullRange: rangeSchema,
  definitionRange: rangeSchema,
  bodyRange: rangeSchema.optional(),
  provenance: provenanceSchema,
});
const candidateSchema = z.object({ targetId: idSchema, targetDefinition: anchorSchema, label: z.string().min(1) });
const resolutionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('resolved'), targetId: idSchema, targetDefinition: anchorSchema, certainty: z.enum(['exact', 'probable']) }),
  z.object({ status: z.literal('ambiguous'), candidates: z.array(candidateSchema).min(1), reason: z.string().min(1) }),
  z.object({ status: z.literal('unresolved'), reason: z.enum(['dynamic-dispatch', 'missing-file', 'unsupported-syntax', 'incomplete-project', 'adapter-error', 'unknown']), detail: z.string().optional() }),
  z.object({ status: z.literal('external'), endpoint: z.object({ kind: z.enum(['package', 'platform', 'service', 'unknown']), name: z.string().min(1) }) }),
  z.object({ status: z.literal('stale'), previousTarget: anchorSchema.optional(), reason: z.enum(['source-revision-changed', 'target-missing', 'relocation-ambiguous']) }),
]);
const relationSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  sourceFragmentId: idSchema,
  callSite: anchorSchema,
  kind: z.enum(['call', 'construct', 'import', 'implementation', 'inheritance', 'manual']),
  resolution: resolutionSchema,
  branchContext: z.object({ branchId: idSchema, condition: z.string(), arm: z.enum(['A', 'B']), label: z.string() }).optional(),
  loopRegionId: idSchema.optional(),
  evidence: z.array(z.object({ kind: z.enum(['type-checker', 'alias', 'call-signature', 'manual', 'revision']), detail: z.string() })),
  adapter: adapterProvenanceSchema,
});
const controlEdgeSchema = z.object({ id: idSchema, kind: z.enum(['entry', 'back', 'continue']), source: anchorSchema, target: anchorSchema });
const exitEdgeSchema = z.object({ id: idSchema, reason: z.enum(['condition-false', 'break', 'return', 'throw', 'normal-function-exit']), source: anchorSchema, target: anchorSchema.optional() });
const estimateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('upper-bound'), value: z.number().int().nonnegative(), proofRange: anchorSchema }),
  z.object({ kind: z.literal('expression'), expression: z.string().min(1), source: anchorSchema }),
  z.object({ kind: z.literal('unknown') }),
]);
const loopSchema = z.object({
  id: idSchema,
  ownerFragmentId: idSchema,
  kind: z.enum(['for', 'while', 'do-while', 'for-of', 'for-in', 'control-flow-cycle']),
  source: anchorSchema,
  condition: anchorSchema.optional(),
  body: anchorSchema,
  bodyFunctionIds: z.array(idSchema),
  entryEdges: z.array(controlEdgeSchema).min(1),
  backEdges: z.array(controlEdgeSchema).min(1),
  continueEdges: z.array(controlEdgeSchema),
  exitEdges: z.array(exitEdgeSchema).min(1),
  iterationEstimate: estimateSchema,
});
const diagnosticSchema = z.object({
  id: idSchema,
  code: idSchema,
  severity: z.enum(['info', 'warning', 'error']),
  phase: z.enum(['detect', 'read', 'parse', 'bind', 'resolve', 'persist', 'render']),
  scope: z.enum(['project', 'adapter', 'file', 'symbol', 'relation']),
  recoverability: z.enum(['retryable', 'skipped', 'requires-user-action', 'fatal']),
  source: anchorSchema.optional(),
  message: z.string(),
  causeCode: z.string().optional(),
});
const manifestSchema = z.object({
  adapterId: idSchema,
  displayName: z.string().min(1),
  adapterVersion: idSchema,
  compilerVersion: idSchema,
  coreApiRange: idSchema,
  dtoSchemaVersion: z.literal(1),
  languages: z.array(z.object({ languageId: idSchema, displayName: z.string(), filePatterns: z.array(z.string()) })).min(1),
  detection: z.object({ projectFiles: z.array(z.string()), filePatterns: z.array(z.string()) }),
  capabilities: z.object({
    symbols: z.enum(['none', 'syntax', 'semantic']),
    references: z.enum(['none', 'syntax', 'semantic']),
    controlFlow: z.boolean(), loops: z.boolean(), stableIds: z.enum(['declaration', 'relocatable']),
    incrementalUpdate: z.boolean(), externalEndpoints: z.boolean(),
  }),
  runtime: z.object({ kind: z.literal('bundled-node'), entrypoint: relativePathSchema }),
});
const healthSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('healthy'), checkedAt: z.string().datetime() }),
  z.object({ status: z.literal('degraded'), checkedAt: z.string().datetime(), diagnostics: z.array(diagnosticSchema) }),
  z.object({ status: z.literal('limited'), checkedAt: z.string().datetime(), reason: z.string() }),
]);
const evidenceSchema = z.object({ kind: z.enum(['configuration', 'extension', 'manifest']), projectRelativePath: relativePathSchema });
const detectionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('matched'), confidence: z.enum(['exact', 'probable']), evidence: z.array(evidenceSchema), configurations: z.array(relativePathSchema) }),
  z.object({ status: z.literal('not-matched'), evidence: z.array(evidenceSchema) }),
  z.object({ status: z.literal('limited'), reason: z.string(), evidence: z.array(evidenceSchema) }),
  z.object({ status: z.literal('failed'), diagnostic: diagnosticSchema }),
]);

export const adapterIndexSnapshotSchema = z.object({
  manifest: manifestSchema,
  health: healthSchema,
  detection: detectionSchema,
  sourceFiles: z.array(sourceFileSchema),
  sourceContents: z.record(idSchema, z.string()),
  fragments: z.array(fragmentSchema),
  relations: z.array(relationSchema),
  loops: z.array(loopSchema),
  diagnostics: z.array(diagnosticSchema),
}).superRefine((snapshot, context) => {
  const files = new Map(snapshot.sourceFiles.map((file) => [file.id, file]));
  const fragments = new Map(snapshot.fragments.map((fragment) => [fragment.id, fragment]));
  const validateAnchor = (anchor: z.infer<typeof anchorSchema>, label: string): void => {
    const file = files.get(anchor.sourceFileId);
    const content = snapshot.sourceContents[anchor.sourceFileId];
    if (file === undefined || content === undefined || file.revision !== anchor.revision || anchor.range.end > content.length) {
      context.addIssue({ code: 'custom', message: `Invalid ${label} anchor` });
    }
  };
  for (const key of Object.keys(snapshot.sourceContents)) {
    if (!files.has(key)) context.addIssue({ code: 'custom', message: 'Source content key has no SourceFile' });
  }
  for (const fragment of snapshot.fragments) {
    const file = files.get(fragment.sourceFileId);
    if (file === undefined || file.projectRelativePath !== fragment.provenance.projectRelativePath || file.revision !== fragment.provenance.revision) {
      context.addIssue({ code: 'custom', message: 'Fragment provenance does not match SourceFile' });
    }
    validateAnchor({ sourceFileId: fragment.sourceFileId, revision: fragment.provenance.revision, range: fragment.fullRange }, 'fragment');
    if (fragment.definitionRange.start < fragment.fullRange.start || fragment.definitionRange.end > fragment.fullRange.end) {
      context.addIssue({ code: 'custom', message: 'Definition range must be inside fragment range' });
    }
  }
  for (const relation of snapshot.relations) {
    if (!fragments.has(relation.sourceFragmentId)) context.addIssue({ code: 'custom', message: 'Relation source fragment is missing' });
    validateAnchor(relation.callSite, 'call-site');
    if (relation.resolution.status === 'resolved') {
      if (!fragments.has(relation.resolution.targetId)) context.addIssue({ code: 'custom', message: 'Resolved target is missing' });
      validateAnchor(relation.resolution.targetDefinition, 'target-definition');
    } else if (relation.resolution.status === 'ambiguous') {
      relation.resolution.candidates.forEach((candidate) => validateAnchor(candidate.targetDefinition, 'candidate'));
    }
  }
  for (const loop of snapshot.loops) {
    if (!fragments.has(loop.ownerFragmentId)) context.addIssue({ code: 'custom', message: 'Loop owner is missing' });
    [loop.source, loop.condition, loop.body].filter((anchor): anchor is z.infer<typeof anchorSchema> => anchor !== undefined).forEach((anchor) => validateAnchor(anchor, 'loop'));
    [...loop.entryEdges, ...loop.backEdges, ...loop.continueEdges].forEach((edge) => { validateAnchor(edge.source, 'loop-edge'); validateAnchor(edge.target, 'loop-edge'); });
    loop.exitEdges.forEach((edge) => { validateAnchor(edge.source, 'loop-exit'); if (edge.target !== undefined) validateAnchor(edge.target, 'loop-exit'); });
  }
});

export const parseAdapterIndexSnapshot = (value: unknown): AdapterIndexSnapshot =>
  adapterIndexSnapshotSchema.parse(value) as unknown as AdapterIndexSnapshot;
