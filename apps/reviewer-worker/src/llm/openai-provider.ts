/**
 * OpenAI LLM Provider
 *
 * Supports OpenAI and Azure OpenAI endpoints
 */

import OpenAI from 'openai';
import { IssueSchema, type Issue } from '@ai-reviewer/core';

import type { WorkerConfig } from '../config.js';
import type { LLMProvider, LLMAnalysisInput, LLMAnalysisResult } from './provider.js';
import {
    SYSTEM_PROMPT,
    ISSUE_JSON_SCHEMA,
    buildUserPrompt,
    validateLLMOutput,
    extractJsonFromResponse,
} from './prompts.js';

export class OpenAIProvider implements LLMProvider {
    name = 'openai';

    async analyze(input: LLMAnalysisInput, config: WorkerConfig): Promise<LLMAnalysisResult> {
        const client = this.createClient(config);
        const model = config.llmProvider === 'azure'
            ? (config.azureOpenaiDeployment ?? 'gpt-4')
            : config.openaiModel;

        const userPrompt = buildUserPrompt(
            input.chunk,
            input.prTitle,
            input.prBody,
            input.context
        );

        const response = await client.chat.completions.create({
            model,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
            ],
            max_tokens: config.openaiMaxTokens,
            temperature: 0.1,
            response_format: { type: 'json_object' },
        });

        const content = response.choices[0]?.message?.content ?? '{"issues":[]}';
        const tokensUsed = response.usage?.total_tokens ?? 0;

        // Parse and validate response
        const issues = this.parseResponse(content, input.chunk.filePaths);

        return {
            issues,
            model,
            tokensUsed,
        };
    }

    private createClient(config: WorkerConfig): OpenAI {
        if (config.llmProvider === 'azure') {
            return new OpenAI({
                apiKey: config.azureOpenaiApiKey,
                baseURL: `${config.azureOpenaiEndpoint}/openai/deployments/${config.azureOpenaiDeployment}`,
                defaultQuery: { 'api-version': '2024-02-15-preview' },
                defaultHeaders: { 'api-key': config.azureOpenaiApiKey },
            });
        }

        // Support OpenRouter and other OpenAI-compatible APIs via custom base URL
        return new OpenAI({
            apiKey: config.openaiApiKey,
            baseURL: config.openaiBaseUrl, // undefined uses default OpenAI URL
            defaultHeaders: config.openaiBaseUrl?.includes('openrouter.ai')
                ? {
                    'HTTP-Referer': 'https://github.com/ai-code-reviewer',
                    'X-Title': 'AI Code Reviewer',
                }
                : undefined,
        });
    }

    private parseResponse(content: string, validPaths: string[]): Issue[] {
        try {
            const jsonStr = extractJsonFromResponse(content);
            const parsed = JSON.parse(jsonStr) as unknown;

            if (!validateLLMOutput(parsed)) {
                return [];
            }

            const issues: Issue[] = [];
            for (const item of parsed.issues) {
                // Validate with Zod and add LLM-specific fields
                const result = IssueSchema.safeParse({
                    ...item,
                    id: crypto.randomUUID(),
                    source_tool: 'llm',
                    is_llm_generated: true,
                });

                if (result.success) {
                    // Only include if file path is in the chunk
                    if (validPaths.some((p) => result.data.file_path.includes(p) || p.includes(result.data.file_path))) {
                        issues.push(result.data);
                    }
                }
            }

            return issues;
        } catch {
            return [];
        }
    }
}
