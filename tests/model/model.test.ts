import { describe, expect, it } from 'vitest';
import {
  businessNodeId,
  flowPageId,
  formatIterationEstimate,
  parseBusinessNode,
  parseFlowPage,
  parseRange,
  projectId,
  sourceFileId,
  symbolId,
  type FlowPage,
  type IterationEstimate,
} from '../../src/model/index.js';

describe('domain model', () => {
  it('enforces zero-based half-open ranges', () => {
    expect(parseRange({ start: 0, end: 4 })).toEqual({ start: 0, end: 4 });
    expect(() => parseRange({ start: 5, end: 4 })).toThrow('Range end');
  });

  it('round-trips a strictly typed FlowPage', () => {
    const page: FlowPage = {
      id: flowPageId('flow:create-order'),
      projectId: projectId('project:fixture'),
      name: '创建订单',
      entry: { kind: 'function', id: 'symbol:createOrder' },
      projectionRevision: 'revision-1',
      placements: [{
        id: 'placement:entry',
        kind: 'function',
        targetId: symbolId('symbol:createOrder'),
        depth: 0,
        order: 0,
        collapsed: false,
      }],
      expandedRelations: [],
      collapsedRegions: [],
      branchFilter: { mode: 'show-all' },
      viewport: { x: 0, y: 0, zoom: 1 },
      mode: 'standard',
      hiddenSummary: { hiddenBranches: 0, hiddenRelations: 0, restoreAvailable: false },
    };
    expect(parseFlowPage(JSON.parse(JSON.stringify(page)))).toEqual(page);
  });

  it('keeps BusinessNode membership restricted to functions', () => {
    const parsed = parseBusinessNode({
      id: businessNodeId('business:create-order'),
      projectId: projectId('project:fixture'),
      name: '创建订单',
      description: '跨文件创建订单流程',
      members: [{ fragmentId: symbolId('symbol:createOrder'), order: 0 }],
      presentation: { collapsedByDefault: false },
      provenance: {
        definitionPath: 'xanadu/business/create-order.json',
        createdBy: 'local-user',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    });
    expect(parsed.members[0]?.fragmentId).toBe('symbol:createOrder');
    expect(Object.keys(parsed.members[0] ?? {})).not.toContain('businessNodeId');
  });

  it.each<[IterationEstimate, string]>([
    [{ kind: 'upper-bound', value: 12, proofRange: { sourceFileId: sourceFileId('file:a'), revision: 'r1', range: { start: 0, end: 10 } } }, '静态上限 12 次'],
    [{ kind: 'expression', expression: 'order.items.length', source: { sourceFileId: sourceFileId('file:a'), revision: 'r1', range: { start: 0, end: 10 } } }, '次数：order.items.length'],
    [{ kind: 'unknown' }, '次数：静态未知'],
  ])('formats static iteration semantics without runtime claims', (estimate, expected) => {
    expect(formatIterationEstimate(estimate)).toBe(expected);
    expect(formatIterationEstimate(estimate)).not.toContain('实际');
  });
});
