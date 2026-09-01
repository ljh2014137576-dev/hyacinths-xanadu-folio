import type {
  Diagnostic,
  FunctionFragment,
  LoopRegion,
  RelationBridge,
  SourceAnchor,
  SourceFile,
  TextRange,
} from '../model/index.js';

export interface LanguageDescriptor {
  readonly languageId: string;
  readonly displayName: string;
  readonly filePatterns: readonly string[];
}

export interface AdapterCapabilities {
  readonly symbols: 'none' | 'syntax' | 'semantic';
  readonly references: 'none' | 'syntax' | 'semantic';
  readonly controlFlow: boolean;
  readonly loops: boolean;
  readonly stableIds: 'declaration' | 'relocatable';
  readonly incrementalUpdate: boolean;
  readonly externalEndpoints: boolean;
}

export interface LanguageAdapterManifest {
  readonly adapterId: string;
  readonly displayName: string;
  readonly adapterVersion: string;
  readonly compilerVersion: string;
  readonly coreApiRange: string;
  readonly dtoSchemaVersion: 1;
  readonly languages: readonly LanguageDescriptor[];
  readonly detection: {
    readonly projectFiles: readonly string[];
    readonly filePatterns: readonly string[];
  };
  readonly capabilities: AdapterCapabilities;
  readonly runtime: { readonly kind: 'bundled-node'; readonly entrypoint: string };
}

export type AdapterHealth =
  | { readonly status: 'healthy'; readonly checkedAt: string }
  | { readonly status: 'degraded'; readonly checkedAt: string; readonly diagnostics: readonly Diagnostic[] }
  | { readonly status: 'limited'; readonly checkedAt: string; readonly reason: string };

export interface DetectionEvidence {
  readonly kind: 'configuration' | 'extension' | 'manifest';
  readonly projectRelativePath: string;
}

export type DetectionResult =
  | {
      readonly status: 'matched';
      readonly confidence: 'exact' | 'probable';
      readonly evidence: readonly DetectionEvidence[];
      readonly configurations: readonly string[];
    }
  | { readonly status: 'not-matched'; readonly evidence: readonly DetectionEvidence[] }
  | { readonly status: 'limited'; readonly reason: string; readonly evidence: readonly DetectionEvidence[] }
  | { readonly status: 'failed'; readonly diagnostic: Diagnostic };

export interface AdapterCallContext {
  readonly requestId: string;
  readonly generation: number;
  readonly signal: AbortSignal;
}

export interface AdapterHost {
  listFiles(patterns: readonly string[]): Promise<readonly string[]>;
  readFile(projectRelativePath: string, expectedRevision?: string): Promise<{
    readonly content: string;
    readonly revision: string;
  }>;
  now(): string;
  hash(value: string): string;
  reportProgress(progress: IndexProgress): void;
}

export interface DetectProjectRequest {
  readonly candidateFiles: readonly string[];
}

export interface OpenSessionRequest {
  readonly projectId: string;
  readonly configuration?: string;
}

export interface IndexRequest {
  readonly changedFiles?: readonly string[];
}

export interface IndexProgress {
  readonly phase: 'detect' | 'read' | 'parse' | 'bind' | 'resolve' | 'persist';
  readonly completed: number;
  readonly total?: number | undefined;
  readonly message: string;
}

export type IndexEvent =
  | { readonly type: 'file'; readonly file: SourceFile; readonly content: string }
  | {
      readonly type: 'symbols';
      readonly fileId: string;
      readonly revision: string;
      readonly symbols: readonly FunctionFragment[];
    }
  | {
      readonly type: 'relations';
      readonly fileId: string;
      readonly revision: string;
      readonly relations: readonly RelationBridge[];
    }
  | {
      readonly type: 'loops';
      readonly fileId: string;
      readonly revision: string;
      readonly loops: readonly LoopRegion[];
    }
  | { readonly type: 'diagnostics'; readonly diagnostics: readonly Diagnostic[] }
  | { readonly type: 'progress'; readonly progress: IndexProgress };

export interface IndexEventSink {
  emit(event: IndexEvent): void;
}

