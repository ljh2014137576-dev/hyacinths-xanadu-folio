import { z } from 'zod';

type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type ProjectId = Brand<string, 'ProjectId'>;
export type SourceFileId = Brand<string, 'SourceFileId'>;
export type SymbolId = Brand<string, 'SymbolId'>;
export type RelationId = Brand<string, 'RelationId'>;
export type LoopRegionId = Brand<string, 'LoopRegionId'>;
export type FlowPageId = Brand<string, 'FlowPageId'>;
export type BusinessNodeId = Brand<string, 'BusinessNodeId'>;

export const projectId = (value: string): ProjectId => value as ProjectId;
export const sourceFileId = (value: string): SourceFileId => value as SourceFileId;
export const symbolId = (value: string): SymbolId => value as SymbolId;
export const relationId = (value: string): RelationId => value as RelationId;
export const loopRegionId = (value: string): LoopRegionId => value as LoopRegionId;
export const flowPageId = (value: string): FlowPageId => value as FlowPageId;
export const businessNodeId = (value: string): BusinessNodeId => value as BusinessNodeId;

export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export interface SourceAnchor {
  readonly sourceFileId: SourceFileId;
  readonly revision: string;
  readonly range: TextRange;
}

export interface AdapterProvenance {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly coreApiVersion: string;
}

export interface Provenance extends AdapterProvenance {
  readonly source: 'adapter' | 'user';
  readonly projectRelativePath: string;
  readonly revision: string;
  readonly range: TextRange;
  readonly generatedAt: string;
}

export type IndexState = 'pending' | 'indexed' | 'partial' | 'failed' | 'stale';

export interface SourceFile {
  readonly id: SourceFileId;
  readonly projectId: ProjectId;
  readonly projectRelativePath: string;
  readonly languageId: string;
  readonly revision: string;
  readonly contentHash: string;
  readonly lineStarts: readonly number[];
  readonly indexState: IndexState;
}

export type SymbolKind = 'function' | 'method' | 'constructor' | 'accessor';

export interface FunctionFragment {
  readonly id: SymbolId;
  readonly sourceFileId: SourceFileId;
  readonly languageId: string;
  readonly symbolKind: SymbolKind;
  readonly displayName: string;
  readonly qualifiedName: string;
  readonly fullRange: TextRange;
  readonly definitionRange: TextRange;
  readonly bodyRange?: TextRange;
  readonly identity: {
    readonly recipeVersion: 1 | 2;
    readonly signatureHash: string;
    readonly declarationFingerprint: string;
    readonly lexicalFingerprint?: string;
    readonly containerFingerprint?: string;
    readonly lexicalParentFingerprint?: string;
    readonly containerSemanticFingerprint?: string;
  };
  readonly provenance: Provenance;
}

export interface ResolutionEvidence {
  readonly kind: 'type-checker' | 'alias' | 'call-signature' | 'manual' | 'revision';
  readonly detail: string;
}

export interface RelationCandidate {
  readonly targetId: SymbolId;
  readonly targetDefinition: SourceAnchor;
  readonly label: string;
}

export interface ExternalEndpoint {
  readonly kind: 'package' | 'platform' | 'service' | 'unknown';
  readonly name: string;
}

export type UnresolvedReason =
  | 'dynamic-dispatch'
  | 'missing-file'
  | 'unsupported-syntax'
  | 'incomplete-project'
  | 'adapter-error'
  | 'unknown';

export type ReferenceResolution =
  | {
      readonly status: 'resolved';
      readonly targetId: SymbolId;
      readonly targetDefinition: SourceAnchor;
      readonly certainty: 'exact' | 'probable';
    }
  | {
      readonly status: 'ambiguous';
      readonly candidates: readonly RelationCandidate[];
      readonly reason: string;
    }
  | {
      readonly status: 'unresolved';
      readonly reason: UnresolvedReason;
      readonly detail?: string;
    }
  | {
      readonly status: 'external';
      readonly endpoint: ExternalEndpoint;
    }
  | {
      readonly status: 'stale';
      readonly previousTarget?: SourceAnchor;
      readonly reason: 'source-revision-changed' | 'target-missing' | 'relocation-ambiguous';
    };

