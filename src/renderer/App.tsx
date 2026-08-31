import { useEffect, useState } from 'react';
import type { AppInfo, UtilityHealth, WorkspaceSummary } from '../ipc/contracts.js';

export function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [health, setHealth] = useState<UtilityHealth | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.xanadu.getAppInfo().then(setAppInfo).catch(() => setError('无法读取应用信息'));
    void window.xanadu.getUtilityHealth().then(setHealth).catch(() => setHealth({ status: 'degraded', process: 'utility' }));
  }, []);

  const chooseWorkspace = async (): Promise<void> => {
    setError(null);
    try {
      setWorkspace(await window.xanadu.selectWorkspace());
    } catch {
      setError('项目选择失败，请重试。');
    }
  };

  return (
    <main className="app-shell">
      <header className="app-bar">
        <div className="brand-mark" aria-hidden="true">X</div>
        <div>
          <h1>Xanadu Code Flow Browser</h1>
          <p>本地优先 · 静态来源浏览</p>
        </div>
        <span className={`health health--${health?.status ?? 'pending'}`}>
          {health?.status === 'healthy' ? '索引进程健康' : '正在检查索引进程'}
        </span>
      </header>
      <section className="welcome-panel" aria-labelledby="welcome-title">
        <div className="welcome-copy">
          <span className="eyebrow">MVP 0.1</span>
          <h2 id="welcome-title">从真实源码出发，连续阅读业务流程。</h2>
          <p>选择本地 TypeScript 项目。源码只在本机索引，renderer 不获得任意文件系统权限。</p>
          <button type="button" onClick={() => void chooseWorkspace()}>选择本地项目</button>
          {workspace !== null && <p className="workspace-result">已授权：{workspace.displayName}</p>}
          {error !== null && <p className="error" role="alert">{error}</p>}
        </div>
        <div className="boundary-card" aria-label="安全进程边界">
          <div><strong>Renderer</strong><span>只读 UI</span></div>
          <i aria-hidden="true">→</i>
          <div><strong>Preload</strong><span>窄化 IPC</span></div>
          <i aria-hidden="true">→</i>
          <div><strong>Utility</strong><span>本地索引</span></div>
        </div>
      </section>
      <footer>{appInfo === null ? '正在载入…' : `${appInfo.name} ${appInfo.version} · ${appInfo.platform}`}</footer>
    </main>
  );
}
