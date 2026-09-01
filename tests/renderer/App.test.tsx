import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App.js';
import type { UtilityHealth, XanaduDesktopApi } from '../../src/ipc/contracts.js';
import type { UserWorkspaceState } from '../../src/model/index.js';
import { testSnapshot } from '../fixtures/adapter-snapshot.js';

describe('App shell', () => {
  const indexWorkspaceMock = vi.fn<XanaduDesktopApi['indexWorkspace']>(() => Promise.resolve({ status: 'completed', snapshot: testSnapshot }));
  const api: XanaduDesktopApi = {
    getAppInfo: vi.fn(() => Promise.resolve({ name: 'Xanadu', version: '0.1.0', platform: 'test' })),
    getUtilityHealth: vi.fn((): Promise<UtilityHealth> => Promise.resolve({ status: 'healthy', process: 'utility' })),
    selectWorkspace: vi.fn(() => Promise.resolve({ handle: 'opaque-handle', displayName: 'order-service' })),
    indexWorkspace: indexWorkspaceMock,
    cancelIndex: vi.fn(() => Promise.resolve(false)),
    onIndexProgress: vi.fn(() => () => undefined),
    loadUserState: vi.fn((): Promise<UserWorkspaceState> => Promise.resolve({ schemaVersion: 1, flowPages: [], businessNodes: [], recentFlowPageIds: [] })),
    saveUserState: vi.fn((request: Parameters<XanaduDesktopApi['saveUserState']>[0]) => Promise.resolve({ status: 'saved' as const, generation: request.generation })),
    clearIndexCache: vi.fn(() => Promise.resolve()),
  };

  beforeEach(() => {
    indexWorkspaceMock.mockReset().mockResolvedValue({ status: 'completed', snapshot: testSnapshot });
    Object.defineProperty(window, 'xanadu', { configurable: true, value: api });
  });

  it('selects a workspace without rendering an absolute path', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: '选择本地 TypeScript 项目' }));
    expect(await screen.findByText('选择入口函数，创建 FlowPage')).toBeInTheDocument();
    expect(screen.getAllByText('order-service').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain('C:\\');
  });

  it('keeps cancellation terminal and does not present an index as completed', async () => {
    indexWorkspaceMock.mockResolvedValueOnce({ status: 'cancelled' });
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: '选择本地 TypeScript 项目' }));
    expect(await screen.findByText('索引已取消')).toBeInTheDocument();
    expect(screen.queryByText('选择入口函数，创建 FlowPage')).not.toBeInTheDocument();
  });

  it('labels a recoverable partial snapshot explicitly', async () => {
    indexWorkspaceMock.mockResolvedValueOnce({ status: 'partial', snapshot: testSnapshot });
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: '选择本地 TypeScript 项目' }));
    expect(await screen.findByText('部分索引 · 查看诊断')).toBeInTheDocument();
  });
});