export interface BranchContext {
  readonly branchId: string;
  readonly condition: string;
  readonly arm: 'A' | 'B';
  readonly label: string;
}

export interface RelationBridge {
  readonly id: RelationId;
  readonly projectId: ProjectId;
  readonly sourceFragmentId: SymbolId;
  readonly callSite: SourceAnchor;
  readonly kind: 'call' | 'construct' | 'import' | 'implementation' | 'inheritance' | 'manual';
  readonly resolution: ReferenceResolution;
  readonly branchContext?: BranchContext;
  readonly loopRegionId?: LoopRegionId;
  readonly evidence: readonly ResolutionEvidence[];
  readonly adapter: AdapterProvenance;
  readonly identity: {
    readonly recipeVersion: 1 | 2;
    readonly callFingerprint: string;
    readonly callExpressionText?: string;
    readonly occurrence: number;
    readonly lexicalPath?: string;
  };
}

export type IterationEstimate =
  | { readonly kind: 'upper-bound'; readonly value: number; readonly proofRange: SourceAnchor }
  | { readonly kind: 'expression'; readonly expression: string; readonly source: SourceAnchor }
  | { readonly kind: 'unknown' };

export interface LoopControlEdge {
  readonly id: string;
  readonly kind: 'entry' | 'back' | 'continue';
  readonly source: SourceAnchor;
  readonly target: SourceAnchor;
}

export type LoopExitReason =
  | 'condition-false'
  | 'break'
  | 'return'
  | 'throw'
  | 'normal-function-exit';

export interface LoopExitEdge {
  readonly id: string;
  readonly reason: LoopExitReason;
  readonly source: SourceAnchor;
  readonly target?: SourceAnchor;
}

export interface LoopRegion {
  readonly id: LoopRegionId;
  readonly ownerFragmentId: SymbolId;
  readonly kind: 'for' | 'while' | 'do-while' | 'for-of' | 'for-in' | 'control-flow-cycle';
  readonly source: SourceAnchor;
  readonly condition?: SourceAnchor;
  readonly body: SourceAnchor;
  readonly bodyFunctionIds: readonly SymbolId[];
  readonly entryEdges: readonly LoopControlEdge[];
  readonly backEdges: readonly LoopControlEdge[];
  readonly continueEdges: readonly LoopControlEdge[];
  readonly exitEdges: readonly LoopExitEdge[];
  readonly iterationEstimate: IterationEstimate;
}

export interface Diagnostic {
  readonly id: string;
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly phase: 'detect' | 'read' | 'parse' | 'bind' | 'resolve' | 'persist' | 'render';
  readonly scope: 'project' | 'adapter' | 'file' | 'symbol' | 'relation';
  readonly recoverability: 'retryable' | 'skipped' | 'requires-user-action' | 'fatal';
  readonly source?: SourceAnchor;
  readonly message: string;
  readonly causeCode?: string;
}

export interface FlowPlacement {
  readonly id: string;
  readonly kind: 'function' | 'business-node' | 'cycle';
  readonly targetId: SymbolId | BusinessNodeId;
  readonly depth: number;
  readonly order: number;
  readonly collapsed: boolean;
  readonly viaRelationId?: RelationId;
  readonly cycleTargetPlacementId?: string;
}

export type BranchViewFilter =
  | { readonly mode: 'show-all' }
  | { readonly mode: 'only'; readonly branchId: string; readonly arm: 'A' | 'B' };

export interface HiddenContentSummary {
  readonly hiddenBranches: number;
  readonly hiddenRelations: number;
  readonly restoreAvailable: boolean;
}

