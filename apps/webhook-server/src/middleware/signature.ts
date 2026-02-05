/**
 * Webhook Signature Verification Middleware
 *
 * Verifies X-Hub-Signature-256 header using HMAC-SHA256
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import crypto from 'node:crypto';

import { getLogger } from '../logging/logger.js';

/**
 * Verify GitHub webhook signature
 */
export function verifySignature(payload: string, signature: string, secret: string): boolean {
    const expectedSignature = `sha256=${crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex')}`;

    try {
        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );
    } catch {
        return false;
    }
}

/**
 * Express middleware for webhook signature verification
 */
export function signatureMiddleware(webhookSecret: string): RequestHandler {
    const logger = getLogger();

    return (req: Request, res: Response, next: NextFunction): void => {
        const signature = req.headers['x-hub-signature-256'];
        const requestId = (req.headers['x-request-id'] as string | undefined) ?? 'unknown';

        // Signature header must be present
        if (signature === undefined || typeof signature !== 'string') {
            logger.warn({ requestId }, 'Missing X-Hub-Signature-256 header');
            res.status(401).json({ error: 'Missing signature header' });
            return;
        }

        // Body must be a string (raw body)
        const rawBody = (req as Request & { rawBody?: string }).rawBody;
        if (rawBody === undefined || typeof rawBody !== 'string') {
            logger.error({ requestId }, 'Raw body not available for signature verification');
            res.status(500).json({ error: 'Internal server error' });
            return;
        }

        // Verify signature
        if (!verifySignature(rawBody, signature, webhookSecret)) {
            logger.warn({ requestId }, 'Invalid webhook signature');
            res.status(401).json({ error: 'Invalid signature' });
            return;
        }

        logger.debug({ requestId }, 'Webhook signature verified');
        next();
    };
}

/**
 * Express middleware to capture raw body for signature verification
 */
export function rawBodyMiddleware(
    req: Request & { rawBody?: string },
    _res: Response,
    next: NextFunction
): void {
    let data = '';

    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
        data += chunk;
    });

    req.on('end', () => {
        req.rawBody = data;
        try {
            req.body = JSON.parse(data) as unknown;
        } catch {
            req.body = {};
        }
        next();
    });
}
