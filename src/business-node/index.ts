import {
  businessNodeId,
  type BusinessNode,
  type ProjectId,
  type SymbolId,
} from '../model/index.js';

export interface CreateBusinessNodeInput {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly description?: string;
  readonly memberIds: readonly SymbolId[];
  readonly availableFragmentIds: ReadonlySet<SymbolId>;
  readonly now: string;
}

export const createBusinessNode = (input: CreateBusinessNodeInput): BusinessNode => {
  const name = input.name.trim();
  if (name.length === 0) throw new Error('BusinessNode name is required');
  if (input.memberIds.length === 0) throw new Error('BusinessNode requires at least one function');
  const uniqueMembers = [...new Set(input.memberIds)];
  if (uniqueMembers.some((memberId) => !input.availableFragmentIds.has(memberId))) {
    throw new Error('BusinessNode nesting or unknown members are not allowed');
  }
  return {
    id: businessNodeId(input.id),
    projectId: input.projectId,
    name,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    members: uniqueMembers.map((fragmentId, order) => ({ fragmentId, order })),
    presentation: { collapsedByDefault: false },
    provenance: {
      definitionPath: `xanadu/business/${input.id}.json`,
      createdBy: 'local-user',
      createdAt: input.now,
      updatedAt: input.now,
    },
  };
};

export const moveBusinessMember = (
  node: BusinessNode,
  fragmentId: SymbolId,
  direction: -1 | 1,
  now: string,
): BusinessNode => {
  const ordered = [...node.members].sort((left, right) => left.order - right.order);
  const currentIndex = ordered.findIndex((member) => member.fragmentId === fragmentId);
  const targetIndex = currentIndex + direction;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= ordered.length) return node;
  const current = ordered[currentIndex];
  const target = ordered[targetIndex];
  if (current === undefined || target === undefined) return node;
  ordered[currentIndex] = target;
  ordered[targetIndex] = current;
  return {
    ...node,
    members: ordered.map((member, order) => ({ fragmentId: member.fragmentId, order })),
    provenance: { ...node.provenance, updatedAt: now },
  };
};

export const setBusinessNodeCollapsed = (node: BusinessNode, collapsed: boolean, now: string): BusinessNode => ({
  ...node,
  presentation: { collapsedByDefault: collapsed },
  provenance: { ...node.provenance, updatedAt: now },
});