export interface FlowViewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface FlowPage {
  readonly id: FlowPageId;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly entry: { readonly kind: 'function' | 'file' | 'business-node'; readonly id: string };
  readonly projectionRevision: string;
  readonly placements: readonly FlowPlacement[];
  readonly expandedRelations: readonly RelationId[];
  readonly collapsedRegions: readonly string[];
  readonly branchFilter: BranchViewFilter;
  readonly viewport: FlowViewport;
  readonly mode: 'standard' | 'immersive';
  readonly hiddenSummary: HiddenContentSummary;
  readonly selectedRelationId?: RelationId;
}

export interface BusinessNodeProvenance {
  readonly definitionPath: string;
  readonly createdBy: 'local-user';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BusinessNode {
  readonly id: BusinessNodeId;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly description?: string;
  readonly members: readonly { readonly fragmentId: SymbolId; readonly order: number }[];
  readonly presentation: { readonly collapsedByDefault: boolean };
  readonly provenance: BusinessNodeProvenance;
}

export interface UserWorkspaceState {
  readonly schemaVersion: 1;
  readonly flowPages: readonly FlowPage[];
  readonly businessNodes: readonly BusinessNode[];
  readonly recentFlowPageIds: readonly FlowPageId[];
  readonly pendingMigrations?: readonly PendingAssetMigration[];
  readonly staleAssets?: readonly StaleAsset[];
}

export interface PendingAssetMigration {
  readonly id: string;
  readonly kind: 'symbol' | 'relation';
  readonly status: 'ambiguous' | 'missing';
  readonly previousId: string;
  readonly candidates: readonly string[];
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface StaleAsset {
  readonly id: string;
  readonly kind: 'symbol' | 'relation';
  readonly previousId: string;
  readonly provenance: 'previous-index';
  readonly evidence: readonly string[];
  readonly keptAt: string;
}

const rangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
}).superRefine((range, context) => {
  if (range.end < range.start) {
    context.addIssue({ code: 'custom', message: 'Range end must not precede range start' });
  }
});

const relativePathSchema = z.string().min(1).refine((value) =>
  !/^[A-Za-z]:[\\/]/.test(value) && !value.startsWith('/') && !value.startsWith('\\') && !value.split(/[\\/]+/).some((segment) => segment === '..'),
'Path must stay inside the workspace');

const anchorSchema = z.object({
  sourceFileId: z.string().min(1),
  revision: z.string().min(1),
  range: rangeSchema,
});

const relationIdSchema = z.string().min(1);

export const flowPageSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  entry: z.object({ kind: z.enum(['function', 'file', 'business-node']), id: z.string().min(1) }),
  projectionRevision: z.string().min(1),
  placements: z.array(z.object({
    id: z.string().min(1),
    kind: z.enum(['function', 'business-node', 'cycle']),
    targetId: z.string().min(1),
    depth: z.number().int().nonnegative(),
    order: z.number().int().nonnegative(),
    collapsed: z.boolean(),
    viaRelationId: relationIdSchema.optional(),
    cycleTargetPlacementId: z.string().optional(),
  })),
  expandedRelations: z.array(relationIdSchema),
  collapsedRegions: z.array(z.string()),
  branchFilter: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('show-all') }),
    z.object({ mode: z.literal('only'), branchId: z.string().min(1), arm: z.enum(['A', 'B']) }),
  ]),
  viewport: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    zoom: z.number().positive().max(4),
  }),
  mode: z.enum(['standard', 'immersive']),
  hiddenSummary: z.object({
    hiddenBranches: z.number().int().nonnegative(),
    hiddenRelations: z.number().int().nonnegative(),
    restoreAvailable: z.boolean(),
  }),
  selectedRelationId: relationIdSchema.optional(),
});

export const businessNodeSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  members: z.array(z.object({
    fragmentId: z.string().min(1),
    order: z.number().int().nonnegative(),
  })).min(1),
  presentation: z.object({ collapsedByDefault: z.boolean() }),
  provenance: z.object({
    definitionPath: relativePathSchema,
    createdBy: z.literal('local-user'),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
});

