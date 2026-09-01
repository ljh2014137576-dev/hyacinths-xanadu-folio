import { describe, expect, it } from 'vitest';
import { parseAdapterIndexSnapshot, isSafeProjectRelativePath } from '../../src/ipc/adapter-schemas.js';
import { indexWorkspaceRequestSchema, indexWorkspaceResultSchema } from '../../src/ipc/contracts.js';
import { isTrustedSenderUrl } from '../../src/ipc/security.js';
import { testSnapshot } from '../fixtures/adapter-snapshot.js';

const clone = (): unknown => structuredClone(testSnapshot);

describe('runtime IPC DTO validation', () => {
  it('accepts a complete valid snapshot and rejects nested range/revision/path corruption', () => {
    expect(parseAdapterIndexSnapshot(clone()).relations).toHaveLength(2);

    const badRange = clone() as { relations: { callSite: { range: { end: number } } }[] };
    const firstRelation = badRange.relations[0];
    if (firstRelation === undefined) throw new Error('fixture relation missing');
    firstRelation.callSite.range.end = 100_000;
    expect(() => parseAdapterIndexSnapshot(badRange)).toThrow('Invalid call-site anchor');

    const badPath = clone() as { sourceFiles: { projectRelativePath: string }[] };
    const firstFile = badPath.sourceFiles[0];
    if (firstFile === undefined) throw new Error('fixture source missing');
    firstFile.projectRelativePath = '..\\outside.ts';
    expect(() => parseAdapterIndexSnapshot(badPath)).toThrow('Path must stay inside');

    const badRevision = clone() as { fragments: { provenance: { revision: string } }[] };
    const firstFragment = badRevision.fragments[0];
    if (firstFragment === undefined) throw new Error('fixture fragment missing');
    firstFragment.provenance.revision = 'stale-revision';
    expect(() => parseAdapterIndexSnapshot(badRevision)).toThrow('provenance');
  });

  it('rejects invalid request handles and invalid utility result payloads', () => {
    expect(() => indexWorkspaceRequestSchema.parse({ handle: '../workspace', requestId: 'index-1' })).toThrow();
    expect(() => indexWorkspaceResultSchema.parse({ status: 'completed', snapshot: { sourceFiles: [] } })).toThrow();
    expect(isSafeProjectRelativePath('src/order.ts')).toBe(true);
    expect(isSafeProjectRelativePath('..\\outside.ts')).toBe(false);
  });

  it('requires an exact production URL or exact development origin', () => {
    expect(isTrustedSenderUrl('file:///app/dist/index.html', undefined, 'file:///app/dist/index.html')).toBe(true);
    expect(isTrustedSenderUrl('file:///tmp/other.html', undefined, 'file:///app/dist/index.html')).toBe(false);
    expect(isTrustedSenderUrl('http://127.0.0.1:5173/page', 'http://127.0.0.1:5173', 'file:///app/index.html')).toBe(true);
    expect(isTrustedSenderUrl('http://127.0.0.1:51730/page', 'http://127.0.0.1:5173', 'file:///app/index.html')).toBe(false);
  });
});
