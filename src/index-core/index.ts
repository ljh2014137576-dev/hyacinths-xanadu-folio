import type { AdapterIndexSnapshot, RelocationMatch } from '../adapter-api/index.js';
import {
  flowPageId,
  symbolId,
  type BranchViewFilter,
  type BusinessNode,
  type FlowPage,
  type FlowPlacement,
  type RelationBridge,
  type RelationId,
  type SymbolId,
  type UserWorkspaceState,
} from '../model/index.js';

const revisionFor = (snapshot: AdapterIndexSnapshot): string =>
  `projection:${snapshot.sourceFiles.map((file) => `${file.id}:${file.revision}`).sort().join('|')}`;

export interface ProjectionOptions {
  readonly pageName?: string;
}

interface ProjectionSeed {
  readonly placements: readonly FlowPlacement[];
  readonly functionIds: readonly SymbolId[];
}

const functionPlacement = (targetId: SymbolId, depth: number, order: number, viaRelationId?: RelationId): FlowPlacement => ({
  id: `placement:function:${targetId}`,
  kind: 'function',
  targetId,
  depth,
  order,
  collapsed: false,
  ...(viaRelationId === undefined ? {} : { viaRelationId }),
});

const rebuildPlacements = (
  snapshot: AdapterIndexSnapshot,
  seed: ProjectionSeed,
  requestedExpanded: ReadonlySet<RelationId>,
): { readonly placements: readonly FlowPlacement[]; readonly expandedRelations: readonly RelationId[] } => {
  const placements: FlowPlacement[] = [...seed.placements];
  const registry = new Map<SymbolId, string>();
  seed.placements.forEach((placement) => {
    if (placement.kind === 'function') registry.set(placement.targetId as SymbolId, placement.id);
  });
  const usedRelations: RelationId[] = [];
  let order = placements.length;

  const expandFrom = (sourceId: SymbolId, depth: number, path: ReadonlySet<SymbolId>): void => {
    if (depth >= 7) return;
    const nextPath = new Set(path);
    nextPath.add(sourceId);
    for (const relation of snapshot.relations.filter((item) => item.sourceFragmentId === sourceId)) {
      if (!requestedExpanded.has(relation.id) || relation.resolution.status !== 'resolved') continue;
      usedRelations.push(relation.id);
      const targetId = relation.resolution.targetId;
      const existing = registry.get(targetId);
      if (existing !== undefined || nextPath.has(targetId)) {
        placements.push({
          id: `placement:cycle:${relation.id}`,
          kind: 'cycle',
          targetId,
          depth: depth + 1,
          order,
          collapsed: true,
          viaRelationId: relation.id,
          cycleTargetPlacementId: existing ?? `placement:function:${targetId}`,
        });
        order += 1;
        continue;
      }
      const placement = functionPlacement(targetId, depth + 1, order, relation.id);
      placements.push(placement);
      registry.set(targetId, placement.id);
      order += 1;
      expandFrom(targetId, depth + 1, nextPath);
    }
  };

  seed.functionIds.forEach((id) => expandFrom(id, seed.placements.find((placement) => placement.targetId === id)?.depth ?? 0, new Set()));
  return { placements, expandedRelations: [...new Set(usedRelations)] };
};

const rebuildPage = (page: FlowPage, snapshot: AdapterIndexSnapshot, expandedRelations: readonly RelationId[]): FlowPage => {
  if (page.entry.kind === 'business-node') {
    const businessPlacement = page.placements.find((placement) => placement.kind === 'business-node');
    const memberPlacements = page.placements.filter((placement) => placement.kind === 'function' && placement.viaRelationId === undefined);
    if (businessPlacement === undefined) return page;
    const projected = rebuildPlacements(snapshot, {
      placements: [businessPlacement, ...memberPlacements],
      functionIds: memberPlacements.map((placement) => placement.targetId as SymbolId),
    }, new Set(expandedRelations));
    return { ...page, placements: projected.placements, expandedRelations: projected.expandedRelations };
  }
  const entryId = page.entry.id as SymbolId;
  const seedPlacement = functionPlacement(entryId, 0, 0);
  const projected = rebuildPlacements(snapshot, { placements: [seedPlacement], functionIds: [entryId] }, new Set(expandedRelations));
  return { ...page, placements: projected.placements, expandedRelations: projected.expandedRelations };
};

