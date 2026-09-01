import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AdapterIndexSnapshot } from '../../adapter-api/index.js';
import { measureBridge, type BridgeGeometry, type RectLike } from '../../bridge-renderer/geometry.js';
import { formatIterationEstimate, type BusinessNode, type FlowPage, type FunctionFragment, type RelationBridge } from '../../model/index.js';

interface FlowCanvasProps {
  readonly snapshot: AdapterIndexSnapshot;
  readonly businessNodes: readonly BusinessNode[];
  readonly page: FlowPage;
  readonly relationStates: Readonly<Record<string, 'visible' | 'dimmed' | 'collapsed'>>;
  readonly selectedRelationId?: string;
  readonly onSelectRelation: (relationId: string) => void;
  readonly onToggleRelation: (relationId: string) => void;
  readonly onOpenSource: (fragmentId: string) => void;
  readonly onToggleLoop: (loopId: string) => void;
  readonly onToggleBusinessPlacement: (placementId: string) => void;
  readonly onViewportChange: (x: number, y: number) => void;
}

interface Decoration {
  readonly start: number;
  readonly end: number;
  readonly kind: 'definition' | 'call';
  readonly id: string;
  readonly status?: RelationBridge['resolution']['status'];
  readonly certainty?: 'exact' | 'probable';
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
      ...(relation.resolution.status === 'resolved' ? { certainty: relation.resolution.certainty } : {}),
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
          className={`source-anchor source-anchor--call source-anchor--${decoration.status ?? 'unresolved'}${decoration.certainty === 'probable' ? ' source-anchor--probable' : ''}`}
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
      return `${resolution.certainty === 'probable' ? '可能目标 · ' : ''}${snapshot.fragments.find((fragment) => fragment.id === resolution.targetId)?.displayName ?? '已解析目标'}`;
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
  const animationFrame = useRef<number | null>(null);
  const layoutGeneration = useRef(0);
  const businessCollapsed = props.page.placements.find((placement) => placement.kind === 'business-node')?.collapsed ?? false;
  const displayPlacements = useMemo(() => props.page.placements.filter((placement) => !businessCollapsed || placement.kind === 'business-node'), [businessCollapsed, props.page.placements]);
  const placementFragments = useMemo(() => new Map(displayPlacements
    .filter((placement) => placement.kind !== 'business-node')
    .map((placement) => [placement.id, props.snapshot.fragments.find((fragment) => fragment.id === placement.targetId)])), [displayPlacements, props.snapshot.fragments]);
  const maxDepth = Math.max(0, ...displayPlacements.map((placement) => placement.depth));
  const placedFunctions = useMemo(() => new Set(displayPlacements.filter((placement) => placement.kind === 'function').map((placement) => placement.targetId)), [displayPlacements]);
  const visibleRelations = useMemo(() => props.snapshot.relations.filter((relation) => placedFunctions.has(relation.sourceFragmentId)), [placedFunctions, props.snapshot.relations]);
  const expandedRelations = useMemo(() => visibleRelations.filter((relation) => props.page.expandedRelations.includes(relation.id)), [props.page.expandedRelations, visibleRelations]);

