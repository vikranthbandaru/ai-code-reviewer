/**
 * RAG Context Retriever
 *
 * Retrieves relevant project context (README, docs, lint configs) for LLM
 */

import type { WorkerConfig } from '../config.js';
import { fetchFileContent, listDirectoryFiles } from '../github/diff-fetcher.js';

export interface RepoContext {
    readme: string | null;
    contributing: string | null;
    lintConfig: string | null;
    relevantDocs: string[];
}

const CONTEXT_FILES = [
    'README.md',
    'README',
    'CONTRIBUTING.md',
    'CONTRIBUTING',
    'STYLEGUIDE.md',
    'docs/CODING_STANDARDS.md',
    'docs/ARCHITECTURE.md',
];

const LINT_CONFIG_FILES = [
    '.eslintrc.js',
    '.eslintrc.json',
    'eslint.config.js',
    'pyproject.toml',
    'ruff.toml',
    '.golangci.yml',
];

/**
 * Retrieve relevant context from repository
 */
export async function retrieveRepoContext(
    owner: string,
    repo: string,
    ref: string,
    installationId: number,
    config: WorkerConfig
): Promise<RepoContext> {
    const context: RepoContext = {
        readme: null,
        contributing: null,
        lintConfig: null,
        relevantDocs: [],
    };

    // Fetch README
    for (const file of ['README.md', 'README']) {
        const content = await fetchFileContent(owner, repo, file, ref, installationId, config);
        if (content !== null) {
            context.readme = truncateContext(content, 2000);
            break;
        }
    }

    // Fetch CONTRIBUTING
    for (const file of ['CONTRIBUTING.md', 'CONTRIBUTING']) {
        const content = await fetchFileContent(owner, repo, file, ref, installationId, config);
        if (content !== null) {
            context.contributing = truncateContext(content, 1000);
            break;
        }
    }

    // Fetch lint config
    for (const file of LINT_CONFIG_FILES) {
        const content = await fetchFileContent(owner, repo, file, ref, installationId, config);
        if (content !== null) {
            context.lintConfig = truncateContext(content, 500);
            break;
        }
    }

    return context;
}

/**
 * Build context string for LLM prompt
 */
export function buildContextString(context: RepoContext): string {
    const parts: string[] = [];

    if (context.readme !== null) {
        parts.push('## Project Overview (from README)');
        parts.push(context.readme);
        parts.push('');
    }

    if (context.contributing !== null) {
        parts.push('## Contributing Guidelines');
        parts.push(context.contributing);
        parts.push('');
    }

    if (context.lintConfig !== null) {
        parts.push('## Lint Configuration');
        parts.push('```');
        parts.push(context.lintConfig);
        parts.push('```');
        parts.push('');
    }

    return parts.join('\n');
}

function truncateContext(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + '\n... (truncated)';
}
