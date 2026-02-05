/**
 * Go Tools Integration
 *
 * govet, staticcheck, and gosec
 */

import type { Issue } from '@ai-reviewer/core';
import path from 'node:path';

import type { WorkerConfig } from '../config.js';
import { isCommandAvailable, runCommand, type ToolRunner, type ToolResult } from './runner.js';

interface GosecOutput {
    Issues: Array<{
        severity: string;
        confidence: string;
        cwe: { id: string };
        rule_id: string;
        details: string;
        file: string;
        line: string;
        column: string;
    }>;
}

interface StaticcheckOutput {
    code: string;
    message: string;
    location: {
        file: string;
        line: number;
        column: number;
    };
    severity: string;
}

export const gosecRunner: ToolRunner = {
    name: 'gosec',

    async isAvailable(): Promise<boolean> {
        return isCommandAvailable('gosec');
    },

    async run(_files: string[], workdir: string, _config: WorkerConfig): Promise<ToolResult> {
        const startTime = Date.now();

        try {
            const { stdout } = await runCommand(
                'gosec',
                ['-fmt=json', '-quiet', './...'],
                { cwd: workdir }
            );

            let output: GosecOutput = { Issues: [] };
            try {
                output = JSON.parse(stdout) as GosecOutput;
            } catch {
                // Empty output
            }

            const issues = output.Issues.map((r): Issue => ({
                id: crypto.randomUUID(),
                category: 'security',
                subtype: r.rule_id,
                severity: mapGosecSeverity(r.severity),
                confidence: mapGosecConfidence(r.confidence),
                file_path: path.relative(workdir, r.file),
                line_start: parseInt(r.line, 10),
                line_end: parseInt(r.line, 10),
                message: r.details,
                evidence: '',
                cwe: `CWE-${r.cwe.id}`,
                source_tool: 'gosec',
                is_llm_generated: false,
            }));

            return {
                tool: 'gosec',
                success: true,
                issues,
                duration: Date.now() - startTime,
            };
        } catch (error) {
            return {
                tool: 'gosec',
                success: false,
                issues: [],
                error: error instanceof Error ? error.message : 'Unknown error',
                duration: Date.now() - startTime,
            };
        }
    },
};

export const staticcheckRunner: ToolRunner = {
    name: 'staticcheck',

    async isAvailable(): Promise<boolean> {
        return isCommandAvailable('staticcheck');
    },

    async run(_files: string[], workdir: string, _config: WorkerConfig): Promise<ToolResult> {
        const startTime = Date.now();

        try {
            const { stdout } = await runCommand(
                'staticcheck',
                ['-f', 'json', './...'],
                { cwd: workdir }
            );

            // Staticcheck outputs one JSON per line
            const issues: Issue[] = [];
            for (const line of stdout.split('\n').filter(Boolean)) {
                try {
                    const r = JSON.parse(line) as StaticcheckOutput;
                    issues.push({
                        id: crypto.randomUUID(),
                        category: categorizeStaticcheck(r.code),
                        subtype: r.code,
                        severity: mapStaticcheckSeverity(r.severity),
                        confidence: 0.9,
                        file_path: path.relative(workdir, r.location.file),
                        line_start: r.location.line,
                        line_end: r.location.line,
                        message: r.message,
                        evidence: '',
                        source_tool: 'staticcheck',
                        is_llm_generated: false,
                    });
                } catch {
                    // Skip invalid lines
                }
            }

            return {
                tool: 'staticcheck',
                success: true,
                issues,
                duration: Date.now() - startTime,
            };
        } catch (error) {
            return {
                tool: 'staticcheck',
                success: false,
                issues: [],
                error: error instanceof Error ? error.message : 'Unknown error',
                duration: Date.now() - startTime,
            };
        }
    },
};

export const govetRunner: ToolRunner = {
    name: 'go-vet',

    async isAvailable(): Promise<boolean> {
        return isCommandAvailable('go');
    },

    async run(_files: string[], workdir: string, _config: WorkerConfig): Promise<ToolResult> {
        const startTime = Date.now();

        try {
            const { stderr } = await runCommand(
                'go',
                ['vet', '-json', './...'],
                { cwd: workdir }
            );

            // Parse go vet JSON output
            const issues: Issue[] = [];
            for (const line of stderr.split('\n').filter(Boolean)) {
                try {
                    const r = JSON.parse(line) as {
                        posn?: string;
                        message?: string;
                    };
                    if (r.posn !== undefined && r.message !== undefined) {
                        const [file, lineStr] = r.posn.split(':');
                        issues.push({
                            id: crypto.randomUUID(),
                            category: 'correctness',
                            subtype: 'go-vet',
                            severity: 'medium',
                            confidence: 0.9,
                            file_path: file ?? '',
                            line_start: parseInt(lineStr ?? '1', 10),
                            line_end: parseInt(lineStr ?? '1', 10),
                            message: r.message,
                            evidence: '',
                            source_tool: 'go-vet',
                            is_llm_generated: false,
                        });
                    }
                } catch {
                    // Skip invalid lines
                }
            }

            return {
                tool: 'go-vet',
                success: true,
                issues,
                duration: Date.now() - startTime,
            };
        } catch (error) {
            return {
                tool: 'go-vet',
                success: false,
                issues: [],
                error: error instanceof Error ? error.message : 'Unknown error',
                duration: Date.now() - startTime,
            };
        }
    },
};

function mapGosecSeverity(severity: string): Issue['severity'] {
    switch (severity.toUpperCase()) {
        case 'HIGH': return 'high';
        case 'MEDIUM': return 'medium';
        default: return 'low';
    }
}

function mapGosecConfidence(confidence: string): number {
    switch (confidence.toUpperCase()) {
        case 'HIGH': return 0.9;
        case 'MEDIUM': return 0.7;
        default: return 0.5;
    }
}

function mapStaticcheckSeverity(severity: string): Issue['severity'] {
    switch (severity) {
        case 'error': return 'high';
        case 'warning': return 'medium';
        default: return 'low';
    }
}

function categorizeStaticcheck(code: string): Issue['category'] {
    if (code.startsWith('S')) return 'correctness';
    if (code.startsWith('SA')) return 'security';
    if (code.startsWith('ST')) return 'style';
    return 'maintainability';
}
