/**
 * Request ID Middleware
 *
 * Generates or propagates X-Request-ID for tracing
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';

export interface RequestWithId extends Request {
    requestId: string;
}

/**
 * Express middleware for request ID generation/propagation
 */
export function requestIdMiddleware(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
        // Use existing header or generate new UUID
        const requestId =
            (req.headers['x-request-id'] as string | undefined) ?? uuidv4();

        // Attach to request object
        (req as RequestWithId).requestId = requestId;

        // Set response header
        res.setHeader('X-Request-ID', requestId);

        next();
    };
}

/**
 * Get request ID from request object
 */
export function getRequestId(req: Request): string {
    return (req as RequestWithId).requestId ?? 'unknown';
}
