/* ══════════════════════════════════════════════════════════════════════════
   NestJS Project Analyzer — File Scanner Utilities
   ══════════════════════════════════════════════════════════════════════════ */

import * as fs from 'fs';
import * as path from 'path';

export interface SourceFile {
  path: string; // absolute path
  relative: string; // relative to src
  content: string;
  lines: string[];
  lineCount: number;
}

/**
 * Recursively scan a directory for TypeScript files.
 */
export function scanDirectory(dir: string, baseDir: string, exclude: string[] = []): SourceFile[] {
  const results: SourceFile[] = [];

  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (exclude.some((ex) => entry.name === ex || fullPath.includes(ex))) continue;

    if (entry.isDirectory()) {
      results.push(...scanDirectory(fullPath, baseDir, exclude));
    } else if (entry.isFile() && /\.ts$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      results.push({
        path: fullPath,
        relative: path.relative(baseDir, fullPath).replace(/\\/g, '/'),
        content,
        lines,
        lineCount: lines.length,
      });
    }
  }

  return results;
}

/**
 * Read a single file safely.
 */
export function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Find line number of a pattern match in content.
 */
export function findLineNumber(content: string, pattern: RegExp): number {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) return i + 1;
  }
  return 0;
}

/**
 * Count matches of a pattern in content.
 */
export function countMatches(content: string, pattern: RegExp): number {
  const matches = content.match(
    new RegExp(pattern.source, 'g' + (pattern.flags.includes('i') ? 'i' : '')),
  );
  return matches ? matches.length : 0;
}

/**
 * Extract all regex matches with line numbers.
 */
export function findAllMatches(
  content: string,
  pattern: RegExp,
): { match: string; line: number; index: number }[] {
  const results: { match: string; line: number; index: number }[] = [];
  const lines = content.split('\n');
  const globalPattern = new RegExp(pattern.source, 'g' + pattern.flags.replace('g', ''));

  for (let i = 0; i < lines.length; i++) {
    let m: RegExpExecArray | null;
    globalPattern.lastIndex = 0;
    while ((m = globalPattern.exec(lines[i])) !== null) {
      results.push({ match: m[0], line: i + 1, index: m.index });
    }
  }

  return results;
}
