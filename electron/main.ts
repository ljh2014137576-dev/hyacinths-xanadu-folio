import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  utilityProcess,
  type IpcMainInvokeEvent,
  type UtilityProcess,
} from 'electron';
import {
  IPC_CHANNELS,
  cancelIndexRequestSchema,
  indexProgressEnvelopeSchema,
  indexWorkspaceRequestSchema,
  isEmptyRequest,
  saveUserStateRequestSchema,
  workspaceHandleRequestSchema,
  workspaceSummarySchema,
  type AppInfo,
  type UtilityHealth,
  type WorkspaceSummary,
} from '../src/ipc/contracts.js';
import type { AdapterIndexSnapshot, IndexProgress } from '../src/adapter-api/index.js';
import { parseUserWorkspaceState } from '../src/model/index.js';
import { JsonStorage } from '../src/storage/json-storage.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
interface WorkspaceRecord {
  readonly rootPath: string;
  readonly storageIdentity: string;
}

const workspaceRoots = new Map<string, WorkspaceRecord>();
const activeIndexes = new Map<string, UtilityProcess>();

const configuredUserData = process.env.XANADU_USER_DATA;
if (configuredUserData !== undefined) {
  app.setPath('userData', resolve(configuredUserData));
}

const senderIsTrusted = (event: IpcMainInvokeEvent): boolean => {
  const senderUrl = event.senderFrame?.url ?? '';
  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl !== undefined) {
    try {
      return new URL(senderUrl).origin === new URL(developmentUrl).origin;
    } catch {
      return false;
    }
  }
  return senderUrl === pathToFileURL(join(currentDirectory, '../../dist/index.html')).href;
};

const assertTrustedEmptyRequest = (event: IpcMainInvokeEvent, request: unknown): void => {
  if (!senderIsTrusted(event) || !isEmptyRequest(request)) {
    throw new Error('IPC request rejected');
  }
};

const assertTrustedRequest = (event: IpcMainInvokeEvent): void => {
  if (!senderIsTrusted(event)) throw new Error('IPC sender rejected');
};

const registerWorkspace = (rootPath: string): WorkspaceSummary => {
  const handle = randomUUID();
  workspaceRoots.set(handle, {
    rootPath,
    storageIdentity: createHash('sha256').update(resolve(rootPath).toLocaleLowerCase()).digest('hex'),
  });
  return workspaceSummarySchema.parse({ handle, displayName: rootPath.split(/[\\/]/).at(-1) ?? 'workspace' });
};

const getWorkspace = (handle: string): WorkspaceRecord => {
  const record = workspaceRoots.get(handle);
  if (record === undefined) throw new Error('Workspace handle is invalid or expired');
  return record;
};

const storageFor = (record: WorkspaceRecord): JsonStorage =>
  new JsonStorage(join(app.getPath('userData'), 'xanadu-data'), record.storageIdentity);

const isSafeRelativePath = (value: string): boolean =>
  !isAbsolute(value) && value !== '..' && !value.startsWith('../') && !value.includes('/../');

const validateIndexSnapshot = (value: unknown): AdapterIndexSnapshot => {
  if (
    typeof value !== 'object' || value === null ||
    !('manifest' in value) || typeof value.manifest !== 'object' || value.manifest === null ||
    !('sourceFiles' in value) || !Array.isArray(value.sourceFiles) ||
    !('sourceContents' in value) || typeof value.sourceContents !== 'object' || value.sourceContents === null ||
    !('fragments' in value) || !Array.isArray(value.fragments) ||
    !('relations' in value) || !Array.isArray(value.relations) ||
    !('loops' in value) || !Array.isArray(value.loops) ||
    !('diagnostics' in value) || !Array.isArray(value.diagnostics)
  ) {
    throw new Error('Indexer utility returned an invalid snapshot');
  }
  const sourceFiles: unknown[] = value.sourceFiles;
  for (const file of sourceFiles) {
    if (
      typeof file !== 'object' || file === null ||
      !('projectRelativePath' in file) || typeof file.projectRelativePath !== 'string' ||
      !isSafeRelativePath(file.projectRelativePath)
    ) {
      throw new Error('Indexer snapshot contains an unsafe source path');
    }
  }
  return value as AdapterIndexSnapshot;
};

const runUtilityHealth = (): Promise<UtilityHealth> =>
  new Promise((resolve, reject) => {
    const child: UtilityProcess = utilityProcess.fork(join(currentDirectory, 'utility.js'));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Indexer utility health check timed out'));
    }, 5_000);

    child.once('message', (message: unknown) => {
      clearTimeout(timer);
      child.kill();
      if (
        typeof message === 'object' &&
        message !== null &&
        'status' in message &&
        message.status === 'healthy'
      ) {
        resolve({ status: 'healthy', process: 'utility' });
        return;
      }
      reject(new Error('Indexer utility returned an invalid health response'));
    });
    child.postMessage({ type: 'health' });
  });

