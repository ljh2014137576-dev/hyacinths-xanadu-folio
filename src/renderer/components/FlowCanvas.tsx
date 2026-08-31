import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AdapterIndexSnapshot } from '../../adapter-api/index.js';
import { measureBridge, type BridgeGeometry, type RectLike } from '../../bridge-renderer/geometry.js';
import { formatIterationEstimate, type FlowPage, type FunctionFragment, type RelationBridge } from '../../model/index.js';

interface FlowCanvasProps {
  readonly snapshot: AdapterIndexSnapshot;
  readonly page: FlowPage;
  readonly relationStates: Readonly<Record<string, 'visible' | 'dimmed' | 'collapsed'>>;
  readonly selectedRelationId?: string;
  readonly onSelectRelation: (relationId: string) => void;
  readonly onOpenSource: (fragmentId: string) => void;
  readonly onToggleLoop: (loopId: string) => void;
  readonly onViewportChange: (x: number, y: number) => void;
}

interface Decoration {
  readonly start: number;
  readonly end: number;
  readonly kind: 'definition' | 'call';
  readonly id: string;
  readonly status?: RelationBridge['resolution']['status'];
}

interface BridgePath extends BridgeGeometry {
  readonly relation: RelationBridge;
}

const localRect = (world: DOMRect, anchor: DOMRect, zoom: number): RectLike => ({
  left: (anchor.left - world.left) / zoom,
  right: (anchor.right - world.left) / zoom,
  top: (anchor.top - world.top) / zoom,
  bottom: (anchor.bottom - world.top) / zoom,
  width: anchor.width / zoom,
  height: anchor.height / zoom,
});

const worldOrigin: RectLike = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };

function DecoratedSource({
  fragment,
  source,
  relations,
  onSelectRelation,
}: {
  readonly fragment: FunctionFragment;
  readonly source: string;
  readonly relations: readonly RelationBridge[];
  readonly onSelectRelation: (relationId: string) => void;
}): React.JSX.Element {
  const decorations: Decoration[] = [
    { start: fragment.definitionRange.start, end: fragment.definitionRange.end, kind: 'definition' as const, id: fragment.id },
    ...relations.map((relation) => ({
      start: relation.callSite.range.start,
      end: relation.callSite.range.end,
      kind: 'call' as const,
      id: relation.id,
      status: relation.resolution.status,
    })),
  ].filter((item) => item.start >= fragment.fullRange.start && item.end <= fragment.fullRange.end)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const nodes: React.ReactNode[] = [];
  let cursor = fragment.fullRange.start;
  for (const decoration of decorations) {
    if (decoration.start < cursor) continue;
    if (decoration.start > cursor) nodes.push(source.slice(cursor, decoration.start));
    const text = source.slice(decoration.start, decoration.end);
    if (decoration.kind === 'definition') {
      nodes.push(<span className="source-anchor source-anchor--definition" data-definition-id={decoration.id} key={`definition:${decoration.id}`}>{text}</span>);
    } else {
      nodes.push(
        <span
          className={`source-anchor source-anchor--call source-anchor--${decoration.status ?? 'unresolved'}`}
          data-call-id={decoration.id}
          key={`call:${decoration.id}`}
          role="button"
          tabIndex={0}
          onClick={() => onSelectRelation(decoration.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') onSelectRelation(decoration.id);
          }}
        >
          {text}
        </span>,
      );
    }
    cursor = decoration.end;
  }
  if (cursor < fragment.fullRange.end) nodes.push(source.slice(cursor, fragment.fullRange.end));
  return <pre className="source-code"><code>{nodes}</code></pre>;
}

const relationLabel = (relation: RelationBridge, snapshot: AdapterIndexSnapshot): string => {
  const resolution = relation.resolution;
  switch (resolution.status) {
    case 'resolved':
      return snapshot.fragments.find((fragment) => fragment.id === resolution.targetId)?.displayName ?? '已解析目标';
    case 'ambiguous':
      return `${resolution.candidates.length} 个可能目标`;
    case 'unresolved':
      return `未解析 · ${resolution.reason}`;
    case 'external':
      return `外部 · ${resolution.endpoint.name}`;
    case 'stale':
      return '范围已过期';
  }
};

