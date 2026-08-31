import type { MessageEvent } from 'electron';
import { indexTypeScriptProject } from '../src/adapter-typescript/index.js';
import type { IndexProgress } from '../src/adapter-api/index.js';

interface HealthRequest {
  readonly type: 'health';
}

interface IndexWorkspaceRequest {
  readonly type: 'index';
  readonly requestId: string;
  readonly rootPath: string;
}

interface CancelRequest {
  readonly type: 'cancel';
  readonly requestId: string;
}

const controllers = new Map<string, AbortController>();

const isHealthRequest = (value: unknown): value is HealthRequest =>
  typeof value === 'object' && value !== null && 'type' in value && value.type === 'health';

const isIndexRequest = (value: unknown): value is IndexWorkspaceRequest =>
  typeof value === 'object' && value !== null &&
  'type' in value && value.type === 'index' &&
  'requestId' in value && typeof value.requestId === 'string' &&
  'rootPath' in value && typeof value.rootPath === 'string';

const isCancelRequest = (value: unknown): value is CancelRequest =>
  typeof value === 'object' && value !== null &&
  'type' in value && value.type === 'cancel' &&
  'requestId' in value && typeof value.requestId === 'string';

process.parentPort?.on('message', (event: MessageEvent) => {
  if (isCancelRequest(event.data)) {
    controllers.get(event.data.requestId)?.abort();
    return;
  }
  if (isHealthRequest(event.data)) {
    process.parentPort?.postMessage({ status: 'healthy', process: 'utility' });
    return;
  }
  if (isIndexRequest(event.data)) {
    const { requestId, rootPath } = event.data;
    const controller = new AbortController();
    controllers.set(requestId, controller);
    const reportProgress = (progress: IndexProgress): void => {
      process.parentPort?.postMessage({ type: 'index-progress', requestId, progress });
    };
    void indexTypeScriptProject(rootPath, controller.signal, reportProgress)
      .then((snapshot) => process.parentPort?.postMessage({ type: 'index-result', requestId, snapshot }))
      .catch((error: unknown) => process.parentPort?.postMessage({
        type: 'index-error',
        requestId,
        message: error instanceof Error ? error.message : 'Unknown index error',
      }))
      .finally(() => controllers.delete(requestId));
  }
});
