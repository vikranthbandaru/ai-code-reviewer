/**
 * Static Analysis Tool Runner
 *
 * Base abstraction for running static analysis tools
 */

import { execa, type ExecaError } from 'execa';
import type { Issue } from '@ai-reviewer/core';

import type { WorkerConfig } from '../config.js';

export interface ToolResult {
    tool: string;
    success: boolean;
    issues: Issue[];
    error?: string;
    duration: number;
}

export interface ToolRunner {
    name: string;
    isAvailable(): Promise<boolean>;
    run(files: string[], workdir: string, config: WorkerConfig): Promise<ToolResult>;
}

/**
 * Check if a command is available on the system
 */
export async function isCommandAvailable(command: string): Promise<boolean> {
    try {
        await execa('which', [command]);
        return true;
    } catch {
        // Try Windows 'where' command
        try {
            await execa('where', [command]);
            return true;
        } catch {
            return false;
        }
    }
}

/**
 * Run a command and capture output
 */
export async function runCommand(
    command: string,
    args: string[],
    options: { cwd?: string; timeout?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
        const result = await execa(command, args, {
            cwd: options.cwd,
            timeout: options.timeout ?? 300000, // 5 minutes default
            reject: false,
        });

        return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode ?? 0,
        };
    } catch (error) {
        const execaError = error as ExecaError;
        return {
            stdout: execaError.stdout ?? '',
            stderr: execaError.stderr ?? execaError.message,
            exitCode: execaError.exitCode ?? 1,
        };
    }
}

/**
 * Parse SARIF format output (used by many tools)
 */
export function parseSarifOutput(sarifJson: string): Issue[] {
    try {
        const sarif = JSON.parse(sarifJson) as {
            runs?: Array<{
                results?: Array<{
                    ruleId?: string;
                    level?: string;
                    message?: { text?: string };
                    locations?: Array<{
                        physicalLocation?: {
                            artifactLocation?: { uri?: string };
                            region?: { startLine?: number; endLine?: number };
                        };
                    }>;
                }>;
            }>;
        };

        const issues: Issue[] = [];

        for (const run of sarif.runs ?? []) {
            for (const result of run.results ?? []) {
                const location = result.locations?.[0]?.physicalLocation;
                if (location?.artifactLocation?.uri === undefined) continue;

                const severity = mapSarifLevel(result.level ?? 'warning');

                issues.push({
                    id: crypto.randomUUID(),
                    category: 'security',
                    subtype: result.ruleId ?? 'unknown',
                    severity,
                    confidence: 0.8,
                    file_path: location.artifactLocation.uri,
                    line_start: location.region?.startLine ?? 1,
                    line_end: location.region?.endLine ?? location.region?.startLine ?? 1,
                    message: result.message?.text ?? 'Issue detected',
                    evidence: '',
                    source_tool: 'sarif',
                    is_llm_generated: false,
                });
            }
        }

        return issues;
    } catch {
        return [];
    }
}

/**
 * Map SARIF severity levels to our severity
 */
function mapSarifLevel(level: string): Issue['severity'] {
    switch (level.toLowerCase()) {
        case 'error':
            return 'high';
        case 'warning':
            return 'medium';
        case 'note':
        case 'none':
            return 'low';
        default:
            return 'medium';
    }
}
