import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App.js';
import type { UtilityHealth, XanaduDesktopApi } from '../../src/ipc/contracts.js';

describe('App shell', () => {
  const api: XanaduDesktopApi = {
    getAppInfo: vi.fn(() => Promise.resolve({ name: 'Xanadu', version: '0.1.0', platform: 'test' })),
    getUtilityHealth: vi.fn((): Promise<UtilityHealth> => Promise.resolve({ status: 'healthy', process: 'utility' })),
    selectWorkspace: vi.fn(() => Promise.resolve({ handle: 'opaque-handle', displayName: 'order-service' })),
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
