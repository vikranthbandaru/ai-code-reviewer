import { z } from 'zod';

/**
 * Issue category - determines severity weight in risk scoring
 */
export const IssueCategorySchema = z.enum([
    'security',
    'correctness',
    'performance',
    'maintainability',
    'style',
    'dependency',
]);
export type IssueCategory = z.infer<typeof IssueCategorySchema>;

/**
 * Issue severity levels
 */
export const IssueSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type IssueSeverity = z.infer<typeof IssueSeveritySchema>;

/**
 * Individual issue identified in code review
 */
export const IssueSchema = z.object({
    /** Unique identifier for this issue */
    id: z.string().uuid(),

    /** Issue category for classification */
    category: IssueCategorySchema,

    /** Specific subtype within category (e.g., 'sql-injection', 'null-dereference') */
    subtype: z.string().min(1).max(50),

    /** Issue severity */
    severity: IssueSeveritySchema,

    /** Confidence score from 0 to 1 */
    confidence: z.number().min(0).max(1),

    /** File path relative to repository root */
    file_path: z.string().min(1),

    /** Starting line number (1-indexed) */
    line_start: z.number().int().positive(),

    /** Ending line number (1-indexed, inclusive) */
    line_end: z.number().int().positive(),

    /** Human-readable issue description (max 900 chars for inline comments) */
    message: z.string().min(1).max(900),

    /** Short code evidence or snippet */
    evidence: z.string().max(500),

    /** Suggested fix description */
    suggested_fix: z.string().max(500).optional(),

    /** Unified diff patch for fix */
    patch: z.string().max(2000).optional(),

    /** OWASP classification tag */
    owasp_tag: z.string().max(20).optional(),

    /** CWE identifier */
    cwe: z.string().regex(/^CWE-\d+$/).optional(),

    /** Source tool that identified this issue */
    source_tool: z.string().optional(),

    /** Whether this issue was identified by LLM vs static tool */
    is_llm_generated: z.boolean().default(false),
});

export type Issue = z.infer<typeof IssueSchema>;

/**
 * Create a new Issue with generated UUID
 */
export function createIssue(data: Omit<Issue, 'id'>): Issue {
    return IssueSchema.parse({
        ...data,
        id: crypto.randomUUID(),
    });
}

/**
 * Validate line range
 */
export function validateLineRange(start: number, end: number): boolean {
    return start > 0 && end >= start;
}
