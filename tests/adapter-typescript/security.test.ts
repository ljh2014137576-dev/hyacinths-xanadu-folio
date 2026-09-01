// @vitest-environment node
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileSystemAdapterHost, indexTypeScriptProject } from '../../src/adapter-typescript/index.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('authorized TypeScript workspace boundary', () => {
  it('rejects config/include/import and symlink escapes before they become source facts', async () => {
    const temporary = await fs.mkdtemp(join(tmpdir(), 'xanadu-boundary-'));
    temporaryRoots.push(temporary);
    const workspace = join(temporary, 'workspace');
    const source = join(workspace, 'src');
    const outsideDirectory = join(temporary, 'outside-dir');
    await fs.mkdir(source, { recursive: true });
    await fs.mkdir(outsideDirectory, { recursive: true });
    await fs.writeFile(join(temporary, 'outside.ts'), "export const SECRET_SENTINEL = 'must-not-read';\n", 'utf8');
    await fs.writeFile(join(temporary, 'outside-config.json'), '{"compilerOptions":{"strict":false}}', 'utf8');
    await fs.writeFile(join(outsideDirectory, 'escape.ts'), "export const SYMLINK_SECRET = 'must-not-read';\n", 'utf8');
    await fs.writeFile(join(source, 'index.ts'), "import { SECRET_SENTINEL } from '../../outside.js';\nexport function inside() { return SECRET_SENTINEL; }\n", 'utf8');
    await fs.symlink(outsideDirectory, join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await fs.writeFile(join(workspace, 'tsconfig.json'), JSON.stringify({
      extends: '../outside-config.json',
      compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', types: [], noEmit: true },
      include: ['src/**/*.ts', '../outside.ts'],
    }), 'utf8');

    const snapshot = await indexTypeScriptProject(workspace);
    expect(snapshot.diagnostics.some((diagnostic) => diagnostic.code === 'WORKSPACE_PATH_ESCAPE')).toBe(true);
    expect(snapshot.diagnostics.some((diagnostic) => diagnostic.code === 'WORKSPACE_SYMLINK_ESCAPE')).toBe(true);
    expect(Object.values(snapshot.sourceContents).join('\n')).not.toContain('must-not-read');
    expect(snapshot.sourceFiles.every((file) => !file.projectRelativePath.includes('..'))).toBe(true);
  });

  it('rejects direct AdapterHost traversal with either slash style', async () => {
    const temporary = await fs.mkdtemp(join(tmpdir(), 'xanadu-host-'));
    temporaryRoots.push(temporary);
    const workspace = join(temporary, 'workspace');
    await fs.mkdir(workspace);
    await fs.writeFile(join(workspace, 'tsconfig.json'), '{}', 'utf8');
    const host = createFileSystemAdapterHost(workspace);
    await expect(host.readFile('../outside.ts')).rejects.toThrow('rejected');
    await expect(host.readFile('..\\outside.ts')).rejects.toThrow('rejected');
  });
});
