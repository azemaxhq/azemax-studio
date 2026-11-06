/**
 * Zod Schemas for Runtime Storage Validation and Type Safety.
 */
import { z } from 'zod';

export const ExplorerSortSchema = z.object({
    by: z.enum(['name', 'type', 'modified', 'size']).default('name'),
    direction: z.enum(['asc', 'desc']).default('asc'),
    foldersFirst: z.boolean().default(true),
}).default({
    by: 'name',
    direction: 'asc',
    foldersFirst: true,
});

export type ExplorerSortState = z.infer<typeof ExplorerSortSchema>;

export const BottomTabSchema = z.enum(['terminal', 'problems', 'output', 'performance']).default('performance');
export type BottomTabType = z.infer<typeof BottomTabSchema>;

export const LeftSidebarViewSchema = z.enum(['explorer', 'explanation', 'settings']).default('explorer');
export type LeftSidebarViewType = z.infer<typeof LeftSidebarViewSchema>;

export const LayoutDimensionsSchema = z.object({
    aiPanelWidth: z.number().min(200).max(800).default(350),
    leftSidebarWidth: z.number().min(150).max(600).default(256),
    bottomPanelHeight: z.number().min(100).max(800).default(256),
    isAiSidebarOpen: z.boolean().default(true),
    isLeftSidebarOpen: z.boolean().default(true),
    leftSidebarView: LeftSidebarViewSchema,
    bottomPanelActiveTab: BottomTabSchema,
});

export type LayoutDimensions = z.infer<typeof LayoutDimensionsSchema>;

export const BookmarkedFilesSchema = z.array(z.string()).max(1000).default([]);

export const ExplanationPersistedSchema = z.object({
    explanation: z.string().nullable().default(null),
    explanationError: z.string().nullable().default(null),
    explainedFor: z.string().nullable().default(null),
}).default({
    explanation: null,
    explanationError: null,
    explainedFor: null,
});

export type ExplanationPersisted = z.infer<typeof ExplanationPersistedSchema>;

export const ComposerChipSchema = z.object({
    id: z.string(),
    type: z.enum(['file', 'symbol', 'folder', 'selection']),
    label: z.string(),
    path: z.string().optional(),
    content: z.string().optional(),
});

export const ComposerChipsSchema = z.array(ComposerChipSchema).max(50).default([]);

export const PerformanceAlertMetricSchema = z.object({
    current: z.number().default(0),
    previous: z.number().default(0),
    change: z.number().default(0),
});

export const PerformanceAlertItemSchema = z.object({
    id: z.string(),
    type: z.enum(['improvement', 'regression', 'warning', 'achievement']).default('warning'),
    severity: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
    title: z.string().max(300).default('Alert'),
    message: z.string().max(2000).default(''),
    timestamp: z.number().default(0),
    metrics: PerformanceAlertMetricSchema.default({ current: 0, previous: 0, change: 0 }),
    category: z.enum(['execution', 'memory', 'cpu', 'quality', 'efficiency']).default('execution'),
});

export const PerformanceAlertsListSchema = z.array(PerformanceAlertItemSchema).max(50).default([]);

export const AnalysisSnapshotSchema = z.object({
    timestamp: z.number(),
    fileId: z.string(),
    fileName: z.string(),
    analysis: z.any(),
});

export const TrendDataSchema = z.object({
    fileId: z.string(),
    fileName: z.string(),
    snapshots: z.array(AnalysisSnapshotSchema).default([]),
    trend: z.object({
        improving: z.boolean().default(true),
        changeRate: z.number().default(0),
        stability: z.number().default(100),
    }).default({ improving: true, changeRate: 0, stability: 100 }),
});

export const AnalysisHistorySchema = z.record(z.string(), TrendDataSchema).default({});

/**
 * Validates and safely parses untrusted storage data with Zod schema.
 * If data is corrupted, malformed or invalid, safely returns the schema default.
 */
export function safeValidateWithSchema<T>(
    schema: z.ZodType<T>,
    data: unknown,
    fallback: T
): T {
    const result = schema.safeParse(data);
    if (result.success) {
        return result.data;
    }
    return fallback;
}