export const buildFlowPage = (
  snapshot: AdapterIndexSnapshot,
  entrySymbolId: SymbolId,
  options: ProjectionOptions = {},
): FlowPage => {
  const entry = snapshot.fragments.find((fragment) => fragment.id === entrySymbolId);
  const firstSourceFile = snapshot.sourceFiles[0];
  if (entry === undefined || firstSourceFile === undefined) throw new Error('FlowPage entry symbol does not exist');
  return {
    id: flowPageId(`flow:${entrySymbolId}`),
    projectId: firstSourceFile.projectId,
    name: options.pageName ?? entry.displayName,
    entry: { kind: 'function', id: entrySymbolId },
    projectionRevision: revisionFor(snapshot),
    placements: [functionPlacement(entrySymbolId, 0, 0)],
    expandedRelations: [],
    collapsedRegions: [],
    branchFilter: { mode: 'show-all' },
    viewport: { x: 0, y: 0, zoom: 1 },
    mode: 'standard',
    hiddenSummary: { hiddenBranches: 0, hiddenRelations: 0, restoreAvailable: false },
  };
};

export const buildBusinessNodeFlowPage = (
  snapshot: AdapterIndexSnapshot,
  node: BusinessNode,
): FlowPage => {
  const members = [...node.members].sort((left, right) => left.order - right.order);
  const placements: FlowPlacement[] = [{
    id: `placement:business:${node.id}`,
    kind: 'business-node',
    targetId: node.id,
    depth: 0,
    order: 0,
    collapsed: node.presentation.collapsedByDefault,
  }, ...members.map((member, index) => functionPlacement(member.fragmentId, 1, index + 1))];
  return {
    id: flowPageId(`flow:business:${node.id}`),
    projectId: node.projectId,
    name: node.name,
    entry: { kind: 'business-node', id: node.id },
    projectionRevision: revisionFor(snapshot),
    placements,
    expandedRelations: [],
    collapsedRegions: [],
    branchFilter: { mode: 'show-all' },
    viewport: { x: 0, y: 0, zoom: 1 },
    mode: 'standard',
    hiddenSummary: { hiddenBranches: 0, hiddenRelations: 0, restoreAvailable: false },
  };
};

export const toggleFlowRelation = (page: FlowPage, snapshot: AdapterIndexSnapshot, relationId: RelationId): FlowPage => {
  const relation = snapshot.relations.find((item) => item.id === relationId);
  if (relation?.resolution.status !== 'resolved') return page;
  const requested = page.expandedRelations.includes(relationId)
    ? page.expandedRelations.filter((id) => id !== relationId)
    : [...page.expandedRelations, relationId];
  return rebuildPage(page, snapshot, requested);
};

export const relationsForPage = (snapshot: AdapterIndexSnapshot, page: FlowPage): readonly RelationBridge[] => {
  const placedFunctions = new Set(page.placements.filter((placement) => placement.kind === 'function').map((placement) => placement.targetId));
  return snapshot.relations.filter((relation) => placedFunctions.has(relation.sourceFragmentId));
};

export type RelationPresentationState = 'visible' | 'dimmed' | 'collapsed';

export interface BranchProjection {
  readonly relations: readonly RelationBridge[];
  readonly states: Readonly<Record<string, RelationPresentationState>>;
  readonly hiddenRelations: number;
  readonly hiddenBranches: number;
}

const reachableTargets = (relations: readonly RelationBridge[], roots: ReadonlySet<SymbolId>): ReadonlySet<SymbolId> => {
  const visited = new Set<SymbolId>();
  const queue = [...roots];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    for (const relation of relations) {
      if (relation.sourceFragmentId === current && relation.resolution.status === 'resolved') queue.push(relation.resolution.targetId);
    }
  }
  return visited;
};

