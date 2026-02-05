import { z } from 'zod';

import { IssueSchema } from './issue.js';

/**
 * Risk level derived from risk score
 */
export const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

/**
 * Statistics about the review execution
 */
export const ReviewStatsSchema = z.object({
    /** Number of files changed in the PR */
    files_changed: z.number().int().nonnegative(),

    /** Total number of issues found */
    issues_found: z.number().int().nonnegative(),

    /** List of tools that were run */
    tools_run: z.array(z.string()),

    /** LLM model used for analysis */
    model_used: z.string(),

    /** Total review latency in milliseconds */
    latency_ms: z.number().int().nonnegative(),

    /** Lines added in the PR */
    lines_added: z.number().int().nonnegative().optional(),

    /** Lines removed in the PR */
    lines_removed: z.number().int().nonnegative().optional(),
});

export type ReviewStats = z.infer<typeof ReviewStatsSchema>;

/**
 * Category-level risk breakdown for summary
 */
export const CategoryBreakdownSchema = z.object({
    category: z.string(),
    count: z.number().int().nonnegative(),
    max_severity: z.string(),
    score_contribution: z.number().nonnegative(),
});

export type CategoryBreakdown = z.infer<typeof CategoryBreakdownSchema>;

/**
 * Complete review output structure
 */
export const ReviewOutputSchema = z.object({
    /** Overall risk score from 0-100 */
    risk_score: z.number().min(0).max(100),

    /** Risk level category derived from score */
    risk_level: RiskLevelSchema,

    /** Issues to be posted as inline PR comments */
    inline_comments: z.array(IssueSchema),

    /** Full markdown summary for PR comment */
    summary_markdown: z.string().max(4000),

    /** Executive summary with max 6 bullet points */
    exec_summary_eli2: z.string().max(1000),

    /** Review execution statistics */
    stats: ReviewStatsSchema,

    /** Risk breakdown by category */
    category_breakdown: z.array(CategoryBreakdownSchema).optional(),

    /** Request ID for tracing */
    request_id: z.string().optional(),

    /** Timestamp of review completion */
    completed_at: z.string().datetime().optional(),

    /** PR reference information */
    pr_info: z
        .object({
            owner: z.string(),
            repo: z.string(),
            number: z.number().int().positive(),
            sha: z.string(),
        })
        .optional(),
});

export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

/**
 * Determine risk level from score
 */
export function getRiskLevel(score: number): RiskLevel {
    if (score >= 85) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 30) return 'medium';
    return 'low';
}

/**
 * Create an empty review output for error cases
 */
export function createEmptyReviewOutput(error?: string): ReviewOutput {
    return {
        risk_score: 0,
        risk_level: 'low',
        inline_comments: [],
        summary_markdown: error ? `Review could not be completed: ${error}` : 'No issues found.',
        exec_summary_eli2: error ? `• Error: ${error}` : '• No issues found in this PR',
        stats: {
            files_changed: 0,
            issues_found: 0,
            tools_run: [],
            model_used: 'none',
            latency_ms: 0,
        },
        completed_at: new Date().toISOString(),
    };
}
