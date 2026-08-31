import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceView } from '../../src/renderer/components/WorkspaceView.js';
import { testSnapshot } from '../fixtures/adapter-snapshot.js';

describe('WorkspaceView interactions', () => {
  it('shares FlowPage state across modes, filters branches and controls the overlay drawer', async () => {
    const persist = vi.fn(() => Promise.resolve());
    render(<WorkspaceView workspace={{ handle: '00000000-0000-4000-8000-000000000000', displayName: 'order-service' }} snapshot={testSnapshot} initialState={{ schemaVersion: 1, flowPages: [], businessNodes: [], recentFlowPageIds: [] }} onPersist={persist} onChooseAnother={() => undefined} />);
    await userEvent.click(screen.getAllByRole('button', { name: /createOrder/ })[0] ?? (() => { throw new Error('entry button missing'); })());
    expect(screen.getByText('静态查看过滤，不代表真实执行路径')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('分支查看'), 'A');
    expect(await screen.findByText(/已弱化 1 条关系/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '沉浸式' }));
    expect(screen.queryByLabelText('关系与来源详情')).not.toBeInTheDocument();
    await userEvent.keyboard('{Control>} {/Control}');
    expect(await screen.findByRole('dialog', { name: '项目目录抽屉' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '项目目录抽屉' })).not.toBeInTheDocument();
  });

  it('creates a persisted non-nested BusinessNode from multiple functions', async () => {
    const persist = vi.fn(() => Promise.resolve());
    render(<WorkspaceView workspace={{ handle: '00000000-0000-4000-8000-000000000000', displayName: 'order-service' }} snapshot={testSnapshot} initialState={{ schemaVersion: 1, flowPages: [], businessNodes: [], recentFlowPageIds: [] }} onPersist={persist} onChooseAnother={() => undefined} />);
    await userEvent.click(screen.getByLabelText('选择 createOrder'));
    await userEvent.click(screen.getByLabelText('选择 shipOrder'));
    await userEvent.click(screen.getByRole('button', { name: /创建业务节点 · 2/ }));
    expect(screen.getByRole('dialog', { name: '创建业务节点' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '保存业务节点' }));
    expect(await screen.findByText('2 个函数 · 折叠')).toBeInTheDocument();
    expect(persist).toHaveBeenCalled();
  });
});