export const projectBranchView = (
  relations: readonly RelationBridge[],
  filter: BranchViewFilter,
): BranchProjection => {
  const states: Record<string, RelationPresentationState> = {};
  if (filter.mode === 'show-all') {
    relations.forEach((relation) => { states[relation.id] = 'visible'; });
    return { relations, states, hiddenRelations: 0, hiddenBranches: 0 };
  }

  const selectedRoots = new Set<SymbolId>();
  const hiddenRoots = new Set<SymbolId>();
  for (const relation of relations) {
    const branch = relation.branchContext;
    if (branch?.branchId !== filter.branchId || relation.resolution.status !== 'resolved') continue;
    (branch.arm === filter.arm ? selectedRoots : hiddenRoots).add(relation.resolution.targetId);
  }
  const selectedReachable = reachableTargets(relations, selectedRoots);
  const hiddenReachable = reachableTargets(relations, hiddenRoots);
  const hiddenOnly = new Set([...hiddenReachable].filter((target) => !selectedReachable.has(target)));
  let hiddenRelations = 0;
  const hiddenArms = new Set<string>();
  for (const relation of relations) {
    const directHidden = relation.branchContext?.branchId === filter.branchId && relation.branchContext.arm !== filter.arm;
    const downstreamHidden = hiddenOnly.has(relation.sourceFragmentId);
    const hidden = directHidden || downstreamHidden;
    states[relation.id] = hidden ? 'dimmed' : 'visible';
    if (hidden) {
      hiddenRelations += 1;
      if (relation.branchContext?.branchId === filter.branchId) hiddenArms.add(relation.branchContext.arm);
    }
  }
  return { relations, states, hiddenRelations, hiddenBranches: hiddenArms.size };
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

export const migrateUserAssets = (
  state: UserWorkspaceState,
  relocation: readonly RelocationMatch[],
): { readonly state: UserWorkspaceState; readonly unresolved: readonly RelocationMatch[] } => {
  const replacements = new Map(relocation.flatMap((match) => match.status === 'matched' ? [[match.previousId, match.currentId] as const] : []));
  const replace = (id: string): string => replacements.get(id) ?? id;
  return {
    state: {
      ...state,
      flowPages: state.flowPages.map((page) => ({
        ...page,
        entry: page.entry.kind === 'function' ? { ...page.entry, id: replace(page.entry.id) } : page.entry,
        placements: page.placements.map((placement) => placement.kind === 'business-node'
          ? placement
          : { ...placement, targetId: symbolId(replace(placement.targetId)) }),
      })),
      businessNodes: state.businessNodes.map((node) => ({
        ...node,
        members: node.members.map((member) => ({ ...member, fragmentId: symbolId(replace(member.fragmentId)) })),
      })),
    },
    unresolved: relocation.filter((match) => match.status !== 'matched'),
  };
};

export const rebuildMigratedFlowPages = (
  state: UserWorkspaceState,
  snapshot: AdapterIndexSnapshot,
): UserWorkspaceState => ({
  ...state,
  flowPages: state.flowPages.map((page) => {
    const rebuilt = page.entry.kind === 'function'
      ? (() => {
          const fragment = snapshot.fragments.find((candidate) => candidate.id === page.entry.id);
          return fragment === undefined ? undefined : buildFlowPage(snapshot, fragment.id, { pageName: page.name });
        })()
      : page.entry.kind === 'business-node'
        ? (() => {
            const node = state.businessNodes.find((candidate) => candidate.id === page.entry.id);
            return node === undefined ? undefined : buildBusinessNodeFlowPage(snapshot, node);
          })()
        : undefined;
    return rebuilt === undefined ? page : {
      ...rebuilt,
      id: page.id,
      name: page.name,
      mode: page.mode,
      viewport: page.viewport,
      collapsedRegions: page.collapsedRegions,
      branchFilter: page.branchFilter,
      hiddenSummary: { hiddenBranches: 0, hiddenRelations: 0, restoreAvailable: false },
    };
  }),
});
