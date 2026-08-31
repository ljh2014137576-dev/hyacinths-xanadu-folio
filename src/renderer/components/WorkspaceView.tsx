import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdapterIndexSnapshot } from '../../adapter-api/index.js';
import { createBusinessNode, moveBusinessMember, setBusinessNodeCollapsed } from '../../business-node/index.js';
import { buildFlowPage, projectBranchView, setBranchFilter } from '../../index-core/index.js';
import {
  type BusinessNode,
  type FlowPage,
  type FunctionFragment,
  type RelationBridge,
  type SymbolId,
  type UserWorkspaceState,
} from '../../model/index.js';
import type { WorkspaceSummary } from '../../ipc/contracts.js';
import { FlowCanvas } from './FlowCanvas.js';

interface WorkspaceViewProps {
  readonly workspace: WorkspaceSummary;
  readonly snapshot: AdapterIndexSnapshot;
  readonly initialState: UserWorkspaceState;
  readonly onPersist: (state: UserWorkspaceState) => Promise<void>;
  readonly onChooseAnother: () => void;
}

interface BusinessDialogProps {
  readonly fragments: readonly FunctionFragment[];
  readonly onCancel: () => void;
  readonly onSave: (name: string, description: string, members: readonly SymbolId[]) => void;
}

function BusinessDialog({ fragments, onCancel, onSave }: BusinessDialogProps): React.JSX.Element {
  const [name, setName] = useState('创建订单');
  const [description, setDescription] = useState('由真实索引函数组成的本地业务阅读节点。');
  const [ordered, setOrdered] = useState(fragments.map((fragment) => fragment.id));
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, []);

  const move = (id: SymbolId, direction: -1 | 1): void => {
    const index = ordered.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    const targetValue = next[target];
    if (targetValue === undefined) return;
    next[target] = id;
    next[index] = targetValue;
    setOrdered(next);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="business-dialog" role="dialog" aria-modal="true" aria-labelledby="business-title" ref={dialogRef}>
        <header><span>BUSINESS NODE</span><h2 id="business-title">创建业务节点</h2><p>MVP 成员只能是函数，不支持节点嵌套。</p></header>
        <label>名称<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>描述<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></label>
        <div className="member-order">
          <strong>成员与阅读顺序</strong>
          {ordered.map((id, index) => {
            const fragment = fragments.find((item) => item.id === id);
            if (fragment === undefined) return null;
            return (
              <div key={id}>
                <span>{index + 1}</span><code>{fragment.displayName}</code><small>{fragment.provenance.projectRelativePath}</small>
                <button type="button" onClick={() => move(id, -1)} aria-label={`上移 ${fragment.displayName}`}>↑</button>
                <button type="button" onClick={() => move(id, 1)} aria-label={`下移 ${fragment.displayName}`}>↓</button>
              </div>
            );
          })}
        </div>
        <footer>
          <button type="button" className="button-secondary" onClick={onCancel}>取消</button>
          <button type="button" disabled={name.trim().length === 0} onClick={() => onSave(name, description, ordered)}>保存业务节点</button>
        </footer>
      </div>
    </div>
  );
}

function SourceViewer({
  fragment,
  snapshot,
  onBack,
}: {
  readonly fragment: FunctionFragment;
  readonly snapshot: AdapterIndexSnapshot;
  readonly onBack: () => void;
}): React.JSX.Element {
  const file = snapshot.sourceFiles.find((item) => item.id === fragment.sourceFileId);
  const content = snapshot.sourceContents[fragment.sourceFileId];
  const stale = file === undefined || content === undefined || file.revision !== fragment.provenance.revision;
  return (
    <section className="source-viewer">
      <header>
        <button type="button" onClick={onBack}>← 返回流程页</button>
        <div><span>函数来源</span><h2>{fragment.displayName}</h2><p>{fragment.provenance.projectRelativePath}</p></div>
        <aside><strong>UTF-16 精确范围</strong><code>[{fragment.fullRange.start}, {fragment.fullRange.end})</code></aside>
      </header>
      {stale ? (
        <div className="stale-state" role="alert"><strong>来源范围已过期或文件缺失</strong><p>请重新索引；应用不会静默跳转到相同行号。</p></div>
      ) : (
        <pre className="original-source"><code>{content.slice(0, fragment.fullRange.start)}<mark>{content.slice(fragment.fullRange.start, fragment.fullRange.end)}</mark>{content.slice(fragment.fullRange.end)}</code></pre>
      )}
    </section>
  );
}

