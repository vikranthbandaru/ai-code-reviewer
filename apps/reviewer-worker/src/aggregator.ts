/**
 * Issue Aggregator
 *
 * Combines issues from all sources, deduplicates, and prioritizes
 */

import {
    type Issue,
    sortIssuesByPriority,
    calculateRiskScore,
    type RiskScoreResult,
} from '@ai-reviewer/core';

import type { WorkerConfig } from './config.js';

export interface AggregationResult {
    /** Issues selected for inline comments (capped) */
    inlineComments: Issue[];
    /** All issues found before capping */
    allIssues: Issue[];
    /** Risk score calculation result */
    riskScore: RiskScoreResult;
    /** Statistics */
    stats: {
        totalFound: number;
        afterDedup: number;
        afterFiltering: number;
        selected: number;
    };
}

/**
 * Aggregate issues from multiple sources
 */
export function aggregateIssues(
    issues: Issue[],
    config: WorkerConfig
): AggregationResult {
    const totalFound = issues.length;

    // Step 1: Deduplicate issues
    const deduplicated = deduplicateIssues(issues);
    const afterDedup = deduplicated.length;

    // Step 2: Filter by confidence threshold
    const filtered = deduplicated.filter(
        (issue) => issue.confidence >= config.confidenceThreshold
    );
    const afterFiltering = filtered.length;

    // Step 3: Sort by priority
    const sorted = sortIssuesByPriority(filtered);

    // Step 4: Cap to max inline comments
    const selected = sorted.slice(0, config.maxInlineComments);

    // Step 5: Calculate risk score on ALL filtered issues (not just selected)
    const riskScore = calculateRiskScore(filtered);

    return {
        inlineComments: selected,
        allIssues: filtered,
        riskScore,
        stats: {
            totalFound,
            afterDedup,
            afterFiltering,
            selected: selected.length,
        },
    };
}

/**
 * Deduplicate issues based on file, line, and similar message
 */
function deduplicateIssues(issues: Issue[]): Issue[] {
    const seen = new Map<string, Issue>();

    for (const issue of issues) {
        const key = createDedupeKey(issue);
        const existing = seen.get(key);

        if (existing === undefined) {
            seen.set(key, issue);
        } else {
            // Keep the one with higher confidence or severity
            if (shouldReplace(existing, issue)) {
                seen.set(key, issue);
            }
        }
    }

    return Array.from(seen.values());
}

/**
 * Create a deduplication key for an issue
 */
function createDedupeKey(issue: Issue): string {
    // Group by file, line range, and category
    return `${issue.file_path}:${issue.line_start}-${issue.line_end}:${issue.category}:${issue.subtype.slice(0, 20)}`;
}

/**
 * Check if new issue should replace existing one
 */
function shouldReplace(existing: Issue, newIssue: Issue): boolean {
    // Prefer higher severity
    const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    const existingSev = severityOrder[existing.severity];
    const newSev = severityOrder[newIssue.severity];

    if (newSev > existingSev) return true;
    if (newSev < existingSev) return false;

    // Same severity, prefer higher confidence
    return newIssue.confidence > existing.confidence;
}

/**
 * Merge issues from multiple tool runs
 */
export function mergeToolResults(
    ...issueArrays: Issue[][]
): Issue[] {
    return issueArrays.flat();
}
