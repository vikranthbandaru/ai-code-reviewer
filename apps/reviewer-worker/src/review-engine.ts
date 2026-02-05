/**
 * Review Engine
 *
 * Orchestrates the full review process
 */

import pino from 'pino';
import {
    parseDiff,
    chunkDiff,
    categorizeFiles,
    createExecutiveSummary,
    type ReviewOutput,
    type Issue,
    getFilePath,
} from '@ai-reviewer/core';

import type { WorkerConfig } from './config.js';
import { fetchPRDiff, type PRInfo, type FetchedDiff } from './github/diff-fetcher.js';
import { postReview, createCheckRun, updateCheckRun, type PostReviewOptions } from './github/review-poster.js';
import { eslintRunner } from './tools/eslint.js';
import { semgrepRunner } from './tools/semgrep.js';
import { ruffRunner, banditRunner } from './tools/python-tools.js';
import { gosecRunner, staticcheckRunner, govetRunner } from './tools/go-tools.js';
import { scanDependencies } from './cve/osv-scanner.js';
import { getLLMProvider } from './llm/provider.js';
import { retrieveRepoContext, buildContextString } from './rag/context-retriever.js';
import { aggregateIssues, mergeToolResults } from './aggregator.js';

export interface ReviewJob {
    id: string;
    owner: string;
    repo: string;
    prNumber: number;
    sha: string;
    installationId: number;
    action: string;
    requestId?: string;
}

export interface ReviewResult {
    success: boolean;
    output?: ReviewOutput;
    error?: string;
}

/**
 * Run the full review process
 */
export async function runReview(
    job: ReviewJob,
    config: WorkerConfig,
    logger: pino.Logger
): Promise<ReviewResult> {
    const startTime = Date.now();
    const toolsRun: string[] = [];
    let checkRunId: number | undefined;

    const prInfo: PRInfo = {
        owner: job.owner,
        repo: job.repo,
        number: job.prNumber,
        sha: job.sha,
        installationId: job.installationId,
    };

    try {
        // Create check run (if permissions allow)
        try {
            const options: PostReviewOptions = {
                ...prInfo,
                prNumber: prInfo.number,
            };
            checkRunId = await createCheckRun(options, config);
            logger.info({ checkRunId }, 'Created check run');
        } catch (error) {
            logger.warn({ error }, 'Could not create check run - continuing without');
        }

        // Step 1: Fetch PR diff
        logger.info('Fetching PR diff');
        const fetchedDiff = await fetchPRDiff(prInfo, config);
        logger.info(
            { additions: fetchedDiff.additions, deletions: fetchedDiff.deletions, files: fetchedDiff.changedFiles },
            'Fetched PR diff'
        );

        // Step 2: Parse diff
        const parsedDiff = parseDiff(fetchedDiff.diff);
        logger.info({ files: parsedDiff.files.length }, 'Parsed diff');

        // Step 3: Categorize files
        const categorized = categorizeFiles(parsedDiff.files);
        logger.info(
            {
                sourceFiles: categorized.sourceFiles.length,
                lockfiles: categorized.lockfiles.length,
                excluded: categorized.excluded.length,
            },
            'Categorized files'
        );

        if (categorized.sourceFiles.length === 0 && categorized.lockfiles.length === 0) {
            logger.info('No files to review');
            return createEmptyResult(fetchedDiff, startTime);
        }

        // Step 4: Run static analysis tools in parallel
        const filePaths = categorized.sourceFiles.map(getFilePath);
        const workdir = '.'; // In production, clone repo to temp dir

        const toolResults = await runStaticTools(filePaths, workdir, config, logger, toolsRun);

        // Step 5: Scan dependencies for CVEs
        if (categorized.lockfiles.length > 0) {
            logger.info('Scanning dependencies for vulnerabilities');
            for (const lockfile of categorized.lockfiles) {
                const path = getFilePath(lockfile);
                // Note: In production, fetch actual lockfile content
                const cveIssues = await scanDependencies('', path, config);
                toolResults.push(...cveIssues);
                if (cveIssues.length > 0) {
                    toolsRun.push('osv-scanner');
                }
            }
        }

        // Step 6: Get RAG context
        logger.info('Retrieving repository context');
        const repoContext = await retrieveRepoContext(
            job.owner,
            job.repo,
            job.sha,
            job.installationId,
            config
        );
        const contextString = buildContextString(repoContext);

        // Step 7: Run LLM analysis
        let llmIssues: Issue[] = [];
        const llmProvider = await getLLMProvider(config);
        const chunks = chunkDiff(parsedDiff);
        logger.info({ chunks: chunks.length }, 'Created diff chunks for LLM');

        let modelUsed = config.openaiModel;
        for (const chunk of chunks) {
            try {
                const result = await llmProvider.analyze(
                    {
                        chunk,
                        context: contextString,
                        prTitle: fetchedDiff.title,
                        prBody: fetchedDiff.body,
                    },
                    config
                );
                llmIssues.push(...result.issues);
                modelUsed = result.model;
                toolsRun.push(`llm-${llmProvider.name}`);
            } catch (error) {
                logger.warn({ error, chunkIndex: chunk.index }, 'LLM analysis failed for chunk');
            }
        }

        // Step 8: Aggregate all issues
        const allIssues = mergeToolResults(toolResults, llmIssues);
        const aggregated = aggregateIssues(allIssues, config);
        logger.info(
            {
                totalFound: aggregated.stats.totalFound,
                selected: aggregated.stats.selected,
                riskScore: aggregated.riskScore.score,
            },
            'Aggregated issues'
        );

        // Step 9: Build review output
        const output: ReviewOutput = {
            risk_score: aggregated.riskScore.score,
            risk_level: aggregated.riskScore.level,
            inline_comments: aggregated.inlineComments,
            summary_markdown: '', // Will be generated by poster
            exec_summary_eli2: createExecutiveSummary(aggregated.allIssues),
            stats: {
                files_changed: parsedDiff.totalFilesChanged,
                issues_found: aggregated.allIssues.length,
                tools_run: [...new Set(toolsRun)],
                model_used: modelUsed,
                latency_ms: Date.now() - startTime,
                lines_added: parsedDiff.totalLinesAdded,
                lines_removed: parsedDiff.totalLinesRemoved,
            },
            category_breakdown: aggregated.riskScore.breakdown,
            request_id: job.requestId,
            completed_at: new Date().toISOString(),
            pr_info: {
                owner: job.owner,
                repo: job.repo,
                number: job.prNumber,
                sha: job.sha,
            },
        };

        // Step 10: Post review to GitHub
        logger.info('Posting review to GitHub');
        const postOptions: PostReviewOptions = {
            owner: job.owner,
            repo: job.repo,
            prNumber: job.prNumber,
            sha: job.sha,
            installationId: job.installationId,
        };

        await postReview(output, postOptions, config);
        logger.info('Posted review successfully');

        // Update check run
        if (checkRunId !== undefined) {
            await updateCheckRun(checkRunId, output, postOptions, config);
        }

        return { success: true, output };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ error }, 'Review failed');

        return { success: false, error: errorMsg };
    }
}

