// @vitest-environment node
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdapterIndexSnapshot, RelocationMatch } from '../../src/adapter-api/index.js';
import { relocateFunctionFragments } from '../../src/adapter-api/relocation.js';
import { indexTypeScriptProject } from '../../src/adapter-typescript/index.js';
import { createBusinessNode } from '../../src/business-node/index.js';
import { buildBusinessNodeFlowPage, buildFlowPage, migrateUserAssets, rebuildMigratedFlowPages } from '../../src/index-core/index.js';
import { parseAdapterIndexSnapshot } from '../../src/ipc/adapter-schemas.js';
import type { FunctionFragment, UserWorkspaceState } from '../../src/model/index.js';
import { JsonStorage } from '../../src/storage/json-storage.js';

const temporaryRoots: string[] = [];

afterEach(async () => Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

const workspace = async (): Promise<string> => {
  const root = await fs.mkdtemp(join(tmpdir(), 'xanadu-catch-relocation-'));
  temporaryRoots.push(root);
  await fs.mkdir(join(root, 'src'));
  await fs.writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ['src'] }), 'utf8');
  return root;
};

const indexSource = async (root: string, source: string): Promise<AdapterIndexSnapshot> => {
  await fs.writeFile(join(root, 'src', 'entry.ts'), source, 'utf8');
  return indexTypeScriptProject(root);
};

const helperCatch = (thrown: string, options: { readonly leadingComment?: string; readonly bodyComment?: string; readonly finallyBody?: string } = {}): string => `${options.leadingComment ?? ''}
try {
  throw ${thrown};
} catch (error) {
  const helper = (value: number): number => { ${options.bodyComment ?? ''} return value + 1; };
  void error;
  void helper(1);
}${options.finallyBody === undefined ? '' : ` finally { ${options.finallyBody} }`}`;

const plainCatch = `try { throw 0; } catch { void 0; }`;
const program = (...blocks: readonly string[]): string => `export function entry(): void {
${blocks.join('\n')}
}
`;

const helpers = (snapshot: AdapterIndexSnapshot): readonly FunctionFragment[] =>
  snapshot.fragments.filter((fragment) => fragment.displayName === 'helper');

const helperForThrow = (snapshot: AdapterIndexSnapshot, thrown: string): FunctionFragment => {
  const match = helpers(snapshot).find((fragment) => {
    const source = snapshot.sourceContents[fragment.sourceFileId];
    if (source === undefined) return false;
    const preceding = source.slice(0, fragment.fullRange.start);
    const throws = [...preceding.matchAll(/throw\s+([^;]+);/g)];
    return throws[throws.length - 1]?.[1]?.trim() === thrown;
  });
  if (match === undefined) throw new Error(`helper for throw ${thrown} missing`);
  return match;
};

const relocationFor = (matches: readonly RelocationMatch[], fragment: FunctionFragment): RelocationMatch => {
  const match = matches.find((candidate) => candidate.previousId === fragment.id);
  if (match === undefined) throw new Error(`relocation for ${fragment.id} missing`);
  return match;
};

const expectSameSemanticCatch = (
  previous: AdapterIndexSnapshot,
  current: AdapterIndexSnapshot,
  thrown: string,
): void => {
  const previousHelper = helperForThrow(previous, thrown);
  const currentHelper = helperForThrow(current, thrown);
  expect(previousHelper.identity.containerSemanticFingerprint).toBeTruthy();
  expect(currentHelper.identity.containerSemanticFingerprint).toBe(previousHelper.identity.containerSemanticFingerprint);
  expect(currentHelper.id).not.toBe(previousHelper.id);
  const match = relocationFor(relocateFunctionFragments(previous.fragments, current.fragments), previousHelper);
  expect(match).toMatchObject({ status: 'matched', currentId: currentHelper.id, certainty: 'probable' });
  const source = current.sourceContents[currentHelper.sourceFileId];
  expect(source?.slice(0, currentHelper.fullRange.start)).toMatch(new RegExp(`throw\\s+${thrown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^]*catch`));
};

