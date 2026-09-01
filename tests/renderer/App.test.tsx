import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App.js';
import type { UtilityHealth, XanaduDesktopApi } from '../../src/ipc/contracts.js';
import type { UserWorkspaceState } from '../../src/model/index.js';
import { testSnapshot } from '../fixtures/adapter-snapshot.js';

describe('App shell', () => {
  const indexWorkspaceMock = vi.fn<XanaduDesktopApi['indexWorkspace']>(() => Promise.resolve({ status: 'completed', snapshot: testSnapshot }));
  const saveUserStateMock = vi.fn<XanaduDesktopApi['saveUserState']>((request) => Promise.resolve({ status: 'saved', generation: request.generation }));
  const api: XanaduDesktopApi = {
    getAppInfo: vi.fn(() => Promise.resolve({ name: 'Xanadu', version: '0.1.0', platform: 'test' })),
    getUtilityHealth: vi.fn((): Promise<UtilityHealth> => Promise.resolve({ status: 'healthy', process: 'utility' })),
    selectWorkspace: vi.fn(() => Promise.resolve({ handle: 'opaque-handle', displayName: 'order-service' })),
    indexWorkspace: indexWorkspaceMock,
    cancelIndex: vi.fn(() => Promise.resolve(false)),
    onIndexProgress: vi.fn(() => () => undefined),
    loadUserState: vi.fn((): Promise<UserWorkspaceState> => Promise.resolve({ schemaVersion: 1, flowPages: [], businessNodes: [], recentFlowPageIds: [] })),
    saveUserState: saveUserStateMock,
    clearIndexCache: vi.fn(() => Promise.resolve()),
  };

  beforeEach(() => {
    indexWorkspaceMock.mockReset().mockResolvedValue({ status: 'completed', snapshot: testSnapshot });
    saveUserStateMock.mockClear();
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

  it('persists migration evidence before acknowledging the relocation journal', async () => {
    indexWorkspaceMock.mockResolvedValueOnce({
      status: 'completed', snapshot: testSnapshot, relocationJournalId: 'journal-1',
      relocation: [{ status: 'ambiguous', previousId: 'symbol:old', candidates: ['symbol:a', 'symbol:b'], evidence: ['two candidates'] }],
      relationRelocation: [],
    });
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: '选择本地 TypeScript 项目' }));
    await screen.findByText('选择入口函数，创建 FlowPage');
    expect(saveUserStateMock).toHaveBeenCalled();
    const request = saveUserStateMock.mock.calls.at(-1)?.[0];
    expect(request?.acknowledgeRelocationJournal).toBe('journal-1');
    expect(request?.state.pendingMigrations).toHaveLength(1);
  });
});
