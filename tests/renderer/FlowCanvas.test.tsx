import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AdapterIndexSnapshot } from '../../src/adapter-api/index.js';
import { buildFlowPage, toggleFlowRelation } from '../../src/index-core/index.js';
import { FlowCanvas } from '../../src/renderer/components/FlowCanvas.js';
import { testSnapshot } from '../fixtures/adapter-snapshot.js';

describe('FlowCanvas bridge lifecycle and certainty', () => {
  it('does not remeasure while idle, remeasures internal scroll, and labels probable without color alone', async () => {
    const originalRelation = testSnapshot.relations[0];
    const entry = testSnapshot.fragments.find((fragment) => fragment.displayName === 'createOrder');
    if (originalRelation === undefined || entry === undefined || originalRelation.resolution.status !== 'resolved') throw new Error('fixture relation missing');
    const relation = { ...originalRelation, resolution: { ...originalRelation.resolution, certainty: 'probable' as const } };
    const snapshot: AdapterIndexSnapshot = { ...testSnapshot, relations: [relation, ...testSnapshot.relations.slice(1)] };
    const page = toggleFlowRelation(buildFlowPage(snapshot, entry.id), snapshot, relation.id);

    const originalResizeObserver = globalThis.ResizeObserver;
    class ImmediateResizeObserver implements ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element): void { this.callback([{ target } as ResizeObserverEntry], this); }
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = ImmediateResizeObserver;
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, right: 80, top: 0, bottom: 20, width: 80, height: 20,
      toJSON: () => ({}),
    });
    try {
      const view = render(
        <FlowCanvas
          snapshot={snapshot}
          businessNodes={[]}
          page={page}
          relationStates={{}}
          onSelectRelation={() => undefined}
          onToggleRelation={() => undefined}
          onOpenSource={() => undefined}
          onToggleLoop={() => undefined}
          onToggleBusinessPlacement={() => undefined}
          onViewportChange={() => undefined}
        />,
      );
      await waitFor(() => expect(view.container.querySelector('.bridge--probable')).not.toBeNull());
      const probable = view.container.querySelector('.bridge--probable');
      expect(probable?.getAttribute('aria-label')).toMatch(/可能目标.*probable/);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 40));
      const idleCount = rect.mock.calls.length;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 80));
      expect(rect.mock.calls.length).toBe(idleCount);
      const source = view.container.querySelector('.source-code');
      if (source === null) throw new Error('source surface missing');
      fireEvent.scroll(source);
      await waitFor(() => expect(rect.mock.calls.length).toBeGreaterThan(idleCount));
    } finally {
      rect.mockRestore();
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });
});
