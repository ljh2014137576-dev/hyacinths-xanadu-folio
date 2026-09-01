import type { XanaduDesktopApi } from '../ipc/contracts.js';

declare global {
  interface Window {
    readonly xanadu: XanaduDesktopApi;
  }
}

export {};
