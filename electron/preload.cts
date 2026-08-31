import { contextBridge, ipcRenderer } from 'electron';
import {
  indexProgressEnvelopeSchema,
  type IndexProgressListener,
  type XanaduDesktopApi,
} from '../src/ipc/contracts.js';

const api: XanaduDesktopApi = Object.freeze({
  getAppInfo: () => ipcRenderer.invoke('xanadu:app-info') as ReturnType<XanaduDesktopApi['getAppInfo']>,
  selectWorkspace: () => ipcRenderer.invoke('xanadu:select-workspace') as ReturnType<XanaduDesktopApi['selectWorkspace']>,
  getUtilityHealth: () => ipcRenderer.invoke('xanadu:utility-health') as ReturnType<XanaduDesktopApi['getUtilityHealth']>,
  indexWorkspace: (request: Parameters<XanaduDesktopApi['indexWorkspace']>[0]) => ipcRenderer.invoke('xanadu:index-workspace', request) as ReturnType<XanaduDesktopApi['indexWorkspace']>,
  cancelIndex: (request: Parameters<XanaduDesktopApi['cancelIndex']>[0]) => ipcRenderer.invoke('xanadu:cancel-index', request) as ReturnType<XanaduDesktopApi['cancelIndex']>,
  onIndexProgress: (listener: IndexProgressListener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const parsed = indexProgressEnvelopeSchema.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on('xanadu:index-progress', handler);
    return () => ipcRenderer.removeListener('xanadu:index-progress', handler);
  },
  loadUserState: (request: Parameters<XanaduDesktopApi['loadUserState']>[0]) => ipcRenderer.invoke('xanadu:load-user-state', request) as ReturnType<XanaduDesktopApi['loadUserState']>,
  saveUserState: (request: Parameters<XanaduDesktopApi['saveUserState']>[0]) => ipcRenderer.invoke('xanadu:save-user-state', request) as ReturnType<XanaduDesktopApi['saveUserState']>,
  clearIndexCache: (request: Parameters<XanaduDesktopApi['clearIndexCache']>[0]) => ipcRenderer.invoke('xanadu:clear-index-cache', request) as ReturnType<XanaduDesktopApi['clearIndexCache']>,
});

contextBridge.exposeInMainWorld('xanadu', api);
