// @vitest-environment node
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import ts from '@typescript/typescript6';
import { createFileSystemAdapterHost, indexTypeScriptProjectOperation } from '../../src/adapter-typescript/index.js';
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
  it('matches official wildcard semantics for directories, dot files, literals, excludes, extends and outDir', async () => {
    const root = await createWorkspace({ compilerOptions: { noEmit: true, types: [] } });
    const files = [
      'src/a.ts', 'src/b.ts', 'src/aa.ts', 'src/.hidden.ts', 'src/{a,b}.ts', 'src/[ab].ts',
      'src/deep/value.ts', 'src/.dot/value.ts', 'src/excluded/skip.ts', 'out/generated.ts',
    ];
    for (const file of files) {
      await fs.mkdir(join(root, file.split('/').slice(0, -1).join('/')), { recursive: true });
      await fs.writeFile(join(root, file), `export const value = ${JSON.stringify(file)};\n`, 'utf8');
    }
    await fs.mkdir(join(root, 'config'));
    await fs.writeFile(join(root, 'config', 'base.json'), '{"compilerOptions":{"outDir":"../out","types":[]}}', 'utf8');
    const cases = [
      { include: ['src'] }, { include: ['src/*.ts'] }, { include: ['src/?.ts'] }, { include: ['src/**/*.ts'] },
      { include: ['src/{a,b}.ts'] }, { include: ['src/@(a|b).ts'] }, { include: ['src/[ab].ts'] },
      { include: ['src'], exclude: ['src/excluded'] }, {},
      { extends: './config/base.json', include: ['src', 'out'] },
    ];
    const system = new SecureTypeScriptSystem(root);
    await system.prepareProjectFileIndex(new AbortController().signal);
    for (const config of cases) {
      const official = ts.parseJsonConfigFileContent(config, ts.sys, root, undefined, join(root, 'tsconfig.json')).fileNames
        .map((file) => file.slice(root.length + 1).replaceAll('\\', '/')).sort();
      const secured = ts.parseJsonConfigFileContent(config, system.createParseConfigHost(), root, undefined, join(root, 'tsconfig.json')).fileNames
        .map((file) => file.slice(root.length + 1).replaceAll('\\', '/')).sort();
      expect(secured, JSON.stringify(config)).toEqual(official);
    }
  });

  it('includes in-root file/directory links with logical paths and rejects external targets', async () => {
    const root = await createWorkspace({ compilerOptions: { noEmit: true, types: [] }, include: ['linked', 'linked-file.ts', 'outside-link'] });
    await fs.mkdir(join(root, 'real'));
    await fs.writeFile(join(root, 'real', 'inside.ts'), 'export function linkedInside() { return 1; }\n', 'utf8');
    await fs.symlink(join(root, 'real'), join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    try {
      await fs.symlink(join(root, 'real', 'inside.ts'), join(root, 'linked-file.ts'), 'file');
    } catch (error: unknown) {
      if (process.platform !== 'win32' || typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'EPERM') throw error;
      await fs.link(join(root, 'real', 'inside.ts'), join(root, 'linked-file.ts'));
    }
    const outside = await fs.mkdtemp(join(tmpdir(), 'xanadu-outside-link-'));
    temporaryRoots.push(outside);
    await fs.writeFile(join(outside, 'escape.ts'), 'export const escaped = true;\n', 'utf8');
    await fs.symlink(outside, join(root, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir');
    const snapshot = await snapshotFrom(root);
    const aliasFiles = snapshot.sourceFiles.filter((file) => file.projectRelativePath === 'linked/inside.ts' || file.projectRelativePath === 'linked-file.ts');
    expect(aliasFiles, JSON.stringify(snapshot.sourceFiles.map((file) => file.projectRelativePath))).toHaveLength(1);
    expect(snapshot.sourceFiles.some((file) => file.projectRelativePath.includes('outside-link'))).toBe(false);
    expect(snapshot.diagnostics.some((diagnostic) => diagnostic.code === 'WORKSPACE_SYMLINK_ESCAPE')).toBe(true);
  });

  it('matches TypeScript alias ownership and emits one physical SourceFile', async () => {
    const root = await createWorkspace({ compilerOptions: { noEmit: true, types: [] } });
    await fs.mkdir(join(root, 'real'));
    await fs.writeFile(join(root, 'real', 'linked.ts'), 'export function linkedFunction() { return 1; }\n', 'utf8');
    await fs.symlink(join(root, 'real'), join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const system = new SecureTypeScriptSystem(root);
    await system.prepareProjectFileIndex(new AbortController().signal);
    const relativeNames = (names: readonly string[]) => names.map((file) => file.slice(root.length + 1).replaceAll('\\', '/')).sort();
    const parse = (config: object) => relativeNames(ts.parseJsonConfigFileContent(config, system.createParseConfigHost(), root, undefined, join(root, 'tsconfig.json')).fileNames);
    const official = (config: object) => relativeNames(ts.parseJsonConfigFileContent(config, ts.sys, root, undefined, join(root, 'tsconfig.json')).fileNames);
    for (const config of [{}, { include: ['real'] }, { include: ['linked'] }, { include: ['real', 'linked'] }, { include: ['real', 'linked'], exclude: ['real', 'linked'] }]) expect(parse(config), JSON.stringify({ config, secured: parse(config), official: official(config) })).toEqual(official(config));
    expect(parse({ include: ['real', 'linked'] })).toHaveLength(1);
    expect(parse({ include: ['real', 'linked'], exclude: ['real'] })).toEqual(['linked/linked.ts']);
    expect(parse({ include: ['real', 'linked'], exclude: ['linked'] })).toEqual(['real/linked.ts']);
    const snapshot = await snapshotFrom(root);
    expect(snapshot.sourceFiles.filter((file) => file.projectRelativePath.includes('linked.ts'))).toHaveLength(1);
    expect(snapshot.fragments.filter((fragment) => fragment.displayName === 'linkedFunction')).toHaveLength(1);
    expect(new Set(snapshot.fragments.map((fragment) => fragment.id)).size).toBe(snapshot.fragments.length);
  });

  it('indexes the current repository directory includes with non-empty business symbols', async () => {
    const result = await indexTypeScriptProjectOperation(resolve('.'));
    expect(['completed', 'partial']).toContain(result.status);
    if (result.status !== 'completed' && result.status !== 'partial') throw new Error('repository index failed');
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
  }, 60_000);

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

  it('allows an excluded build/vendor file to enter Program through a legal import', async () => {
    const root = await createWorkspace({ compilerOptions: { strict: true, noEmit: true, module: 'ESNext', moduleResolution: 'Bundler', types: [] }, include: ['src'], exclude: ['build', 'vendor'] });
    await fs.mkdir(join(root, 'src'));
    await fs.mkdir(join(root, 'build'));
    await fs.mkdir(join(root, 'vendor'));
    await fs.writeFile(join(root, 'src', 'index.ts'), "import { built } from '../build/generated.js';\nimport { vendored } from '../vendor/library.js';\nexport function imported() { return built + vendored; }\n", 'utf8');
    await fs.writeFile(join(root, 'build', 'generated.ts'), 'export const built = 1;\n', 'utf8');
    await fs.writeFile(join(root, 'vendor', 'library.ts'), 'export const vendored = 2;\n', 'utf8');
    const snapshot = await snapshotFrom(root);
    expect(snapshot.sourceFiles.some((file) => file.projectRelativePath === 'build/generated.ts')).toBe(true);
    expect(snapshot.sourceFiles.some((file) => file.projectRelativePath === 'vendor/library.ts')).toBe(true);
    expect(snapshot.fragments.some((fragment) => fragment.displayName === 'imported')).toBe(true);
  });

  it('supports cancellable batched enumeration', async () => {
    const root = await createWorkspace({ compilerOptions: { noEmit: true, types: [] }, include: ['src'] });
    await fs.mkdir(join(root, 'src'));
    await Promise.all(Array.from({ length: 180 }, (_, index) => fs.writeFile(join(root, 'src', `file-${index}.ts`), `export const value${index} = ${index};\n`, 'utf8')));
    const system = new SecureTypeScriptSystem(root);
    const controller = new AbortController();
    await expect(system.prepareProjectFileIndex(controller.signal, () => controller.abort())).rejects.toThrow('cancelled');
  });

  it('uses observable cancellable heavy-dir exclusions for no-root-config detection and reports nested config', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'xanadu-detect-'));
    temporaryRoots.push(root);
    await fs.mkdir(join(root, 'src'));
    await fs.mkdir(join(root, 'build'));
    await fs.mkdir(join(root, 'vendor'));
    await fs.mkdir(join(root, 'nested'));
    await fs.writeFile(join(root, 'build', 'generated.ts'), 'export const buildOnly = 1;\n', 'utf8');
    await fs.writeFile(join(root, 'vendor', 'library.ts'), 'export const vendorOnly = 1;\n', 'utf8');
    await fs.writeFile(join(root, 'nested', 'tsconfig.json'), JSON.stringify({ compilerOptions: { noEmit: true, types: [] }, include: ['.'] }), 'utf8');
    await fs.writeFile(join(root, 'nested', 'entry.ts'), 'export function nestedEntry() { return 1; }\n', 'utf8');
    await Promise.all(Array.from({ length: 150 }, (_, index) => fs.writeFile(join(root, 'src', `file-${index}.ts`), `export const detected${index} = ${index};\n`, 'utf8')));
    const progress: number[] = [];
    const host = createFileSystemAdapterHost(root, (event) => progress.push(event.completed));
    const detected = await host.listFiles(['**/*.ts']);
    expect(detected).toContain('nested/tsconfig.json');
    expect(detected.some((file) => file.startsWith('build/') || file.startsWith('vendor/'))).toBe(false);
    expect(progress.length).toBeGreaterThan(0);
    const result = await indexTypeScriptProjectOperation(root);
    expect(result.status === 'completed' && result.snapshot.fragments.some((fragment) => fragment.displayName === 'nestedEntry')).toBe(true);

    const cancelledController = new AbortController();
    const cancellingHost = createFileSystemAdapterHost(root, () => cancelledController.abort(), cancelledController.signal);
    await expect(cancellingHost.listFiles(['**/*.ts'])).rejects.toThrow('cancelled');
  });
});
