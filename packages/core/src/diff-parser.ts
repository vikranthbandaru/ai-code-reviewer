/**
 * Diff Parser - Parse unified diff format into structured data
 *
 * Handles:
 * - File additions, deletions, modifications
 * - Renames with similarity detection
 * - Binary file markers
 * - Mode changes
 * - Hunk extraction with line number mapping
 */

export interface DiffHunk {
    /** Original file start line */
    oldStart: number;
    /** Original file line count */
    oldCount: number;
    /** New file start line */
    newStart: number;
    /** New file line count */
    newCount: number;
    /** Raw hunk content including context lines */
    content: string;
    /** Added lines with their new line numbers */
    addedLines: Array<{ lineNumber: number; content: string }>;
    /** Removed lines with their old line numbers */
    removedLines: Array<{ lineNumber: number; content: string }>;
}

export interface DiffFile {
    /** Original file path (null for new files) */
    oldPath: string | null;
    /** New file path (null for deleted files) */
    newPath: string | null;
    /** Type of change */
    type: 'add' | 'delete' | 'modify' | 'rename';
    /** Is this a binary file */
    isBinary: boolean;
    /** File mode changes (e.g., 100644 -> 100755) */
    modeChange?: { old: string; new: string };
    /** Rename similarity percentage (for renames) */
    similarity?: number;
    /** Parsed hunks */
    hunks: DiffHunk[];
    /** Total lines added */
    linesAdded: number;
    /** Total lines removed */
    linesRemoved: number;
}

export interface ParsedDiff {
    /** All files in the diff */
    files: DiffFile[];
    /** Total lines added across all files */
    totalLinesAdded: number;
    /** Total lines removed across all files */
    totalLinesRemoved: number;
    /** Total files changed */
    totalFilesChanged: number;
}

const DIFF_HEADER_REGEX = /^diff --git a\/(.+) b\/(.+)$/;
const OLD_FILE_REGEX = /^--- (?:a\/)?(.+)$/;
const NEW_FILE_REGEX = /^\+\+\+ (?:b\/)?(.+)$/;
const HUNK_HEADER_REGEX = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const RENAME_FROM_REGEX = /^rename from (.+)$/;
const RENAME_TO_REGEX = /^rename to (.+)$/;
const SIMILARITY_REGEX = /^similarity index (\d+)%$/;
const BINARY_REGEX = /^Binary files .+ differ$/;
const MODE_OLD_REGEX = /^old mode (\d+)$/;
const MODE_NEW_REGEX = /^new mode (\d+)$/;
const NEW_FILE_MODE_REGEX = /^new file mode (\d+)$/;
const DELETED_FILE_MODE_REGEX = /^deleted file mode (\d+)$/;

/**
 * Parse a unified diff string into structured data
 */
