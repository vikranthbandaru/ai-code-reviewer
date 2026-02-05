/**
 * Configuration management for the webhook server
 */

import { z } from 'zod';
import fs from 'node:fs';

const ConfigSchema = z.object({
    // GitHub App configuration
    githubAppId: z.string().min(1, 'GITHUB_APP_ID is required'),
    githubPrivateKey: z.string().min(1, 'GitHub private key is required'),
    githubWebhookSecret: z.string().min(1, 'GITHUB_WEBHOOK_SECRET is required'),

    // Server configuration
    port: z.number().int().positive().default(3000),
    host: z.string().default('0.0.0.0'),
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

    // Queue configuration
    queueBackend: z.enum(['memory', 'redis']).default('memory'),
    redisUrl: z.string().optional(),

    // Logging
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    logJson: z.boolean().default(true),

    // Tracing
    enableTracing: z.boolean().default(false),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Load private key from file or environment variable
 */
function loadPrivateKey(): string {
    // Check for base64-encoded key in env
    const encodedKey = process.env['GITHUB_PRIVATE_KEY'];
    if (encodedKey !== undefined && encodedKey.length > 0) {
        try {
            return Buffer.from(encodedKey, 'base64').toString('utf-8');
        } catch {
            // Not base64, use as-is
            return encodedKey;
        }
    }

    // Check for key file path
    const keyPath = process.env['GITHUB_PRIVATE_KEY_PATH'];
    if (keyPath !== undefined && keyPath.length > 0) {
        try {
            return fs.readFileSync(keyPath, 'utf-8');
        } catch (err) {
            throw new Error(`Failed to read private key file: ${keyPath}`);
        }
    }

    throw new Error('Either GITHUB_PRIVATE_KEY or GITHUB_PRIVATE_KEY_PATH must be set');
}

/**
 * Load and validate configuration from environment
 */
export function loadConfig(): Config {
    const rawConfig = {
        githubAppId: process.env['GITHUB_APP_ID'] ?? '',
        githubPrivateKey: loadPrivateKey(),
        githubWebhookSecret: process.env['GITHUB_WEBHOOK_SECRET'] ?? '',
        port: parseInt(process.env['PORT'] ?? '3000', 10),
        host: process.env['HOST'] ?? '0.0.0.0',
        nodeEnv: process.env['NODE_ENV'] ?? 'development',
        queueBackend: process.env['QUEUE_BACKEND'] ?? 'memory',
        redisUrl: process.env['REDIS_URL'],
        logLevel: process.env['LOG_LEVEL'] ?? 'info',
        logJson: process.env['LOG_JSON'] !== 'false',
        enableTracing: process.env['ENABLE_TRACING'] === 'true',
    };

    const result = ConfigSchema.safeParse(rawConfig);

    if (!result.success) {
        const errors = result.error.errors
            .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
            .join('\n');
        throw new Error(`Configuration validation failed:\n${errors}`);
    }

    return result.data;
}

/**
 * Validate that required config is present for startup
 */
export function validateStartupConfig(config: Config): void {
    // In production, require Redis for queue
    if (config.nodeEnv === 'production' && config.queueBackend === 'redis') {
        if (config.redisUrl === undefined || config.redisUrl.length === 0) {
            throw new Error('REDIS_URL is required when QUEUE_BACKEND=redis');
        }
    }
}