  const measure = useCallback((): void => {
    const world = worldRef.current;
    if (world === null) return;
    const worldRect = world.getBoundingClientRect();
    const calls = new Map([...world.querySelectorAll<HTMLElement>('[data-call-id]')].map((element) => [element.dataset.callId ?? '', element]));
    const definitions = new Map([...world.querySelectorAll<HTMLElement>('[data-definition-id]')].map((element) => [element.dataset.definitionId ?? '', element]));
    const next: BridgePath[] = [];
    for (const relation of expandedRelations) {
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
    layoutGeneration.current += 1;
    setPaths((previous) => {
      const unchanged = previous.length === next.length && previous.every((path, index) => {
        const candidate = next[index];
        return candidate !== undefined && path.relation.id === candidate.relation.id && path.path === candidate.path;
      });
      return unchanged ? previous : next;
    });
  }, [expandedRelations, props.page.viewport.zoom]);

  const scheduleMeasure = useCallback((): void => {
    if (animationFrame.current !== null) return;
    animationFrame.current = requestAnimationFrame(() => {
      animationFrame.current = null;
      measure();
    });
  }, [measure]);

  useLayoutEffect(() => {
    scheduleMeasure();
  }, [props.page.mode, props.page.placements, props.page.viewport.zoom, props.page.branchFilter, scheduleMeasure]);

  useEffect(() => {
    const world = worldRef.current;
    const observer = world !== null && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleMeasure) : null;
    if (world !== null) observer?.observe(world);
    window.addEventListener('resize', scheduleMeasure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
    };
  }, [scheduleMeasure]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller !== null) {
      scroller.scrollLeft = props.page.viewport.x;
      scroller.scrollTop = props.page.viewport.y;
    }
  }, [props.page.id, props.page.mode]);

  const columns = Array.from({ length: maxDepth + 1 }, (_, depth) => displayPlacements.filter((placement) => placement.depth === depth));

  return (
    <div
      className="flow-scroller"
      ref={scrollRef}
      onScroll={(event) => {
        props.onViewportChange(event.currentTarget.scrollLeft, event.currentTarget.scrollTop);
        scheduleMeasure();
      }}
      data-testid="flow-scroller"
    >
      <div
        className="flow-world"
        ref={worldRef}
        onScrollCapture={scheduleMeasure}
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
                className={`bridge bridge--${bridge.relation.resolution.status}${bridge.relation.resolution.status === 'resolved' && bridge.relation.resolution.certainty === 'probable' ? ' bridge--probable' : ''} bridge--${state}${selected ? ' bridge--selected' : ''}`}
                data-relation-id={bridge.relation.id}
                key={bridge.relation.id}
                onClick={() => props.onSelectRelation(bridge.relation.id)}
                role="button"
                tabIndex={0}
                aria-label={`${relationLabel(bridge.relation, props.snapshot)} · ${bridge.relation.resolution.status === 'resolved' ? bridge.relation.resolution.certainty : bridge.relation.resolution.status}`}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') props.onSelectRelation(bridge.relation.id);
                }}
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
                if (placement.kind === 'business-node') {
                  const node = props.businessNodes.find((item) => item.id === placement.targetId);
                  if (node === undefined) return null;
                  return (
                    <article className="source-card business-flow-card" data-business-node-id={node.id} key={placement.id}>
                      <header><button type="button" onClick={() => props.onToggleBusinessPlacement(placement.id)}><strong>◇ {node.name}</strong><span>{node.provenance.definitionPath}</span></button><small>{placement.collapsed ? 'EXPAND' : 'COLLAPSE'}</small></header>
                      {!placement.collapsed && <div className="business-flow-members"><p>{node.description}</p><dl><div><dt>定义来源</dt><dd>{node.provenance.definitionPath}</dd></div><div><dt>创建者</dt><dd>{node.provenance.createdBy}</dd></div><div><dt>更新时间</dt><dd>{node.provenance.updatedAt}</dd></div></dl>{node.members.slice().sort((left, right) => left.order - right.order).map((member) => { const fragment = props.snapshot.fragments.find((item) => item.id === member.fragmentId); return fragment === undefined ? null : <div key={member.fragmentId}><strong>{member.order + 1}. {fragment.displayName}</strong><span>{fragment.provenance.projectRelativePath}</span><code>[{fragment.fullRange.start}, {fragment.fullRange.end})</code></div>; })}</div>}
                    </article>
                  );
                }
                const fragment = placementFragments.get(placement.id);
                if (fragment === undefined) return null;
                if (placement.kind === 'cycle') {
                  return <div className="cycle-card" key={placement.id}>↩ 调用环回连 · {fragment.displayName}</div>;
                }
                const file = props.snapshot.sourceFiles.find((item) => item.id === fragment.sourceFileId);
                const source = props.snapshot.sourceContents[fragment.sourceFileId] ?? '';
                const outgoing = visibleRelations.filter((relation) => relation.sourceFragmentId === fragment.id);
                const loops = props.snapshot.loops.filter((loop) => loop.ownerFragmentId === fragment.id);
                const incomingStates = visibleRelations.flatMap((relation) => relation.resolution.status === 'resolved' && relation.resolution.targetId === fragment.id
                  ? [props.relationStates[relation.id] ?? 'visible']
                  : []);
                const viaState = incomingStates.includes('visible')
                  ? 'visible'
                  : placement.viaRelationId === undefined ? 'visible' : props.relationStates[placement.viaRelationId] ?? 'visible';
                return (
                  <article className={`source-card source-card--${viaState}`} data-fragment-id={fragment.id} key={placement.id}>
                    <header>
                      <button type="button" onClick={() => props.onOpenSource(fragment.id)}>
                        <strong>{fragment.displayName}</strong>
                        <span>{file?.projectRelativePath ?? fragment.provenance.projectRelativePath}</span>
                      </button>
                      <small>UTF-16 [{fragment.fullRange.start}, {fragment.fullRange.end})</small>
                    </header>
                    <DecoratedSource
                      fragment={fragment}
                      source={source}
                      relations={outgoing}
                      onSelectRelation={(relationId) => {
                        props.onSelectRelation(relationId);
                        const relation = outgoing.find((item) => item.id === relationId);
                        if (relation?.resolution.status === 'resolved') props.onToggleRelation(relationId);
                      }}
                    />
                    {outgoing.length > 0 && (
                      <div className="relation-stubs">
                        {outgoing.map((relation) => (
                          <button
                            type="button"
                            className={`relation-stub relation-stub--${relation.resolution.status}`}
                            key={relation.id}
                            onClick={() => {
                              props.onSelectRelation(relation.id);
                              if (relation.resolution.status === 'resolved') props.onToggleRelation(relation.id);
                            }}
                          >
                            {relation.resolution.status === 'resolved'
                              ? props.page.expandedRelations.includes(relation.id) ? '− 收起' : '+ 展开'
                              : relation.resolution.status === 'ambiguous' ? '◇' : relation.resolution.status === 'external' ? '↗' : '○'}{' '}
                            {relationLabel(relation, props.snapshot)}
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
