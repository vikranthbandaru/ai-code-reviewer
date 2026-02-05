/**
 * Anthropic Claude Provider
 */

import { IssueSchema, type Issue } from '@ai-reviewer/core';

import type { WorkerConfig } from '../config.js';
import type { LLMProvider, LLMAnalysisInput, LLMAnalysisResult } from './provider.js';
import {
    SYSTEM_PROMPT,
    buildUserPrompt,
    validateLLMOutput,
    extractJsonFromResponse,
} from './prompts.js';

interface AnthropicResponse {
    content: Array<{ type: 'text'; text: string }>;
    usage?: { input_tokens: number; output_tokens: number };
}

export class AnthropicProvider implements LLMProvider {
    name = 'anthropic';

    async analyze(input: LLMAnalysisInput, config: WorkerConfig): Promise<LLMAnalysisResult> {
        const model = config.anthropicModel;

        const userPrompt = buildUserPrompt(
            input.chunk,
            input.prTitle,
            input.prBody,
            input.context
        );

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.anthropicApiKey ?? '',
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model,
                max_tokens: config.openaiMaxTokens,
                system: SYSTEM_PROMPT,
                messages: [{ role: 'user', content: userPrompt }],
            }),
        });

        if (!response.ok) {
            throw new Error(`Anthropic request failed: ${response.status}`);
        }

        const data = (await response.json()) as AnthropicResponse;
        const content = data.content[0]?.text ?? '{"issues":[]}';
        const tokensUsed = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);

        const issues = this.parseResponse(content, input.chunk.filePaths);

        return {
            issues,
            model,
            tokensUsed,
        };
    }

    private parseResponse(content: string, validPaths: string[]): Issue[] {
        try {
            const jsonStr = extractJsonFromResponse(content);
            const parsed = JSON.parse(jsonStr) as unknown;

            if (!validateLLMOutput(parsed)) return [];

            const issues: Issue[] = [];
            for (const item of parsed.issues) {
                const result = IssueSchema.safeParse({
                    ...item,
                    id: crypto.randomUUID(),
                    source_tool: 'llm-claude',
                    is_llm_generated: true,
                });

                if (result.success) {
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
