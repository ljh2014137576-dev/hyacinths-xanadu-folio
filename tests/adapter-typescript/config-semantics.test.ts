// @vitest-environment node
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { indexTypeScriptProjectOperation } from '../../src/adapter-typescript/index.js';
import { SecureTypeScriptSystem } from '../../src/adapter-typescript/secure-system.js';

const temporaryRoots: string[] = [];
afterEach(async () => Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

const createWorkspace = async (config: object): Promise<string> => {
  const root = await fs.mkdtemp(join(tmpdir(), 'xanadu-config-'));
  temporaryRoots.push(root);
  await fs.writeFile(join(root, 'tsconfig.json'), JSON.stringify(config), 'utf8');
  return root;
};

const snapshotFrom = async (root: string) => {
  const result = await indexTypeScriptProjectOperation(root);
  if (result.status !== 'completed' && result.status !== 'partial') throw new Error(`Index failed: ${result.status}`);
  return result.snapshot;
};

describe('TypeScript-compatible config enumeration', () => {
  it('indexes the current repository directory includes with non-empty business symbols', async () => {
    const result = await indexTypeScriptProjectOperation(resolve('.'));
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('repository index failed');
    expect(result.snapshot.fragments.length).toBeGreaterThan(50);
    expect(result.snapshot.fragments.some((fragment) => fragment.displayName === 'indexTypeScriptProjectOperation')).toBe(true);
    expect(result.snapshot.fragments.some((fragment) => fragment.displayName === 'WorkspaceView')).toBe(true);
  }, 60_000);

  it('treats include directory as recursive and directory exclude as recursive', async () => {
    const root = await createWorkspace({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ['src'], exclude: ['src/excluded'] });
    await fs.mkdir(join(root, 'src', 'excluded'), { recursive: true });
    await fs.writeFile(join(root, 'src', 'kept.ts'), 'export function kept() { return 1; }\n', 'utf8');
    await fs.writeFile(join(root, 'src', 'excluded', 'skip.ts'), 'export function skipped() { return 2; }\n', 'utf8');
    const snapshot = await snapshotFrom(root);
    expect(snapshot.fragments.some((fragment) => fragment.displayName === 'kept')).toBe(true);
    expect(snapshot.fragments.some((fragment) => fragment.displayName === 'skipped')).toBe(false);
  });

  it('supports default include while excluding dependency enumeration', async () => {
    const root = await createWorkspace({ compilerOptions: { strict: true, noEmit: true, types: [] } });
    await fs.mkdir(join(root, 'node_modules', 'ignored'), { recursive: true });
    await fs.writeFile(join(root, 'main.ts'), 'export function defaultIncluded() { return 1; }\n', 'utf8');
    await fs.writeFile(join(root, 'node_modules', 'ignored', 'index.ts'), 'export function dependencySource() { return 2; }\n', 'utf8');
    const snapshot = await snapshotFrom(root);
    expect(snapshot.fragments.some((fragment) => fragment.displayName === 'defaultIncluded')).toBe(true);
    expect(snapshot.fragments.some((fragment) => fragment.displayName === 'dependencySource')).toBe(false);
  });

  it('resolves legal workspace typeRoots on demand without pre-enumerating node_modules', async () => {
    const root = await createWorkspace({
      compilerOptions: { strict: true, noEmit: true, module: 'NodeNext', moduleResolution: 'NodeNext', typeRoots: ['./node_modules/@types'], types: ['custom'] },
      include: ['src'],
    });
    await fs.mkdir(join(root, 'src'), { recursive: true });
    await fs.mkdir(join(root, 'node_modules', '@types', 'custom'), { recursive: true });
    await fs.mkdir(join(root, 'node_modules', 'workspace-package'), { recursive: true });
    await fs.writeFile(join(root, 'src', 'index.ts'), "import { packageValue } from 'workspace-package';\nexport function typed() { return customValue + packageValue; }\n", 'utf8');
    await fs.writeFile(join(root, 'node_modules', '@types', 'custom', 'index.d.ts'), 'declare const customValue: number;\n', 'utf8');
    await fs.writeFile(join(root, 'node_modules', 'workspace-package', 'package.json'), '{"name":"workspace-package","types":"index.d.ts"}', 'utf8');
    await fs.writeFile(join(root, 'node_modules', 'workspace-package', 'index.d.ts'), 'export declare const packageValue: number;\n', 'utf8');
    const snapshot = await snapshotFrom(root);
    expect(snapshot.fragments.some((fragment) => fragment.displayName === 'typed')).toBe(true);
    expect(snapshot.diagnostics.some((diagnostic) => diagnostic.code === 'TS2304')).toBe(false);
    expect(snapshot.diagnostics.some((diagnostic) => diagnostic.code === 'TS2307')).toBe(false);

    const system = new SecureTypeScriptSystem(root);
    expect(system.enumeratedFileCount).toBe(0);
    await system.prepareProjectFileIndex(new AbortController().signal);
    expect(system.enumeratedProjectRelativePaths.some((path) => path.startsWith('node_modules/'))).toBe(false);
  });

  it('supports cancellable batched enumeration', async () => {
    const root = await createWorkspace({ compilerOptions: { noEmit: true, types: [] }, include: ['src'] });
    await fs.mkdir(join(root, 'src'));
    await Promise.all(Array.from({ length: 180 }, (_, index) => fs.writeFile(join(root, 'src', `file-${index}.ts`), `export const value${index} = ${index};\n`, 'utf8')));
    const system = new SecureTypeScriptSystem(root);
    const controller = new AbortController();
    await expect(system.prepareProjectFileIndex(controller.signal, () => controller.abort())).rejects.toThrow('cancelled');
  });
});
