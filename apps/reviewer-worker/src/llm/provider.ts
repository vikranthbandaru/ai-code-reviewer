/**
 * LLM Provider Interface
 *
 * Abstraction for different LLM backends
 */

import type { Issue } from '@ai-reviewer/core';
import type { DiffChunk } from '@ai-reviewer/core';

import type { WorkerConfig } from '../config.js';

export interface LLMAnalysisInput {
    chunk: DiffChunk;
    context: string;
    prTitle: string;
    prBody: string | null;
}

export interface LLMAnalysisResult {
    issues: Issue[];
    model: string;
    tokensUsed: number;
}

export interface LLMProvider {
    name: string;
    analyze(input: LLMAnalysisInput, config: WorkerConfig): Promise<LLMAnalysisResult>;
}

/**
 * Get the LLM provider based on config
 */
export async function getLLMProvider(config: WorkerConfig): Promise<LLMProvider> {
    switch (config.llmProvider) {
        case 'openai':
        case 'azure': {
            const { OpenAIProvider } = await import('./openai-provider.js');
            return new OpenAIProvider();
        }
        case 'vllm': {
            const { VLLMProvider } = await import('./vllm-provider.js');
            return new VLLMProvider();
        }
        case 'anthropic': {
            const { AnthropicProvider } = await import('./anthropic-provider.js');
            return new AnthropicProvider();
        }
        default:
            throw new Error(`Unknown LLM provider: ${config.llmProvider}`);
    }
}
