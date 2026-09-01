// @vitest-environment node
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { indexTypeScriptProject } from '../../src/adapter-typescript/index.js';
import type { AdapterIndexSnapshot } from '../../src/adapter-api/index.js';
import { buildFlowPage, outgoingRelations, projectBranchView, setBranchFilter, toggleFlowRelation } from '../../src/index-core/index.js';
import { projectId, relationId, sourceFileId, symbolId, type RelationBridge, type SymbolId } from '../../src/model/index.js';

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
    expect(page.placements).toHaveLength(1);
    expect(page.expandedRelations).toEqual([]);
    expect(outgoingRelations(snapshot, createOrder.id).length).toBeGreaterThan(0);
    expect(page.placements.some((placement) => placement.targetId === unrelated.id)).toBe(false);
    expect(page.placements.some((placement) => placement.targetId === createOrder.id)).toBe(true);
  });

  it('bounds recursion and call cycles with backlink placements', () => {
    const cycleA = snapshot.fragments.find((fragment) => fragment.displayName === 'cycleA');
    if (cycleA === undefined) throw new Error('cycleA missing');
    const cycleB = snapshot.fragments.find((fragment) => fragment.displayName === 'cycleB');
    if (cycleB === undefined) throw new Error('cycleB missing');
    const aToB = snapshot.relations.find((relation) => relation.sourceFragmentId === cycleA.id && relation.resolution.status === 'resolved' && relation.resolution.targetId === cycleB.id);
    const bToA = snapshot.relations.find((relation) => relation.sourceFragmentId === cycleB.id && relation.resolution.status === 'resolved' && relation.resolution.targetId === cycleA.id);
    if (aToB === undefined || bToA === undefined) throw new Error('cycle relations missing');
    let page = buildFlowPage(snapshot, cycleA.id);
    page = toggleFlowRelation(page, snapshot, aToB.id);
    expect(page.placements.some((placement) => placement.targetId === cycleB.id)).toBe(true);
    page = toggleFlowRelation(page, snapshot, bToA.id);
    expect(page.placements.length).toBeLessThanOrEqual(3);
    expect(page.placements.some((placement) => placement.kind === 'cycle')).toBe(true);
    page = toggleFlowRelation(page, snapshot, aToB.id);
    expect(page.placements).toHaveLength(1);
  });

  it('propagates a hidden arm through two downstream levels but stops at a shared merge', () => {
    const file = sourceFileId('file:branch');
    const revision = 'r1';
    const root = symbolId('symbol:root');
    const armA = symbolId('symbol:a');
    const armB = symbolId('symbol:b');
    const b2 = symbolId('symbol:b2');
    const merge = symbolId('symbol:merge');
    const after = symbolId('symbol:after');
    const makeRelation = (id: string, source: SymbolId, target: SymbolId, arm?: 'A' | 'B'): RelationBridge => ({
      id: relationId(id), projectId: projectId('project:branch'), sourceFragmentId: source,
      callSite: { sourceFileId: file, revision, range: { start: 0, end: 1 } }, kind: 'call',
      resolution: { status: 'resolved', targetId: target, targetDefinition: { sourceFileId: file, revision, range: { start: 1, end: 2 } }, certainty: 'exact' },
      ...(arm === undefined ? {} : { branchContext: { branchId: 'branch:root', condition: 'paid', arm, label: arm } }),
      evidence: [], adapter: { adapterId: 'test', adapterVersion: '1.0.0', coreApiVersion: '1.0.0' },
      identity: { recipeVersion: 1, callFingerprint: `fingerprint:${id}`, occurrence: 0 },
    });
    const relations = [
      makeRelation('ra', root, armA, 'A'), makeRelation('rb', root, armB, 'B'),
      makeRelation('rb2', armB, b2), makeRelation('ram', armA, merge),
      makeRelation('rbm', b2, merge), makeRelation('rma', merge, after),
    ];
    const projection = projectBranchView(relations, { mode: 'only', branchId: 'branch:root', arm: 'A' });
    expect(projection.states['rb']).toBe('dimmed');
    expect(projection.states['rb2']).toBe('dimmed');
    expect(projection.states['rbm']).toBe('dimmed');
    expect(projection.states['rma']).toBe('visible');
    expect(projection.hiddenRelations).toBe(3);
    expect(projection.relations).toHaveLength(relations.length);
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
