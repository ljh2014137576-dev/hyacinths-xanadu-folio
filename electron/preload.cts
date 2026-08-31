import { contextBridge, ipcRenderer } from 'electron';
import type { XanaduDesktopApi } from '../src/ipc/contracts.js';

const api: XanaduDesktopApi = Object.freeze({
  getAppInfo: () => ipcRenderer.invoke('xanadu:app-info') as ReturnType<XanaduDesktopApi['getAppInfo']>,
  selectWorkspace: () => ipcRenderer.invoke('xanadu:select-workspace') as ReturnType<XanaduDesktopApi['selectWorkspace']>,
  getUtilityHealth: () => ipcRenderer.invoke('xanadu:utility-health') as ReturnType<XanaduDesktopApi['getUtilityHealth']>,
});

contextBridge.exposeInMainWorld('xanadu', api);
