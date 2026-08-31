import { createHash } from 'node:crypto';
import type { AdapterIndexSnapshot } from '../adapter-api/index.js';
import {
  flowPageId,
  type BranchViewFilter,
  type FlowPage,
  type FlowPlacement,
  type RelationBridge,
  type RelationId,
  type SymbolId,
} from '../model/index.js';

const revisionFor = (snapshot: AdapterIndexSnapshot): string => createHash('sha256')
  .update(snapshot.sourceFiles.map((file) => `${file.id}:${file.revision}`).sort().join('|'))
  .digest('hex');

export interface ProjectionOptions {
  readonly maxDepth?: number;
  readonly pageName?: string;
}

export const buildFlowPage = (
  snapshot: AdapterIndexSnapshot,
  entrySymbolId: SymbolId,
  options: ProjectionOptions = {},
): FlowPage => {
  const entry = snapshot.fragments.find((fragment) => fragment.id === entrySymbolId);
  const firstSourceFile = snapshot.sourceFiles[0];
  if (entry === undefined || firstSourceFile === undefined) throw new Error('FlowPage entry symbol does not exist');
  const maxDepth = options.maxDepth ?? 7;
  const placements: FlowPlacement[] = [];
  const expandedRelations: RelationId[] = [];
  const registry = new Map<SymbolId, string>();
  let sequence = 0;

  const expand = (targetId: SymbolId, depth: number, viaRelationId?: RelationId): void => {
    const existingPlacement = registry.get(targetId);
    if (existingPlacement !== undefined) {
      placements.push({
        id: `placement:cycle:${sequence}`,
        kind: 'cycle',
        targetId,
        depth,
        order: sequence,
        collapsed: true,
        ...(viaRelationId === undefined ? {} : { viaRelationId }),
        cycleTargetPlacementId: existingPlacement,
      });
      sequence += 1;
      return;
    }

    const placementId = `placement:${sequence}:${targetId}`;
    registry.set(targetId, placementId);
    placements.push({
      id: placementId,
      kind: 'function',
      targetId,
      depth,
      order: sequence,
      collapsed: false,
      ...(viaRelationId === undefined ? {} : { viaRelationId }),
    });
    sequence += 1;
    if (depth >= maxDepth) return;

    const outgoing = snapshot.relations.filter((relation) => relation.sourceFragmentId === targetId);
    for (const relation of outgoing) {
      expandedRelations.push(relation.id);
      if (relation.resolution.status === 'resolved') {
        expand(relation.resolution.targetId, depth + 1, relation.id);
      }
    }
  };

  expand(entrySymbolId, 0);
  return {
    id: flowPageId(`flow:${entrySymbolId}`),
    projectId: firstSourceFile.projectId,
    name: options.pageName ?? entry.displayName,
    entry: { kind: 'function', id: entrySymbolId },
    projectionRevision: revisionFor(snapshot),
    placements,
    expandedRelations: [...new Set(expandedRelations)],
    collapsedRegions: [],
    branchFilter: { mode: 'show-all' },
    viewport: { x: 0, y: 0, zoom: 1 },
    mode: 'standard',
    hiddenSummary: { hiddenBranches: 0, hiddenRelations: 0, restoreAvailable: false },
  };
};

export type RelationPresentationState = 'visible' | 'dimmed' | 'collapsed';

export interface BranchProjection {
  readonly relations: readonly RelationBridge[];
  readonly states: Readonly<Record<string, RelationPresentationState>>;
  readonly hiddenRelations: number;
  readonly hiddenBranches: number;
}

export const projectBranchView = (
  relations: readonly RelationBridge[],
  filter: BranchViewFilter,
): BranchProjection => {
  const states: Record<string, RelationPresentationState> = {};
  const hiddenBranchIds = new Set<string>();
  let hiddenRelations = 0;
  for (const relation of relations) {
    const branch = relation.branchContext;
    const hidden = filter.mode === 'only' && branch !== undefined &&
      branch.branchId === filter.branchId && branch.arm !== filter.arm;
    states[relation.id] = hidden ? 'dimmed' : 'visible';
    if (hidden && branch !== undefined) {
      hiddenRelations += 1;
      hiddenBranchIds.add(`${branch.branchId}:${branch.arm}`);
    }
  }
  return { relations, states, hiddenRelations, hiddenBranches: hiddenBranchIds.size };
};

export const setBranchFilter = (
  page: FlowPage,
  relations: readonly RelationBridge[],
  filter: BranchViewFilter,
): FlowPage => {
  const projection = projectBranchView(relations, filter);
  return {
    ...page,
    branchFilter: filter,
    hiddenSummary: {
      hiddenBranches: projection.hiddenBranches,
      hiddenRelations: projection.hiddenRelations,
      restoreAvailable: projection.hiddenRelations > 0,
    },
  };
};

export const outgoingRelations = (
  snapshot: AdapterIndexSnapshot,
  sourceFragmentId: SymbolId,
): readonly RelationBridge[] => snapshot.relations.filter((relation) => relation.sourceFragmentId === sourceFragmentId);
