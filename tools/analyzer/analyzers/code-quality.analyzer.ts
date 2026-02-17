/* ══════════════════════════════════════════════════════════════════════════
   Code Quality Analyzer — TypeScript, testing, logging, complexity, naming
   ══════════════════════════════════════════════════════════════════════════ */

import { findAllMatches, findLineNumber, type SourceFile } from '../scanner';
import type { Finding, AnalyzerConfig, ProjectStats } from '../types';

export function analyzeCodeQuality(files: SourceFile[], config: AnalyzerConfig) {
  const findings: Finding[] = [];

  // ══════════════════════════════════════════════════════════════════════
  // 1. TypeScript strict mode compliance
  // ══════════════════════════════════════════════════════════════════════

  // Check for "any" usage
  for (const file of files) {
    if (/\.(spec|test|mock)\.ts$/.test(file.relative)) continue;

    const anyMatches = findAllMatches(file.content, /:\s*any\b/);
    if (anyMatches.length > 6) {
      findings.push({
        id: `cq-excessive-any-${file.relative}`,
        category: 'code-quality',
        severity: 'medium',
        title: `Excessive "any" usage (${anyMatches.length} occurrences)`,
        description: `${file.relative} uses "any" type ${anyMatches.length} times, reducing type safety.`,
        file: file.relative,
        recommendation: 'Replace "any" with specific types or "unknown" for better type safety.',
      });
    }

    // TS suppression comments (ts-ignore, ts-expect-error)
    const tsIgnores = findAllMatches(file.content, /@ts-ignore|@ts-expect-error/);
    for (const match of tsIgnores) {
      findings.push({
        id: `cq-ts-ignore-${file.relative}-${match.line}`,
        category: 'code-quality',
        severity: 'medium',
        title: 'TypeScript suppression comment',
        description: `${match.match} at line ${match.line} suppresses type checking.`,
        file: file.relative,
        line: match.line,
        recommendation: 'Fix the type error instead of suppressing it.',
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 2. Test coverage analysis
  // ══════════════════════════════════════════════════════════════════════

  const serviceFiles = files.filter(
    (f) => f.relative.endsWith('.service.ts') && !/spec|test/.test(f.relative),
  );
  const testFiles = files.filter((f) => /\.(spec|test|e2e-spec)\.ts$/.test(f.relative));

  const untestedServices: string[] = [];
  for (const service of serviceFiles) {
    const baseName = service.relative.replace('.service.ts', '');
    const hasTest = testFiles.some(
      (t) => t.relative.includes(baseName) || t.relative.includes(baseName.split('/').pop()!),
    );
    if (!hasTest) {
      untestedServices.push(service.relative);
    }
  }

  if (untestedServices.length > 0) {
    findings.push({
      id: 'cq-missing-tests',
      category: 'code-quality',
      severity: 'medium',
      title: `${untestedServices.length} services without tests`,
      description: `Services missing test files: ${untestedServices.slice(0, 5).join(', ')}${untestedServices.length > 5 ? ` (+${untestedServices.length - 5} more)` : ''}`,
      recommendation: 'Add unit tests for all service files. Aim for >80% coverage.',
    });
  }

  if (testFiles.length === 0) {
    findings.push({
      id: 'cq-no-tests',
      category: 'code-quality',
      severity: 'critical',
      title: 'No test files found',
      description: 'Zero test files (.spec.ts, .test.ts, .e2e-spec.ts) exist in the project.',
      recommendation:
        'Add unit and integration tests. Start with critical services and auth flows.',
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 3. Error handling — try/catch, unhandled promises
  // ══════════════════════════════════════════════════════════════════════

  for (const file of files) {
    if (/\.(spec|test)\.ts$/.test(file.relative)) continue;

    // Empty catch blocks
    const emptyCatch = findAllMatches(file.content, /catch\s*\([^)]*\)\s*\{\s*\}/);
    for (const match of emptyCatch) {
      findings.push({
        id: `cq-empty-catch-${file.relative}-${match.line}`,
        category: 'code-quality',
        severity: 'medium',
        title: 'Empty catch block',
        description: `Empty catch at line ${match.line} silently swallows errors.`,
        file: file.relative,
        line: match.line,
        recommendation: 'At minimum, log the error. Never silently swallow exceptions.',
      });
    }

    // console.log in production code
    const consoleLogs = findAllMatches(file.content, /console\.(log|debug|info)\(/);
    if (consoleLogs.length > 0 && !/main\.ts$/.test(file.relative)) {
      findings.push({
        id: `cq-console-log-${file.relative}`,
        category: 'code-quality',
        severity: 'low',
        title: `console.log in production code (${consoleLogs.length})`,
        description: `${file.relative} uses console.log ${consoleLogs.length} times.`,
        file: file.relative,
        line: consoleLogs[0].line,
        recommendation: 'Use NestJS Logger instead of console.log for structured logging.',
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 4. TODO/FIXME/HACK comments
  // ══════════════════════════════════════════════════════════════════════

  const todoComments: { file: string; line: number; text: string }[] = [];

  for (const file of files) {
    const todos = findAllMatches(file.content, /\/\/\s*(TODO|FIXME|HACK|XXX|TEMP)\b[^]*/i);
    for (const match of todos) {
      todoComments.push({
        file: file.relative,
        line: match.line,
        text: match.match.trim().substring(0, 100),
      });
    }
  }

  if (todoComments.length > 0) {
    findings.push({
      id: 'cq-todo-comments',
      category: 'code-quality',
      severity: 'low',
      title: `${todoComments.length} TODO/FIXME comments found`,
      description: todoComments
        .slice(0, 5)
        .map((t) => `${t.file}:${t.line} — ${t.text}`)
        .join('\n'),
      recommendation: 'Review and address TODO comments. Track them as issues if needed.',
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 5. File size analysis
  // ══════════════════════════════════════════════════════════════════════

  for (const file of files) {
    if (file.lineCount > config.rules.maxFileLines) {
      findings.push({
        id: `cq-large-file-${file.relative}`,
        category: 'code-quality',
        severity: 'medium',
        title: `Large file: ${file.lineCount} lines`,
        description: `${file.relative} exceeds ${config.rules.maxFileLines} line limit (${file.lineCount} lines).`,
        file: file.relative,
        recommendation: 'Split into smaller, focused files/classes.',
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 6. Cyclomatic complexity (simplified)
  // ══════════════════════════════════════════════════════════════════════

  for (const file of files) {
    if (/\.(spec|test)\.ts$/.test(file.relative)) continue;

    // Count complexity indicators per function
    const funcStarts = findAllMatches(
      file.content,
      /(?:async\s+)?(?:\w+)\s*\([^)]*\)\s*(?::\s*\w+[^{]*)?\s*\{/,
    );

    for (const func of funcStarts) {
      // Get function body (rough)
      const startLine = func.line - 1;
      let braceCount = 0;
      let endLine = startLine;
      let started = false;

      for (let j = startLine; j < file.lines.length; j++) {
        for (const ch of file.lines[j]) {
          if (ch === '{') {
            braceCount++;
            started = true;
          }
          if (ch === '}') braceCount--;
        }
        if (started && braceCount === 0) {
          endLine = j;
          break;
        }
      }

      const body = file.lines.slice(startLine, endLine + 1).join('\n');
      const complexity =
        1 +
        (body.match(/\bif\b/g) || []).length +
        (body.match(/\belse\b/g) || []).length +
        (body.match(/\bfor\b/g) || []).length +
        (body.match(/\bwhile\b/g) || []).length +
        (body.match(/\bswitch\b/g) || []).length +
        (body.match(/\bcase\b/g) || []).length +
        (body.match(/\bcatch\b/g) || []).length +
        (body.match(/\?\?/g) || []).length +
        (body.match(/\?\./g) || []).length * 0.5 +
        (body.match(/&&|\|\|/g) || []).length;

      if (complexity > config.rules.maxCyclomaticComplexity) {
        findings.push({
          id: `cq-complexity-${file.relative}-${func.line}`,
          category: 'code-quality',
          severity: complexity > 25 ? 'high' : 'medium',
          title: `High cyclomatic complexity: ${Math.round(complexity)}`,
          description: `Function at line ${func.line} in ${file.relative} has complexity ${Math.round(complexity)} (max: ${config.rules.maxCyclomaticComplexity}).`,
          file: file.relative,
          line: func.line,
          recommendation:
            'Refactor into smaller functions. Use early returns and strategy patterns.',
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 7. Unused imports (basic detection)
  // ══════════════════════════════════════════════════════════════════════

  for (const file of files) {
    const importMatches = [...file.content.matchAll(/import\s*\{([^}]+)\}\s*from/g)];
    for (const imp of importMatches) {
      const symbols = imp[1].split(',').map((s) =>
        s
          .trim()
          .split(/\s+as\s+/)
          .pop()!
          .trim(),
      );
      for (const sym of symbols) {
        if (!sym) continue;
        // Count occurrences (should be > 1: the import itself + at least 1 usage)
        const re = new RegExp(`\\b${sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
        const count = (file.content.match(re) || []).length;
        if (count <= 1) {
          findings.push({
            id: `cq-unused-import-${file.relative}-${sym}`,
            category: 'code-quality',
            severity: 'low',
            title: `Potentially unused import: ${sym}`,
            description: `"${sym}" is imported but not used in ${file.relative}.`,
            file: file.relative,
            line: findLineNumber(file.content, new RegExp(`import.*${sym}`)),
            recommendation: 'Remove unused imports to keep code clean.',
          });
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 8. Logging — check if Logger is used
  // ══════════════════════════════════════════════════════════════════════

  for (const file of serviceFiles) {
    if (!/Logger|logger/.test(file.content)) {
      findings.push({
        id: `cq-no-logger-${file.relative}`,
        category: 'code-quality',
        severity: 'low',
        title: 'Service without logger',
        description: `${file.relative} doesn't use NestJS Logger.`,
        file: file.relative,
        recommendation:
          'Add private readonly logger = new Logger(ClassName.name) for observability.',
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Compute project stats
  // ══════════════════════════════════════════════════════════════════════

  const stats: ProjectStats = {
    totalFiles: files.length,
    totalLines: files.reduce((sum, f) => sum + f.lineCount, 0),
    controllers: files.filter((f) => f.relative.endsWith('.controller.ts')).length,
    services: files.filter((f) => f.relative.endsWith('.service.ts')).length,
    modules: files.filter((f) => f.relative.endsWith('.module.ts')).length,
    endpoints: 0, // filled by caller
    models: 0, // filled by caller
    entities: 0,
    testFiles: testFiles.length,
    dtoFiles: files.filter((f) => f.relative.endsWith('.dto.ts')).length,
  };

  return { findings, stats };
}
