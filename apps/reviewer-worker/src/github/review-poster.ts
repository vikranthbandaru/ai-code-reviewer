/**
 * GitHub Review Poster
 *
 * Posts review comments to GitHub PRs
 */

import { Octokit } from '@octokit/rest';
import type { Issue, ReviewOutput } from '@ai-reviewer/core';
import { formatInlineComment, formatSummaryComment } from '@ai-reviewer/core';

import type { WorkerConfig } from '../config.js';
import { createOctokit } from './diff-fetcher.js';

export interface PostReviewOptions {
    owner: string;
    repo: string;
    prNumber: number;
    sha: string;
    installationId: number;
}

interface ReviewComment {
    path: string;
    position?: number;
    line: number;
    side: 'RIGHT';
    body: string;
}

/**
 * Create inline review comments from issues
 */
function createReviewComments(issues: Issue[]): ReviewComment[] {
    return issues.map((issue) => ({
        path: issue.file_path,
        line: issue.line_end,
        side: 'RIGHT' as const,
        body: formatInlineComment(issue),
    }));
}

/**
 * Post a review with inline comments
 */
export async function postReview(
    review: ReviewOutput,
    options: PostReviewOptions,
    config: WorkerConfig
): Promise<{ reviewId: number; commentIds: number[] }> {
    const octokit = await createOctokit(options.installationId, config);

    // Prepare inline comments
    const comments = createReviewComments(review.inline_comments);

    // Determine review event (approve, comment, request changes)
    let event: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES' = 'COMMENT';
    if (review.risk_level === 'critical') {
        event = 'REQUEST_CHANGES';
    } else if (review.risk_score < 10 && review.inline_comments.length === 0) {
        event = 'APPROVE';
    }

    // Create the review
    const { data: reviewData } = await octokit.pulls.createReview({
        owner: options.owner,
        repo: options.repo,
        pull_number: options.prNumber,
        commit_id: options.sha,
        body: formatSummaryComment(review),
        event,
        comments: comments.length > 0 ? comments : undefined,
    });

    return {
        reviewId: reviewData.id,
        commentIds: [], // GitHub doesn't return individual comment IDs in review creation
    };
}

/**
 * Post a summary comment (without inline comments)
 */
export async function postSummaryComment(
    review: ReviewOutput,
    options: PostReviewOptions,
    config: WorkerConfig
): Promise<number> {
    const octokit = await createOctokit(options.installationId, config);

    const { data } = await octokit.issues.createComment({
        owner: options.owner,
        repo: options.repo,
        issue_number: options.prNumber,
        body: formatSummaryComment(review),
    });

    return data.id;
}

/**
 * Update check run with review results
 */
export async function updateCheckRun(
    checkRunId: number,
    review: ReviewOutput,
    options: PostReviewOptions,
    config: WorkerConfig
): Promise<void> {
    const octokit = await createOctokit(options.installationId, config);

    const conclusion = review.risk_score >= config.riskThreshold ? 'failure' : 'success';

    await octokit.checks.update({
        owner: options.owner,
        repo: options.repo,
        check_run_id: checkRunId,
        status: 'completed',
        conclusion,
        output: {
            title: `AI Code Review - Risk Score: ${review.risk_score}/100`,
            summary: review.exec_summary_eli2,
            text: review.summary_markdown,
        },
    });
}

/**
 * Create a check run for the review
 */
export async function createCheckRun(
    options: PostReviewOptions,
    config: WorkerConfig
): Promise<number> {
    const octokit = await createOctokit(options.installationId, config);

    const { data } = await octokit.checks.create({
        owner: options.owner,
        repo: options.repo,
        name: 'AI Code Review',
        head_sha: options.sha,
        status: 'in_progress',
        started_at: new Date().toISOString(),
    });

    return data.id;
}