/**
 * Run static analysis tools
 */
async function runStaticTools(
    files: string[],
    workdir: string,
    config: WorkerConfig,
    logger: pino.Logger,
    toolsRun: string[]
): Promise<Issue[]> {
    const issues: Issue[] = [];

    // Determine which tools to run based on file types
    const hasJs = files.some((f) => /\.(js|jsx|ts|tsx)$/.test(f));
    const hasPy = files.some((f) => f.endsWith('.py'));
    const hasGo = files.some((f) => f.endsWith('.go'));

    const toolPromises: Promise<void>[] = [];

    // ESLint for JS/TS
    if (hasJs && config.enableEslint) {
        toolPromises.push(
            eslintRunner.run(files, workdir, config).then((result) => {
                if (result.success) {
                    issues.push(...result.issues);
                    if (result.issues.length > 0) toolsRun.push('eslint');
                }
                logger.debug({ tool: 'eslint', issues: result.issues.length }, 'ESLint complete');
            })
        );
    }

    // Semgrep for all
    if (config.enableSemgrep) {
        toolPromises.push(
            semgrepRunner.run(files, workdir, config).then((result) => {
                if (result.success) {
                    issues.push(...result.issues);
                    if (result.issues.length > 0) toolsRun.push('semgrep');
                }
                logger.debug({ tool: 'semgrep', issues: result.issues.length }, 'Semgrep complete');
            })
        );
    }

    // Ruff for Python
    if (hasPy && config.enableRuff) {
        toolPromises.push(
            ruffRunner.run(files, workdir, config).then((result) => {
                if (result.success) {
                    issues.push(...result.issues);
                    if (result.issues.length > 0) toolsRun.push('ruff');
                }
                logger.debug({ tool: 'ruff', issues: result.issues.length }, 'Ruff complete');
            })
        );
    }

    // Bandit for Python
    if (hasPy && config.enableBandit) {
        toolPromises.push(
            banditRunner.run(files, workdir, config).then((result) => {
                if (result.success) {
                    issues.push(...result.issues);
                    if (result.issues.length > 0) toolsRun.push('bandit');
                }
                logger.debug({ tool: 'bandit', issues: result.issues.length }, 'Bandit complete');
            })
        );
    }

    // Go tools
    if (hasGo && config.enableGosec) {
        toolPromises.push(
            gosecRunner.run(files, workdir, config).then((result) => {
                if (result.success) {
                    issues.push(...result.issues);
                    if (result.issues.length > 0) toolsRun.push('gosec');
                }
            })
        );
    }

    if (hasGo && config.enableStaticcheck) {
        toolPromises.push(
            staticcheckRunner.run(files, workdir, config).then((result) => {
                if (result.success) {
                    issues.push(...result.issues);
                    if (result.issues.length > 0) toolsRun.push('staticcheck');
                }
            })
        );
    }

    await Promise.all(toolPromises);
    return issues;
}

function createEmptyResult(diff: FetchedDiff, startTime: number): ReviewResult {
    return {
        success: true,
        output: {
            risk_score: 0,
            risk_level: 'low',
            inline_comments: [],
            summary_markdown: 'No reviewable files in this PR.',
            exec_summary_eli2: '• No issues found - all changes are in excluded files',
            stats: {
                files_changed: 0,
                issues_found: 0,
                tools_run: [],
                model_used: 'none',
                latency_ms: Date.now() - startTime,
            },
            completed_at: new Date().toISOString(),
        },
    };
}
