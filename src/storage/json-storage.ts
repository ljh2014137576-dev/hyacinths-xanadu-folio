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
  private saveQueue: Promise<void> = Promise.resolve();
  private lastGeneration = -1;
  private generationLoaded = false;

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
    if (value === undefined) {
      this.generationLoaded = true;
      return createEmptyUserWorkspaceState();
    }
    if (
      typeof value === 'object' && value !== null &&
      'storageVersion' in value && value.storageVersion === 1 &&
      'generation' in value && typeof value.generation === 'number' &&
      'state' in value
    ) {
      this.lastGeneration = value.generation;
      this.generationLoaded = true;
      return parseUserWorkspaceState(value.state);
    }
    this.generationLoaded = true;
    return parseUserWorkspaceState(value);
  }

  saveUserState(state: UserWorkspaceState, generation: number): Promise<{ readonly status: 'saved' | 'stale'; readonly generation: number }> {
    const parsedState = parseUserWorkspaceState(state);
    const operation = this.saveQueue.then(async () => {
      if (!this.generationLoaded) await this.loadUserState();
      if (generation <= this.lastGeneration) return { status: 'stale' as const, generation };
      await atomicWriteJson(this.assetPath, { storageVersion: 1, generation, state: parsedState });
      this.lastGeneration = generation;
      return { status: 'saved' as const, generation };
    });
    this.saveQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async loadIndexCache(): Promise<AdapterIndexSnapshot | undefined> {
    const value = await readJson(this.cachePath);
    if (value === undefined || typeof value !== 'object' || value === null || !('fragments' in value) || !Array.isArray(value.fragments)) return undefined;
    if (value.fragments.some((fragment: unknown) => typeof fragment !== 'object' || fragment === null || !('identity' in fragment))) return undefined;
    return value as AdapterIndexSnapshot;
  }

  saveIndexCache(snapshot: AdapterIndexSnapshot): Promise<void> {
    return atomicWriteJson(this.cachePath, snapshot);
  }

  async clearIndexCache(): Promise<void> {
    await fs.rm(this.cachePath, { force: true });
  }
}