export interface IndexSummary {
  readonly status: 'completed' | 'partial' | 'cancelled' | 'failed';
  readonly filesIndexed: number;
  readonly diagnostics: readonly Diagnostic[];
}

export interface SourceFragmentRequest {
  readonly anchor: SourceAnchor;
  readonly contextCharacters?: number;
}

export type SourceFragmentResult =
  | {
      readonly status: 'ok';
      readonly projectRelativePath: string;
      readonly revision: string;
      readonly requestedRange: TextRange;
      readonly contextRange: TextRange;
      readonly content: string;
    }
  | { readonly status: 'stale'; readonly currentRevision: string }
  | { readonly status: 'missing' };

export interface RelocateRequest {
  readonly previous: readonly FunctionFragment[];
}

export type RelocationMatch =
  | {
      readonly status: 'matched';
      readonly previousId: string;
      readonly currentId: string;
      readonly certainty: 'exact' | 'probable';
      readonly evidence: readonly string[];
    }
  | { readonly status: 'ambiguous'; readonly previousId: string; readonly candidates: readonly string[]; readonly evidence: readonly string[] }
  | { readonly status: 'missing'; readonly previousId: string; readonly evidence: readonly string[] };

export interface AdapterSession {
  index(request: IndexRequest, sink: IndexEventSink, context: AdapterCallContext): Promise<IndexSummary>;
  getSourceFragment(request: SourceFragmentRequest, context: AdapterCallContext): Promise<SourceFragmentResult>;
  relocateSymbols(request: RelocateRequest, context: AdapterCallContext): Promise<readonly RelocationMatch[]>;
  dispose(): Promise<void>;
}

export interface LanguageAdapter {
  readonly manifest: LanguageAdapterManifest;
  getHealth(): AdapterHealth;
  detectProject(request: DetectProjectRequest, context: AdapterCallContext): Promise<DetectionResult>;
  openSession(request: OpenSessionRequest, host: AdapterHost): Promise<AdapterSession>;
}

export interface AdapterIndexSnapshot {
  readonly manifest: LanguageAdapterManifest;
  readonly health: AdapterHealth;
  readonly detection: DetectionResult;
  readonly sourceFiles: readonly SourceFile[];
  readonly sourceContents: Readonly<Record<string, string>>;
  readonly fragments: readonly FunctionFragment[];
  readonly relations: readonly RelationBridge[];
  readonly loops: readonly LoopRegion[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface AdapterContractReport {
  readonly manifestValid: boolean;
  readonly detectionStatus: DetectionResult['status'];
  readonly eventTypes: readonly IndexEvent['type'][];
  readonly summaryStatus: IndexSummary['status'];
}

const isSemver = (value: string): boolean => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);

export const validateAdapterManifest = (manifest: LanguageAdapterManifest): readonly string[] => {
  const problems: string[] = [];
  if (manifest.adapterId.trim().length === 0) problems.push('adapterId is required');
  if (!isSemver(manifest.adapterVersion)) problems.push('adapterVersion must be SemVer');
  if (!isSemver(manifest.compilerVersion)) problems.push('compilerVersion must be SemVer');
  if (manifest.languages.length === 0) problems.push('at least one language is required');
  if (manifest.runtime.kind !== 'bundled-node') problems.push('MVP adapters must be bundled');
  return problems;
};

export const exerciseAdapterContract = async (
  adapter: LanguageAdapter,
  host: AdapterHost,
  candidateFiles: readonly string[],
  signal: AbortSignal,
): Promise<AdapterContractReport> => {
  const context: AdapterCallContext = { requestId: 'contract-suite', generation: 1, signal };
  const detection = await adapter.detectProject({ candidateFiles }, context);
  const session = await adapter.openSession({ projectId: 'contract-project' }, host);
  const events: IndexEvent[] = [];
  try {
    const summary = await session.index({}, { emit: (event) => events.push(event) }, context);
    return {
      manifestValid: validateAdapterManifest(adapter.manifest).length === 0,
      detectionStatus: detection.status,
      eventTypes: events.map((event) => event.type),
      summaryStatus: summary.status,
    };
  } finally {
    await session.dispose();
  }
};