describe('catch semantic identity and relocation', () => {
  it.each([
    {
      name: 'insertion',
      before: program(helperCatch('1'), helperCatch('2')),
      after: program(plainCatch, helperCatch('1'), helperCatch('2')),
    },
    {
      name: 'deletion',
      before: program(plainCatch, helperCatch('1'), helperCatch('2')),
      after: program(helperCatch('1'), helperCatch('2')),
    },
    {
      name: 'reorder',
      before: program(helperCatch('1'), helperCatch('2')),
      after: program(helperCatch('2'), helperCatch('1')),
    },
  ])('maps throw 1 and throw 2 to their actual semantic catches after $name', async ({ before, after }) => {
    const root = await workspace();
    const previous = await indexSource(root, before);
    const current = await indexSource(root, after);
    expect(helperForThrow(previous, '1').identity.containerSemanticFingerprint)
      .not.toBe(helperForThrow(previous, '2').identity.containerSemanticFingerprint);
    expectSameSemanticCatch(previous, current, '1');
    expectSameSemanticCatch(previous, current, '2');
  });

  it('separates lexical nesting while fingerprints deterministically cover finally presence and body', async () => {
    const root = await workspace();
    const identicalInner = helperCatch('1', { finallyBody: 'cleanup(1);' });
    const snapshot = await indexSource(root, `function cleanup(value: number): void { void value; }
export function entry(): void {
  try { throw 'outer'; } catch (outerError) {
    void outerError;
    ${identicalInner}
  }
  ${identicalInner}
  ${helperCatch('1')}
  ${helperCatch('1', { finallyBody: 'cleanup(2);' })}
}
`);
    const catchHelpers = helpers(snapshot);
    expect(catchHelpers).toHaveLength(4);
    const nested = catchHelpers[0];
    const directSameTry = catchHelpers[1];
    const withoutFinally = catchHelpers[2];
    const changedFinally = catchHelpers[3];
    if (nested === undefined || directSameTry === undefined || withoutFinally === undefined || changedFinally === undefined) throw new Error('nested catch fixture missing');
    expect(nested.identity.containerSemanticFingerprint).toBe(directSameTry.identity.containerSemanticFingerprint);
    expect(nested.identity.lexicalParentFingerprint).not.toBe(directSameTry.identity.lexicalParentFingerprint);
    expect(withoutFinally.identity.containerSemanticFingerprint).not.toBe(directSameTry.identity.containerSemanticFingerprint);
    expect(changedFinally.identity.containerSemanticFingerprint).not.toBe(directSameTry.identity.containerSemanticFingerprint);
    expect(changedFinally.identity.containerSemanticFingerprint).not.toBe(withoutFinally.identity.containerSemanticFingerprint);
  });

  it('keeps catch identities stable and exact across comment and whitespace trivia only', async () => {
    const root = await workspace();
    const previous = await indexSource(root, program(helperCatch('1'), helperCatch('2')));
    const current = await indexSource(root, `export function entry(): void {
      // comment before the first try
      ${helperCatch('1', { leadingComment: '/* catch trivia */', bodyComment: '/* helper trivia */' })}

      ${helperCatch('2', { leadingComment: '// second catch trivia', bodyComment: '// body trivia\n' })}
    }
`);
    const matches = relocateFunctionFragments(previous.fragments, current.fragments);
    for (const thrown of ['1', '2']) {
      const oldHelper = helperForThrow(previous, thrown);
      const newHelper = helperForThrow(current, thrown);
      expect(newHelper.id).toBe(oldHelper.id);
      expect(newHelper.identity.containerSemanticFingerprint).toBe(oldHelper.identity.containerSemanticFingerprint);
      expect(relocationFor(matches, oldHelper)).toMatchObject({ status: 'matched', currentId: newHelper.id, certainty: 'exact' });
    }
  });

  it.each([
    {
      name: 'insertion',
      before: program(helperCatch('1', { leadingComment: '/* first */' }), helperCatch('1', { leadingComment: '/* second */' })),
      after: program(helperCatch('1', { leadingComment: '/* inserted */' }), helperCatch('1', { leadingComment: '/* first */' }), helperCatch('1', { leadingComment: '/* second */' })),
    },
    {
      name: 'deletion',
      before: program(helperCatch('1', { leadingComment: '/* first */' }), helperCatch('1', { leadingComment: '/* second */' }), helperCatch('1', { leadingComment: '/* third */' })),
      after: program(helperCatch('1', { leadingComment: '/* first */' }), helperCatch('1', { leadingComment: '/* third */' })),
    },
    {
      name: 'reorder',
      before: program(helperCatch('1', { leadingComment: '/* first */' }), helperCatch('1', { leadingComment: '/* second */' })),
      after: program(helperCatch('1', { leadingComment: '/* second */' }), helperCatch('1', { leadingComment: '/* first */' })),
    },
  ])('returns deterministic ambiguity for truly identical repeated catches after $name', async ({ before, after }) => {
    const root = await workspace();
    const previous = await indexSource(root, before);
    const current = await indexSource(root, after);
    const expectedCandidates = helpers(current).map((fragment) => fragment.id).sort((left, right) => left.localeCompare(right));
    const matches = relocateFunctionFragments(previous.fragments, current.fragments);
    for (const oldHelper of helpers(previous)) {
      expect(relocationFor(matches, oldHelper)).toMatchObject({ status: 'ambiguous', candidates: expectedCandidates });
    }
  });

  it('keeps FlowPage placements and BusinessNode members on the same semantic catches through persistence', async () => {
    const root = await workspace();
    const previous = await indexSource(root, program(helperCatch('1'), helperCatch('2')));
    const oldOne = helperForThrow(previous, '1');
    const oldTwo = helperForThrow(previous, '2');
    const page = buildFlowPage(previous, oldOne.id);
    const node = createBusinessNode({
      id: 'catch-business',
      projectId: page.projectId,
      name: 'Catch business',
      memberIds: [oldOne.id, oldTwo.id],
      availableFragmentIds: new Set(previous.fragments.map((fragment) => fragment.id)),
      now: '2026-09-01T00:00:00.000Z',
    });
    const state: UserWorkspaceState = {
      schemaVersion: 1,
      flowPages: [page, buildBusinessNodeFlowPage(previous, node)],
      businessNodes: [node],
      recentFlowPageIds: [page.id],
    };

    const current = await indexSource(root, program(plainCatch, helperCatch('2'), helperCatch('1')));
    const migration = migrateUserAssets(state, relocateFunctionFragments(previous.fragments, current.fragments));
    expect(migration.unresolved).toEqual([]);
    const migrated = rebuildMigratedFlowPages(migration.state, current);
    const currentOne = helperForThrow(current, '1');
    const currentTwo = helperForThrow(current, '2');
    expect(migrated.flowPages[0]?.entry.id).toBe(currentOne.id);
    expect(migrated.flowPages[0]?.placements[0]?.targetId).toBe(currentOne.id);
    expect(migrated.businessNodes[0]?.members.map((member) => member.fragmentId)).toEqual([currentOne.id, currentTwo.id]);
    expect(currentOne.identity.containerSemanticFingerprint).toBe(oldOne.identity.containerSemanticFingerprint);
    expect(currentTwo.identity.containerSemanticFingerprint).toBe(oldTwo.identity.containerSemanticFingerprint);

    const storage = new JsonStorage(join(root, '.state'), 'catch-assets');
    await storage.saveUserState(migrated, 1);
    const reloaded = await new JsonStorage(join(root, '.state'), 'catch-assets').loadUserState();
    expect(reloaded.flowPages[0]?.entry.id).toBe(currentOne.id);
    expect(reloaded.flowPages[0]?.placements[0]?.targetId).toBe(currentOne.id);
    expect(reloaded.businessNodes[0]?.members.map((member) => member.fragmentId)).toEqual([currentOne.id, currentTwo.id]);
  });

  it('parses and persists legacy recipe-v2 identities without semantic fields but never marks them exact', async () => {
    const root = await workspace();
    const current = await indexSource(root, program(helperCatch('1'), helperCatch('2')));
    const legacySnapshot: AdapterIndexSnapshot = {
      ...current,
      fragments: current.fragments.map((fragment) => {
        if (fragment.identity.lexicalFingerprint === undefined || fragment.identity.containerFingerprint === undefined) {
          throw new Error('current recipe-v2 identity is missing structural fingerprints');
        }
        const identity = {
          recipeVersion: fragment.identity.recipeVersion,
          signatureHash: fragment.identity.signatureHash,
          declarationFingerprint: fragment.identity.declarationFingerprint,
          lexicalFingerprint: fragment.identity.lexicalFingerprint,
          containerFingerprint: fragment.identity.containerFingerprint,
        };
        return { ...fragment, identity };
      }),
    };
    const parsed = parseAdapterIndexSnapshot(legacySnapshot);
    const storage = new JsonStorage(join(root, '.legacy-cache'), 'legacy-catch');
    await storage.saveIndexCache(parsed);
    const loaded = await storage.loadIndexCache();
    if (loaded === undefined) throw new Error('legacy cache did not load');
    const legacyHelper = helperForThrow(loaded, '1');
    const currentHelper = helperForThrow(current, '1');
    expect(relocationFor(relocateFunctionFragments(loaded.fragments, current.fragments), legacyHelper))
      .toMatchObject({ status: 'matched', currentId: currentHelper.id, certainty: 'probable' });

    const conflicting: FunctionFragment = {
      ...currentHelper,
      identity: { ...currentHelper.identity, containerSemanticFingerprint: 'different-container-semantics' },
    };
    expect(relocationFor(relocateFunctionFragments([currentHelper], [conflicting]), currentHelper).status).not.toBe('matched');
  });
});
