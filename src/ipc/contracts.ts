import { z } from 'zod';

export const IPC_CHANNELS = {
  appInfo: 'xanadu:app-info',
  selectWorkspace: 'xanadu:select-workspace',
  utilityHealth: 'xanadu:utility-health',
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

export interface XanaduDesktopApi {
  getAppInfo(): Promise<AppInfo>;
  selectWorkspace(): Promise<WorkspaceSummary | null>;
  getUtilityHealth(): Promise<UtilityHealth>;
}

export const isEmptyRequest = (value: unknown): value is undefined => value === undefined;
