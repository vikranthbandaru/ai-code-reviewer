/**
 * Semgrep Integration
 *
 * Runs Semgrep security scanner across all supported languages
 */

import type { Issue } from '@ai-reviewer/core';

import type { WorkerConfig } from '../config.js';
import { isCommandAvailable, runCommand, parseSarifOutput, type ToolRunner, type ToolResult } from './runner.js';

export const semgrepRunner: ToolRunner = {
    name: 'semgrep',

    async isAvailable(): Promise<boolean> {
        return isCommandAvailable('semgrep');
    },

    async run(files: string[], workdir: string, config: WorkerConfig): Promise<ToolResult> {
        const startTime = Date.now();

        if (!await this.isAvailable()) {
            return {
                tool: 'semgrep',
                success: false,
                issues: [],
                error: 'Semgrep not installed',
                duration: Date.now() - startTime,
            };
        }

        try {
            // Build semgrep command
            const args = [
                'scan',
                '--sarif',
                '--config', config.semgrepRules,
                '--timeout', String(config.semgrepTimeout),
                '--max-target-bytes', '1000000',
                '--no-git-ignore',
                ...files,
            ];

            const { stdout, stderr, exitCode } = await runCommand('semgrep', args, {
                cwd: workdir,
                timeout: config.semgrepTimeout * 1000,
            });

            // Parse SARIF output
            const issues = parseSarifOutput(stdout);

            // Enhance issues with semgrep-specific info
            const enhancedIssues = issues.map((issue) => ({
                ...issue,
                source_tool: 'semgrep',
                category: categorizeRule(issue.subtype) as Issue['category'],
            }));

            return {
                tool: 'semgrep',
                success: exitCode === 0 || issues.length > 0,
                issues: enhancedIssues,
                error: exitCode !== 0 && issues.length === 0 ? stderr : undefined,
                duration: Date.now() - startTime,
            };
        } catch (error) {
            return {
                tool: 'semgrep',
                success: false,
                issues: [],
                error: error instanceof Error ? error.message : 'Unknown error',
                duration: Date.now() - startTime,
            };
        }
    },
};

/**
 * Categorize semgrep rules into our categories
 */
function categorizeRule(ruleId: string): string {
    const lowerRule = ruleId.toLowerCase();

    if (lowerRule.includes('security') ||
        lowerRule.includes('injection') ||
        lowerRule.includes('xss') ||
        lowerRule.includes('sqli') ||
        lowerRule.includes('crypto')) {
        return 'security';
    }

    if (lowerRule.includes('correctness') || lowerRule.includes('bug')) {
        return 'correctness';
    }

    if (lowerRule.includes('performance')) {
        return 'performance';
    }

    if (lowerRule.includes('maintainability')) {
        return 'maintainability';
    }

    return 'security'; // Default for security scanner
}
