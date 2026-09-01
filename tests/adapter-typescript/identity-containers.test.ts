// @vitest-environment node
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { indexTypeScriptProjectOperation } from '../../src/adapter-typescript/index.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

const createProject = async (source: string): Promise<string> => {
  const root = await fs.mkdtemp(join(tmpdir(), 'xanadu-identities-'));
  roots.push(root);
  await fs.mkdir(join(root, 'src'));
  await fs.writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ['src'] }), 'utf8');
  await fs.writeFile(join(root, 'src', 'index.ts'), source, 'utf8');
  return root;
};

describe('stable lexical container identities', () => {
  it('keeps nested helpers, namespaces, class methods and overloads unique without offsets', async () => {
    const root = await createProject(`
export function outerA() { const helper = (value: number) => value + 1; return helper(1); }
export function outerB() { const helper = (value: number) => value + 1; return helper(2); }
namespace SpaceA { export const helper = (value: number) => value + 1; }
namespace SpaceB { export const helper = (value: number) => value + 1; }
export class Service {
  methodA() { const helper = (value: number) => value + 1; return helper(1); }
  methodB() { const helper = (value: number) => value + 1; return helper(2); }
}
export function overloaded(value: number): number;
export function overloaded(value: string): string;
export function overloaded(value: number | string): number | string { return value; }
`);
    const result = await indexTypeScriptProjectOperation(root);
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('identity project failed');
    const ids = result.snapshot.fragments.map((fragment) => fragment.id);
    expect(new Set(ids).size).toBe(ids.length);
    const helperNames = result.snapshot.fragments.filter((fragment) => fragment.displayName === 'helper').map((fragment) => fragment.qualifiedName);
    expect(helperNames).toEqual(expect.arrayContaining([
      'outerA.helper', 'outerB.helper', 'SpaceA.helper', 'SpaceB.helper', 'Service.methodA.helper', 'Service.methodB.helper',
    ]));
    expect(result.snapshot.fragments.filter((fragment) => fragment.displayName === 'overloaded').map((fragment) => fragment.id).every((id, index, all) => all.indexOf(id) === index)).toBe(true);
  });

  it('rejects an actual identity collision before relation generation', async () => {
    const root = await createProject(`
export function duplicate(value: number): number { return value + 1; }
export function duplicate(value: number): number { return value + 1; }
`);
    const result = await indexTypeScriptProjectOperation(root);
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.message).toContain('collision');
  });
});
