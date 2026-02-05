import { describe, it, expect } from 'vitest';

import {
    IssueSchema,
    IssueCategorySchema,
    IssueSeveritySchema,
    createIssue,
    validateLineRange,
} from '../schemas/issue.js';
import {
    ReviewOutputSchema,
    RiskLevelSchema,
    getRiskLevel,
    createEmptyReviewOutput,
} from '../schemas/review-output.js';

describe('IssueSchema', () => {
    const validIssue = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        category: 'security',
        subtype: 'sql-injection',
        severity: 'critical',
        confidence: 0.95,
        file_path: 'src/db.ts',
        line_start: 42,
        line_end: 45,
        message: 'Potential SQL injection vulnerability detected.',
        evidence: "const query = `SELECT * FROM users WHERE id = ${userId}`;",
        suggested_fix: 'Use parameterized queries instead.',
        cwe: 'CWE-89',
        owasp_tag: 'A03:2021',
    };

    it('should validate a correct issue', () => {
        const result = IssueSchema.safeParse(validIssue);
        expect(result.success).toBe(true);
    });

    it('should reject invalid category', () => {
        const invalid = { ...validIssue, category: 'invalid' };
        const result = IssueSchema.safeParse(invalid);
        expect(result.success).toBe(false);
    });

    it('should reject invalid severity', () => {
        const invalid = { ...validIssue, severity: 'extreme' };
        const result = IssueSchema.safeParse(invalid);
        expect(result.success).toBe(false);
    });

    it('should reject confidence outside 0-1 range', () => {
        const tooHigh = { ...validIssue, confidence: 1.5 };
        const tooLow = { ...validIssue, confidence: -0.1 };

        expect(IssueSchema.safeParse(tooHigh).success).toBe(false);
        expect(IssueSchema.safeParse(tooLow).success).toBe(false);
    });

    it('should reject non-positive line numbers', () => {
        const invalidStart = { ...validIssue, line_start: 0 };
        const invalidEnd = { ...validIssue, line_end: -1 };

        expect(IssueSchema.safeParse(invalidStart).success).toBe(false);
        expect(IssueSchema.safeParse(invalidEnd).success).toBe(false);
    });

    it('should reject message over 900 characters', () => {
        const longMessage = { ...validIssue, message: 'x'.repeat(901) };
        const result = IssueSchema.safeParse(longMessage);
        expect(result.success).toBe(false);
    });

    it('should reject invalid CWE format', () => {
        const invalidCwe = { ...validIssue, cwe: 'CWE89' };
        const result = IssueSchema.safeParse(invalidCwe);
        expect(result.success).toBe(false);
    });

    it('should allow optional fields to be undefined', () => {
        const minimalIssue = {
            id: '550e8400-e29b-41d4-a716-446655440000',
            category: 'correctness',
            subtype: 'null-check',
            severity: 'medium',
            confidence: 0.8,
            file_path: 'src/util.ts',
            line_start: 10,
            line_end: 10,
            message: 'Missing null check.',
            evidence: 'user.name.length',
        };

        const result = IssueSchema.safeParse(minimalIssue);
        expect(result.success).toBe(true);
    });
});

describe('IssueCategorySchema', () => {
    it('should accept valid categories', () => {
        const categories = ['security', 'correctness', 'performance', 'maintainability', 'style', 'dependency'];
        for (const cat of categories) {
            expect(IssueCategorySchema.safeParse(cat).success).toBe(true);
        }
    });
});

describe('IssueSeveritySchema', () => {
    it('should accept valid severities', () => {
        const severities = ['low', 'medium', 'high', 'critical'];
        for (const sev of severities) {
            expect(IssueSeveritySchema.safeParse(sev).success).toBe(true);
        }
    });
});

describe('createIssue', () => {
    it('should create an issue with generated UUID', () => {
        const issue = createIssue({
            category: 'performance',
            subtype: 'n-plus-one',
            severity: 'medium',
            confidence: 0.7,
            file_path: 'src/repos.ts',
            line_start: 100,
            line_end: 105,
            message: 'Potential N+1 query detected.',
            evidence: 'for (const user of users) { await db.query(...) }',
        });

        expect(issue.id).toBeDefined();
        expect(issue.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
});

describe('validateLineRange', () => {
    it('should return true for valid ranges', () => {
        expect(validateLineRange(1, 1)).toBe(true);
        expect(validateLineRange(1, 10)).toBe(true);
        expect(validateLineRange(100, 200)).toBe(true);
    });

    it('should return false for invalid ranges', () => {
        expect(validateLineRange(0, 10)).toBe(false);
        expect(validateLineRange(10, 5)).toBe(false);
        expect(validateLineRange(-1, 10)).toBe(false);
    });
});

describe('ReviewOutputSchema', () => {
    const validReview = {
        risk_score: 45,
        risk_level: 'medium',
        inline_comments: [],
        summary_markdown: '## Review Summary\n\nNo critical issues found.',
        exec_summary_eli2: '• 3 minor issues\n• 1 suggestion',
        stats: {
            files_changed: 5,
            issues_found: 4,
            tools_run: ['eslint', 'semgrep'],
            model_used: 'gpt-4-turbo',
            latency_ms: 2500,
        },
    };

    it('should validate a correct review output', () => {
        const result = ReviewOutputSchema.safeParse(validReview);
        expect(result.success).toBe(true);
    });

    it('should reject risk_score outside 0-100', () => {
        const tooHigh = { ...validReview, risk_score: 101 };
        const tooLow = { ...validReview, risk_score: -1 };

        expect(ReviewOutputSchema.safeParse(tooHigh).success).toBe(false);
        expect(ReviewOutputSchema.safeParse(tooLow).success).toBe(false);
    });

    it('should reject summary over 4000 chars', () => {
        const longSummary = { ...validReview, summary_markdown: 'x'.repeat(4001) };
        const result = ReviewOutputSchema.safeParse(longSummary);
        expect(result.success).toBe(false);
    });
});

describe('RiskLevelSchema', () => {
    it('should accept valid risk levels', () => {
        const levels = ['low', 'medium', 'high', 'critical'];
        for (const level of levels) {
            expect(RiskLevelSchema.safeParse(level).success).toBe(true);
        }
    });
});

describe('getRiskLevel', () => {
    it('should return correct risk levels for score ranges', () => {
        expect(getRiskLevel(0)).toBe('low');
        expect(getRiskLevel(29)).toBe('low');
        expect(getRiskLevel(30)).toBe('medium');
        expect(getRiskLevel(59)).toBe('medium');
        expect(getRiskLevel(60)).toBe('high');
        expect(getRiskLevel(84)).toBe('high');
        expect(getRiskLevel(85)).toBe('critical');
        expect(getRiskLevel(100)).toBe('critical');
    });
});

describe('createEmptyReviewOutput', () => {
    it('should create a valid empty review output', () => {
        const empty = createEmptyReviewOutput();
        const result = ReviewOutputSchema.safeParse(empty);
        expect(result.success).toBe(true);
        expect(empty.risk_score).toBe(0);
        expect(empty.inline_comments).toHaveLength(0);
    });

    it('should include error message when provided', () => {
        const withError = createEmptyReviewOutput('Connection timeout');
        expect(withError.summary_markdown).toContain('Connection timeout');
    });
});
