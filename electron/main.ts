import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
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
  indexWorkspaceResultSchema,
  isEmptyRequest,
  saveUserStateRequestSchema,
  workspaceHandleRequestSchema,
  workspaceSummarySchema,
  type AppInfo,
  type IndexWorkspaceResult,
  type UtilityHealth,
  type WorkspaceSummary,
} from '../src/ipc/contracts.js';
import type { IndexProgress } from '../src/adapter-api/index.js';
import { parseUserWorkspaceState } from '../src/model/index.js';
import { JsonStorage } from '../src/storage/json-storage.js';
import { isTrustedSenderUrl } from '../src/ipc/security.js';
import { relocateFunctionFragments } from '../src/adapter-api/relocation.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
interface WorkspaceRecord {
  readonly rootPath: string;
  readonly storage: JsonStorage;
}

interface ActiveIndex {
  readonly child: UtilityProcess;
  cancel(): void;
}

const workspaceRoots = new Map<string, WorkspaceRecord>();
const activeIndexes = new Map<string, ActiveIndex>();

const configuredUserData = process.env.XANADU_USER_DATA;
if (configuredUserData !== undefined) {
  app.setPath('userData', resolve(configuredUserData));
}

const senderIsTrusted = (event: IpcMainInvokeEvent): boolean => {
  const senderUrl = event.senderFrame?.url ?? '';
  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  return isTrustedSenderUrl(
    senderUrl,
    developmentUrl,
    pathToFileURL(join(currentDirectory, '../../dist/index.html')).href,
  );
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
    storage: new JsonStorage(
      join(app.getPath('userData'), 'xanadu-data'),
      createHash('sha256').update(resolve(rootPath).toLocaleLowerCase()).digest('hex'),
    ),
  });
  return workspaceSummarySchema.parse({ handle, displayName: rootPath.split(/[\\/]/).at(-1) ?? 'workspace' });
};

const getWorkspace = (handle: string): WorkspaceRecord => {
  const record = workspaceRoots.get(handle);
  if (record === undefined) throw new Error('Workspace handle is invalid or expired');
  return record;
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
): Promise<IndexWorkspaceResult> => new Promise((resolvePromise, reject) => {
  const child: UtilityProcess = utilityProcess.fork(join(currentDirectory, 'utility.js'));
  let settled = false;
  const finish = (): void => {
    activeIndexes.delete(requestId);
    child.kill();
  };
  const cancel = (): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    finish();
    resolvePromise({ status: 'cancelled' });
  };
  const timer = setTimeout(() => {
    settled = true;
    finish();
    reject(new Error('Indexer utility timed out'));
  }, 60_000);
  activeIndexes.set(requestId, { child, cancel });

  child.on('message', (message: unknown) => {
    if (typeof message !== 'object' || message === null || !('type' in message) || !('requestId' in message) || message.requestId !== requestId) return;
    if (message.type === 'index-progress' && 'progress' in message) {
      const parsed = indexProgressEnvelopeSchema.safeParse({ requestId, progress: message.progress });
      if (parsed.success) onProgress(parsed.data.progress);
      return;
    }
    if (message.type === 'index-result' && 'result' in message) {
      clearTimeout(timer);
      try {
        const result = indexWorkspaceResultSchema.parse(message.result) as unknown as IndexWorkspaceResult;
        settled = true;
        finish();
        resolvePromise(result);
      } catch (error: unknown) {
        settled = true;
        finish();
        reject(error instanceof Error ? error : new Error('Indexer result validation failed'));
      }
      return;
    }
    if (message.type === 'index-error') {
      clearTimeout(timer);
      settled = true;
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
    const previousCache = await workspace.storage.loadIndexCache();
    const result = await runUtilityIndex(workspace.rootPath, parsed.requestId, (progress) => {
      event.sender.send(IPC_CHANNELS.indexProgress, { requestId: parsed.requestId, progress });
    });
    if (result.status === 'completed' || result.status === 'partial') {
      const relocation = previousCache === undefined ? [] : relocateFunctionFragments(previousCache.fragments, result.snapshot.fragments);
      if (result.status === 'completed') await workspace.storage.saveIndexCache(result.snapshot);
      return { ...result, relocation };
    }
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.cancelIndex, (event, request: unknown): boolean => {
    assertTrustedRequest(event);
    const parsed = cancelIndexRequestSchema.parse(request);
    const active = activeIndexes.get(parsed.requestId);
    active?.cancel();
    return active !== undefined;
  });

  ipcMain.handle(IPC_CHANNELS.loadUserState, async (event, request: unknown) => {
    assertTrustedRequest(event);
    const parsed = workspaceHandleRequestSchema.parse(request);
    return getWorkspace(parsed.handle).storage.loadUserState();
  });

  ipcMain.handle(IPC_CHANNELS.saveUserState, async (event, request: unknown) => {
    assertTrustedRequest(event);
    const parsed = saveUserStateRequestSchema.parse(request);
    return getWorkspace(parsed.handle).storage.saveUserState(parseUserWorkspaceState(parsed.state), parsed.generation);
  });

  ipcMain.handle(IPC_CHANNELS.clearIndexCache, async (event, request: unknown) => {
    assertTrustedRequest(event);
    const parsed = workspaceHandleRequestSchema.parse(request);
    await getWorkspace(parsed.handle).storage.clearIndexCache();
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
