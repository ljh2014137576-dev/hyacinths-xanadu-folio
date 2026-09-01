// @vitest-environment node
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { indexTypeScriptProject, indexTypeScriptProjectOperation } from '../../src/adapter-typescript/index.js';
import type { AdapterIndexSnapshot } from '../../src/adapter-api/index.js';

const fixtureRoot = resolve('fixtures/order-service');
let snapshot: AdapterIndexSnapshot;

beforeAll(async () => {
  snapshot = await indexTypeScriptProject(fixtureRoot);
});

describe('TypeScript 6 LanguageAdapter', () => {
  it('detects tsconfig and reports its exact compiler capability', () => {
    expect(snapshot.detection.status).toBe('matched');
    expect(snapshot.manifest.compilerVersion).toMatch(/^6\.0\./);
    expect(snapshot.manifest.capabilities.references).toBe('semantic');
    expect(snapshot.manifest.capabilities.incrementalUpdate).toBe(false);
  });

  it('propagates partial and cancelled terminal states instead of claiming completion', async () => {
    const partial = await indexTypeScriptProjectOperation(fixtureRoot);
    expect(partial.status).toBe('partial');
    const controller = new AbortController();
    controller.abort();
    const cancelled = await indexTypeScriptProjectOperation(fixtureRoot, controller.signal);
    expect(cancelled.status).toBe('cancelled');
    const midFlightController = new AbortController();
    const midFlight = await indexTypeScriptProjectOperation(fixtureRoot, midFlightController.signal, () => midFlightController.abort());
    expect(midFlight.status).toBe('cancelled');
    const changed = await indexTypeScriptProjectOperation(fixtureRoot, new AbortController().signal, () => undefined, ['src/controllers/order.controller.ts']);
    expect(changed.status === 'partial' && changed.snapshot.diagnostics.some((diagnostic) => diagnostic.code === 'INCREMENTAL_UNAVAILABLE')).toBe(true);
  });

  it('extracts functions, methods and exact UTF-16 source ranges', () => {
    const createOrder = snapshot.fragments.find((fragment) => fragment.displayName === 'createOrder');
    const decrementStock = snapshot.fragments.find((fragment) => fragment.displayName === 'decrementStock');
    expect(createOrder).toBeDefined();
    expect(decrementStock?.symbolKind).toBe('method');
    if (createOrder === undefined) throw new Error('createOrder missing');
    const source = snapshot.sourceContents[createOrder.sourceFileId];
    expect(source?.slice(createOrder.definitionRange.start, createOrder.definitionRange.end)).toBe('createOrder');
    expect(source?.slice(createOrder.fullRange.start, createOrder.fullRange.end)).toContain('publishOrderCreated');
  });

  it('resolves cross-file alias and method calls using TypeChecker evidence', () => {
    const createOrder = snapshot.fragments.find((fragment) => fragment.displayName === 'createOrder');
    const reserveInventory = snapshot.fragments.find((fragment) => fragment.displayName === 'reserveInventory');
    if (createOrder === undefined || reserveInventory === undefined) throw new Error('fixture symbols missing');
    const outgoing = snapshot.relations.filter((relation) => relation.sourceFragmentId === createOrder.id);
    const resolvedNames = outgoing.flatMap((relation) => {
      const resolution = relation.resolution;
      return resolution.status === 'resolved'
        ? [snapshot.fragments.find((fragment) => fragment.id === resolution.targetId)?.displayName]
        : [];
    }).filter(Boolean);
    expect(resolvedNames).toContain('getProducts');
    expect(resolvedNames).toContain('reserveInventory');
    expect(outgoing.some((relation) => relation.evidence.some((evidence) => evidence.kind === 'alias'))).toBe(true);

    const inventoryOutgoing = snapshot.relations.filter((relation) => relation.sourceFragmentId === reserveInventory.id);
    expect(inventoryOutgoing.some((relation) => {
      const resolution = relation.resolution;
      return resolution.status === 'resolved' &&
        snapshot.fragments.find((fragment) => fragment.id === resolution.targetId)?.displayName === 'decrementStock';
    })).toBe(true);
  });

  it('preserves ambiguous, unresolved and external calls as first-class facts', () => {
    const statuses = new Set(snapshot.relations.map((relation) => relation.resolution.status));
    expect(statuses).toContain('ambiguous');
    expect(statuses).toContain('unresolved');
    expect(statuses).toContain('external');
  });

  it('recovers from a syntax error with a partial file diagnostic', () => {
    expect(snapshot.diagnostics.some((diagnostic) => diagnostic.code.startsWith('TS') && diagnostic.severity === 'error')).toBe(true);
    expect(snapshot.sourceFiles.find((file) => file.projectRelativePath.endsWith('broken.ts'))?.indexState).toBe('partial');
    expect(snapshot.fragments.some((fragment) => fragment.displayName === 'createOrder')).toBe(true);
  });

  it('models all five source loop kinds once with static-only estimates and exits', () => {
    const kinds = new Set(snapshot.loops.map((loop) => loop.kind));
    expect(kinds).toEqual(new Set(['for', 'while', 'do-while', 'for-of', 'for-in']));
    const estimates = new Set(snapshot.loops.map((loop) => loop.iterationEstimate.kind));
    expect(estimates).toEqual(new Set(['upper-bound', 'expression', 'unknown']));
    const exitReasons = new Set(snapshot.loops.flatMap((loop) => loop.exitEdges.map((edge) => edge.reason)));
    expect(exitReasons).toContain('break');
    expect(exitReasons).toContain('return');
    expect(exitReasons).toContain('throw');
    expect(snapshot.loops.some((loop) => loop.continueEdges.length > 0)).toBe(true);
    expect(snapshot.loops.every((loop) => loop.backEdges.length === 1)).toBe(true);
  });

  it('anchors loop control by loop kind and only proves validated induction updates', () => {
    const textFor = (anchor: { readonly sourceFileId: string; readonly range: { readonly start: number; readonly end: number } }): string =>
      snapshot.sourceContents[anchor.sourceFileId]?.slice(anchor.range.start, anchor.range.end) ?? '';
    const loopByText = (needle: string) => snapshot.loops.find((loop) => textFor(loop.source).includes(needle));

    const stepTwo = loopByText('index += 2');
    expect(stepTwo?.iterationEstimate).toMatchObject({ kind: 'upper-bound', value: 3 });
    expect(textFor(stepTwo?.backEdges[0]?.target ?? (() => { throw new Error('step-two back edge missing'); })())).toBe('index += 2');
    expect(stepTwo?.continueEdges.length).toBeGreaterThan(0);
    expect(stepTwo?.exitEdges.some((edge) => edge.reason === 'break')).toBe(true);
    expect(textFor(stepTwo?.continueEdges[0]?.target ?? (() => { throw new Error('labeled continue missing'); })())).toBe('index += 2');

    expect(loopByText('down--')?.iterationEstimate).toMatchObject({ kind: 'upper-bound', value: 5 });
    expect(loopByText('wrong++')?.iterationEstimate.kind).toBe('unknown');
    expect(loopByText('stuck < 5')?.iterationEstimate.kind).toBe('unknown');

    const doWhile = snapshot.loops.find((loop) => loop.kind === 'do-while');
    expect(doWhile?.entryEdges[0]?.target.range).toEqual(doWhile?.body.range);
  });
});
