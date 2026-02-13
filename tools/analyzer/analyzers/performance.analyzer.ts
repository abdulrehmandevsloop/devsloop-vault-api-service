/* ══════════════════════════════════════════════════════════════════════════
   Performance Analyzer — N+1 queries, missing selects, caching, async
   ══════════════════════════════════════════════════════════════════════════ */

import { findAllMatches, type SourceFile } from '../scanner';
import type { Finding, AnalyzerConfig } from '../types';

export function analyzePerformance(files: SourceFile[], _config: AnalyzerConfig) {
  const findings: Finding[] = [];

  const serviceFiles = files.filter(
    (f) => f.relative.endsWith('.service.ts') || f.relative.endsWith('.processor.ts'),
  );

  for (const file of serviceFiles) {
    // ── N+1 detection: loop + query inside (brace-depth aware) ──────
    // Only flag DB calls that are actually inside the loop body, not
    // queries that happen to be within a flat line-window after the loop.
    const loopStartPatterns = [/for\s*\(.*\)\s*\{/, /for\s*\(.*of\s.*\)\s*\{/, /for\s+await\s*\(/];

    const lines = file.lines;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isLoop = loopStartPatterns.some((p) => p.test(line));

      if (isLoop) {
        // Walk forward tracking brace depth to find the loop body extent
        let depth = 0;
        const bodyStart = i;
        let bodyEnd = Math.min(i + 50, lines.length); // safety cap
        let foundOpen = false;

        for (let j = i; j < Math.min(i + 80, lines.length); j++) {
          for (const ch of lines[j]) {
            if (ch === '{') {
              depth++;
              foundOpen = true;
            }
            if (ch === '}') {
              depth--;
            }
          }
          if (foundOpen && depth <= 0) {
            bodyEnd = j + 1;
            break;
          }
        }

        const loopBody = lines.slice(bodyStart, bodyEnd).join('\n');

        const dbCallPatterns = [
          /prisma\.\w+\.(findUnique|findFirst|findMany|count|create|update|delete)\(/,
          /\$queryRaw/,
        ];

        for (const dbPattern of dbCallPatterns) {
          if (dbPattern.test(loopBody)) {
            findings.push({
              id: `perf-n-plus-1-${file.relative}-${i}`,
              category: 'performance',
              severity: 'high',
              title: 'Potential N+1 query pattern',
              description: `Database call inside loop detected in ${file.relative}. This causes N+1 queries.`,
              file: file.relative,
              line: i + 1,
              recommendation:
                'Batch queries using findMany with "in" filter, or use Promise.all outside the loop.',
            });
            break;
          }
        }
      }
    }

    // ── findMany without select ──────────────────────────────────────
    const findManyMatches = findAllMatches(file.content, /\.findMany\(\{/);
    for (const match of findManyMatches) {
      const block = lines.slice(match.line - 1, Math.min(match.line + 15, lines.length)).join('\n');
      if (!/select\s*:/.test(block) && !/include\s*:/.test(block)) {
        findings.push({
          id: `perf-no-select-${file.relative}-${match.line}`,
          category: 'performance',
          severity: 'medium',
          title: 'findMany without select or include',
          description: `Query at line ${match.line} fetches all columns. This over-fetches data.`,
          file: file.relative,
          line: match.line,
          recommendation:
            'Add a "select" clause to only fetch needed columns, reducing payload and memory.',
        });
      }
    }

    // ── findMany without pagination ──────────────────────────────────
    for (const match of findManyMatches) {
      const block = lines.slice(match.line - 1, Math.min(match.line + 15, lines.length)).join('\n');
      if (!/take\s*:/.test(block) && !/limit/i.test(block)) {
        findings.push({
          id: `perf-no-pagination-${file.relative}-${match.line}`,
          category: 'performance',
          severity: 'medium',
          title: 'findMany without pagination (no take/limit)',
          description: `Query at line ${match.line} has no limit — could return unbounded rows.`,
          file: file.relative,
          line: match.line,
          recommendation: 'Add "take" and "skip" for pagination to prevent unbounded result sets.',
        });
      }
    }

    // ── Sequential awaits that could be parallelized ─────────────────
    for (let i = 0; i < lines.length - 1; i++) {
      if (
        /^\s*const\s+\w+\s*=\s*await\s+/.test(lines[i]) &&
        /^\s*const\s+\w+\s*=\s*await\s+/.test(lines[i + 1])
      ) {
        // Check if second line references variable from first
        const firstVar = lines[i].match(/const\s+(\w+)/)?.[1];
        if (firstVar && !lines[i + 1].includes(firstVar)) {
          findings.push({
            id: `perf-sequential-await-${file.relative}-${i}`,
            category: 'performance',
            severity: 'low',
            title: 'Sequential awaits could be parallelized',
            description: `Two independent await calls at lines ${i + 1}-${i + 2} could use Promise.all().`,
            file: file.relative,
            line: i + 1,
            recommendation: 'Use Promise.all([...]) for independent async operations.',
          });
        }
      }
    }

    // ── Missing $transaction for multiple writes ─────────────────────
    const writeOps = findAllMatches(file.content, /prisma\.\w+\.(create|update|delete|upsert)\(/);

    // Group by function (rough heuristic: within 20 lines)
    for (let i = 0; i < writeOps.length - 1; i++) {
      if (writeOps[i + 1].line - writeOps[i].line < 20) {
        const block = lines
          .slice(Math.max(0, writeOps[i].line - 5), writeOps[i + 1].line + 5)
          .join('\n');
        if (!/\$transaction/.test(block)) {
          findings.push({
            id: `perf-no-transaction-${file.relative}-${writeOps[i].line}`,
            category: 'performance',
            severity: 'medium',
            title: 'Multiple write operations without transaction',
            description: `Multiple DB writes near line ${writeOps[i].line} are not wrapped in $transaction.`,
            file: file.relative,
            line: writeOps[i].line,
            recommendation: 'Wrap related writes in prisma.$transaction([...]) for atomicity.',
          });
        }
      }
    }

    // ── Missing caching on read-heavy services ───────────────────────
    if (
      /findMany|findUnique|findFirst/.test(file.content) &&
      !/cacheManager|@Cacheable|cache/.test(file.content)
    ) {
      findings.push({
        id: `perf-no-caching-${file.relative}`,
        category: 'performance',
        severity: 'low',
        title: 'No caching detected in service',
        description: `${file.relative} performs DB reads but has no caching mechanism.`,
        file: file.relative,
        recommendation: 'Consider adding caching (CacheManager, Redis) for frequently-read data.',
      });
    }

    // ── Blocking operations in request handlers ──────────────────────
    const blockingPatterns = [
      { pattern: /fs\.readFileSync|fs\.writeFileSync/, name: 'Sync file I/O' },
      { pattern: /child_process\.execSync/, name: 'Sync child process' },
      { pattern: /JSON\.parse\(.*readFileSync/, name: 'Sync file read + parse' },
    ];

    for (const bp of blockingPatterns) {
      const matches = findAllMatches(file.content, bp.pattern);
      for (const match of matches) {
        findings.push({
          id: `perf-blocking-${file.relative}-${match.line}`,
          category: 'performance',
          severity: 'high',
          title: `Blocking operation: ${bp.name}`,
          description: `${bp.name} at line ${match.line} blocks the event loop.`,
          file: file.relative,
          line: match.line,
          recommendation: 'Use async alternatives (fs.promises, child_process.exec).',
        });
      }
    }
  }

  return { findings };
}
