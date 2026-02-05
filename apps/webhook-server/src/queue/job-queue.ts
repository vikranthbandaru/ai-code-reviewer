/**
 * Job Queue Abstraction
 *
 * Supports:
 * - In-memory queue for development
 * - BullMQ/Redis for production
 */

import type { Config } from '../config.js';
import { getLogger } from '../logging/logger.js';

export interface ReviewJob {
    id: string;
    owner: string;
    repo: string;
    prNumber: number;
    sha: string;
    installationId: number;
    action: string;
    createdAt: string;
    requestId?: string;
}

export interface JobQueue {
    enqueue(job: ReviewJob): Promise<void>;
    close(): Promise<void>;
}

/**
 * In-memory queue for development/testing
 */
class MemoryQueue implements JobQueue {
    private jobs: ReviewJob[] = [];
    private processing = false;
    private processor?: (job: ReviewJob) => Promise<void>;

    async enqueue(job: ReviewJob): Promise<void> {
        const logger = getLogger();
        logger.info({ jobId: job.id }, 'Enqueuing job to memory queue');
        this.jobs.push(job);

        // Process immediately if processor is set
        if (this.processor !== undefined && !this.processing) {
            void this.processJobs();
        }
    }

    setProcessor(handler: (job: ReviewJob) => Promise<void>): void {
        this.processor = handler;
    }

    private async processJobs(): Promise<void> {
        if (this.processor === undefined || this.processing) return;

        this.processing = true;
        const logger = getLogger();

        while (this.jobs.length > 0) {
            const job = this.jobs.shift();
            if (job === undefined) continue;

            try {
                logger.info({ jobId: job.id }, 'Processing job from memory queue');
                await this.processor(job);
                logger.info({ jobId: job.id }, 'Job completed');
            } catch (error) {
                logger.error({ jobId: job.id, error }, 'Job failed');
            }
        }

        this.processing = false;
    }

    async close(): Promise<void> {
        this.jobs = [];
        this.processing = false;
    }
}

/**
 * Redis-backed queue using BullMQ
 */
class RedisQueue implements JobQueue {
    private queue: import('bullmq').Queue | null = null;
    private redisUrl: string;

    constructor(redisUrl: string) {
        this.redisUrl = redisUrl;
    }

    private async getQueue(): Promise<import('bullmq').Queue> {
        if (this.queue !== null) return this.queue;

        const { Queue } = await import('bullmq');
        const { Redis } = await import('ioredis');

        const connection = new Redis(this.redisUrl, {
            maxRetriesPerRequest: null,
        });

        this.queue = new Queue('code-review', {
            connection,
            defaultJobOptions: {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 1000,
                },
                removeOnComplete: 100,
                removeOnFail: 1000,
            },
        });

        return this.queue;
    }

    async enqueue(job: ReviewJob): Promise<void> {
        const logger = getLogger();
        const queue = await this.getQueue();

        await queue.add('review', job, {
            jobId: job.id,
        });

        logger.info({ jobId: job.id }, 'Enqueued job to Redis queue');
    }

    async close(): Promise<void> {
        if (this.queue !== null) {
            await this.queue.close();
            this.queue = null;
        }
    }
}

// Singleton queue instance
let queueInstance: JobQueue | null = null;

/**
 * Initialize the job queue based on configuration
 */
export async function initQueue(config: Config): Promise<JobQueue> {
    const logger = getLogger();

    if (config.queueBackend === 'redis' && config.redisUrl !== undefined) {
        logger.info('Initializing Redis queue');
        queueInstance = new RedisQueue(config.redisUrl);
    } else {
        logger.info('Initializing in-memory queue with inline processor');
        const memQueue = new MemoryQueue();

        // Register inline processor for development
        memQueue.setProcessor(async (job: ReviewJob) => {
            logger.info({ jobId: job.id, pr: job.prNumber }, 'Processing review job inline');

            try {
                // Dynamic import for GitHub auth
                const { createAppAuth } = await import('@octokit/auth-app');
                const { Octokit } = await import('@octokit/rest');
                const OpenAI = (await import('openai')).default;

                // Create authenticated Octokit instance
                const auth = createAppAuth({
                    appId: config.githubAppId,
                    privateKey: config.githubPrivateKey,
                    installationId: job.installationId,
                });

                const installationAuth = await auth({ type: 'installation' });
                const octokit = new Octokit({ auth: installationAuth.token });

                // Fetch the PR diff
                const { data: diff } = await octokit.pulls.get({
                    owner: job.owner,
                    repo: job.repo,
                    pull_number: job.prNumber,
                    mediaType: { format: 'diff' },
                });

                const diffContent = typeof diff === 'string' ? diff : String(diff);
                logger.info({ diffLength: diffContent.length }, 'Fetched PR diff');

                // Call OpenRouter LLM for analysis
                const openai = new OpenAI({
                    apiKey: process.env['OPENAI_API_KEY'],
                    baseURL: process.env['OPENAI_BASE_URL'] || 'https://openrouter.ai/api/v1',
                    defaultHeaders: {
                        'HTTP-Referer': 'https://github.com/ai-code-reviewer',
                        'X-Title': 'AI Code Reviewer',
                    },
                });

                const model = process.env['OPENAI_MODEL'] || 'google/gemma-3-12b-it:free';

                const response = await openai.chat.completions.create({
                    model,
                    messages: [
                        {
                            role: 'system',
                            content: `You are an expert code reviewer. Analyze the provided diff and identify security vulnerabilities, bugs, and code quality issues. Be specific about line numbers and provide actionable suggestions. Format your response as a markdown review summary.`,
                        },
                        {
                            role: 'user',
                            content: `Please review this code diff and identify any issues:\n\n\`\`\`diff\n${diffContent.substring(0, 10000)}\n\`\`\``,
                        },
                    ],
                    max_tokens: 2000,
                    temperature: 0.3,
                });

                const reviewContent = response.choices[0]?.message?.content || 'No issues found.';
                logger.info({ tokensUsed: response.usage?.total_tokens }, 'LLM analysis complete');

                // Post review comment on PR
                await octokit.issues.createComment({
                    owner: job.owner,
                    repo: job.repo,
                    issue_number: job.prNumber,
                    body: `## 🤖 AI Code Review\n\n${reviewContent}\n\n---\n*Reviewed by AI Code Reviewer using ${model}*`,
                });

                logger.info({ pr: job.prNumber }, 'Posted review comment to PR');

            } catch (error) {
                logger.error({ error, jobId: job.id }, 'Failed to process review job');
                throw error;
            }
        });

        queueInstance = memQueue;
    }

    return queueInstance;
}

/**
 * Get the queue instance
 */
export function getQueue(): JobQueue {
    if (queueInstance === null) {
        throw new Error('Queue not initialized. Call initQueue first.');
    }
    return queueInstance;
}

/**
 * Close the queue
 */
export async function closeQueue(): Promise<void> {
    if (queueInstance !== null) {
        await queueInstance.close();
        queueInstance = null;
    }
}