const runUtilityIndex = (
  rootPath: string,
  requestId: string,
  onProgress: (progress: IndexProgress) => void,
): Promise<AdapterIndexSnapshot> => new Promise((resolvePromise, reject) => {
  const child: UtilityProcess = utilityProcess.fork(join(currentDirectory, 'utility.js'));
  activeIndexes.set(requestId, child);
  const finish = (): void => {
    activeIndexes.delete(requestId);
    child.kill();
  };
  const timer = setTimeout(() => {
    finish();
    reject(new Error('Indexer utility timed out'));
  }, 60_000);

  child.on('message', (message: unknown) => {
    if (typeof message !== 'object' || message === null || !('type' in message) || !('requestId' in message) || message.requestId !== requestId) return;
    if (message.type === 'index-progress' && 'progress' in message) {
      const parsed = indexProgressEnvelopeSchema.safeParse({ requestId, progress: message.progress });
      if (parsed.success) onProgress(parsed.data.progress);
      return;
    }
    if (message.type === 'index-result' && 'snapshot' in message) {
      clearTimeout(timer);
      try {
        const snapshot = validateIndexSnapshot(message.snapshot);
        finish();
        resolvePromise(snapshot);
      } catch (error: unknown) {
        finish();
        reject(error instanceof Error ? error : new Error('Indexer snapshot validation failed'));
      }
      return;
    }
    if (message.type === 'index-error') {
      clearTimeout(timer);
      finish();
      reject(new Error('message' in message && typeof message.message === 'string' ? message.message : 'Indexer utility failed'));
    }
  });
  child.postMessage({ type: 'index', requestId, rootPath });
});

const installIpcHandlers = (): void => {
  ipcMain.handle(IPC_CHANNELS.appInfo, (event, request: unknown): AppInfo => {
    assertTrustedEmptyRequest(event, request);
    return { name: app.getName(), version: app.getVersion(), platform: process.platform };
  });

  ipcMain.handle(IPC_CHANNELS.selectWorkspace, async (event, request: unknown) => {
    assertTrustedEmptyRequest(event, request);
    const demoWorkspace = process.env.XANADU_DEMO_WORKSPACE;
    if (demoWorkspace !== undefined) {
      return registerWorkspace(demoWorkspace);
    }
    const result = await dialog.showOpenDialog({
      title: '选择 TypeScript 项目',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths[0] === undefined) {
      return null;
    }
    return registerWorkspace(result.filePaths[0]);
  });

  ipcMain.handle(IPC_CHANNELS.utilityHealth, async (event, request: unknown) => {
    assertTrustedEmptyRequest(event, request);
    return runUtilityHealth();
  });

  ipcMain.handle(IPC_CHANNELS.indexWorkspace, async (event, request: unknown) => {
    assertTrustedRequest(event);
    const parsed = indexWorkspaceRequestSchema.parse(request);
    const workspace = getWorkspace(parsed.handle);
    const snapshot = await runUtilityIndex(workspace.rootPath, parsed.requestId, (progress) => {
      event.sender.send(IPC_CHANNELS.indexProgress, { requestId: parsed.requestId, progress });
    });
    await storageFor(workspace).saveIndexCache(snapshot);
    return snapshot;
  });

  ipcMain.handle(IPC_CHANNELS.cancelIndex, (event, request: unknown): boolean => {
    assertTrustedRequest(event);
    const parsed = cancelIndexRequestSchema.parse(request);
    const child = activeIndexes.get(parsed.requestId);
    child?.postMessage({ type: 'cancel', requestId: parsed.requestId });
    return child !== undefined;
  });

  ipcMain.handle(IPC_CHANNELS.loadUserState, async (event, request: unknown) => {
    assertTrustedRequest(event);
    const parsed = workspaceHandleRequestSchema.parse(request);
    return storageFor(getWorkspace(parsed.handle)).loadUserState();
  });

  ipcMain.handle(IPC_CHANNELS.saveUserState, async (event, request: unknown) => {
    assertTrustedRequest(event);
    const parsed = saveUserStateRequestSchema.parse(request);
    await storageFor(getWorkspace(parsed.handle)).saveUserState(parseUserWorkspaceState(parsed.state));
  });

  ipcMain.handle(IPC_CHANNELS.clearIndexCache, async (event, request: unknown) => {
    assertTrustedRequest(event);
    const parsed = workspaceHandleRequestSchema.parse(request);
    await storageFor(getWorkspace(parsed.handle)).clearIndexCache();
  });
};

const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#11151a',
    show: false,
    webPreferences: {
      preload: join(currentDirectory, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, targetUrl) => {
    const developmentUrl = process.env.VITE_DEV_SERVER_URL;
    let allowed = targetUrl === pathToFileURL(join(currentDirectory, '../../dist/index.html')).href;
    if (developmentUrl !== undefined) {
      try {
        allowed = new URL(targetUrl).origin === new URL(developmentUrl).origin;
      } catch {
        allowed = false;
      }
    }
    if (!allowed) {
      event.preventDefault();
    }
  });
  window.once('ready-to-show', () => window.show());

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl !== undefined) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(join(currentDirectory, '../../dist/index.html'));
  }
  return window;
};

app.whenReady().then(() => {
  installIpcHandlers();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error: unknown) => {
  console.error('Failed to start Xanadu', error);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