export const userWorkspaceStateSchema = z.object({
  schemaVersion: z.literal(1),
  flowPages: z.array(flowPageSchema),
  businessNodes: z.array(businessNodeSchema),
  recentFlowPageIds: z.array(z.string().min(1)),
  pendingMigrations: z.array(z.object({
    id: z.string().min(1),
    kind: z.enum(['symbol', 'relation']),
    status: z.enum(['ambiguous', 'missing']),
    previousId: z.string().min(1),
    candidates: z.array(z.string().min(1)),
    evidence: z.array(z.string().min(1)),
    createdAt: z.string().datetime(),
  })).optional(),
  staleAssets: z.array(z.object({
    id: z.string().min(1),
    kind: z.enum(['symbol', 'relation']),
    previousId: z.string().min(1),
    provenance: z.literal('previous-index'),
    evidence: z.array(z.string().min(1)),
    keptAt: z.string().datetime(),
  })).optional(),
}).superRefine((state, context) => {
  const pageIds = new Set(state.flowPages.map((page) => page.id));
  const nodeIds = new Set(state.businessNodes.map((node) => node.id));
  for (const id of state.recentFlowPageIds) if (!pageIds.has(id)) context.addIssue({ code: 'custom', path: ['recentFlowPageIds'], message: `Unknown flow page ${id}` });
  for (const node of state.businessNodes) {
    if (node.members.length === 0) context.addIssue({ code: 'custom', path: ['businessNodes', node.id], message: 'Business node must have a member' });
    for (const page of state.flowPages.filter((candidate) => candidate.entry.kind === 'business-node' && candidate.entry.id === node.id)) {
      if (!nodeIds.has(page.entry.id)) context.addIssue({ code: 'custom', path: ['flowPages', page.id], message: 'Unknown business node entry' });
    }
  }
  for (const page of state.flowPages) {
    if (page.entry.kind === 'business-node' && !nodeIds.has(page.entry.id)) {
      context.addIssue({ code: 'custom', path: ['flowPages', page.id, 'entry', 'id'], message: 'Business node flow page must reference an existing node' });
    }
  }
  for (const page of state.flowPages) {
    const placementIds = new Set(page.placements.map((placement) => placement.id));
    for (const placement of page.placements) {
      if (placement.cycleTargetPlacementId !== undefined && !placementIds.has(placement.cycleTargetPlacementId)) context.addIssue({ code: 'custom', path: ['flowPages', page.id, 'placements'], message: 'Cycle target must reference a placement on the same page' });
      if (placement.viaRelationId !== undefined && !page.expandedRelations.includes(placement.viaRelationId)) context.addIssue({ code: 'custom', path: ['flowPages', page.id, 'placements'], message: 'Placement relation must be expanded on the page' });
    }
  }
});

export const parseRange = (value: unknown): TextRange => rangeSchema.parse(value);
export const parseAnchor = (value: unknown): SourceAnchor => anchorSchema.parse(value) as SourceAnchor;
export const parseFlowPage = (value: unknown): FlowPage => flowPageSchema.parse(value) as unknown as FlowPage;
export const parseBusinessNode = (value: unknown): BusinessNode => businessNodeSchema.parse(value) as unknown as BusinessNode;
export const parseUserWorkspaceState = (value: unknown): UserWorkspaceState =>
  userWorkspaceStateSchema.parse(value) as unknown as UserWorkspaceState;

export const createEmptyUserWorkspaceState = (): UserWorkspaceState => ({
  schemaVersion: 1,
  flowPages: [],
  businessNodes: [],
  recentFlowPageIds: [],
});

export const formatIterationEstimate = (estimate: IterationEstimate): string => {
  switch (estimate.kind) {
    case 'upper-bound':
      return `静态上限 ${estimate.value} 次`;
    case 'expression':
      return `次数：${estimate.expression}`;
    case 'unknown':
      return '次数：静态未知';
  }
};
