import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AdapterIndexSnapshot } from '../adapter-api/index.js';
import {
  createEmptyUserWorkspaceState,
  parseUserWorkspaceState,
  type UserWorkspaceState,
} from '../model/index.js';

const safeWorkspaceKey = (value: string): string => createHash('sha256').update(value).digest('hex');

const readJson = async (filePath: string): Promise<unknown> => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
};

const atomicWriteJson = async (filePath: string, value: unknown): Promise<void> => {
  await fs.mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await fs.rename(temporaryPath, filePath);
};

export class JsonStorage {
  private readonly key: string;

  constructor(private readonly rootPath: string, workspaceIdentity: string) {
    this.key = safeWorkspaceKey(workspaceIdentity);
  }

  private get assetPath(): string {
    return join(this.rootPath, 'assets', `${this.key}.json`);
  }

  private get cachePath(): string {
    return join(this.rootPath, 'cache', `${this.key}.json`);
  }

  async loadUserState(): Promise<UserWorkspaceState> {
    const value = await readJson(this.assetPath);
    return value === undefined ? createEmptyUserWorkspaceState() : parseUserWorkspaceState(value);
  }

  saveUserState(state: UserWorkspaceState): Promise<void> {
    return atomicWriteJson(this.assetPath, parseUserWorkspaceState(state));
  }

  async loadIndexCache(): Promise<AdapterIndexSnapshot | undefined> {
    const value = await readJson(this.cachePath);
    if (value === undefined || typeof value !== 'object' || value === null) return undefined;
    return value as AdapterIndexSnapshot;
  }

  saveIndexCache(snapshot: AdapterIndexSnapshot): Promise<void> {
    return atomicWriteJson(this.cachePath, snapshot);
  }

  async clearIndexCache(): Promise<void> {
    await fs.rm(this.cachePath, { force: true });
  }
}
