import { useEffect, useRef, useState } from 'react';
import type { AdapterIndexSnapshot, IndexProgress } from '../adapter-api/index.js';
import type { AppInfo, UtilityHealth, WorkspaceSummary } from '../ipc/contracts.js';
import type { UserWorkspaceState } from '../model/index.js';
import { migrateUserAssets, rebuildMigratedFlowPages } from '../index-core/index.js';
import { WorkspaceView } from './components/WorkspaceView.js';

export function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [health, setHealth] = useState<UtilityHealth | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [snapshot, setSnapshot] = useState<AdapterIndexSnapshot | null>(null);
  const [userState, setUserState] = useState<UserWorkspaceState | null>(null);
  const [indexStatus, setIndexStatus] = useState<'completed' | 'partial'>('completed');
  const [relocationWarnings, setRelocationWarnings] = useState(0);
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);

  useEffect(() => {
    void window.xanadu.getAppInfo().then(setAppInfo).catch(() => setError('无法读取应用信息'));
    void window.xanadu.getUtilityHealth().then(setHealth).catch(() => setHealth({ status: 'degraded', process: 'utility' }));
    return window.xanadu.onIndexProgress((event) => {
      if (event.requestId === requestId.current) setProgress(event.progress);
    });
  }, []);

  const chooseWorkspace = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    setProgress({ phase: 'detect', completed: 0, message: '等待本地项目授权' });
    try {
      const selected = await window.xanadu.selectWorkspace();
      if (selected === null) {
        setBusy(false);
        setProgress(null);
        return;
      }
      setWorkspace(selected);
      const nextRequestId = `index-${Date.now()}`;
      requestId.current = nextRequestId;
      const [indexResult, restored] = await Promise.all([
        window.xanadu.indexWorkspace({ handle: selected.handle, requestId: nextRequestId }),
        window.xanadu.loadUserState({ handle: selected.handle }),
      ]);
      if (indexResult.status === 'cancelled') {
        setProgress({ phase: 'read', completed: 0, message: '索引已取消' });
        setWorkspace(null);
        return;
      }
      if (indexResult.status === 'failed') throw new Error(indexResult.message);
      const relocation = indexResult.relocation ?? [];
      const relationRelocation = indexResult.relationRelocation ?? [];
      const migration = migrateUserAssets(restored, relocation, relationRelocation);
      const hasMigrationWork = indexResult.relocationJournalId !== undefined;
      const migratedState = hasMigrationWork ? rebuildMigratedFlowPages(migration.state, indexResult.snapshot) : migration.state;
      setSnapshot(indexResult.snapshot);
      setIndexStatus(indexResult.status);
      setUserState(migratedState);
      setRelocationWarnings(migratedState.pendingMigrations?.length ?? 0);
      if (hasMigrationWork) {
        await window.xanadu.saveUserState({
          handle: selected.handle,
          generation: Date.now(),
          state: migratedState,
          acknowledgeRelocationJournal: indexResult.relocationJournalId,
        });
      }
      setProgress({
        phase: 'persist',
        completed: indexResult.snapshot.sourceFiles.length,
        total: indexResult.snapshot.sourceFiles.length,
        message: indexResult.status === 'partial' ? '部分索引完成，请查看诊断' : '索引完成',
      });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : '项目索引失败，请检查 TypeScript 配置。');
    } finally {
      setBusy(false);
    }
  };

  const cancelIndex = async (): Promise<void> => {
    if (requestId.current !== null) await window.xanadu.cancelIndex({ requestId: requestId.current });
  };

  if (workspace !== null && snapshot !== null && userState !== null) {
    return (
      <WorkspaceView
        workspace={workspace}
        snapshot={snapshot}
        initialState={userState}
        indexStatus={indexStatus}
        relocationWarnings={relocationWarnings}
        onPersist={(state, generation) => window.xanadu.saveUserState({ handle: workspace.handle, generation, state })}
        onChooseAnother={() => {
          setWorkspace(null);
          setSnapshot(null);
          setUserState(null);
          setProgress(null);
          setIndexStatus('completed');
          setRelocationWarnings(0);
        }}
      />
    );
  }

  return (
    <main className="app-shell import-shell">
      <header className="app-bar">
        <div className="brand-mark" aria-hidden="true">X</div>
        <div><h1>Xanadu Code Flow Browser</h1><p>本地优先 · 静态来源浏览</p></div>
        <span className={`health health--${health?.status ?? 'pending'}`}>
          {health?.status === 'healthy' ? '索引进程健康' : '正在检查索引进程'}
        </span>
      </header>
      <section className="import-layout" aria-labelledby="welcome-title">
        <aside className="recent-placeholder"><span>最近项目</span>{workspace === null ? <p>尚未打开项目</p> : <article><strong>{workspace.displayName}</strong><small>本地授权句柄已创建</small></article>}</aside>
        <div className="import-card">
          <span className="eyebrow">MVP 0.1 · STATIC ONLY</span>
          <h2 id="welcome-title">把跨文件调用，重新组织成可追溯的源码长页。</h2>
          <p>通过原生选择器授权 TypeScript 项目。源码只在本机的 utility process 中索引，renderer 不持有任意文件系统权限或绝对路径。</p>
          <button type="button" onClick={() => void chooseWorkspace()} disabled={busy}>{busy ? '正在扫描…' : '选择本地 TypeScript 项目'}</button>
          {busy && <button className="button-secondary" type="button" onClick={() => void cancelIndex()}>取消索引</button>}
          {progress !== null && (
            <div className="index-progress" aria-live="polite"><span>{progress.message}</span><progress value={progress.completed} {...(progress.total === undefined ? {} : { max: progress.total })} /></div>
          )}
          {error !== null && <p className="error" role="alert">{error}</p>}
        </div>
        <aside className="adapter-preview"><span>语言规则</span><article className="adapter-card"><i>TS</i><div><strong>TypeScript</strong><small>内置 · @typescript/typescript6</small></div><b>{health?.status === 'healthy' ? '健康' : '检查中'}</b></article><dl><div><dt>符号提取</dt><dd>semantic</dd></div><div><dt>引用解析</dt><dd>TypeChecker</dd></div><div><dt>控制流 / LoopRegion</dt><dd>支持</dd></div></dl></aside>
      </section>
      <footer>{appInfo === null ? '正在载入…' : `${appInfo.name} ${appInfo.version} · ${appInfo.platform}`}</footer>
    </main>
  );
}
