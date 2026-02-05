import { describe, it, expect } from 'vitest';

import type { Issue } from '../schemas/issue.js';
import {
    calculateRiskScore,
    shouldFailCheck,
    getIssueScore,
    sortIssuesByPriority,
    SEVERITY_WEIGHTS,
    CATEGORY_WEIGHTS,
} from '../risk-scorer.js';

const createTestIssue = (
    category: Issue['category'],
    severity: Issue['severity'],
    confidence: number
): Issue => ({
    id: crypto.randomUUID(),
    category,
    severity,
    confidence,
    subtype: 'test',
    file_path: 'test.ts',
    line_start: 1,
    line_end: 1,
    message: 'Test issue',
    evidence: 'test',
});

describe('calculateRiskScore', () => {
    it('should return 0 for empty issues array', () => {
        const result = calculateRiskScore([]);
        expect(result.score).toBe(0);
        expect(result.level).toBe('low');
        expect(result.breakdown).toHaveLength(0);
    });

    it('should calculate score for a single low-severity issue', () => {
        const issues = [createTestIssue('style', 'low', 0.8)];
        const result = calculateRiskScore(issues);

        expect(result.score).toBeGreaterThan(0);
        expect(result.score).toBeLessThan(30);
        expect(result.level).toBe('low');
    });

    it('should calculate higher score for security issues', () => {
        const securityIssue = [createTestIssue('security', 'high', 0.9)];
        const styleIssue = [createTestIssue('style', 'high', 0.9)];

        const securityScore = calculateRiskScore(securityIssue);
        const styleScore = calculateRiskScore(styleIssue);

        expect(securityScore.score).toBeGreaterThan(styleScore.score);
    });

    it('should calculate higher score for critical severity', () => {
        const critical = [createTestIssue('correctness', 'critical', 0.9)];
        const low = [createTestIssue('correctness', 'low', 0.9)];

        const criticalScore = calculateRiskScore(critical);
        const lowScore = calculateRiskScore(low);

        expect(criticalScore.score).toBeGreaterThan(lowScore.score);
    });

    it('should factor in confidence', () => {
        const highConfidence = [createTestIssue('security', 'high', 1.0)];
        const lowConfidence = [createTestIssue('security', 'high', 0.3)];

        const highScore = calculateRiskScore(highConfidence);
        const lowScore = calculateRiskScore(lowConfidence);

        expect(highScore.score).toBeGreaterThan(lowScore.score);
    });

    it('should provide breakdown by category', () => {
        const issues = [
            createTestIssue('security', 'high', 0.9),
            createTestIssue('security', 'medium', 0.8),
            createTestIssue('correctness', 'low', 0.7),
        ];

        const result = calculateRiskScore(issues);

        expect(result.breakdown).toHaveLength(2);

        const securityBreakdown = result.breakdown.find(b => b.category === 'security');
        expect(securityBreakdown).toBeDefined();
        expect(securityBreakdown!.count).toBe(2);
        expect(securityBreakdown!.max_severity).toBe('high');
    });

    it('should cap score at 100', () => {
        // Create many critical security issues
        const issues = Array(50).fill(null).map(() =>
            createTestIssue('security', 'critical', 1.0)
        );

        const result = calculateRiskScore(issues);
        expect(result.score).toBeLessThanOrEqual(100);
    });

    it('should return critical level for high scores', () => {
        const issues = Array(10).fill(null).map(() =>
            createTestIssue('security', 'critical', 1.0)
        );

        const result = calculateRiskScore(issues);
        expect(result.level).toBe('critical');
    });
});

describe('shouldFailCheck', () => {
    it('should not fail for low risk scores', () => {
        const result = calculateRiskScore([createTestIssue('style', 'low', 0.5)]);
        expect(shouldFailCheck(result)).toBe(false);
    });

    it('should fail for scores above threshold', () => {
        const issues = Array(10).fill(null).map(() =>
            createTestIssue('security', 'critical', 1.0)
        );
        const result = calculateRiskScore(issues);
        expect(shouldFailCheck(result, 85)).toBe(true);
    });

    it('should fail for critical security issues even if score is low', () => {
        const issues = [createTestIssue('security', 'critical', 0.3)];
        const result = calculateRiskScore(issues);

        // Score might be below threshold
        expect(shouldFailCheck(result, 85, true)).toBe(true);
    });

    it('should respect custom threshold', () => {
        const issues = [
            createTestIssue('correctness', 'high', 0.9),
            createTestIssue('correctness', 'high', 0.9),
        ];
        const result = calculateRiskScore(issues);

        expect(shouldFailCheck(result, 20)).toBe(true);
        expect(shouldFailCheck(result, 100, false)).toBe(false);
    });
});

describe('getIssueScore', () => {
    it('should calculate correct score for an issue', () => {
        const issue = createTestIssue('security', 'high', 1.0);
        const score = getIssueScore(issue);

        const expected = SEVERITY_WEIGHTS.high * 1.0 * CATEGORY_WEIGHTS.security;
        expect(score).toBe(expected);
    });

    it('should account for confidence', () => {
        const fullConfidence = createTestIssue('security', 'high', 1.0);
        const halfConfidence = createTestIssue('security', 'high', 0.5);

        expect(getIssueScore(fullConfidence)).toBe(getIssueScore(halfConfidence) * 2);
    });
});

describe('sortIssuesByPriority', () => {
    it('should sort issues by score descending', () => {
        const issues = [
            createTestIssue('style', 'low', 0.5),
            createTestIssue('security', 'critical', 1.0),
            createTestIssue('correctness', 'medium', 0.8),
        ];

        const sorted = sortIssuesByPriority(issues);

        expect(sorted[0]!.category).toBe('security');
        expect(sorted[0]!.severity).toBe('critical');
        expect(sorted[sorted.length - 1]!.category).toBe('style');
    });

    it('should not modify original array', () => {
        const issues = [
            createTestIssue('style', 'low', 0.5),
            createTestIssue('security', 'critical', 1.0),
        ];

        const original = [...issues];
        sortIssuesByPriority(issues);

        expect(issues[0]!.category).toBe(original[0]!.category);
    });
});
