/**
 * Reviewer Worker Entry Point
 */

// Load environment variables from .env file
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import pino from 'pino';

import { loadWorkerConfig, type WorkerConfig } from './config.js';
import { runReview, type ReviewJob } from './review-engine.js';

let logger: pino.Logger;
let config: WorkerConfig;

/**
 * Process a review job
 */
async function processJob(job: ReviewJob): Promise<void> {
    const jobLogger = logger.child({
        jobId: job.id,
        owner: job.owner,
        repo: job.repo,
        prNumber: job.prNumber,
        requestId: job.requestId,
    });

    jobLogger.info('Starting review job');
    const result = await runReview(job, config, jobLogger);

    if (result.success) {
        jobLogger.info(
            {
                riskScore: result.output?.risk_score,
                issuesFound: result.output?.stats.issues_found,
                latencyMs: result.output?.stats.latency_ms,
            },
            'Review completed successfully'
        );
    } else {
        jobLogger.error({ error: result.error }, 'Review failed');
    }
}

/**
 * Start the worker in queue mode
 */
async function startQueueWorker(): Promise<void> {
    if (config.queueBackend === 'redis' && config.redisUrl !== undefined) {
        const { Worker } = await import('bullmq');
        const { Redis } = await import('ioredis');

        const connection = new Redis(config.redisUrl, {
            maxRetriesPerRequest: null,
        });

        const worker = new Worker<ReviewJob>(
            'code-review',
            async (job) => {
                await processJob(job.data);
            },
            {
                connection,
                concurrency: 3,
            }
        );

        worker.on('completed', (job) => {
            logger.info({ jobId: job.id }, 'Job completed');
        });

        worker.on('failed', (job, err) => {
            logger.error({ jobId: job?.id, error: err.message }, 'Job failed');
        });

        logger.info('Worker started in Redis queue mode');

        // Graceful shutdown
        const shutdown = async (): Promise<void> => {
            logger.info('Shutting down worker');
            await worker.close();
            connection.disconnect();
            process.exit(0);
        };

        process.on('SIGTERM', () => void shutdown());
        process.on('SIGINT', () => void shutdown());
    } else {
        logger.info('Worker started in standalone mode (no queue)');
        logger.info('Use this worker with the webhook server in-memory queue for development');
    }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
    try {
        config = loadWorkerConfig();
    } catch (error) {
        console.error('Configuration error:', error);
        process.exit(1);
    }

    logger = pino({
        level: config.logLevel,
        transport: config.nodeEnv === 'development' && !config.logJson
            ? {
                target: 'pino-pretty',
                options: { colorize: true },
            }
            : undefined,
        base: { service: 'reviewer-worker' },
    });

    logger.info({ nodeEnv: config.nodeEnv }, 'Starting reviewer worker');

    await startQueueWorker();
}

// Export for use as library
export { processJob, runReview };
export type { ReviewJob, ReviewResult } from './review-engine.js';

// Run if executed directly
main().catch((error: unknown) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
