import { z } from 'zod';
import type { AdapterIndexSnapshot, IndexProgress, RelocationMatch } from '../adapter-api/index.js';
import { userWorkspaceStateSchema, type UserWorkspaceState } from '../model/index.js';
import { adapterIndexSnapshotSchema } from './adapter-schemas.js';

export const IPC_CHANNELS = {
  appInfo: 'xanadu:app-info',
  selectWorkspace: 'xanadu:select-workspace',
  utilityHealth: 'xanadu:utility-health',
  indexWorkspace: 'xanadu:index-workspace',
  cancelIndex: 'xanadu:cancel-index',
  indexProgress: 'xanadu:index-progress',
  loadUserState: 'xanadu:load-user-state',
  saveUserState: 'xanadu:save-user-state',
  clearIndexCache: 'xanadu:clear-index-cache',
} as const;

export const workspaceSummarySchema = z.object({
  handle: z.string().min(1),
  displayName: z.string().min(1),
});

export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;

export interface AppInfo {
  readonly name: string;
  readonly version: string;
  readonly platform: string;
}

export interface UtilityHealth {
  readonly status: 'healthy' | 'degraded';
  readonly process: 'utility';
}

export const workspaceHandleRequestSchema = z.object({ handle: z.string().uuid() });
export const indexWorkspaceRequestSchema = workspaceHandleRequestSchema.extend({ requestId: z.string().min(1).max(100) });
export const cancelIndexRequestSchema = z.object({ requestId: z.string().min(1).max(100) });
export const saveUserStateRequestSchema = workspaceHandleRequestSchema.extend({
  generation: z.number().int().nonnegative(),
  state: userWorkspaceStateSchema,
  acknowledgeRelocationJournal: z.string().min(1).optional(),
});
export const indexProgressEnvelopeSchema = z.object({
  requestId: z.string().min(1),
  progress: z.object({
    phase: z.enum(['detect', 'read', 'parse', 'bind', 'resolve', 'persist']),
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().optional(),
    message: z.string(),
  }),
});

export interface IndexProgressEnvelope {
  readonly requestId: string;
  readonly progress: IndexProgress;
}

export type IndexProgressListener = (event: IndexProgressEnvelope) => void;

export type IndexWorkspaceResult =
  | { readonly status: 'completed' | 'partial'; readonly snapshot: AdapterIndexSnapshot; readonly relocation?: readonly RelocationMatch[]; readonly relationRelocation?: readonly RelocationMatch[]; readonly relocationJournalId?: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly message: string };

export const indexWorkspaceResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('completed'), snapshot: adapterIndexSnapshotSchema, relocation: z.array(z.discriminatedUnion('status', [
    z.object({ status: z.literal('matched'), previousId: z.string().min(1), currentId: z.string().min(1), certainty: z.enum(['exact', 'probable']), evidence: z.array(z.string()) }),
    z.object({ status: z.literal('ambiguous'), previousId: z.string().min(1), candidates: z.array(z.string().min(1)).min(1), evidence: z.array(z.string()).min(1) }),
    z.object({ status: z.literal('missing'), previousId: z.string().min(1), evidence: z.array(z.string()).min(1) }),
  ])).optional(), relationRelocation: z.array(z.discriminatedUnion('status', [
    z.object({ status: z.literal('matched'), previousId: z.string().min(1), currentId: z.string().min(1), certainty: z.enum(['exact', 'probable']), evidence: z.array(z.string()) }),
    z.object({ status: z.literal('ambiguous'), previousId: z.string().min(1), candidates: z.array(z.string().min(1)).min(1), evidence: z.array(z.string()).min(1) }),
    z.object({ status: z.literal('missing'), previousId: z.string().min(1), evidence: z.array(z.string()).min(1) }),
  ])).optional(), relocationJournalId: z.string().min(1).optional() }),
  z.object({ status: z.literal('partial'), snapshot: adapterIndexSnapshotSchema, relocation: z.array(z.discriminatedUnion('status', [
    z.object({ status: z.literal('matched'), previousId: z.string().min(1), currentId: z.string().min(1), certainty: z.enum(['exact', 'probable']), evidence: z.array(z.string()) }),
    z.object({ status: z.literal('ambiguous'), previousId: z.string().min(1), candidates: z.array(z.string().min(1)).min(1), evidence: z.array(z.string()).min(1) }),
    z.object({ status: z.literal('missing'), previousId: z.string().min(1), evidence: z.array(z.string()).min(1) }),
  ])).optional(), relationRelocation: z.array(z.discriminatedUnion('status', [
    z.object({ status: z.literal('matched'), previousId: z.string().min(1), currentId: z.string().min(1), certainty: z.enum(['exact', 'probable']), evidence: z.array(z.string()) }),
    z.object({ status: z.literal('ambiguous'), previousId: z.string().min(1), candidates: z.array(z.string().min(1)).min(1), evidence: z.array(z.string()).min(1) }),
    z.object({ status: z.literal('missing'), previousId: z.string().min(1), evidence: z.array(z.string()).min(1) }),
  ])).optional(), relocationJournalId: z.string().min(1).optional() }),
  z.object({ status: z.literal('cancelled') }),
  z.object({ status: z.literal('failed'), message: z.string().min(1) }),
]);

export interface SaveUserStateResult {
  readonly status: 'saved' | 'stale';
  readonly generation: number;
}

export const saveUserStateResultSchema = z.object({
  status: z.enum(['saved', 'stale']),
  generation: z.number().int().nonnegative(),
});

export interface XanaduDesktopApi {
  getAppInfo(): Promise<AppInfo>;
  selectWorkspace(): Promise<WorkspaceSummary | null>;
  getUtilityHealth(): Promise<UtilityHealth>;
  indexWorkspace(request: { readonly handle: string; readonly requestId: string }): Promise<IndexWorkspaceResult>;
  cancelIndex(request: { readonly requestId: string }): Promise<boolean>;
  onIndexProgress(listener: IndexProgressListener): () => void;
  loadUserState(request: { readonly handle: string }): Promise<UserWorkspaceState>;
  saveUserState(request: { readonly handle: string; readonly generation: number; readonly state: UserWorkspaceState; readonly acknowledgeRelocationJournal?: string }): Promise<SaveUserStateResult>;
  clearIndexCache(request: { readonly handle: string }): Promise<void>;
}

export const isEmptyRequest = (value: unknown): value is undefined => value === undefined;
