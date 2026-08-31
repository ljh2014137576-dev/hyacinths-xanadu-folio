import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  isEmptyRequest,
  workspaceSummarySchema,
  type AppInfo,
  type UtilityHealth,
  type WorkspaceSummary,
} from '../src/ipc/contracts.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoots = new Map<string, string>();

const senderIsTrusted = (event: IpcMainInvokeEvent): boolean => {
  const senderUrl = event.senderFrame?.url ?? '';
  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl !== undefined) {
    return senderUrl.startsWith(developmentUrl);
  }
  return senderUrl.startsWith('file://');
};

const assertTrustedEmptyRequest = (event: IpcMainInvokeEvent, request: unknown): void => {
  if (!senderIsTrusted(event) || !isEmptyRequest(request)) {
    throw new Error('IPC request rejected');
  }
};

const registerWorkspace = (rootPath: string): WorkspaceSummary => {
  const handle = randomUUID();
  workspaceRoots.set(handle, rootPath);
  return workspaceSummarySchema.parse({ handle, displayName: rootPath.split(/[\\/]/).at(-1) ?? 'workspace' });
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
    const allowed = developmentUrl !== undefined ? targetUrl.startsWith(developmentUrl) : targetUrl.startsWith('file://');
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
