/**
 * OSV Vulnerability Scanner
 *
 * Scans dependency files for known vulnerabilities using OSV API
 */

import type { Issue } from '@ai-reviewer/core';

import type { WorkerConfig } from '../config.js';

interface OsvVulnerability {
    id: string;
    summary: string;
    details: string;
    severity?: Array<{ type: string; score: string }>;
    affected: Array<{
        package: { name: string; ecosystem: string };
        ranges?: Array<{ events: Array<{ introduced?: string; fixed?: string }> }>;
    }>;
    references?: Array<{ type: string; url: string }>;
}

interface OsvQueryResult {
    vulns?: OsvVulnerability[];
}

interface PackageDependency {
    name: string;
    version: string;
    ecosystem: 'npm' | 'PyPI' | 'Go';
}

/**
 * Query OSV API for vulnerabilities
 */
async function queryOsv(
    pkg: PackageDependency,
    config: WorkerConfig
): Promise<OsvVulnerability[]> {
    try {
        const response = await fetch(`${config.osvApiUrl}/v1/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                package: { name: pkg.name, ecosystem: pkg.ecosystem },
                version: pkg.version,
            }),
        });

        if (!response.ok) return [];

        const data = (await response.json()) as OsvQueryResult;
        return data.vulns ?? [];
    } catch {
        return [];
    }
}

/**
 * Parse package.json for dependencies
 */
export function parsePackageJson(content: string): PackageDependency[] {
    try {
        const pkg = JSON.parse(content) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
        };

        const deps: PackageDependency[] = [];

        for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
            deps.push({ name, version: cleanVersion(version), ecosystem: 'npm' });
        }

        for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
            deps.push({ name, version: cleanVersion(version), ecosystem: 'npm' });
        }

        return deps;
    } catch {
        return [];
    }
}

/**
 * Parse requirements.txt for dependencies
 */
export function parseRequirements(content: string): PackageDependency[] {
    const deps: PackageDependency[] = [];

    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('#')) continue;

        // Parse name==version or name>=version
        const match = /^([a-zA-Z0-9_-]+)[=<>!~]+(.+)$/.exec(trimmed);
        if (match?.[1] !== undefined && match[2] !== undefined) {
            deps.push({
                name: match[1],
                version: cleanVersion(match[2]),
                ecosystem: 'PyPI',
            });
        }
    }

    return deps;
}

/**
 * Parse go.mod for dependencies
 */
export function parseGoMod(content: string): PackageDependency[] {
    const deps: PackageDependency[] = [];

    const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/);
    if (requireBlock?.[1] !== undefined) {
        for (const line of requireBlock[1].split('\n')) {
            const match = /^\s*([^\s]+)\s+v?([^\s]+)/.exec(line);
            if (match?.[1] !== undefined && match[2] !== undefined) {
                deps.push({
                    name: match[1],
                    version: match[2],
                    ecosystem: 'Go',
                });
            }
        }
    }

    // Also match single-line requires
    const singleRequires = content.matchAll(/require\s+([^\s]+)\s+v?([^\s]+)/g);
    for (const match of singleRequires) {
        if (match[1] !== undefined && match[2] !== undefined) {
            deps.push({
                name: match[1],
                version: match[2],
                ecosystem: 'Go',
            });
        }
    }

    return deps;
}

function cleanVersion(version: string): string {
    // Remove common prefixes and suffixes
    return version.replace(/^[^0-9]*/, '').replace(/[^0-9.].*$/, '');
}

/**
 * Scan dependencies for vulnerabilities
 */
export async function scanDependencies(
    lockfileContent: string,
    lockfilePath: string,
    config: WorkerConfig
): Promise<Issue[]> {
    if (!config.enableOsvScan) return [];

    // Determine parser based on file name
    const filename = lockfilePath.split('/').pop() ?? '';
    let deps: PackageDependency[] = [];

    if (filename === 'package.json' || filename.includes('package-lock') || filename.includes('pnpm-lock')) {
        deps = parsePackageJson(lockfileContent);
    } else if (filename === 'requirements.txt' || filename === 'pyproject.toml') {
        deps = parseRequirements(lockfileContent);
    } else if (filename === 'go.mod') {
        deps = parseGoMod(lockfileContent);
    }

    const issues: Issue[] = [];

    // Query OSV for each dependency (batch in production)
    for (const dep of deps.slice(0, 50)) { // Limit to first 50 deps
        const vulns = await queryOsv(dep, config);

        for (const vuln of vulns) {
            issues.push({
                id: crypto.randomUUID(),
                category: 'dependency',
                subtype: 'cve',
                severity: mapOsvSeverity(vuln),
                confidence: 0.95,
                file_path: lockfilePath,
                line_start: 1,
                line_end: 1,
                message: `**${vuln.id}**: ${vuln.summary} (${dep.name}@${dep.version})`,
                evidence: vuln.details.slice(0, 200),
                source_tool: 'osv',
                is_llm_generated: false,
            });
        }
    }

    return issues;
}

function mapOsvSeverity(vuln: OsvVulnerability): Issue['severity'] {
    const severity = vuln.severity?.[0];
    if (severity === undefined) return 'medium';

    const score = parseFloat(severity.score);
    if (score >= 9) return 'critical';
    if (score >= 7) return 'high';
    if (score >= 4) return 'medium';
    return 'low';
}
