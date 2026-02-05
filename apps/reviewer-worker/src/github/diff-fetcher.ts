/**
 * GitHub Diff Fetcher
 *
 * Fetches PR diff content from GitHub API
 */

import { Octokit } from '@octokit/rest';

import type { WorkerConfig } from '../config.js';

export interface PRInfo {
    owner: string;
    repo: string;
    number: number;
    sha: string;
    installationId: number;
}

export interface FetchedDiff {
    diff: string;
    baseSha: string;
    headSha: string;
    title: string;
    body: string | null;
    author: string;
    additions: number;
    deletions: number;
    changedFiles: number;
}

/**
 * Create an authenticated Octokit instance for an installation
 */
export async function createOctokit(
    installationId: number,
    config: WorkerConfig
): Promise<Octokit> {
    const { createAppAuth } = await import('@octokit/auth-app');

    return new Octokit({
        authStrategy: createAppAuth,
        auth: {
            appId: config.githubAppId,
            privateKey: config.githubPrivateKey,
            installationId,
        },
    });
}

/**
 * Fetch PR diff from GitHub
 */
export async function fetchPRDiff(
    pr: PRInfo,
    config: WorkerConfig
): Promise<FetchedDiff> {
    const octokit = await createOctokit(pr.installationId, config);

    // Get PR details
    const { data: prData } = await octokit.pulls.get({
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
    });

    // Get diff content
    const { data: diff } = await octokit.pulls.get({
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
        mediaType: {
            format: 'diff',
        },
    });

    return {
        diff: diff as unknown as string,
        baseSha: prData.base.sha,
        headSha: prData.head.sha,
        title: prData.title,
        body: prData.body,
        author: prData.user?.login ?? 'unknown',
        additions: prData.additions,
        deletions: prData.deletions,
        changedFiles: prData.changed_files,
    };
}

/**
 * Fetch file content from GitHub
 */
export async function fetchFileContent(
    owner: string,
    repo: string,
    path: string,
    ref: string,
    installationId: number,
    config: WorkerConfig
): Promise<string | null> {
    const octokit = await createOctokit(installationId, config);

    try {
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path,
            ref,
        });

        if ('content' in data && typeof data.content === 'string') {
            return Buffer.from(data.content, 'base64').toString('utf-8');
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * List files in a directory
 */
export async function listDirectoryFiles(
    owner: string,
    repo: string,
    path: string,
    ref: string,
    installationId: number,
    config: WorkerConfig
): Promise<string[]> {
    const octokit = await createOctokit(installationId, config);

    try {
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path,
            ref,
        });

        if (Array.isArray(data)) {
            return data.map((item) => item.path);
        }

        return [];
    } catch {
        return [];
    }
}
