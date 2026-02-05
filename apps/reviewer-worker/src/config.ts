/**
 * Worker Configuration
 */

import { z } from 'zod';
import fs from 'node:fs';

const ConfigSchema = z.object({
    // GitHub App configuration
    githubAppId: z.string().min(1),
    githubPrivateKey: z.string().min(1),

    // Queue configuration
    queueBackend: z.enum(['memory', 'redis']).default('memory'),
    redisUrl: z.string().optional(),

    // LLM Provider configuration
    llmProvider: z.enum(['openai', 'azure', 'vllm', 'anthropic']).default('openai'),
    openaiApiKey: z.string().optional(),
    openaiBaseUrl: z.string().optional(), // For OpenRouter or other OpenAI-compatible APIs
    openaiModel: z.string().default('gpt-4-turbo-preview'),
    openaiMaxTokens: z.number().int().positive().default(4096),
    vllmBaseUrl: z.string().optional(),
    vllmModel: z.string().optional(),
    anthropicApiKey: z.string().optional(),
    anthropicModel: z.string().default('claude-3-sonnet-20240229'),
    azureOpenaiApiKey: z.string().optional(),
    azureOpenaiEndpoint: z.string().optional(),
    azureOpenaiDeployment: z.string().optional(),

    // Review configuration
    maxInlineComments: z.number().int().positive().default(10),
    maxSummaryLength: z.number().int().positive().default(4000),
    riskThreshold: z.number().int().min(0).max(100).default(85),
    confidenceThreshold: z.number().min(0).max(1).default(0.5),

    // Static analysis tools
    enableEslint: z.boolean().default(true),
    enableSemgrep: z.boolean().default(true),
    enableRuff: z.boolean().default(true),
    enableBandit: z.boolean().default(true),
    enableGosec: z.boolean().default(true),
    enableStaticcheck: z.boolean().default(true),
    semgrepRules: z.string().default('auto'),
    semgrepTimeout: z.number().int().positive().default(300),

    // CVE scanning
    enableOsvScan: z.boolean().default(true),
    osvApiUrl: z.string().default('https://api.osv.dev'),

    // Logging
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    logJson: z.boolean().default(true),
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
});

export type WorkerConfig = z.infer<typeof ConfigSchema>;

/**
 * Load private key from file or environment variable
 */
function loadPrivateKey(): string {
    const encodedKey = process.env['GITHUB_PRIVATE_KEY'];
    if (encodedKey !== undefined && encodedKey.length > 0) {
        try {
            return Buffer.from(encodedKey, 'base64').toString('utf-8');
        } catch {
            return encodedKey;
        }
    }

    const keyPath = process.env['GITHUB_PRIVATE_KEY_PATH'];
    if (keyPath !== undefined && keyPath.length > 0) {
        return fs.readFileSync(keyPath, 'utf-8');
    }

    throw new Error('Either GITHUB_PRIVATE_KEY or GITHUB_PRIVATE_KEY_PATH must be set');
}

/**
 * Load and validate configuration
 */
export function loadWorkerConfig(): WorkerConfig {
    const rawConfig = {
        githubAppId: process.env['GITHUB_APP_ID'] ?? '',
        githubPrivateKey: loadPrivateKey(),
        queueBackend: process.env['QUEUE_BACKEND'] ?? 'memory',
        redisUrl: process.env['REDIS_URL'],
        llmProvider: process.env['LLM_PROVIDER'] ?? 'openai',
        openaiApiKey: process.env['OPENAI_API_KEY'],
        openaiBaseUrl: process.env['OPENAI_BASE_URL'], // For OpenRouter: https://openrouter.ai/api/v1
        openaiModel: process.env['OPENAI_MODEL'] ?? 'gpt-4-turbo-preview',
        openaiMaxTokens: parseInt(process.env['OPENAI_MAX_TOKENS'] ?? '4096', 10),
        vllmBaseUrl: process.env['VLLM_BASE_URL'],
        vllmModel: process.env['VLLM_MODEL'],
        anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
        anthropicModel: process.env['ANTHROPIC_MODEL'] ?? 'claude-3-sonnet-20240229',
        azureOpenaiApiKey: process.env['AZURE_OPENAI_API_KEY'],
        azureOpenaiEndpoint: process.env['AZURE_OPENAI_ENDPOINT'],
        azureOpenaiDeployment: process.env['AZURE_OPENAI_DEPLOYMENT'],
        maxInlineComments: parseInt(process.env['MAX_INLINE_COMMENTS'] ?? '10', 10),
        maxSummaryLength: parseInt(process.env['MAX_SUMMARY_LENGTH'] ?? '4000', 10),
        riskThreshold: parseInt(process.env['RISK_THRESHOLD'] ?? '85', 10),
        confidenceThreshold: parseFloat(process.env['CONFIDENCE_THRESHOLD'] ?? '0.5'),
        enableEslint: process.env['ENABLE_ESLINT'] !== 'false',
        enableSemgrep: process.env['ENABLE_SEMGREP'] !== 'false',
        enableRuff: process.env['ENABLE_RUFF'] !== 'false',
        enableBandit: process.env['ENABLE_BANDIT'] !== 'false',
        enableGosec: process.env['ENABLE_GOSEC'] !== 'false',
        enableStaticcheck: process.env['ENABLE_STATICCHECK'] !== 'false',
        semgrepRules: process.env['SEMGREP_RULES'] ?? 'auto',
        semgrepTimeout: parseInt(process.env['SEMGREP_TIMEOUT'] ?? '300', 10),
        enableOsvScan: process.env['ENABLE_OSV_SCAN'] !== 'false',
        osvApiUrl: process.env['OSV_API_URL'] ?? 'https://api.osv.dev',
        logLevel: process.env['LOG_LEVEL'] ?? 'info',
        logJson: process.env['LOG_JSON'] !== 'false',
        nodeEnv: process.env['NODE_ENV'] ?? 'development',
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
