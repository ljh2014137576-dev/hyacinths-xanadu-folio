// @vitest-environment node
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { indexTypeScriptProject } from '../../src/adapter-typescript/index.js';
import { buildFlowPage } from '../../src/index-core/index.js';
import { businessNodeId, type UserWorkspaceState } from '../../src/model/index.js';
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
    await storage.saveUserState(state);
    await storage.saveIndexCache(snapshot);
    expect((await storage.loadIndexCache())?.fragments.length).toBeGreaterThan(0);
    await storage.clearIndexCache();
    expect(await storage.loadIndexCache()).toBeUndefined();
    expect(await storage.loadUserState()).toEqual(state);
  });
});
