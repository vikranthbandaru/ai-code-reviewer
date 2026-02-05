// Core package exports

// Schemas and types
export * from './schemas/index.js';

// Diff parsing and chunking
export * from './diff-parser.js';
export * from './chunker.js';

// Risk scoring
export * from './risk-scorer.js';

// Comment formatting
export * from './comment-formatter.js';

// File filtering and categorization
export * from './file-filters.js';

// Utility functions
import type { Issue } from './schemas/issue.js';
import { sortIssuesByPriority } from './risk-scorer.js';

/**
 * Create executive summary from issues
 */
export function createExecutiveSummary(issues: Issue[]): string {
    if (issues.length === 0) {
        return '• No issues found - all changes look good!';
    }

    const bySeverity: Record<string, number> = {};
    for (const issue of issues) {
        bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
    }

    const parts: string[] = [];
    const severityEmoji: Record<string, string> = {
        critical: '🔴',
        high: '🟠',
        medium: '🟡',
        low: '🔵',
    };

    // Summary line
    const counts = Object.entries(bySeverity)
        .map(([sev, count]) => `${count} ${sev}`)
        .join(', ');
    parts.push(`• Found ${issues.length} issue(s): ${counts}`);

    // Top issues (max 5)
    const sorted = sortIssuesByPriority(issues);
    for (const issue of sorted.slice(0, 5)) {
        const emoji = severityEmoji[issue.severity] ?? '⚪';
        const path = issue.file_path.split('/').pop() ?? issue.file_path;
        parts.push(`${emoji} ${path}:${issue.line_start} - ${issue.message.slice(0, 60)}...`);
    }

    return parts.join('\n');
}
