/**
 * Structured logging with Pino
 */

import pino from 'pino';

import type { Config } from '../config.js';

export interface LogContext {
    requestId?: string;
    repo?: string;
    prNumber?: number;
    installationId?: number;
    [key: string]: unknown;
}

let logger: pino.Logger;

/**
 * Initialize the logger with configuration
 */
export function initLogger(config: Config): pino.Logger {
    logger = pino({
        level: config.logLevel,
        transport: config.nodeEnv === 'development' && !config.logJson
            ? {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                },
            }
            : undefined,
        base: {
            service: 'webhook-server',
            env: config.nodeEnv,
        },
        formatters: {
            level: (label) => ({ level: label }),
        },
    });

    return logger;
}

/**
 * Get the logger instance
 */
export function getLogger(): pino.Logger {
    if (logger === undefined) {
        // Create a default logger if not initialized
        logger = pino({ level: 'info' });
    }
    return logger;
}

/**
 * Create a child logger with context
 */
export function createChildLogger(context: LogContext): pino.Logger {
    return getLogger().child(context);
}

/**
 * Log with request context
 */
export function logWithContext(
    level: 'debug' | 'info' | 'warn' | 'error',
    context: LogContext,
    message: string,
    data?: Record<string, unknown>
): void {
    const child = createChildLogger(context);
    child[level](data ?? {}, message);
}

/**
 * Log a webhook event
 */
export function logWebhookEvent(
    event: string,
    action: string | undefined,
    context: LogContext
): void {
    logWithContext('info', context, `Received webhook: ${event}${action !== undefined ? `.${action}` : ''}`, {
        event,
        action,
    });
}

/**
 * Log a job enqueue
 */
export function logJobEnqueue(
    jobId: string,
    context: LogContext
): void {
    logWithContext('info', context, `Enqueued review job`, {
        jobId,
    });
}

/**
 * Log an error with context
 */
export function logError(
    error: Error,
    context: LogContext,
    message?: string
): void {
    logWithContext('error', context, message ?? error.message, {
        error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
        },
    });
}
