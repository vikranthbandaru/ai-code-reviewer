/**
 * Python Tools Integration
 *
 * Ruff (linter) and Bandit (security scanner)
 */

import type { Issue } from '@ai-reviewer/core';
import fs from 'node:fs';
import path from 'node:path';

import type { WorkerConfig } from '../config.js';
import { isCommandAvailable, runCommand, type ToolRunner, type ToolResult } from './runner.js';

interface RuffOutput {
    code: string;
    message: string;
    location: {
        file: string;
        row: number;
        column: number;
    };
    end_location: {
        row: number;
        column: number;
    };
    fix?: {
        message?: string;
        edits?: Array<{ content: string }>;
    };
}

interface BanditOutput {
    results: Array<{
        test_id: string;
        test_name: string;
        issue_severity: string;
        issue_confidence: string;
        filename: string;
        line_number: number;
        line_range: number[];
        issue_text: string;
        issue_cwe?: { id: number };
    }>;
}

export const ruffRunner: ToolRunner = {
    name: 'ruff',

    async isAvailable(): Promise<boolean> {
        return isCommandAvailable('ruff');
    },

    async run(files: string[], workdir: string, _config: WorkerConfig): Promise<ToolResult> {
        const startTime = Date.now();

        // Check for Ruff config
        if (!hasRuffConfig(workdir)) {
            return {
                tool: 'ruff',
                success: true,
                issues: [],
                duration: Date.now() - startTime,
            };
        }

        // Filter to Python files
        const pyFiles = files.filter((f) => f.endsWith('.py'));
        if (pyFiles.length === 0) {
            return {
                tool: 'ruff',
                success: true,
                issues: [],
                duration: Date.now() - startTime,
            };
        }

        try {
            const { stdout } = await runCommand(
                'ruff',
                ['check', '--output-format', 'json', ...pyFiles],
                { cwd: workdir }
            );

            let results: RuffOutput[] = [];
            try {
                results = JSON.parse(stdout) as RuffOutput[];
            } catch {
                // Empty output
            }

            const issues = results.map((r): Issue => ({
                id: crypto.randomUUID(),
                category: categorizeRuffRule(r.code),
                subtype: r.code,
                severity: 'low',
                confidence: 0.9,
                file_path: path.relative(workdir, r.location.file),
                line_start: r.location.row,
                line_end: r.end_location.row,
                message: r.message,
                evidence: '',
                suggested_fix: r.fix?.message,
                source_tool: 'ruff',
                is_llm_generated: false,
            }));

            return {
                tool: 'ruff',
                success: true,
                issues,
                duration: Date.now() - startTime,
            };
        } catch (error) {
            return {
                tool: 'ruff',
                success: false,
                issues: [],
                error: error instanceof Error ? error.message : 'Unknown error',
                duration: Date.now() - startTime,
            };
        }
    },
};

export const banditRunner: ToolRunner = {
    name: 'bandit',

    async isAvailable(): Promise<boolean> {
        return isCommandAvailable('bandit');
    },

    async run(files: string[], workdir: string, _config: WorkerConfig): Promise<ToolResult> {
        const startTime = Date.now();

        const pyFiles = files.filter((f) => f.endsWith('.py'));
        if (pyFiles.length === 0) {
            return {
                tool: 'bandit',
                success: true,
                issues: [],
                duration: Date.now() - startTime,
            };
        }

        try {
            const { stdout } = await runCommand(
                'bandit',
                ['-f', 'json', '-r', ...pyFiles],
                { cwd: workdir }
            );

            let output: BanditOutput = { results: [] };
            try {
                output = JSON.parse(stdout) as BanditOutput;
            } catch {
                // Empty output
            }

            const issues = output.results.map((r): Issue => ({
                id: crypto.randomUUID(),
                category: 'security',
                subtype: r.test_name,
                severity: mapBanditSeverity(r.issue_severity),
                confidence: mapBanditConfidence(r.issue_confidence),
                file_path: path.relative(workdir, r.filename),
                line_start: r.line_number,
                line_end: r.line_range.length > 0 ? Math.max(...r.line_range) : r.line_number,
                message: r.issue_text,
                evidence: '',
                cwe: r.issue_cwe ? `CWE-${r.issue_cwe.id}` : undefined,
                source_tool: 'bandit',
                is_llm_generated: false,
            }));

            return {
                tool: 'bandit',
                success: true,
                issues,
                duration: Date.now() - startTime,
            };
        } catch (error) {
            return {
                tool: 'bandit',
                success: false,
                issues: [],
                error: error instanceof Error ? error.message : 'Unknown error',
                duration: Date.now() - startTime,
            };
        }
    },
};

function hasRuffConfig(workdir: string): boolean {
    const configFiles = ['ruff.toml', '.ruff.toml', 'pyproject.toml'];
    return configFiles.some((f) => fs.existsSync(path.join(workdir, f)));
}

function categorizeRuffRule(code: string): Issue['category'] {
    const prefix = code.slice(0, 1);
    switch (prefix) {
        case 'S': return 'security';
        case 'E': case 'W': return 'correctness';
        case 'C': return 'maintainability';
        default: return 'style';
    }
}

function mapBanditSeverity(severity: string): Issue['severity'] {
    switch (severity.toUpperCase()) {
        case 'HIGH': return 'high';
        case 'MEDIUM': return 'medium';
        default: return 'low';
    }
}

function mapBanditConfidence(confidence: string): number {
    switch (confidence.toUpperCase()) {
        case 'HIGH': return 0.9;
        case 'MEDIUM': return 0.7;
        default: return 0.5;
    }
}
