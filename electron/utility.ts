import type { MessageEvent } from 'electron';

interface HealthRequest {
  readonly type: 'health';
}

const isHealthRequest = (value: unknown): value is HealthRequest =>
  typeof value === 'object' && value !== null && 'type' in value && value.type === 'health';

process.parentPort?.on('message', (event: MessageEvent) => {
  if (!isHealthRequest(event.data)) {
    return;
  }
  process.parentPort?.postMessage({ status: 'healthy', process: 'utility' });
});
