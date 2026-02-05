/**
 * Comment Formatter - Format review comments with character limits
 *
 * Features:
 * - Enforce character limits (900 inline, 4000 summary)
 * - Smart truncation with indicators
 * - Markdown formatting
 * - Severity badges
 */

import type { Issue } from './schemas/issue.js';
import type { CategoryBreakdown, ReviewOutput, RiskLevel } from './schemas/review-output.js';

export interface CommentFormatConfig {
    /** Max characters for inline comments */
    maxInlineChars: number;
    /** Max characters for summary comment */
    maxSummaryChars: number;
    /** Include code evidence in inline comments */
    includeEvidence: boolean;
    /** Include suggested fixes */
    includeFixes: boolean;
}

export const DEFAULT_COMMENT_CONFIG: CommentFormatConfig = {
    maxInlineChars: 900,
    maxSummaryChars: 4000,
    includeEvidence: true,
    includeFixes: true,
};

/**
 * Severity emoji badges
 */
const SEVERITY_BADGES: Record<string, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢',
};

/**
 * Category emoji badges
 */
const CATEGORY_BADGES: Record<string, string> = {
    security: '🔒',
    correctness: '🐛',
    performance: '⚡',
    maintainability: '🔧',
    style: '✨',
    dependency: '📦',
};

/**
 * Risk level emoji badges
 */
const RISK_BADGES: Record<RiskLevel, string> = {
    critical: '🚨',
    high: '⚠️',
    medium: '📋',
    low: '✅',
};

/**
 * Truncate text to max length with indicator
 */
export function truncateText(text: string, maxLength: number, indicator = '...'): string {
    if (text.length <= maxLength) {
        return text;
    }
    return text.slice(0, maxLength - indicator.length) + indicator;
}

/**
 * Format a single inline comment
 */
export function formatInlineComment(issue: Issue, config: Partial<CommentFormatConfig> = {}): string {
    const cfg = { ...DEFAULT_COMMENT_CONFIG, ...config };
    const parts: string[] = [];

    // Header with badges
    const severityBadge = SEVERITY_BADGES[issue.severity] ?? '';
    const categoryBadge = CATEGORY_BADGES[issue.category] ?? '';
    parts.push(`${severityBadge} **${issue.severity.toUpperCase()}** ${categoryBadge} ${issue.category}/${issue.subtype}`);
    parts.push('');

    // Main message
    parts.push(issue.message);

    // Evidence (if enabled and available)
    if (cfg.includeEvidence && issue.evidence.length > 0) {
        parts.push('');
        parts.push('**Evidence:**');
        parts.push('```');
        parts.push(truncateText(issue.evidence, 200));
        parts.push('```');
    }

    // Suggested fix (if enabled and available)
    if (cfg.includeFixes && issue.suggested_fix !== undefined && issue.suggested_fix.length > 0) {
        parts.push('');
        parts.push(`💡 **Suggested fix:** ${issue.suggested_fix}`);
    }

    // CWE/OWASP tags
    const tags: string[] = [];
    if (issue.cwe !== undefined) tags.push(issue.cwe);
    if (issue.owasp_tag !== undefined) tags.push(`OWASP: ${issue.owasp_tag}`);
    if (tags.length > 0) {
        parts.push('');
        parts.push(`🏷️ ${tags.join(' | ')}`);
    }

    const fullComment = parts.join('\n');
    return truncateText(fullComment, cfg.maxInlineChars);
}

/**
 * Format the summary markdown comment
 */
