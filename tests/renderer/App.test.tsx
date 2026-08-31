import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App.js';
import type { UtilityHealth, XanaduDesktopApi } from '../../src/ipc/contracts.js';
import type { UserWorkspaceState } from '../../src/model/index.js';

describe('App shell', () => {
  const api: XanaduDesktopApi = {
    getAppInfo: vi.fn(() => Promise.resolve({ name: 'Xanadu', version: '0.1.0', platform: 'test' })),
    getUtilityHealth: vi.fn((): Promise<UtilityHealth> => Promise.resolve({ status: 'healthy', process: 'utility' })),
    selectWorkspace: vi.fn(() => Promise.resolve({ handle: 'opaque-handle', displayName: 'order-service' })),
    indexWorkspace: vi.fn(() => Promise.reject(new Error('not used in shell test'))),
    cancelIndex: vi.fn(() => Promise.resolve(false)),
    onIndexProgress: vi.fn(() => () => undefined),
    loadUserState: vi.fn((): Promise<UserWorkspaceState> => Promise.resolve({ schemaVersion: 1, flowPages: [], businessNodes: [], recentFlowPageIds: [] })),
    saveUserState: vi.fn(() => Promise.resolve()),
    clearIndexCache: vi.fn(() => Promise.resolve()),
  };

  beforeEach(() => {
    Object.defineProperty(window, 'xanadu', { configurable: true, value: api });
  });

  it('selects a workspace without rendering an absolute path', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: '选择本地项目' }));
    expect(await screen.findByText('已授权：order-service')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('C:\\');
  });
});
