/**
 * File Filters - Filter out generated, vendor, and non-reviewable files
 *
 * Features:
 * - Skip generated files (*.generated.*, dist/, build/)
 * - Skip vendor directories
 * - Skip lockfiles (except for dependency risk analysis)
 * - Configurable include/exclude patterns
 */

import type { DiffFile } from './diff-parser.js';
import { getFilePath } from './diff-parser.js';

export interface FilterConfig {
    /** Patterns to exclude (glob-like) */
    excludePatterns: string[];
    /** Patterns to include (overrides excludes) */
    includePatterns: string[];
    /** Skip binary files */
    skipBinary: boolean;
    /** Skip files larger than this many lines */
    maxLines: number;
    /** Allow lockfiles for dependency analysis only */
    allowLockfilesForDeps: boolean;
}

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
    excludePatterns: [
        // Generated files
        '*.generated.*',
        '*.gen.*',
        '*_generated.*',
        '*.pb.go',
        '*.pb.ts',

        // Build outputs
        'dist/**',
        'build/**',
        'out/**',
        '.next/**',
        '.nuxt/**',

        // Dependencies
        'node_modules/**',
        'vendor/**',
        'third_party/**',
        '.vendor/**',

        // Lockfiles (handled separately for dep analysis)
        'package-lock.json',
        'pnpm-lock.yaml',
        'yarn.lock',
        'poetry.lock',
        'Pipfile.lock',
        'go.sum',
        'Cargo.lock',
        'Gemfile.lock',
        'composer.lock',

        // IDE and config
        '.idea/**',
        '.vscode/**',
        '*.min.js',
        '*.min.css',
        '*.bundle.js',
        '*.bundle.css',

        // Assets
        '*.svg',
        '*.png',
        '*.jpg',
        '*.jpeg',
        '*.gif',
        '*.ico',
        '*.woff',
        '*.woff2',
        '*.ttf',
        '*.eot',

        // Documentation (may want to review separately)
        'CHANGELOG.md',
        'CHANGELOG',
    ],
    includePatterns: [],
    skipBinary: true,
    maxLines: 1000,
    allowLockfilesForDeps: true,
};

/**
 * Lockfile patterns for separate handling
 */
export const LOCKFILE_PATTERNS = [
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'poetry.lock',
    'Pipfile.lock',
    'go.sum',
    'Cargo.lock',
    'Gemfile.lock',
    'composer.lock',
];

/**
 * Match a path against a glob-like pattern
 */
function matchPattern(path: string, pattern: string): boolean {
    // Normalize path separators
    const normalizedPath = path.replace(/\\/g, '/');

    // Convert glob pattern to regex
    let regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '{{GLOBSTAR}}')
        .replace(/\*/g, '[^/]*')
        .replace(/{{GLOBSTAR}}/g, '.*')
        .replace(/\?/g, '.');

    // Make pattern match anywhere in path if it doesn't start with **
    if (!pattern.startsWith('**') && !pattern.startsWith('/')) {
        regexPattern = `(^|/)${regexPattern}`;
    }

    // Make pattern match end of path
    regexPattern = `${regexPattern}$`;

    try {
        const regex = new RegExp(regexPattern, 'i');
        return regex.test(normalizedPath);
    } catch {
        return false;
    }
}

/**
 * Check if a file should be excluded
 */
export function shouldExcludeFile(
    file: DiffFile,
    config: Partial<FilterConfig> = {}
): boolean {
    const cfg = { ...DEFAULT_FILTER_CONFIG, ...config };
    const path = getFilePath(file);

    if (path === '') return true;

    // Check binary files
    if (cfg.skipBinary && file.isBinary) {
        return true;
    }

    // Check line limit
    if (file.linesAdded + file.linesRemoved > cfg.maxLines) {
        return true;
    }

    // Check include patterns first (they override excludes)
    for (const pattern of cfg.includePatterns) {
        if (matchPattern(path, pattern)) {
            return false;
        }
    }

    // Check exclude patterns
    for (const pattern of cfg.excludePatterns) {
        if (matchPattern(path, pattern)) {
            return true;
        }
    }

    return false;
}

/**
 * Check if a file is a lockfile
 */
export function isLockfile(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const filename = normalizedPath.split('/').pop() ?? '';
    return LOCKFILE_PATTERNS.includes(filename);
}

/**
 * Filter an array of diff files
 */
export function filterDiffFiles(
    files: DiffFile[],
    config: Partial<FilterConfig> = {}
): DiffFile[] {
    return files.filter((file) => !shouldExcludeFile(file, config));
}

/**
 * Get lockfiles from diff for dependency analysis
 */
export function getLockfiles(files: DiffFile[]): DiffFile[] {
    return files.filter((file) => {
        const path = getFilePath(file);
        return isLockfile(path);
    });
}

/**
 * Categorize files for different review strategies
 */
export interface CategorizedFiles {
    /** Regular source files to review */
    sourceFiles: DiffFile[];
    /** Lockfiles for dependency scanning */
    lockfiles: DiffFile[];
    /** Files excluded from review */
    excluded: DiffFile[];
}

export function categorizeFiles(
    files: DiffFile[],
    config: Partial<FilterConfig> = {}
): CategorizedFiles {
    const cfg = { ...DEFAULT_FILTER_CONFIG, ...config };
    const result: CategorizedFiles = {
        sourceFiles: [],
        lockfiles: [],
        excluded: [],
    };

    for (const file of files) {
        const path = getFilePath(file);

        if (isLockfile(path)) {
            if (cfg.allowLockfilesForDeps) {
                result.lockfiles.push(file);
            } else {
                result.excluded.push(file);
            }
        } else if (shouldExcludeFile(file, config)) {
            result.excluded.push(file);
        } else {
            result.sourceFiles.push(file);
        }
    }

    return result;
}

/**
 * Get file type category for stats
 */
export function getFileCategory(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';

    const categories: Record<string, string[]> = {
        'typescript': ['ts', 'tsx'],
        'javascript': ['js', 'jsx', 'mjs', 'cjs'],
        'python': ['py', 'pyi'],
        'go': ['go'],
        'rust': ['rs'],
        'java': ['java'],
        'config': ['json', 'yaml', 'yml', 'toml', 'ini', 'env'],
        'markdown': ['md', 'mdx'],
        'css': ['css', 'scss', 'sass', 'less'],
        'html': ['html', 'htm'],
    };

    for (const [category, extensions] of Object.entries(categories)) {
        if (extensions.includes(ext)) {
            return category;
        }
    }

    return 'other';
}