export function FlowCanvas(props: FlowCanvasProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<readonly BridgePath[]>([]);
  const placementFragments = useMemo(() => new Map(props.page.placements
    .filter((placement) => placement.kind !== 'business-node')
    .map((placement) => [placement.id, props.snapshot.fragments.find((fragment) => fragment.id === placement.targetId)])), [props.page.placements, props.snapshot.fragments]);
  const maxDepth = Math.max(0, ...props.page.placements.map((placement) => placement.depth));
  const visibleRelations = props.snapshot.relations.filter((relation) => props.page.expandedRelations.includes(relation.id));

  const measure = (): void => {
    const world = worldRef.current;
    if (world === null) return;
    const worldRect = world.getBoundingClientRect();
    const calls = new Map([...world.querySelectorAll<HTMLElement>('[data-call-id]')].map((element) => [element.dataset.callId ?? '', element]));
    const definitions = new Map([...world.querySelectorAll<HTMLElement>('[data-definition-id]')].map((element) => [element.dataset.definitionId ?? '', element]));
    const next: BridgePath[] = [];
    for (const relation of visibleRelations) {
      if (relation.resolution.status !== 'resolved') continue;
      const source = calls.get(relation.id);
      const target = definitions.get(relation.resolution.targetId);
      if (source === undefined || target === undefined) continue;
      const geometry = measureBridge(
        worldOrigin,
        localRect(worldRect, source.getBoundingClientRect(), props.page.viewport.zoom),
        localRect(worldRect, target.getBoundingClientRect(), props.page.viewport.zoom),
      );
      next.push({ ...geometry, relation });
    }
    setPaths(next);
  };

  useLayoutEffect(() => {
    measure();
  }, [props.page.mode, props.page.placements, props.page.viewport.zoom, props.page.branchFilter, props.snapshot.relations]);

  useEffect(() => {
    const world = worldRef.current;
    const observer = world !== null && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (world !== null) observer?.observe(world);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  });

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller !== null) {
      scroller.scrollLeft = props.page.viewport.x;
      scroller.scrollTop = props.page.viewport.y;
    }
  }, [props.page.id, props.page.mode]);

  const columns = Array.from({ length: maxDepth + 1 }, (_, depth) => props.page.placements.filter((placement) => placement.depth === depth));

  return (
    <div
      className="flow-scroller"
      ref={scrollRef}
      onScroll={(event) => {
        props.onViewportChange(event.currentTarget.scrollLeft, event.currentTarget.scrollTop);
        measure();
      }}
      data-testid="flow-scroller"
    >
      <div
        className="flow-world"
        ref={worldRef}
        style={{
          width: `${Math.max(1, columns.length) * 520}px`,
          transform: `scale(${props.page.viewport.zoom})`,
        }}
      >
        <svg className="bridge-layer" aria-label="源码引用桥梁">
          <defs>
            <marker id="arrow-resolved" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker>
          </defs>
          {paths.map((bridge) => {
            const state = props.relationStates[bridge.relation.id] ?? 'visible';
            const selected = props.selectedRelationId === bridge.relation.id;
            return (
              <g
                className={`bridge bridge--${bridge.relation.resolution.status} bridge--${state}${selected ? ' bridge--selected' : ''}`}
                data-relation-id={bridge.relation.id}
                key={bridge.relation.id}
                onClick={() => props.onSelectRelation(bridge.relation.id)}
              >
                <path className="bridge-hit" d={bridge.path} />
                <path className="bridge-stroke" d={bridge.path} markerEnd="url(#arrow-resolved)" />
              </g>
            );
          })}
        </svg>
        <div className="flow-columns">
          {columns.map((placements, depth) => (
            <div className="flow-column" data-depth={depth} key={depth}>
              <div className="depth-label">OUTGOING · {depth === 0 ? 'ENTRY' : `DEPTH ${depth}`}</div>
              {placements.map((placement) => {
                const fragment = placementFragments.get(placement.id);
                if (fragment === undefined) return null;
                if (placement.kind === 'cycle') {
                  return <div className="cycle-card" key={placement.id}>↩ 调用环回连 · {fragment.displayName}</div>;
                }
                const file = props.snapshot.sourceFiles.find((item) => item.id === fragment.sourceFileId);
                const source = props.snapshot.sourceContents[fragment.sourceFileId] ?? '';
                const outgoing = visibleRelations.filter((relation) => relation.sourceFragmentId === fragment.id);
                const loops = props.snapshot.loops.filter((loop) => loop.ownerFragmentId === fragment.id);
                const viaState = placement.viaRelationId === undefined ? 'visible' : props.relationStates[placement.viaRelationId] ?? 'visible';
                return (
                  <article className={`source-card source-card--${viaState}`} data-fragment-id={fragment.id} key={placement.id}>
                    <header>
                      <button type="button" onClick={() => props.onOpenSource(fragment.id)}>
                        <strong>{fragment.displayName}</strong>
                        <span>{file?.projectRelativePath ?? fragment.provenance.projectRelativePath}</span>
                      </button>
                      <small>UTF-16 [{fragment.fullRange.start}, {fragment.fullRange.end})</small>
                    </header>
                    <DecoratedSource fragment={fragment} source={source} relations={outgoing} onSelectRelation={props.onSelectRelation} />
                    {outgoing.some((relation) => relation.resolution.status !== 'resolved') && (
                      <div className="relation-stubs">
                        {outgoing.filter((relation) => relation.resolution.status !== 'resolved').map((relation) => (
                          <button type="button" className={`relation-stub relation-stub--${relation.resolution.status}`} key={relation.id} onClick={() => props.onSelectRelation(relation.id)}>
                            {relation.resolution.status === 'ambiguous' ? '◇' : relation.resolution.status === 'external' ? '↗' : '○'} {relationLabel(relation, props.snapshot)}
                          </button>
                        ))}
                      </div>
                    )}
                    {loops.map((loop) => {
                      const collapsed = props.page.collapsedRegions.includes(loop.id);
                      return (
                        <section className="loop-region" key={loop.id}>
                          <button type="button" onClick={() => props.onToggleLoop(loop.id)} aria-expanded={!collapsed}>
                            <span>↻ LoopRegion · {loop.kind}</span>
                            <strong>{formatIterationEstimate(loop.iterationEstimate)}</strong>
                          </button>
                          {!collapsed && (
                            <div className="loop-details">
                              <span>entry {loop.entryEdges.length}</span>
                              <span>back {loop.backEdges.length}</span>
                              <span>continue {loop.continueEdges.length}</span>
                              <span>exit {loop.exitEdges.map((edge) => edge.reason).join(' / ')}</span>
                              <em>循环体仅建模一次 · 抽象单次迭代</em>
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </article>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
