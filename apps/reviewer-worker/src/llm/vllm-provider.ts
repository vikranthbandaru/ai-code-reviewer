/**
 * Local vLLM Provider
 *
 * Uses OpenAI-compatible API for local vLLM deployment
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

interface VLLMChatResponse {
    choices: Array<{
        message: { content: string };
    }>;
    usage?: { total_tokens: number };
}

export class VLLMProvider implements LLMProvider {
    name = 'vllm';

    async analyze(input: LLMAnalysisInput, config: WorkerConfig): Promise<LLMAnalysisResult> {
        const baseUrl = config.vllmBaseUrl ?? 'http://localhost:8000';
        const model = config.vllmModel ?? 'default';

        const userPrompt = buildUserPrompt(
            input.chunk,
            input.prTitle,
            input.prBody,
            input.context
        );

        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt },
                ],
                max_tokens: config.openaiMaxTokens,
                temperature: 0.1,
            }),
        });

        if (!response.ok) {
            throw new Error(`vLLM request failed: ${response.status}`);
        }

        const data = (await response.json()) as VLLMChatResponse;
        const content = data.choices[0]?.message?.content ?? '{"issues":[]}';
        const tokensUsed = data.usage?.total_tokens ?? 0;

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

            if (!validateLLMOutput(parsed)) {
                return [];
            }

            const issues: Issue[] = [];
            for (const item of parsed.issues) {
                const result = IssueSchema.safeParse({
                    ...item,
                    id: crypto.randomUUID(),
                    source_tool: 'llm-vllm',
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
