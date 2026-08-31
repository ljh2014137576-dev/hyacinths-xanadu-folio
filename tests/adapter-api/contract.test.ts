import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  exerciseAdapterContract,
  type AdapterHost,
  type AdapterSession,
  type LanguageAdapter,
} from '../../src/adapter-api/index.js';
import { projectId, sourceFileId } from '../../src/model/index.js';

const host: AdapterHost = {
  listFiles: () => Promise.resolve(['src/example.fake']),
  readFile: () => Promise.resolve({ content: 'fake source', revision: 'r1' }),
  now: () => '2026-09-01T00:00:00.000Z',
  hash: (value) => createHash('sha256').update(value).digest('hex'),
  reportProgress: () => undefined,
};

const session: AdapterSession = {
  index: (_request, sink, context) => {
    if (context.signal.aborted) {
      return Promise.resolve({ status: 'cancelled', filesIndexed: 0, diagnostics: [] });
    }
    sink.emit({
      type: 'file',
      file: {
        id: sourceFileId('file:example'),
        projectId: projectId('project:fake'),
        projectRelativePath: 'src/example.fake',
        languageId: 'fake',
        revision: 'r1',
        contentHash: 'hash',
        lineStarts: [0],
        indexState: 'indexed',
      },
      content: 'fake source',
    });
    return Promise.resolve({ status: 'completed', filesIndexed: 1, diagnostics: [] });
  },
  getSourceFragment: () => Promise.resolve({ status: 'missing' }),
  relocateSymbols: (request) => Promise.resolve(request.previous.map((item) => ({ status: 'missing', previousId: item.symbolId }))),
  dispose: () => Promise.resolve(),
};

const adapter: LanguageAdapter = {
  manifest: {
    adapterId: 'fake.adapter',
    displayName: 'Fake contract adapter',
    adapterVersion: '1.0.0',
    compilerVersion: '1.0.0',
    coreApiRange: '^1.0.0',
    dtoSchemaVersion: 1,
    languages: [{ languageId: 'fake', displayName: 'Fake', filePatterns: ['**/*.fake'] }],
    detection: { projectFiles: ['fake.json'], filePatterns: ['**/*.fake'] },
    capabilities: {
      symbols: 'semantic',
      references: 'semantic',
      controlFlow: true,
      loops: true,
      stableIds: 'relocatable',
      incrementalUpdate: true,
      externalEndpoints: true,
    },
    runtime: { kind: 'bundled-node', entrypoint: 'fake.js' },
  },
  getHealth: () => ({ status: 'healthy', checkedAt: '2026-09-01T00:00:00.000Z' }),
  detectProject: (request) => {
    const evidence = [{ kind: 'extension' as const, projectRelativePath: 'src/example.fake' }];
    if (request.candidateFiles.some((file) => file.endsWith('.fake'))) {
      return Promise.resolve({ status: 'matched', confidence: 'exact', configurations: ['fake.json'], evidence });
    }
    return Promise.resolve({ status: 'not-matched', evidence });
  },
  openSession: () => Promise.resolve(session),
};

describe('LanguageAdapter contract', () => {
  it('validates a language-neutral adapter and event stream', async () => {
    const report = await exerciseAdapterContract(adapter, host, ['src/example.fake'], new AbortController().signal);
    expect(report).toEqual({
      manifestValid: true,
      detectionStatus: 'matched',
      eventTypes: ['file'],
      summaryStatus: 'completed',
    });
  });

  it('treats cancellation as a normal terminal status', async () => {
    const controller = new AbortController();
    controller.abort();
    const report = await exerciseAdapterContract(adapter, host, ['src/example.fake'], controller.signal);
    expect(report.summaryStatus).toBe('cancelled');
  });
});