export function formatSummaryComment(
    review: ReviewOutput,
    config: Partial<CommentFormatConfig> = {}
): string {
    const cfg = { ...DEFAULT_COMMENT_CONFIG, ...config };
    const parts: string[] = [];

    // Header
    const riskBadge = RISK_BADGES[review.risk_level];
    parts.push(`# ${riskBadge} AI Code Review Summary`);
    parts.push('');

    // Risk score
    parts.push(`## Risk Assessment: ${review.risk_score}/100 (${review.risk_level.toUpperCase()})`);
    parts.push('');

    // Executive summary
    parts.push('## Executive Summary');
    parts.push(review.exec_summary_eli2);
    parts.push('');

    // Category breakdown (if available)
    if (review.category_breakdown !== undefined && review.category_breakdown.length > 0) {
        parts.push('## Issues by Category');
        parts.push('');
        parts.push('| Category | Count | Max Severity | Score |');
        parts.push('|----------|-------|--------------|-------|');
        for (const cat of review.category_breakdown) {
            const badge = CATEGORY_BADGES[cat.category] ?? '';
            parts.push(`| ${badge} ${cat.category} | ${cat.count} | ${cat.max_severity} | ${cat.score_contribution} |`);
        }
        parts.push('');
    }

    // Top issues summary
    if (review.inline_comments.length > 0) {
        parts.push('## Top Issues');
        parts.push('');
        const topIssues = review.inline_comments.slice(0, 5);
        for (const issue of topIssues) {
            const severityBadge = SEVERITY_BADGES[issue.severity] ?? '';
            parts.push(`- ${severityBadge} **${issue.file_path}:${issue.line_start}** - ${truncateText(issue.message, 100)}`);
        }
        parts.push('');
    }

    // Stats
    parts.push('## Review Statistics');
    parts.push('');
    parts.push(`- **Files reviewed:** ${review.stats.files_changed}`);
    parts.push(`- **Issues found:** ${review.stats.issues_found}`);
    parts.push(`- **Tools used:** ${review.stats.tools_run.join(', ') || 'none'}`);
    parts.push(`- **Model:** ${review.stats.model_used}`);
    parts.push(`- **Review time:** ${(review.stats.latency_ms / 1000).toFixed(1)}s`);
    parts.push('');

    // Footer
    parts.push('---');
    parts.push('*Generated by AI Code Reviewer* 🤖');

    const fullSummary = parts.join('\n');
    return truncateText(fullSummary, cfg.maxSummaryChars);
}

/**
 * Format a short summary for PR status
 */
export function formatStatusSummary(review: ReviewOutput): string {
    const riskBadge = RISK_BADGES[review.risk_level];
    return `${riskBadge} Risk: ${review.risk_score}/100 | ${review.stats.issues_found} issues | ${review.stats.files_changed} files`;
}

/**
 * Create executive summary bullets from issues
 */
export function createExecutiveSummary(
    issues: Issue[],
    maxBullets: number = 6
): string {
    if (issues.length === 0) {
        return '• No significant issues found in this PR.';
    }

    const bullets: string[] = [];

    // Group by severity
    const severityCounts = new Map<string, number>();
    for (const issue of issues) {
        severityCounts.set(issue.severity, (severityCounts.get(issue.severity) ?? 0) + 1);
    }

    // Add severity summary as first bullet
    const severityParts: string[] = [];
    for (const [severity, count] of severityCounts) {
        if (count > 0) {
            severityParts.push(`${count} ${severity}`);
        }
    }
    bullets.push(`• Found ${issues.length} issue(s): ${severityParts.join(', ')}`);

    // Add top issues as bullets
    const topIssues = issues.slice(0, maxBullets - 1);
    for (const issue of topIssues) {
        const badge = SEVERITY_BADGES[issue.severity] ?? '';
        bullets.push(`${badge} ${truncateText(issue.message, 120)}`);
    }

    // Add "and more" if needed
    if (issues.length > maxBullets) {
        bullets.push(`• ...and ${issues.length - maxBullets + 1} more issue(s)`);
    }

    return bullets.slice(0, maxBullets).join('\n');
}

/**
 * Format a category breakdown for display
 */
export function formatCategoryBreakdown(breakdown: CategoryBreakdown[]): string {
    if (breakdown.length === 0) {
        return 'No issues by category.';
    }

    return breakdown
        .map((cat) => {
            const badge = CATEGORY_BADGES[cat.category] ?? '';
            return `${badge} **${cat.category}**: ${cat.count} (${cat.max_severity})`;
        })
        .join(' | ');
}
