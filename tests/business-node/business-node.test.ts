import { describe, expect, it } from 'vitest';
import { createBusinessNode, moveBusinessMember, setBusinessNodeCollapsed } from '../../src/business-node/index.js';
import { buildBusinessNodeFlowPage } from '../../src/index-core/index.js';
import { projectId, symbolId } from '../../src/model/index.js';
import { testSnapshot } from '../fixtures/adapter-snapshot.js';

describe('BusinessNode service', () => {
  it('creates ordered function-only members and supports reorder/collapse', () => {
    const now = '2026-09-01T00:00:00.000Z';
    const first = symbolId('symbol:first');
    const second = symbolId('symbol:second');
    const availableFragmentIds = new Set([first, second]);
    const node = createBusinessNode({ id: 'create-order', projectId: projectId('project:test'), name: ' 创建订单 ', description: ' flow ', memberIds: [first, second], availableFragmentIds, now });
    expect(node.name).toBe('创建订单');
    expect(node.members.map((member) => member.fragmentId)).toEqual([first, second]);
    const reordered = moveBusinessMember(node, second, -1, '2026-09-01T00:01:00.000Z');
    expect(reordered.members.map((member) => member.fragmentId)).toEqual([second, first]);
    expect(setBusinessNodeCollapsed(reordered, true, now).presentation.collapsedByDefault).toBe(true);
    expect(node.members.some((member) => 'businessNodeId' in member)).toBe(false);
    const page = buildBusinessNodeFlowPage(testSnapshot, node);
    expect(page.entry).toEqual({ kind: 'business-node', id: node.id });
    expect(page.placements[0]?.kind).toBe('business-node');
    expect(page.placements.filter((placement) => placement.kind === 'function')).toHaveLength(2);
    expect(() => createBusinessNode({ id: 'nested', projectId: projectId('project:test'), name: 'Nested', memberIds: [symbolId('business:other')], availableFragmentIds, now })).toThrow('nesting');
  });
});
