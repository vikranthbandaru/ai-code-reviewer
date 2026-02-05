import { describe, it, expect } from 'vitest';

import { parseDiff, getFilePath, getLanguageFromPath } from '../diff-parser.js';

const SAMPLE_DIFF = `diff --git a/src/utils.ts b/src/utils.ts
index 1234567..abcdefg 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -10,6 +10,8 @@ export function helper() {
   const a = 1;
   const b = 2;
+  const c = 3;
+  const d = 4;
   return a + b;
 }
 
@@ -20,4 +22,3 @@ export function another() {
   console.log("hello");
-  console.log("removed");
 }
`;

const NEW_FILE_DIFF = `diff --git a/src/new-file.ts b/src/new-file.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/new-file.ts
@@ -0,0 +1,5 @@
+export function newFunction() {
+  return 'new';
+}
+
+export const VALUE = 42;
`;

const DELETED_FILE_DIFF = `diff --git a/src/old-file.ts b/src/old-file.ts
deleted file mode 100644
index 1234567..0000000
--- a/src/old-file.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function oldFunction() {
-  return 'old';
-}
`;

const RENAME_DIFF = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 95%
rename from src/old-name.ts
rename to src/new-name.ts
index 1234567..abcdefg 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,3 +1,3 @@
 export function myFunction() {
-  return 'old';
+  return 'new';
 }
`;

const BINARY_DIFF = `diff --git a/assets/logo.png b/assets/logo.png
new file mode 100644
index 0000000..1234567
Binary files /dev/null and b/assets/logo.png differ
`;

describe('parseDiff', () => {
    it('should parse a simple modification diff', () => {
        const result = parseDiff(SAMPLE_DIFF);

        expect(result.files).toHaveLength(1);
        expect(result.totalFilesChanged).toBe(1);

        const file = result.files[0]!;
        expect(file.type).toBe('modify');
        expect(file.oldPath).toBe('src/utils.ts');
        expect(file.newPath).toBe('src/utils.ts');
        expect(file.isBinary).toBe(false);
        expect(file.linesAdded).toBe(2);
        expect(file.linesRemoved).toBe(1);
        expect(file.hunks).toHaveLength(2);
    });

    it('should parse a new file diff', () => {
        const result = parseDiff(NEW_FILE_DIFF);

        expect(result.files).toHaveLength(1);

        const file = result.files[0]!;
        expect(file.type).toBe('add');
        expect(file.oldPath).toBeNull();
        expect(file.newPath).toBe('src/new-file.ts');
        expect(file.linesAdded).toBe(5);
        expect(file.linesRemoved).toBe(0);
    });

    it('should parse a deleted file diff', () => {
        const result = parseDiff(DELETED_FILE_DIFF);

        expect(result.files).toHaveLength(1);

        const file = result.files[0]!;
        expect(file.type).toBe('delete');
        expect(file.oldPath).toBe('src/old-file.ts');
        expect(file.newPath).toBeNull();
        expect(file.linesAdded).toBe(0);
        expect(file.linesRemoved).toBe(3);
    });

    it('should parse a rename diff with similarity', () => {
        const result = parseDiff(RENAME_DIFF);

        expect(result.files).toHaveLength(1);

        const file = result.files[0]!;
        expect(file.type).toBe('rename');
        expect(file.oldPath).toBe('src/old-name.ts');
        expect(file.newPath).toBe('src/new-name.ts');
        expect(file.similarity).toBe(95);
    });

    it('should parse a binary file diff', () => {
        const result = parseDiff(BINARY_DIFF);

        expect(result.files).toHaveLength(1);

        const file = result.files[0]!;
        expect(file.isBinary).toBe(true);
        expect(file.type).toBe('add');
    });

    it('should parse multiple files', () => {
        const multiDiff = SAMPLE_DIFF + '\n' + NEW_FILE_DIFF;
        const result = parseDiff(multiDiff);

        expect(result.files).toHaveLength(2);
        expect(result.totalFilesChanged).toBe(2);
    });

    it('should extract hunk line numbers correctly', () => {
        const result = parseDiff(SAMPLE_DIFF);
        const file = result.files[0]!;
        const hunk = file.hunks[0]!;

        expect(hunk.oldStart).toBe(10);
        expect(hunk.newStart).toBe(10);
        expect(hunk.addedLines.length).toBe(2);
        expect(hunk.addedLines[0]!.lineNumber).toBe(12);
        expect(hunk.addedLines[0]!.content).toBe('  const c = 3;');
    });
});

describe('getFilePath', () => {
    it('should return newPath for modifications', () => {
        const file = {
            oldPath: 'old.ts',
            newPath: 'new.ts',
            type: 'modify' as const,
            isBinary: false,
            hunks: [],
            linesAdded: 0,
            linesRemoved: 0,
        };
        expect(getFilePath(file)).toBe('new.ts');
    });

    it('should return oldPath for deletions', () => {
        const file = {
            oldPath: 'deleted.ts',
            newPath: null,
            type: 'delete' as const,
            isBinary: false,
            hunks: [],
            linesAdded: 0,
            linesRemoved: 0,
        };
        expect(getFilePath(file)).toBe('deleted.ts');
    });
});

describe('getLanguageFromPath', () => {
    it('should detect TypeScript files', () => {
        expect(getLanguageFromPath('src/utils.ts')).toBe('typescript');
        expect(getLanguageFromPath('src/App.tsx')).toBe('typescript');
    });

    it('should detect JavaScript files', () => {
        expect(getLanguageFromPath('index.js')).toBe('javascript');
        expect(getLanguageFromPath('config.mjs')).toBe('javascript');
    });

    it('should detect Python files', () => {
        expect(getLanguageFromPath('main.py')).toBe('python');
    });

    it('should detect Go files', () => {
        expect(getLanguageFromPath('main.go')).toBe('go');
    });

    it('should return null for unknown extensions', () => {
        expect(getLanguageFromPath('Makefile')).toBeNull();
    });
});
