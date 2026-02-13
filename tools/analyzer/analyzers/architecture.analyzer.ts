/* ══════════════════════════════════════════════════════════════════════════
   Architecture Analyzer — Modules, DI, circular deps, SOLID, patterns
   ══════════════════════════════════════════════════════════════════════════ */

import { findLineNumber, type SourceFile } from '../scanner';
import type { Finding, ModuleInfo, AnalyzerConfig } from '../types';

export function analyzeArchitecture(files: SourceFile[], _config: AnalyzerConfig) {
  const findings: Finding[] = [];
  const modules: ModuleInfo[] = [];

  // ══════════════════════════════════════════════════════════════════════
  // 1. Parse NestJS modules
  // ══════════════════════════════════════════════════════════════════════

  const moduleFiles = files.filter((f) => f.relative.endsWith('.module.ts'));

  for (const file of moduleFiles) {
    const nameMatch = file.content.match(/export\s+class\s+(\w+)/);
    const moduleName = nameMatch ? nameMatch[1] : 'Unknown';

    const extractArray = (key: string): string[] => {
      const re = new RegExp(`${key}\\s*:\\s*\\[([^\\]]*?)\\]`, 's');
      const match = file.content.match(re);
      if (!match) return [];
      return match[1]
        .split(',')
        .map((s) => s.trim().replace(/\s+/g, ''))
        .filter(Boolean);
    };

    modules.push({
      name: moduleName,
      file: file.relative,
      imports: extractArray('imports'),
      controllers: extractArray('controllers'),
      providers: extractArray('providers'),
      exports: extractArray('exports'),
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 2. Detect circular dependencies
  // ══════════════════════════════════════════════════════════════════════

  // Build import graph
  const importGraph = new Map<string, string[]>();
  for (const mod of modules) {
    importGraph.set(mod.name, mod.imports);
  }

  // Simple cycle detection
  function hasCycle(
    start: string,
    visited = new Set<string>(),
    path: string[] = [],
  ): string[] | null {
    if (visited.has(start)) return [...path, start];
    visited.add(start);
    path.push(start);

    const deps = importGraph.get(start) || [];
    for (const dep of deps) {
      const result = hasCycle(dep, new Set(visited), [...path]);
      if (result) return result;
    }
    return null;
  }

  const detectedCycles = new Set<string>();
  for (const [moduleName] of importGraph) {
    const cycle = hasCycle(moduleName);
    if (cycle && cycle.length > 2) {
      const cycleKey = cycle.sort().join('->');
      if (!detectedCycles.has(cycleKey)) {
        detectedCycles.add(cycleKey);
        findings.push({
          id: `arch-circular-dep-${cycleKey}`,
          category: 'architecture',
          severity: 'high',
          title: 'Potential circular dependency',
          description: `Circular import chain detected: ${cycle.join(' → ')}`,
          recommendation: 'Use forwardRef() or restructure modules to break the cycle.',
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 3. Check for forwardRef usage (indicator of circular deps)
  // ══════════════════════════════════════════════════════════════════════

  for (const file of files) {
    if (/forwardRef/.test(file.content)) {
      findings.push({
        id: `arch-forward-ref-${file.relative}`,
        category: 'architecture',
        severity: 'medium',
        title: 'forwardRef usage detected',
        description: `${file.relative} uses forwardRef(), indicating a circular dependency.`,
        file: file.relative,
        line: findLineNumber(file.content, /forwardRef/),
        recommendation:
          'Consider restructuring to eliminate circular dependencies instead of using forwardRef.',
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 4. Controller doing business logic (fat controller)
  // ══════════════════════════════════════════════════════════════════════

  const controllerFiles = files.filter((f) => f.relative.endsWith('.controller.ts'));
  for (const file of controllerFiles) {
    // Check if controller directly uses Prisma/DB
    if (/PrismaService|prisma\.\w+\./.test(file.content)) {
      findings.push({
        id: `arch-fat-controller-${file.relative}`,
        category: 'architecture',
        severity: 'high',
        title: 'Controller accesses database directly',
        description: `${file.relative} uses PrismaService directly instead of through a service layer.`,
        file: file.relative,
        recommendation:
          'Move database logic to a service. Controllers should only handle HTTP concerns.',
      });
    }

    // Check for excessive logic (many lines in controller methods)
    const methodBodies = [...file.content.matchAll(/async\s+\w+\([^)]*\)[^{]*\{/g)];
    for (const method of methodBodies) {
      const startIdx = file.content.indexOf(method[0]) + method[0].length;
      let braceCount = 1;
      let lineCount = 0;
      for (let j = startIdx; j < file.content.length && braceCount > 0; j++) {
        if (file.content[j] === '{') braceCount++;
        if (file.content[j] === '}') braceCount--;
        if (file.content[j] === '\n') lineCount++;
      }
      if (lineCount > 20) {
        findings.push({
          id: `arch-long-controller-method-${file.relative}-${method.index}`,
          category: 'architecture',
          severity: 'medium',
          title: 'Long controller method',
          description: `A controller method in ${file.relative} has ${lineCount} lines — too much logic.`,
          file: file.relative,
          recommendation:
            'Extract business logic to service layer. Controller methods should be thin (< 10 lines).',
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 5. God service (too many dependencies)
  // ══════════════════════════════════════════════════════════════════════

  const serviceFiles = files.filter((f) => f.relative.endsWith('.service.ts'));
  for (const file of serviceFiles) {
    const constructorMatch = file.content.match(/constructor\(([^)]+)\)/s);
    if (constructorMatch) {
      const deps = constructorMatch[1]
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      if (deps.length > 8) {
        findings.push({
          id: `arch-god-service-${file.relative}`,
          category: 'architecture',
          severity: 'medium',
          title: `Service has too many dependencies (${deps.length})`,
          description: `${file.relative} injects ${deps.length} dependencies, suggesting it does too much.`,
          file: file.relative,
          line: findLineNumber(file.content, /constructor/),
          recommendation:
            'Split into smaller, focused services. Follow Single Responsibility Principle.',
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 7. Module without exports (dead module)
  // ══════════════════════════════════════════════════════════════════════

  for (const mod of modules) {
    if (
      mod.exports.length === 0 &&
      mod.controllers.length === 0 &&
      !/AppModule|QueueModule/.test(mod.name)
    ) {
      findings.push({
        id: `arch-no-exports-${mod.name}`,
        category: 'architecture',
        severity: 'low',
        title: `Module "${mod.name}" has no exports`,
        description: `${mod.name} doesn't export anything and has no controllers. Other modules can't use its services.`,
        file: mod.file,
        recommendation: 'Export services that other modules need, or merge into a parent module.',
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 8. Check for barrel exports (index.ts)
  // ══════════════════════════════════════════════════════════════════════

  const dirs = new Set(files.map((f) => f.relative.split('/').slice(0, -1).join('/')));
  for (const dir of dirs) {
    if (!dir || /node_modules|dist/.test(dir)) continue;
    const hasIndex = files.some((f) => f.relative === `${dir}/index.ts`);
    const fileCount = files.filter(
      (f) => f.relative.startsWith(dir + '/') && !f.relative.includes('/', dir.length + 1),
    ).length;

    if (!hasIndex && fileCount > 3) {
      findings.push({
        id: `arch-no-barrel-${dir}`,
        category: 'architecture',
        severity: 'low',
        title: `No barrel export in ${dir}/`,
        description: `Directory "${dir}" has ${fileCount} files but no index.ts barrel export.`,
        recommendation: 'Add index.ts barrel export for cleaner imports.',
      });
    }
  }

  return { findings, modules };
}
