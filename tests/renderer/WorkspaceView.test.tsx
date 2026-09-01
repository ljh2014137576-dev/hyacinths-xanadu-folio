import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceView } from '../../src/renderer/components/WorkspaceView.js';
import { testSnapshot } from '../fixtures/adapter-snapshot.js';
import type { AdapterIndexSnapshot } from '../../src/adapter-api/index.js';

describe('WorkspaceView interactions', () => {
  it('shares FlowPage state across modes, filters branches and controls the overlay drawer', async () => {
    const persist = vi.fn((_state, generation: number) => Promise.resolve({ status: 'saved' as const, generation }));
    render(<WorkspaceView workspace={{ handle: '00000000-0000-4000-8000-000000000000', displayName: 'order-service' }} snapshot={testSnapshot} initialState={{ schemaVersion: 1, flowPages: [], businessNodes: [], recentFlowPageIds: [] }} indexStatus="completed" onPersist={persist} onChooseAnother={() => undefined} />);
    expect(screen.getByRole('navigation', { name: '项目目录树' })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /createOrder/ })[0] ?? (() => { throw new Error('entry button missing'); })());
    expect(screen.getByText('静态查看过滤，不代表真实执行路径')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /展开 shipOrder/ }));
    await userEvent.click(screen.getByRole('button', { name: /展开 requestPayment/ }));
    await userEvent.selectOptions(screen.getByLabelText('分支查看'), 'A');
    expect(await screen.findByText(/已弱化 1 条关系/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '沉浸式' }));
    expect(screen.queryByLabelText('关系与来源详情')).not.toBeInTheDocument();
    expect(screen.getByLabelText('中央组合流程文档')).toBeInTheDocument();
    expect(document.querySelectorAll('.immersive-source')).toHaveLength(2);
    await userEvent.keyboard('{Control>} {/Control}');
    expect(await screen.findByRole('dialog', { name: '项目目录抽屉' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '项目目录抽屉' })).not.toBeInTheDocument();
  });

  it('creates a persisted non-nested BusinessNode from multiple functions', async () => {
    const persist = vi.fn((_state, generation: number) => Promise.resolve({ status: 'saved' as const, generation }));
    render(<WorkspaceView workspace={{ handle: '00000000-0000-4000-8000-000000000000', displayName: 'order-service' }} snapshot={testSnapshot} initialState={{ schemaVersion: 1, flowPages: [], businessNodes: [], recentFlowPageIds: [] }} indexStatus="completed" onPersist={persist} onChooseAnother={() => undefined} />);
    await userEvent.click(screen.getByLabelText('选择 createOrder'));
    await userEvent.click(screen.getByLabelText('选择 shipOrder'));
    await userEvent.click(screen.getByRole('button', { name: /创建业务节点 · 2/ }));
    expect(screen.getByRole('dialog', { name: '创建业务节点' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '保存业务节点' }));
    expect(await screen.findByText('2 个函数 · 打开 FlowPage')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('搜索文件、函数、方法或业务节点'), '创建订单');
    const results = screen.getByRole('navigation', { name: '统一搜索结果' });
    expect(results).toBeInTheDocument();
    await userEvent.click(within(results).getByRole('button', { name: /◇ 创建订单/ }));
    expect(await screen.findByText('定义来源')).toBeInTheDocument();
    expect(screen.getAllByText(/src\/order.ts \[/)).toHaveLength(2);
    expect(persist).toHaveBeenCalled();
  });

  it('shows resolved probable in controls and inspector text', async () => {
    const original = testSnapshot.relations[0];
    if (original === undefined || original.resolution.status !== 'resolved') throw new Error('fixture relation missing');
    const snapshot: AdapterIndexSnapshot = { ...testSnapshot, relations: [{ ...original, resolution: { ...original.resolution, certainty: 'probable' } }, ...testSnapshot.relations.slice(1)] };
    const persist = vi.fn((_state, generation: number) => Promise.resolve({ status: 'saved' as const, generation }));
    render(<WorkspaceView workspace={{ handle: '00000000-0000-4000-8000-000000000000', displayName: 'order-service' }} snapshot={snapshot} initialState={{ schemaVersion: 1, flowPages: [], businessNodes: [], recentFlowPageIds: [] }} indexStatus="completed" onPersist={persist} onChooseAnother={() => undefined} />);
    await userEvent.click(screen.getAllByRole('button', { name: /createOrder/ })[0] ?? (() => { throw new Error('entry missing'); })());
    await userEvent.click(screen.getByRole('button', { name: /展开 可能目标 · shipOrder/ }));
    expect(screen.getByText('resolved · probable')).toBeInTheDocument();
    expect(screen.getAllByText(/可能目标 · shipOrder/).length).toBeGreaterThan(1);
  });
});