export function parseDiff(diffContent: string): ParsedDiff {
    const lines = diffContent.split('\n');
    const files: DiffFile[] = [];

    let currentFile: DiffFile | null = null;
    let currentHunk: DiffHunk | null = null;
    let oldLineNum = 0;
    let newLineNum = 0;
    let hunkContent: string[] = [];

    const finalizeHunk = (): void => {
        if (currentHunk !== null && currentFile !== null) {
            currentHunk.content = hunkContent.join('\n');
            currentFile.hunks.push(currentHunk);
        }
        currentHunk = null;
        hunkContent = [];
    };

    const finalizeFile = (): void => {
        finalizeHunk();
        if (currentFile !== null) {
            files.push(currentFile);
        }
        currentFile = null;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check for diff header (new file)
        const diffMatch = DIFF_HEADER_REGEX.exec(line ?? '');
        if (diffMatch !== null) {
            finalizeFile();
            currentFile = {
                oldPath: diffMatch[1] ?? null,
                newPath: diffMatch[2] ?? null,
                type: 'modify',
                isBinary: false,
                hunks: [],
                linesAdded: 0,
                linesRemoved: 0,
            };
            continue;
        }

        if (currentFile === null) continue;

        // Check for rename
        const renameFromMatch = RENAME_FROM_REGEX.exec(line ?? '');
        if (renameFromMatch !== null) {
            currentFile.oldPath = renameFromMatch[1] ?? null;
            currentFile.type = 'rename';
            continue;
        }

        const renameToMatch = RENAME_TO_REGEX.exec(line ?? '');
        if (renameToMatch !== null) {
            currentFile.newPath = renameToMatch[1] ?? null;
            currentFile.type = 'rename';
            continue;
        }

        // Check for similarity
        const similarityMatch = SIMILARITY_REGEX.exec(line ?? '');
        if (similarityMatch !== null) {
            currentFile.similarity = parseInt(similarityMatch[1] ?? '0', 10);
            continue;
        }

        // Check for binary
        if (BINARY_REGEX.test(line ?? '')) {
            currentFile.isBinary = true;
            continue;
        }

        // Check for mode changes
        const oldModeMatch = MODE_OLD_REGEX.exec(line ?? '');
        if (oldModeMatch !== null) {
            currentFile.modeChange = { old: oldModeMatch[1] ?? '', new: '' };
            continue;
        }

        const newModeMatch = MODE_NEW_REGEX.exec(line ?? '');
        if (newModeMatch !== null) {
            if (currentFile.modeChange !== undefined) {
                currentFile.modeChange.new = newModeMatch[1] ?? '';
            }
            continue;
        }

        // Check for new file mode
        if (NEW_FILE_MODE_REGEX.test(line ?? '')) {
            currentFile.type = 'add';
            currentFile.oldPath = null;
            continue;
        }

        // Check for deleted file mode
        if (DELETED_FILE_MODE_REGEX.test(line ?? '')) {
            currentFile.type = 'delete';
            currentFile.newPath = null;
            continue;
        }

        // Check for old file path
        const oldFileMatch = OLD_FILE_REGEX.exec(line ?? '');
        if (oldFileMatch !== null) {
            const path = oldFileMatch[1];
            if (path === '/dev/null') {
                currentFile.oldPath = null;
                currentFile.type = 'add';
            } else {
                currentFile.oldPath = path ?? null;
            }
            continue;
        }

        // Check for new file path
        const newFileMatch = NEW_FILE_REGEX.exec(line ?? '');
        if (newFileMatch !== null) {
            const path = newFileMatch[1];
            if (path === '/dev/null') {
                currentFile.newPath = null;
                currentFile.type = 'delete';
            } else {
                currentFile.newPath = path ?? null;
            }
            continue;
        }

        // Check for hunk header
        const hunkMatch = HUNK_HEADER_REGEX.exec(line ?? '');
        if (hunkMatch !== null) {
            finalizeHunk();
            oldLineNum = parseInt(hunkMatch[1] ?? '0', 10);
            newLineNum = parseInt(hunkMatch[3] ?? '0', 10);
            currentHunk = {
                oldStart: oldLineNum,
                oldCount: parseInt(hunkMatch[2] ?? '1', 10),
                newStart: newLineNum,
                newCount: parseInt(hunkMatch[4] ?? '1', 10),
                content: '',
                addedLines: [],
                removedLines: [],
            };
            hunkContent.push(line ?? '');
            continue;
        }

        // Process hunk content
        if (currentHunk !== null) {
            hunkContent.push(line ?? '');

            if ((line ?? '').startsWith('+') && !(line ?? '').startsWith('+++')) {
                currentHunk.addedLines.push({
                    lineNumber: newLineNum,
                    content: (line ?? '').slice(1),
                });
                currentFile.linesAdded++;
                newLineNum++;
            } else if ((line ?? '').startsWith('-') && !(line ?? '').startsWith('---')) {
                currentHunk.removedLines.push({
                    lineNumber: oldLineNum,
                    content: (line ?? '').slice(1),
                });
                currentFile.linesRemoved++;
                oldLineNum++;
            } else if ((line ?? '').startsWith(' ') || line === '') {
                oldLineNum++;
                newLineNum++;
            }
        }
    }

    finalizeFile();

    // Calculate totals
    const totalLinesAdded = files.reduce((sum, f) => sum + f.linesAdded, 0);
    const totalLinesRemoved = files.reduce((sum, f) => sum + f.linesRemoved, 0);

    return {
        files,
        totalLinesAdded,
        totalLinesRemoved,
        totalFilesChanged: files.length,
    };
}

/**
 * Get the effective file path for a diff file
 */
export function getFilePath(file: DiffFile): string {
    return file.newPath ?? file.oldPath ?? '';
}

/**
 * Get file extension from path
 */
export function getFileExtension(filePath: string): string {
    const parts = filePath.split('.');
    return parts.length > 1 ? (parts[parts.length - 1] ?? '').toLowerCase() : '';
}

/**
 * Determine language from file extension
 */
export function getLanguageFromPath(filePath: string): string | null {
    const ext = getFileExtension(filePath);
    const extensionMap: Record<string, string> = {
        ts: 'typescript',
        tsx: 'typescript',
        js: 'javascript',
        jsx: 'javascript',
        mjs: 'javascript',
        cjs: 'javascript',
        py: 'python',
        go: 'go',
        rb: 'ruby',
        java: 'java',
        kt: 'kotlin',
        rs: 'rust',
        c: 'c',
        cpp: 'cpp',
        h: 'c',
        hpp: 'cpp',
        cs: 'csharp',
        php: 'php',
        swift: 'swift',
        scala: 'scala',
        sh: 'shell',
        bash: 'shell',
        zsh: 'shell',
        yaml: 'yaml',
        yml: 'yaml',
        json: 'json',
        md: 'markdown',
        sql: 'sql',
    };
    return extensionMap[ext] ?? null;
}
