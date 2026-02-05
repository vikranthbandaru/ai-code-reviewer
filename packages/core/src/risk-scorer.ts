/**
 * Risk Scorer - Calculate risk scores based on issue severity and category
 *
 * Scoring formula:
 * - Each issue contributes: severity_weight × confidence × category_weight
 * - Total score is normalized to 0-100 range
 * - Categories have different weights (security highest)
 */

import type { Issue, IssueCategory, IssueSeverity } from './schemas/issue.js';
import type { CategoryBreakdown, RiskLevel } from './schemas/review-output.js';

/**
 * Severity weights for scoring
 */
export const SEVERITY_WEIGHTS: Record<IssueSeverity, number> = {
    low: 1,
    medium: 3,
    high: 7,
    critical: 15,
};

/**
 * Category weights for scoring (multiplier for severity)
 */
export const CATEGORY_WEIGHTS: Record<IssueCategory, number> = {
    security: 4.0,
    correctness: 3.0,
    dependency: 2.5,
    performance: 2.0,
    maintainability: 1.5,
    style: 1.0,
};

/**
 * Risk level thresholds
 */
export const RISK_THRESHOLDS = {
    critical: 85,
    high: 60,
    medium: 30,
    low: 0,
} as const;

export interface RiskScoreResult {
    /** Overall risk score (0-100) */
    score: number;
    /** Risk level category */
    level: RiskLevel;
    /** Breakdown by category */
    breakdown: CategoryBreakdown[];
    /** Raw score before normalization */
    rawScore: number;
    /** Maximum possible score for normalization reference */
    maxPossibleScore: number;
}

export interface ScoreConfig {
    /** Maximum expected issues for normalization */
    maxExpectedIssues: number;
    /** Custom severity weights */
    severityWeights?: Partial<Record<IssueSeverity, number>>;
    /** Custom category weights */
    categoryWeights?: Partial<Record<IssueCategory, number>>;
}

const DEFAULT_SCORE_CONFIG: ScoreConfig = {
    maxExpectedIssues: 20,
};

/**
 * Calculate the risk score for a set of issues
 */
export function calculateRiskScore(issues: Issue[], config: Partial<ScoreConfig> = {}): RiskScoreResult {
    const cfg = { ...DEFAULT_SCORE_CONFIG, ...config };
    const sevWeights = { ...SEVERITY_WEIGHTS, ...cfg.severityWeights };
    const catWeights = { ...CATEGORY_WEIGHTS, ...cfg.categoryWeights };

    // Group issues by category
    const categoryGroups = new Map<IssueCategory, Issue[]>();
    for (const issue of issues) {
        const existing = categoryGroups.get(issue.category) ?? [];
        existing.push(issue);
        categoryGroups.set(issue.category, existing);
    }

    // Calculate score contribution per category
    const breakdown: CategoryBreakdown[] = [];
    let totalRawScore = 0;

    for (const [category, categoryIssues] of categoryGroups) {
        let categoryScore = 0;
        let maxSeverity: IssueSeverity = 'low';

        for (const issue of categoryIssues) {
            const severityWeight = sevWeights[issue.severity] ?? 1;
            const categoryWeight = catWeights[category] ?? 1;
            const issueScore = severityWeight * issue.confidence * categoryWeight;
            categoryScore += issueScore;

            // Track max severity
            if (SEVERITY_WEIGHTS[issue.severity] > SEVERITY_WEIGHTS[maxSeverity]) {
                maxSeverity = issue.severity;
            }
        }

        totalRawScore += categoryScore;

        breakdown.push({
            category,
            count: categoryIssues.length,
            max_severity: maxSeverity,
            score_contribution: Math.round(categoryScore * 10) / 10,
        });
    }

    // Sort breakdown by score contribution (highest first)
    breakdown.sort((a, b) => b.score_contribution - a.score_contribution);

    // Calculate max possible score for normalization
    // Assume max is: maxExpectedIssues × critical severity × security category × confidence 1.0
    const maxPossibleScore =
        cfg.maxExpectedIssues * SEVERITY_WEIGHTS.critical * CATEGORY_WEIGHTS.security;

    // Normalize to 0-100 with a soft cap (tanh-like curve)
    // This prevents extreme scores while still differentiating high-risk PRs
    const normalizedScore = Math.min(100, (totalRawScore / maxPossibleScore) * 100);

    // Apply a slight exponential curve to make differences more visible in mid-range
    const finalScore = Math.round(Math.min(100, normalizedScore * 1.1));

    // Determine risk level
    let level: RiskLevel = 'low';
    if (finalScore >= RISK_THRESHOLDS.critical) {
        level = 'critical';
    } else if (finalScore >= RISK_THRESHOLDS.high) {
        level = 'high';
    } else if (finalScore >= RISK_THRESHOLDS.medium) {
        level = 'medium';
    }

    return {
        score: Math.min(100, finalScore),
        level,
        breakdown,
        rawScore: totalRawScore,
        maxPossibleScore,
    };
}

/**
 * Check if the risk score should fail the check
 */
export function shouldFailCheck(
    result: RiskScoreResult,
    threshold: number = RISK_THRESHOLDS.critical,
    failOnCriticalSecurity: boolean = true
): boolean {
    // Fail if score exceeds threshold
    if (result.score >= threshold) {
        return true;
    }

    // Fail if there are critical security issues
    if (failOnCriticalSecurity) {
        const securityBreakdown = result.breakdown.find((b) => b.category === 'security');
        if (securityBreakdown?.max_severity === 'critical') {
            return true;
        }
    }

    return false;
}

/**
 * Get a human-readable explanation of the risk score
 */
export function explainRiskScore(result: RiskScoreResult): string {
    const lines: string[] = [];

    lines.push(`**Risk Score: ${result.score}/100** (${result.level.toUpperCase()})`);
    lines.push('');

    if (result.breakdown.length === 0) {
        lines.push('No issues detected.');
    } else {
        lines.push('**Breakdown by Category:**');
        for (const cat of result.breakdown) {
            const severity = cat.max_severity === 'critical' || cat.max_severity === 'high'
                ? ` ⚠️`
                : '';
            lines.push(
                `- ${cat.category}: ${cat.count} issue(s), max severity: ${cat.max_severity}${severity}`
            );
        }
    }

    return lines.join('\n');
}

/**
 * Calculate individual issue score for prioritization
 */
export function getIssueScore(issue: Issue): number {
    const severityWeight = SEVERITY_WEIGHTS[issue.severity];
    const categoryWeight = CATEGORY_WEIGHTS[issue.category];
    return severityWeight * issue.confidence * categoryWeight;
}

/**
 * Sort issues by priority (highest score first)
 */
export function sortIssuesByPriority(issues: Issue[]): Issue[] {
    return [...issues].sort((a, b) => getIssueScore(b) - getIssueScore(a));
}
