/**
 * Webhook Server Entry Point
 */

// Load environment variables from .env file (in project root)
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import express from 'express';
import pinoHttp from 'pino-http';

import { loadConfig, validateStartupConfig, type Config } from './config.js';
import { initLogger, getLogger } from './logging/logger.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { initQueue, closeQueue } from './queue/job-queue.js';
import { createWebhookRouter } from './routes/webhook.js';
import { verifyPrivateKey } from './auth/github-app.js';

let server: ReturnType<typeof express>['listen'] extends (
    ...args: infer P
) => infer R
    ? R
    : never;

/**
 * Start the webhook server
 */
async function main(): Promise<void> {
    // Load and validate configuration
    let config: Config;
    try {
        config = loadConfig();
        validateStartupConfig(config);
    } catch (error) {
        console.error('Configuration error:', error);
        process.exit(1);
    }

    // Initialize logger
    const logger = initLogger(config);
    logger.info({ nodeEnv: config.nodeEnv }, 'Starting webhook server');

    // Verify GitHub App private key
    if (!verifyPrivateKey(config)) {
        logger.error('Invalid GitHub App private key');
        process.exit(1);
    }
    logger.info('GitHub App credentials verified');

    // Initialize job queue
    await initQueue(config);
    logger.info({ backend: config.queueBackend }, 'Job queue initialized');

    // Create Express app
    const app = express();

    // Trust proxy (for correct client IP in logs)
    app.set('trust proxy', true);

    // Request ID middleware (before logging)
    app.use(requestIdMiddleware());

    // HTTP logging (after request ID)
    app.use(
        pinoHttp({
            logger,
            autoLogging: {
                ignore: (req) => req.url === '/health',
            },
            customProps: (req) => ({
                requestId: req.headers['x-request-id'],
            }),
        })
    );

    // Health check at root (before body parsing)
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', service: 'webhook-server' });
    });

    // Mount webhook routes
    const webhookRouter = createWebhookRouter(config);
    app.use('/webhook', webhookRouter);

    // Error handler
    app.use(
        (
            err: Error,
            _req: express.Request,
            res: express.Response,
            _next: express.NextFunction
        ) => {
            logger.error({ err }, 'Unhandled error');
            res.status(500).json({ error: 'Internal server error' });
        }
    );

    // Start server
    server = app.listen(config.port, config.host, () => {
        logger.info(
            { host: config.host, port: config.port },
            `Webhook server listening on http://${config.host}:${config.port}`
        );
        logger.info(
            `Webhook URL: http://${config.host}:${config.port}/webhook`
        );
    });

    // Graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
        logger.info({ signal }, 'Shutting down gracefully');

        server.close(() => {
            logger.info('HTTP server closed');
        });

        await closeQueue();
        logger.info('Queue closed');

        process.exit(0);
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
}

// Run
main().catch((error: unknown) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
