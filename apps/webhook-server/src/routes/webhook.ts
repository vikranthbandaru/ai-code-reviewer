/**
 * Webhook Routes
 *
 * Handles GitHub webhook events for pull requests
 */

import type { Router, Request, Response, NextFunction } from 'express';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import type { Config } from '../config.js';
import { signatureMiddleware, rawBodyMiddleware } from '../middleware/signature.js';
import { getRequestId } from '../middleware/request-id.js';
import { getQueue, type ReviewJob } from '../queue/job-queue.js';
import { getLogger } from '../logging/logger.js';

// Supported PR actions
const SUPPORTED_ACTIONS = ['opened', 'synchronize', 'reopened', 'ready_for_review'];

interface PullRequestPayload {
    action: string;
    number: number;
    pull_request: {
        head: {
            sha: string;
        };
        draft: boolean;
    };
    repository: {
        name: string;
        owner: {
            login: string;
        };
    };
    installation?: {
        id: number;
    };
}

/**
 * Validate pull request payload
 */
function isValidPRPayload(body: unknown): body is PullRequestPayload {
    if (typeof body !== 'object' || body === null) return false;

    const payload = body as Record<string, unknown>;
    return (
        typeof payload['action'] === 'string' &&
        typeof payload['number'] === 'number' &&
        typeof payload['pull_request'] === 'object' &&
        payload['pull_request'] !== null &&
        typeof payload['repository'] === 'object' &&
        payload['repository'] !== null
    );
}

/**
 * Create the webhook router
 */
export function createWebhookRouter(config: Config): Router {
    const router = express.Router();
    const logger = getLogger();

    // Apply raw body and signature verification middleware
    router.use(rawBodyMiddleware);
    router.use(signatureMiddleware(config.githubWebhookSecret));

    // Health check endpoint (bypasses signature)
    router.get('/health', (_req: Request, res: Response) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Main webhook endpoint
    router.post('/', (req: Request, res: Response, _next: NextFunction) => {
        const requestId = getRequestId(req);
        const event = req.headers['x-github-event'] as string | undefined;

        // Log received event
        logger.info({ requestId, event }, 'Received webhook event');

        // Only handle pull_request events
        if (event !== 'pull_request') {
            logger.debug({ requestId, event }, 'Ignoring non-pull_request event');
            res.status(200).json({ status: 'ignored', reason: 'not a pull_request event' });
            return;
        }

        // Validate payload
        if (!isValidPRPayload(req.body)) {
            logger.warn({ requestId }, 'Invalid pull_request payload');
            res.status(400).json({ error: 'Invalid payload' });
            return;
        }

        const payload = req.body;

        // Check if action is supported
        if (!SUPPORTED_ACTIONS.includes(payload.action)) {
            logger.debug({ requestId, action: payload.action }, 'Ignoring unsupported action');
            res.status(200).json({ status: 'ignored', reason: `unsupported action: ${payload.action}` });
            return;
        }

        // Skip draft PRs
        if (payload.pull_request.draft) {
            logger.debug({ requestId }, 'Ignoring draft PR');
            res.status(200).json({ status: 'ignored', reason: 'draft PR' });
            return;
        }

        // Check for installation ID
        if (payload.installation?.id === undefined) {
            logger.warn({ requestId }, 'Missing installation ID');
            res.status(400).json({ error: 'Missing installation ID' });
            return;
        }

        // Create review job
        const job: ReviewJob = {
            id: uuidv4(),
            owner: payload.repository.owner.login,
            repo: payload.repository.name,
            prNumber: payload.number,
            sha: payload.pull_request.head.sha,
            installationId: payload.installation.id,
            action: payload.action,
            createdAt: new Date().toISOString(),
            requestId,
        };

        // Enqueue job (async, but we respond immediately)
        const queue = getQueue();
        queue.enqueue(job).catch((error: unknown) => {
            logger.error({ requestId, error }, 'Failed to enqueue job');
        });

        logger.info(
            {
                requestId,
                jobId: job.id,
                owner: job.owner,
                repo: job.repo,
                prNumber: job.prNumber,
            },
            'Enqueued review job'
        );

        res.status(202).json({
            status: 'accepted',
            jobId: job.id,
            message: 'Review job queued',
        });
    });

    return router;
}
