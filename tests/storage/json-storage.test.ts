// @vitest-environment node
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { indexTypeScriptProject } from '../../src/adapter-typescript/index.js';
import { buildFlowPage } from '../../src/index-core/index.js';
import { businessNodeId, flowPageId, type UserWorkspaceState } from '../../src/model/index.js';
import { JsonStorage } from '../../src/storage/json-storage.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('JsonStorage user assets and rebuildable cache', () => {
  it('keeps FlowPage and BusinessNode assets when index cache is cleared', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'xanadu-storage-'));
    temporaryRoots.push(root);
    const snapshot = await indexTypeScriptProject(resolve('fixtures/order-service'));
    const createOrder = snapshot.fragments.find((fragment) => fragment.displayName === 'createOrder');
    if (createOrder === undefined) throw new Error('createOrder missing');
    const page = buildFlowPage(snapshot, createOrder.id);
    const now = '2026-09-01T00:00:00.000Z';
    const state: UserWorkspaceState = {
      schemaVersion: 1,
      flowPages: [page],
      businessNodes: [{
        id: businessNodeId('business:create-order'),
        projectId: page.projectId,
        name: '创建订单',
        members: [{ fragmentId: createOrder.id, order: 0 }],
        presentation: { collapsedByDefault: false },
        provenance: {
          definitionPath: 'xanadu/business/create-order.json',
          createdBy: 'local-user',
          createdAt: now,
          updatedAt: now,
        },
      }],
      recentFlowPageIds: [page.id],
    };
    const storage = new JsonStorage(root, 'fixture-workspace');
    await storage.saveUserState(state, 1);
    await storage.saveIndexCache(snapshot);
    expect((await storage.loadIndexCache())?.fragments.length).toBeGreaterThan(0);
    await storage.clearIndexCache();
    expect(await storage.loadIndexCache()).toBeUndefined();
    expect(await storage.loadUserState()).toEqual(state);
  });

  it('serializes writes and rejects an older generation that arrives later', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'xanadu-storage-order-'));
    temporaryRoots.push(root);
    const storage = new JsonStorage(root, 'fixture-workspace');
    const newer: UserWorkspaceState = { schemaVersion: 1, flowPages: [], businessNodes: [], recentFlowPageIds: [flowPageId('flow:newer')] };
    const older: UserWorkspaceState = { schemaVersion: 1, flowPages: [], businessNodes: [], recentFlowPageIds: [flowPageId('flow:older')] };
    const [newerResult, olderResult] = await Promise.all([
      storage.saveUserState(newer, 20),
      storage.saveUserState(older, 10),
    ]);
    expect(newerResult.status).toBe('saved');
    expect(olderResult.status).toBe('stale');
    expect((await storage.loadUserState()).recentFlowPageIds).toEqual([flowPageId('flow:newer')]);
  });

  it('keeps relocation journal across cache replacement/crash until explicit acknowledgement', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'xanadu-relocation-journal-'));
    temporaryRoots.push(root);
    const snapshot = await indexTypeScriptProject(resolve('fixtures/order-service'));
    const storage = new JsonStorage(root, 'fixture-workspace');
    const journal = {
      id: 'journal-1',
      symbolRelocation: [{ status: 'ambiguous' as const, previousId: 'symbol:old', candidates: ['symbol:a', 'symbol:b'], evidence: ['two candidates'] }],
      relationRelocation: [{ status: 'missing' as const, previousId: 'relation:old', evidence: ['call removed'] }],
      createdAt: '2026-09-01T00:00:00.000Z',
    };
    await storage.saveRelocationJournal(journal);
    await storage.saveIndexCache(snapshot);
    const afterCrash = new JsonStorage(root, 'fixture-workspace');
    expect(await afterCrash.loadRelocationJournal()).toEqual(journal);
    const pendingState: UserWorkspaceState = {
      schemaVersion: 1, flowPages: [], businessNodes: [], recentFlowPageIds: [],
      pendingMigrations: [{
        id: 'migration:symbol:symbol:old', kind: 'symbol', status: 'ambiguous', previousId: 'symbol:old',
        candidates: ['symbol:a', 'symbol:b'], evidence: ['two candidates'], createdAt: '2026-09-01T00:00:00.000Z',
      }],
    };
    await afterCrash.saveUserState(pendingState, 1);
    expect((await new JsonStorage(root, 'fixture-workspace').loadUserState()).pendingMigrations).toEqual(pendingState.pendingMigrations);
    await afterCrash.clearRelocationJournal('wrong-id');
    expect(await afterCrash.loadRelocationJournal()).toEqual(journal);
    await afterCrash.clearRelocationJournal(journal.id);
    expect(await afterCrash.loadRelocationJournal()).toBeUndefined();
  });
});