export function WorkspaceView(props: WorkspaceViewProps): React.JSX.Element {
  const [userState, setUserState] = useState(props.initialState);
  const stateRef = useRef(userState);
  const [activePageId, setActivePageId] = useState<string | null>(props.initialState.recentFlowPageIds[0] ?? props.initialState.flowPages[0]?.id ?? null);
  const [search, setSearch] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<ReadonlySet<SymbolId>>(new Set());
  const [businessDialog, setBusinessDialog] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sourceFragmentId, setSourceFragmentId] = useState<string | null>(null);
  const [selectedRelationId, setSelectedRelationId] = useState<string | undefined>();
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const viewportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement>(null);
  const drawerWasOpen = useRef(false);

  const activePage = userState.flowPages.find((page) => page.id === activePageId);
  const sourceFragment = props.snapshot.fragments.find((fragment) => fragment.id === sourceFragmentId);
  const filteredFragments = useMemo(() => props.snapshot.fragments.filter((fragment) =>
    `${fragment.displayName} ${fragment.qualifiedName} ${fragment.provenance.projectRelativePath}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [props.snapshot.fragments, search]);

  const commit = (next: UserWorkspaceState): void => {
    stateRef.current = next;
    setUserState(next);
    setSaveStatus('saving');
    void props.onPersist(next).then(() => setSaveStatus('saved')).catch(() => setSaveStatus('error'));
  };

  const openFragment = (fragmentId: SymbolId): void => {
    const existing = userState.flowPages.find((page) => page.entry.kind === 'function' && page.entry.id === fragmentId);
    const page = existing ?? buildFlowPage(props.snapshot, fragmentId);
    const pages = existing === undefined ? [...userState.flowPages, page] : userState.flowPages;
    const recent = [page.id, ...userState.recentFlowPageIds.filter((id) => id !== page.id)].slice(0, 8);
    commit({ ...userState, flowPages: pages, recentFlowPageIds: recent });
    setActivePageId(page.id);
    setSelectedRelationId(undefined);
    setSourceFragmentId(null);
    setDrawerOpen(false);
  };

  const updatePage = (page: FlowPage, persist = true): void => {
    const next = { ...stateRef.current, flowPages: stateRef.current.flowPages.map((item) => item.id === page.id ? page : item) };
    stateRef.current = next;
    setUserState(next);
    if (persist) commit(next);
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.code === 'Space') {
        event.preventDefault();
        setDrawerOpen((open) => !open);
      } else if (event.key === 'Escape') {
        setDrawerOpen(false);
        setBusinessDialog(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => () => {
    if (viewportTimer.current !== null) clearTimeout(viewportTimer.current);
  }, []);

  useEffect(() => {
    if (drawerOpen) {
      drawerRef.current?.querySelector<HTMLInputElement>('input')?.focus();
      drawerWasOpen.current = true;
    } else if (drawerWasOpen.current) {
      drawerTriggerRef.current?.focus();
      drawerWasOpen.current = false;
    }
  }, [drawerOpen]);

  const trapDrawerFocus = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return;
    const focusable = [...(drawerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]') ?? [])];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const pageRelations = activePage === undefined
    ? []
    : props.snapshot.relations.filter((relation) => activePage.expandedRelations.includes(relation.id));
  const branchProjection = activePage === undefined
    ? { relations: [], states: {}, hiddenRelations: 0, hiddenBranches: 0 }
    : projectBranchView(pageRelations, activePage.branchFilter);
  const branchContexts = pageRelations.flatMap((relation) => relation.branchContext === undefined ? [] : [relation.branchContext]);
  const branchGroup = branchContexts.find((context) =>
    context.condition.toLocaleLowerCase().includes('paid') &&
    branchContexts.some((candidate) => candidate.branchId === context.branchId && candidate.arm !== context.arm))
    ?? branchContexts.find((context) => branchContexts.some((candidate) => candidate.branchId === context.branchId && candidate.arm !== context.arm))
    ?? branchContexts[0];
  const selectedRelation = props.snapshot.relations.find((relation) => relation.id === selectedRelationId);

  const toggleMember = (id: SymbolId): void => {
    const next = new Set(selectedMembers);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedMembers(next);
  };

  const saveBusinessNode = (name: string, description: string, members: readonly SymbolId[]): void => {
    const firstFile = props.snapshot.sourceFiles[0];
    if (firstFile === undefined) return;
    const id = crypto.randomUUID();
    const node = createBusinessNode({ id, projectId: firstFile.projectId, name, description, memberIds: members, now: new Date().toISOString() });
    commit({ ...userState, businessNodes: [...userState.businessNodes, node] });
    setBusinessDialog(false);
    setSelectedMembers(new Set());
  };

  const updateBusiness = (node: BusinessNode): void => {
    commit({ ...userState, businessNodes: userState.businessNodes.map((item) => item.id === node.id ? node : item) });
  };

  const projectRail = (
    <aside className="project-rail" aria-label="项目目录">
      <div className="rail-heading"><span>PROJECT</span><strong>{props.workspace.displayName}</strong></div>
      <label className="search-field"><span>搜索文件或函数</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="createOrder" /></label>
      <div className="rail-actions">
        <button type="button" disabled={selectedMembers.size < 2} onClick={() => setBusinessDialog(true)}>创建业务节点 · {selectedMembers.size}</button>
      </div>
      <nav className="function-list" aria-label="函数目录">
        {filteredFragments.map((fragment) => (
          <div className="function-row" key={fragment.id}>
            <input type="checkbox" aria-label={`选择 ${fragment.displayName}`} checked={selectedMembers.has(fragment.id)} onChange={() => toggleMember(fragment.id)} />
            <button type="button" onClick={() => openFragment(fragment.id)}>
              <strong>{fragment.displayName}</strong><small>{fragment.provenance.projectRelativePath}</small>
            </button>
          </div>
        ))}
      </nav>
      {userState.businessNodes.length > 0 && (
        <section className="business-list"><h3>业务节点</h3>{userState.businessNodes.map((node) => (
          <article key={node.id}>
            <button type="button" onClick={() => updateBusiness(setBusinessNodeCollapsed(node, !node.presentation.collapsedByDefault, new Date().toISOString()))}>
              <strong>◇ {node.name}</strong><span>{node.members.length} 个函数 · {node.presentation.collapsedByDefault ? '展开' : '折叠'}</span>
            </button>
            {!node.presentation.collapsedByDefault && node.members.slice().sort((a, b) => a.order - b.order).map((member) => {
              const fragment = props.snapshot.fragments.find((item) => item.id === member.fragmentId);
              return fragment === undefined ? null : <button className="business-member" type="button" key={member.fragmentId} onClick={() => openFragment(fragment.id)}>{member.order + 1}. {fragment.displayName}</button>;
            })}
          </article>
        ))}</section>
      )}
    </aside>
  );

  if (sourceFragment !== undefined) {
    return <div className="workspace-shell"><SourceViewer fragment={sourceFragment} snapshot={props.snapshot} onBack={() => setSourceFragmentId(null)} /></div>;
  }

  return (
    <div className={`workspace-shell workspace-shell--${activePage?.mode ?? 'standard'}`}>
      <header className="workspace-toolbar">
        <div className="workspace-brand"><span className="brand-mark">X</span><div><strong>Xanadu</strong><small>{props.workspace.displayName}</small></div></div>
        {activePage !== undefined && (
          <>
            <div className="mode-switch" role="group" aria-label="视图模式">
              <button type="button" className={activePage.mode === 'standard' ? 'active' : ''} onClick={() => updatePage({ ...activePage, mode: 'standard' })}>标准视图</button>
              <button type="button" className={activePage.mode === 'immersive' ? 'active' : ''} onClick={() => updatePage({ ...activePage, mode: 'immersive' })}>沉浸式</button>
            </div>
            {branchGroup !== undefined && (
              <label className="branch-filter">分支查看
                <select
                  value={activePage.branchFilter.mode === 'show-all' ? 'all' : activePage.branchFilter.arm}
                  onChange={(event) => {
                    const filter = event.target.value === 'all'
                      ? { mode: 'show-all' as const }
                      : { mode: 'only' as const, branchId: branchGroup.branchId, arm: event.target.value as 'A' | 'B' };
                    updatePage(setBranchFilter(activePage, pageRelations, filter));
                  }}
                >
                  <option value="all">显示全部</option><option value="A">仅看 A · {branchGroup.condition}=true</option><option value="B">仅看 B · else</option>
                </select>
              </label>
            )}
            <div className="zoom-controls"><button type="button" aria-label="缩小" onClick={() => updatePage({ ...activePage, viewport: { ...activePage.viewport, zoom: Math.max(0.65, activePage.viewport.zoom - 0.1) } })}>−</button><span>{Math.round(activePage.viewport.zoom * 100)}%</span><button type="button" aria-label="放大" onClick={() => updatePage({ ...activePage, viewport: { ...activePage.viewport, zoom: Math.min(1.5, activePage.viewport.zoom + 0.1) } })}>＋</button></div>
          </>
        )}
        <div className="toolbar-status"><span className={`status-dot status-dot--${props.snapshot.health.status}`} />{props.snapshot.manifest.displayName} {props.snapshot.manifest.adapterVersion}<small>{saveStatus === 'saving' ? '保存中…' : saveStatus === 'error' ? '保存失败' : '本地已保存'}</small></div>
        <button type="button" className="button-secondary" onClick={props.onChooseAnother}>切换项目</button>
      </header>

      <div className="workspace-body">
        {(activePage?.mode ?? 'standard') === 'standard' && projectRail}
        <main className="flow-area">
          {activePage === undefined ? (
            <section className="entry-picker">
              <span>INDEX COMPLETE</span><h1>选择入口函数，创建 FlowPage</h1><p>已索引 {props.snapshot.sourceFiles.length} 个文件、{props.snapshot.fragments.length} 个函数；默认只沿出站引用展开。</p>
              <div>{filteredFragments.slice(0, 12).map((fragment) => <button type="button" key={fragment.id} onClick={() => openFragment(fragment.id)}><strong>{fragment.displayName}</strong><small>{fragment.provenance.projectRelativePath}</small></button>)}</div>
            </section>
          ) : (
            <>
              <div className="static-filter-notice">静态查看过滤，不代表真实执行路径{activePage.hiddenSummary.restoreAvailable ? ` · 已弱化 ${activePage.hiddenSummary.hiddenRelations} 条关系` : ''}</div>
              <FlowCanvas
                snapshot={props.snapshot}
                page={activePage}
                relationStates={branchProjection.states}
                {...(selectedRelationId === undefined ? {} : { selectedRelationId })}
                onSelectRelation={setSelectedRelationId}
                onOpenSource={setSourceFragmentId}
                onToggleLoop={(loopId) => {
                  const collapsed = activePage.collapsedRegions.includes(loopId)
                    ? activePage.collapsedRegions.filter((id) => id !== loopId)
                    : [...activePage.collapsedRegions, loopId];
                  updatePage({ ...activePage, collapsedRegions: collapsed });
                }}
                onViewportChange={(x, y) => {
                  const nextPage = { ...activePage, viewport: { ...activePage.viewport, x, y } };
                  updatePage(nextPage, false);
                  if (viewportTimer.current !== null) clearTimeout(viewportTimer.current);
                  viewportTimer.current = setTimeout(() => commit(stateRef.current), 250);
                }}
              />
            </>
          )}
        </main>
        {activePage?.mode === 'standard' && (
          <aside className="inspector" aria-label="关系与来源详情">
            <header><span>LANGUAGE ADAPTER</span><h2>{props.snapshot.manifest.displayName}</h2><p>{props.snapshot.health.status} · Compiler {props.snapshot.manifest.compilerVersion}</p></header>
            <dl><div><dt>符号</dt><dd>{props.snapshot.manifest.capabilities.symbols}</dd></div><div><dt>引用</dt><dd>{props.snapshot.manifest.capabilities.references}</dd></div><div><dt>循环</dt><dd>{props.snapshot.manifest.capabilities.loops ? '支持' : '不支持'}</dd></div></dl>
            {selectedRelation === undefined ? <p className="inspector-empty">点击源码中的调用范围或桥梁，查看解析证据。</p> : <RelationInspector relation={selectedRelation} snapshot={props.snapshot} />}
          </aside>
        )}
      </div>

      {activePage?.mode === 'immersive' && (
        <button className="drawer-trigger" ref={drawerTriggerRef} type="button" onClick={() => setDrawerOpen(true)}>Ctrl+Space · 项目目录</button>
      )}
      {drawerOpen && (
        <div className="drawer-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setDrawerOpen(false); }}>
          <div className="project-drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-label="项目目录抽屉" onKeyDown={trapDrawerFocus}>
            <header><strong>项目目录</strong><button type="button" onClick={() => { if (activePage !== undefined) updatePage({ ...activePage, mode: 'standard' }); setDrawerOpen(false); }} aria-label="固定为标准目录">📌</button><button type="button" onClick={() => setDrawerOpen(false)} aria-label="关闭目录">Esc</button></header>
            {projectRail}
            <section className="recent-pages"><h3>最近流程页</h3>{userState.recentFlowPageIds.map((id) => { const page = userState.flowPages.find((item) => item.id === id); return page === undefined ? null : <button type="button" key={id} onClick={() => { setActivePageId(id); setDrawerOpen(false); }}>{page.name}</button>; })}</section>
          </div>
        </div>
      )}
      {businessDialog && (
        <BusinessDialog fragments={props.snapshot.fragments.filter((fragment) => selectedMembers.has(fragment.id))} onCancel={() => setBusinessDialog(false)} onSave={saveBusinessNode} />
      )}
    </div>
  );
}

function RelationInspector({ relation, snapshot }: { readonly relation: RelationBridge; readonly snapshot: AdapterIndexSnapshot }): React.JSX.Element {
  const source = snapshot.fragments.find((fragment) => fragment.id === relation.sourceFragmentId);
  const resolution = relation.resolution;
  const status = resolution.status;
  let target: string = status;
  if (resolution.status === 'resolved') target = snapshot.fragments.find((fragment) => fragment.id === resolution.targetId)?.displayName ?? status;
  if (resolution.status === 'ambiguous') target = `${resolution.candidates.length} 个可能目标`;
  if (resolution.status === 'external') target = resolution.endpoint.name;
  return <section className="relation-inspector"><span className={`resolution-badge resolution-badge--${status}`}>{status}</span><h3>{source?.displayName ?? '调用'} → {target}</h3><p>调用范围 [{relation.callSite.range.start}, {relation.callSite.range.end})</p>{relation.branchContext !== undefined && <p>条件：{relation.branchContext.label}</p>}<h4>解析证据</h4><ul>{relation.evidence.map((evidence, index) => <li key={`${evidence.kind}:${index}`}><strong>{evidence.kind}</strong><span>{evidence.detail}</span></li>)}</ul></section>;
}

export const reorderBusinessNodeForUi = moveBusinessMember;
