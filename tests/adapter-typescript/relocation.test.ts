// @vitest-environment node
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { indexTypeScriptProject, typescriptAdapterManifest } from '../../src/adapter-typescript/index.js';
import { relocateFunctionFragments } from '../../src/adapter-api/relocation.js';
import { createBusinessNode } from '../../src/business-node/index.js';
import { buildBusinessNodeFlowPage, buildFlowPage, migrateUserAssets, rebuildMigratedFlowPages } from '../../src/index-core/index.js';
import type { UserWorkspaceState } from '../../src/model/index.js';

const temporaryRoots: string[] = [];
afterEach(async () => Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

const workspace = async (): Promise<string> => {
  const root = await fs.mkdtemp(join(tmpdir(), 'xanadu-relocation-'));
  temporaryRoots.push(root);
  await fs.mkdir(join(root, 'src'));
  await fs.writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ['src'] }), 'utf8');
  return root;
};

describe('stable symbol identity and relocation', () => {
  it('survives prepended lines and in-file moves, then migrates assets after a file move', async () => {
    const root = await workspace();
    const initialSource = `export function stable(value: number): number { return value + 1; }
export function moving(value: string): string { return value.trim(); }
`;
    await fs.writeFile(join(root, 'src', 'api.ts'), initialSource, 'utf8');
    const first = await indexTypeScriptProject(root);
    const stableBefore = first.fragments.find((fragment) => fragment.displayName === 'stable');
    const movingBefore = first.fragments.find((fragment) => fragment.displayName === 'moving');
    if (stableBefore === undefined || movingBefore === undefined) throw new Error('initial symbols missing');

    await fs.writeFile(join(root, 'src', 'api.ts'), `// prepended line\n${initialSource.split('\n').reverse().join('\n')}`, 'utf8');
    const edited = await indexTypeScriptProject(root);
    expect(edited.fragments.find((fragment) => fragment.displayName === 'stable')?.id).toBe(stableBefore.id);
    expect(edited.fragments.find((fragment) => fragment.displayName === 'moving')?.id).toBe(movingBefore.id);

    const page = buildFlowPage(first, stableBefore.id);
    const node = createBusinessNode({
      id: 'stable-business', projectId: page.projectId, name: 'Stable business',
      memberIds: [stableBefore.id, movingBefore.id],
      availableFragmentIds: new Set(first.fragments.map((fragment) => fragment.id)),
      now: '2026-09-01T00:00:00.000Z',
    });
    const businessPage = { ...buildBusinessNodeFlowPage(first, node), mode: 'immersive' as const, viewport: { x: 120, y: 40, zoom: 1.2 } };
    const state: UserWorkspaceState = { schemaVersion: 1, flowPages: [page, businessPage], businessNodes: [node], recentFlowPageIds: [businessPage.id, page.id] };

    await fs.mkdir(join(root, 'src', 'nested'));
    await fs.rename(join(root, 'src', 'api.ts'), join(root, 'src', 'nested', 'api.ts'));
    const moved = await indexTypeScriptProject(root);
    const relocation = relocateFunctionFragments(first.fragments, moved.fragments);
    const stableMatch = relocation.find((match) => match.previousId === stableBefore.id);
    expect(stableMatch).toMatchObject({ status: 'matched', certainty: 'probable' });
    const migrated = migrateUserAssets(state, relocation);
    if (stableMatch?.status !== 'matched') throw new Error('stable relocation missing');
    expect(migrated.state.flowPages[0]?.entry.id).toBe(stableMatch.currentId);
    expect(migrated.state.flowPages[0]?.placements[0]?.targetId).toBe(stableMatch.currentId);
    expect(migrated.state.businessNodes[0]?.members[0]?.fragmentId).toBe(stableMatch.currentId);
    expect(migrated.unresolved).toEqual([]);
    const rebuilt = rebuildMigratedFlowPages(migrated.state, moved);
    expect(rebuilt.flowPages[0]?.placements[0]?.targetId).toBe(stableMatch.currentId);
    expect(rebuilt.flowPages[1]?.entry.kind).toBe('business-node');
    expect(rebuilt.flowPages[1]?.mode).toBe('immersive');
    expect(rebuilt.flowPages[1]?.viewport).toEqual({ x: 120, y: 40, zoom: 1.2 });
  });

  it('returns ambiguous rename evidence and missing when no candidate remains', async () => {
    const root = await workspace();
    await fs.writeFile(join(root, 'src', 'api.ts'), 'export function original(value: number): number { return value + 1; }\n', 'utf8');
    const first = await indexTypeScriptProject(root);
    const original = first.fragments.find((fragment) => fragment.displayName === 'original');
    if (original === undefined) throw new Error('original missing');
    await fs.writeFile(join(root, 'src', 'api.ts'), `export function renamedA(value: number): number { return value + 1; }
export function renamedB(value: number): number { return value + 1; }
`, 'utf8');
    const renamed = await indexTypeScriptProject(root);
    const ambiguous = relocateFunctionFragments([original], renamed.fragments)[0];
    expect(ambiguous?.status).toBe('ambiguous');
    expect(ambiguous?.evidence.length).toBeGreaterThan(0);
    await fs.writeFile(join(root, 'src', 'api.ts'), 'export const value = 1;\n', 'utf8');
    const removed = await indexTypeScriptProject(root);
    const missing = relocateFunctionFragments([original], removed.fragments)[0];
    expect(missing?.status).toBe('missing');
    expect(missing?.previousId).toBe(original.id);
    expect(missing?.evidence.length).toBeGreaterThan(0);
    expect(typescriptAdapterManifest.capabilities.stableIds).toBe('relocatable');
  });
});
