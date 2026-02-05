/**
 * Chunker - Split large diffs into LLM-friendly chunks
 *
 * Features:
 * - Configurable chunk size and overlap
 * - Respects file boundaries
 * - Tries to keep related hunks together
 * - Provides context for each chunk
 */

import type { DiffFile, ParsedDiff } from './diff-parser.js';
import { getFilePath } from './diff-parser.js';

export interface ChunkConfig {
    /** Maximum tokens per chunk (approximate) */
    maxTokens: number;
    /** Overlap tokens between chunks for context */
    overlapTokens: number;
    /** Maximum files per chunk */
    maxFilesPerChunk: number;
    /** Whether to keep all hunks of a file together */
    keepFilesTogether: boolean;
}

export const DEFAULT_CHUNK_CONFIG: ChunkConfig = {
    maxTokens: 4000,
    overlapTokens: 200,
    maxFilesPerChunk: 5,
    keepFilesTogether: true,
};

export interface DiffChunk {
    /** Chunk index (0-based) */
    index: number;
    /** Total number of chunks */
    totalChunks: number;
    /** Files included in this chunk */
    files: DiffFile[];
    /** File paths for quick reference */
    filePaths: string[];
    /** Formatted content for LLM consumption */
    content: string;
    /** Estimated token count */
    estimatedTokens: number;
    /** Languages detected in this chunk */
    languages: string[];
}

/**
 * Estimate token count for a string (rough approximation)
 * Uses a heuristic of ~4 characters per token for code
 */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Format a diff file for LLM consumption
 */
export function formatDiffFileForLLM(file: DiffFile): string {
    const path = getFilePath(file);
    const lines: string[] = [];

    lines.push(`## File: ${path}`);
    lines.push(`Type: ${file.type} | +${file.linesAdded} -${file.linesRemoved}`);

    if (file.isBinary) {
        lines.push('(Binary file)');
        return lines.join('\n');
    }

    if (file.type === 'rename' && file.similarity !== undefined) {
        lines.push(`Renamed from: ${file.oldPath ?? 'unknown'} (${file.similarity}% similar)`);
    }

    lines.push('```diff');
    for (const hunk of file.hunks) {
        lines.push(hunk.content);
    }
    lines.push('```');

    return lines.join('\n');
}

/**
 * Split a parsed diff into chunks for LLM processing
 */
export function chunkDiff(diff: ParsedDiff, config: Partial<ChunkConfig> = {}): DiffChunk[] {
    const cfg = { ...DEFAULT_CHUNK_CONFIG, ...config };
    const chunks: DiffChunk[] = [];

    if (diff.files.length === 0) {
        return [];
    }

    let currentFiles: DiffFile[] = [];
    let currentContent: string[] = [];
    let currentTokens = 0;

    const createChunk = (): void => {
        if (currentFiles.length === 0) return;

        const content = currentContent.join('\n\n');
        const languages = new Set<string>();

        for (const file of currentFiles) {
            const lang = detectLanguage(getFilePath(file));
            if (lang !== null) {
                languages.add(lang);
            }
        }

        chunks.push({
            index: chunks.length,
            totalChunks: 0, // Will be updated after all chunks are created
            files: [...currentFiles],
            filePaths: currentFiles.map(getFilePath),
            content,
            estimatedTokens: estimateTokens(content),
            languages: Array.from(languages),
        });

        currentFiles = [];
        currentContent = [];
        currentTokens = 0;
    };

    for (const file of diff.files) {
        const fileContent = formatDiffFileForLLM(file);
        const fileTokens = estimateTokens(fileContent);

        // If this single file exceeds max tokens, we still include it (can't split further)
        // but make it its own chunk
        if (fileTokens > cfg.maxTokens && currentFiles.length > 0) {
            createChunk();
        }

        // Check if adding this file would exceed limits
        const wouldExceedTokens = currentTokens + fileTokens > cfg.maxTokens;
        const wouldExceedFiles = currentFiles.length >= cfg.maxFilesPerChunk;

        if (wouldExceedTokens || wouldExceedFiles) {
            createChunk();
        }

        currentFiles.push(file);
        currentContent.push(fileContent);
        currentTokens += fileTokens;
    }

    // Create final chunk
    createChunk();

    // Update total chunks count
    for (const chunk of chunks) {
        chunk.totalChunks = chunks.length;
    }

    return chunks;
}

/**
 * Detect programming language from file path
 */
function detectLanguage(filePath: string): string | null {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
        ts: 'typescript',
        tsx: 'typescript',
        js: 'javascript',
        jsx: 'javascript',
        py: 'python',
        go: 'go',
        rs: 'rust',
        java: 'java',
        rb: 'ruby',
        php: 'php',
        cs: 'csharp',
        cpp: 'cpp',
        c: 'c',
        swift: 'swift',
        kt: 'kotlin',
    };
    return ext !== undefined ? (langMap[ext] ?? null) : null;
}

/**
 * Create a summary header for a chunk
 */
export function createChunkHeader(chunk: DiffChunk): string {
    const lines = [
        `# Code Review Chunk ${chunk.index + 1}/${chunk.totalChunks}`,
        `Files: ${chunk.filePaths.join(', ')}`,
        `Languages: ${chunk.languages.length > 0 ? chunk.languages.join(', ') : 'unknown'}`,
        '',
    ];
    return lines.join('\n');
}

/**
 * Get the full content with header for LLM input
 */
export function getChunkWithHeader(chunk: DiffChunk): string {
    return createChunkHeader(chunk) + chunk.content;
}
