/**
 * ESLint Integration
 *
 * Runs ESLint for JavaScript/TypeScript files
 */

import type { Issue } from '@ai-reviewer/core';
import fs from 'node:fs';
import path from 'node:path';

import type { WorkerConfig } from '../config.js';
import { isCommandAvailable, runCommand, type ToolRunner, type ToolResult } from './runner.js';

interface ESLintResult {
    filePath: string;
    messages: Array<{
        ruleId: string | null;
        severity: 1 | 2;
        message: string;
        line: number;
        endLine?: number;
        column: number;
        endColumn?: number;
    }>;
}

export const eslintRunner: ToolRunner = {
    name: 'eslint',

    async isAvailable(): Promise<boolean> {
        return isCommandAvailable('npx');
    },

    async run(files: string[], workdir: string, _config: WorkerConfig): Promise<ToolResult> {
        const startTime = Date.now();

        // Check for ESLint config
        const hasConfig = await hasEslintConfig(workdir);
        if (!hasConfig) {
            return {
                tool: 'eslint',
                success: true,
                issues: [],
                duration: Date.now() - startTime,
            };
        }

        // Filter to JS/TS files only
        const jsFiles = files.filter((f) =>
            /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(f)
        );

        if (jsFiles.length === 0) {
            return {
                tool: 'eslint',
                success: true,
                issues: [],
                duration: Date.now() - startTime,
            };
        }

        try {
            const { stdout, exitCode } = await runCommand(
                'npx',
                ['eslint', '--format', 'json', '--no-error-on-unmatched-pattern', ...jsFiles],
                { cwd: workdir }
            );

            // Parse JSON output
            let results: ESLintResult[] = [];
            try {
                results = JSON.parse(stdout) as ESLintResult[];
            } catch {
                // Empty or invalid output
            }

            const issues = results.flatMap((result) =>
                result.messages
                    .filter((msg) => msg.ruleId !== null)
                    .map((msg): Issue => ({
                        id: crypto.randomUUID(),
                        category: categorizeEslintRule(msg.ruleId ?? ''),
                        subtype: msg.ruleId ?? 'unknown',
                        severity: msg.severity === 2 ? 'medium' : 'low',
                        confidence: 0.9,
                        file_path: path.relative(workdir, result.filePath),
                        line_start: msg.line,
                        line_end: msg.endLine ?? msg.line,
                        message: msg.message,
                        evidence: '',
                        source_tool: 'eslint',
                        is_llm_generated: false,
                    }))
            );

            return {
                tool: 'eslint',
                success: true,
                issues,
                duration: Date.now() - startTime,
            };
        } catch (error) {
            return {
                tool: 'eslint',
                success: false,
                issues: [],
                error: error instanceof Error ? error.message : 'Unknown error',
                duration: Date.now() - startTime,
            };
        }
    },
};

/**
 * Check if ESLint config exists
 */
async function hasEslintConfig(workdir: string): Promise<boolean> {
    const configFiles = [
        '.eslintrc',
        '.eslintrc.js',
        '.eslintrc.cjs',
        '.eslintrc.json',
        '.eslintrc.yaml',
        '.eslintrc.yml',
        'eslint.config.js',
        'eslint.config.mjs',
    ];

    for (const file of configFiles) {
        if (fs.existsSync(path.join(workdir, file))) {
            return true;
        }
    }

    // Check package.json for eslintConfig
    try {
        const pkgPath = path.join(workdir, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { eslintConfig?: unknown };
            return pkg.eslintConfig !== undefined;
        }
    } catch {
        // Ignore
    }

    return false;
}

/**
 * Categorize ESLint rules
 */
function categorizeEslintRule(ruleId: string): Issue['category'] {
    const lowerRule = ruleId.toLowerCase();

    if (lowerRule.includes('security') || lowerRule.includes('no-eval')) {
        return 'security';
    }

    if (lowerRule.includes('no-unused') ||
        lowerRule.includes('no-undef') ||
        lowerRule.includes('prefer-const')) {
        return 'correctness';
    }

    if (lowerRule.includes('complexity') || lowerRule.includes('max-')) {
        return 'maintainability';
    }

    return 'style';
}
