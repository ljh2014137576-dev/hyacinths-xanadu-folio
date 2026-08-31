// @vitest-environment node
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { indexTypeScriptProject } from '../../src/adapter-typescript/index.js';
import type { AdapterIndexSnapshot } from '../../src/adapter-api/index.js';
import { buildFlowPage, projectBranchView, setBranchFilter } from '../../src/index-core/index.js';

let snapshot: AdapterIndexSnapshot;

beforeAll(async () => {
  snapshot = await indexTypeScriptProject(resolve('fixtures/order-service'));
});

describe('outgoing-only FlowPage projection', () => {
  it('never introduces an unrelated inbound caller', () => {
    const createOrder = snapshot.fragments.find((fragment) => fragment.displayName === 'createOrder');
    const unrelated = snapshot.fragments.find((fragment) => fragment.displayName === 'unrelatedInboundCaller');
    if (createOrder === undefined || unrelated === undefined) throw new Error('fixture symbols missing');
    const page = buildFlowPage(snapshot, createOrder.id);
    expect(page.placements.some((placement) => placement.targetId === unrelated.id)).toBe(false);
    expect(page.placements.some((placement) => placement.targetId === createOrder.id)).toBe(true);
  });

  it('bounds recursion and call cycles with backlink placements', () => {
    const cycleA = snapshot.fragments.find((fragment) => fragment.displayName === 'cycleA');
    if (cycleA === undefined) throw new Error('cycleA missing');
    const page = buildFlowPage(snapshot, cycleA.id, { maxDepth: 6 });
    expect(page.placements.length).toBeLessThanOrEqual(3);
    expect(page.placements.some((placement) => placement.kind === 'cycle')).toBe(true);
  });
});

describe('static branch view filtering', () => {
  it('dims the other arm without deleting relation facts', () => {
    const branchFunction = snapshot.fragments.find((fragment) => fragment.displayName === 'followPaidBranch');
    if (branchFunction === undefined) throw new Error('followPaidBranch missing');
    const page = buildFlowPage(snapshot, branchFunction.id);
    const relations = snapshot.relations.filter((relation) => relation.sourceFragmentId === branchFunction.id);
    const branch = relations.find((relation) => relation.branchContext?.arm === 'A')?.branchContext;
    if (branch === undefined) throw new Error('paid branch context missing');
    const beforeIds = relations.map((relation) => relation.id);
    const filter = { mode: 'only' as const, branchId: branch.branchId, arm: 'A' as const };
    const projection = projectBranchView(relations, filter);
    const updated = setBranchFilter(page, relations, filter);
    expect(projection.relations.map((relation) => relation.id)).toEqual(beforeIds);
    expect(projection.hiddenRelations).toBeGreaterThan(0);
    expect(Object.values(projection.states)).toContain('dimmed');
    expect(updated.hiddenSummary.restoreAvailable).toBe(true);
  });
});
