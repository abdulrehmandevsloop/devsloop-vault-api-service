#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   NestJS Project Analyzer — CLI Entry Point
   ══════════════════════════════════════════════════════════════════════════
   
   Usage:
     npx ts-node tools/analyzer/index.ts [options]
   
   Options:
     --only <category>   Run only a specific category (api, performance, security, database, architecture, code-quality, dependencies)
     --format <type>     Output format: all (default), json, md, html, csv
     --output <dir>      Output directory (default: ./reports)
     --verbose           Show detailed progress
   ══════════════════════════════════════════════════════════════════════════ */

/* eslint-disable no-console */
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from './config';
import { scanDirectory, readFileSafe } from './scanner';
import { analyzeAPIs } from './analyzers/api.analyzer';
import { analyzePerformance } from './analyzers/performance.analyzer';
import { analyzeSecurity } from './analyzers/security.analyzer';
import { analyzeDatabase } from './analyzers/database.analyzer';
import { analyzeArchitecture } from './analyzers/architecture.analyzer';
import { analyzeCodeQuality } from './analyzers/code-quality.analyzer';
import { analyzeDependencies } from './analyzers/dependencies.analyzer';
import { generateJsonReport, generateCsvReport } from './reporters/json.reporter';
import { generateMarkdownReport } from './reporters/markdown.reporter';
import { generateHtmlReport } from './reporters/html.reporter';
import type { AnalysisReport, CategoryScore, Category, Finding, Severity } from './types';

// ═══════════════════════════════════════════════════════════════════════
// CLI Argument Parsing
// ═══════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const onlyCategory = getArg('only') as Category | undefined;
const outputFormat = getArg('format') || 'all';
const outputDir = getArg('output') || path.resolve(__dirname, '..', '..', 'reports');
const verbose = args.includes('--verbose');

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function log(msg: string) {
  if (verbose) console.log(`  ${msg}`);
}

function calculateScore(findings: Finding[]): number {
  const penalties: Record<Severity, number> = {
    critical: 20,
    high: 10,
    medium: 4,
    low: 1,
    info: 0,
  };

  const totalPenalty = findings.reduce((sum, f) => sum + penalties[f.severity], 0);
  return Math.max(0, Math.min(100, 100 - totalPenalty));
}

function summarize(findings: Finding[], category: string): string {
  if (findings.length === 0) return `${category}: No issues detected. Excellent!`;

  const critical = findings.filter((f) => f.severity === 'critical').length;
  const high = findings.filter((f) => f.severity === 'high').length;

  if (critical > 0)
    return `${category}: ${critical} critical issue(s) require immediate attention.`;
  if (high > 0) return `${category}: ${high} high-priority issue(s) found.`;
  return `${category}: ${findings.length} minor issue(s) found. Generally healthy.`;
}

// ═══════════════════════════════════════════════════════════════════════
// Main Analysis
// ═══════════════════════════════════════════════════════════════════════

function main() {
  const startTime = Date.now();

  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════╗');
  console.log('  ║          NestJS Project Analyzer v1.0.0             ║');
  console.log('  ╚══════════════════════════════════════════════════════╝');
  console.log('');

  // Load configuration
  const config = loadConfig();
  console.log(`  📂 Source:  ${config.srcDir}`);
  console.log(`  📄 Schema:  ${config.prismaSchemaPath}`);
  console.log('');

  // Scan source files
  console.log('  ⏳ Scanning source files...');
  const files = scanDirectory(config.srcDir, config.srcDir, config.exclude);
  console.log(
    `  ✅ Found ${files.length} TypeScript files (${files.reduce((s, f) => s + f.lineCount, 0).toLocaleString()} lines)`,
  );
  console.log('');

  // Get package name
  const pkgContent = readFileSafe(config.packageJsonPath);
  const projectName = pkgContent ? JSON.parse(pkgContent).name || 'unknown' : 'unknown';

  // ── Run analyzers ──────────────────────────────────────────────────
  const categories: CategoryScore[] = [];
  let allEndpoints: any[] = [];
  let allModels: any[] = [];
  let allModules: any[] = [];
  let allDependencies: any[] = [];
  let stats: any = {};

  const shouldRun = (cat: Category) => !onlyCategory || onlyCategory === cat;

  // API Analysis
  if (shouldRun('api')) {
    console.log('  🌐 Analyzing API endpoints...');
    const result = analyzeAPIs(files, config);
    allEndpoints = result.endpoints;
    categories.push({
      category: 'api',
      score: calculateScore(result.findings),
      findings: result.findings,
      summary: summarize(result.findings, 'API'),
    });
    log(`Found ${result.endpoints.length} endpoints, ${result.findings.length} issues`);
  }

  // Performance Analysis
  if (shouldRun('performance')) {
    console.log('  ⚡ Analyzing performance patterns...');
    const result = analyzePerformance(files, config);
    categories.push({
      category: 'performance',
      score: calculateScore(result.findings),
      findings: result.findings,
      summary: summarize(result.findings, 'Performance'),
    });
    log(`Found ${result.findings.length} performance issues`);
  }

  // Security Analysis
  if (shouldRun('security')) {
    console.log('  🔒 Running security audit...');
    const result = analyzeSecurity(files, config);
    categories.push({
      category: 'security',
      score: calculateScore(result.findings),
      findings: result.findings,
      summary: summarize(result.findings, 'Security'),
    });
    log(`Found ${result.findings.length} security issues`);
  }

  // Database Analysis
  if (shouldRun('database')) {
    console.log('  🗃️  Analyzing database schema...');
    const result = analyzeDatabase(files, config);
    allModels = result.models;
    categories.push({
      category: 'database',
      score: calculateScore(result.findings),
      findings: result.findings,
      summary: summarize(result.findings, 'Database'),
    });
    log(`Found ${result.models.length} models, ${result.findings.length} issues`);
  }

  // Architecture Analysis
  if (shouldRun('architecture')) {
    console.log('  🏗️  Analyzing architecture...');
    const result = analyzeArchitecture(files, config);
    allModules = result.modules;
    categories.push({
      category: 'architecture',
      score: calculateScore(result.findings),
      findings: result.findings,
      summary: summarize(result.findings, 'Architecture'),
    });
    log(`Found ${result.modules.length} modules, ${result.findings.length} issues`);
  }

  // Code Quality Analysis
  if (shouldRun('code-quality')) {
    console.log('  📝 Analyzing code quality...');
    const result = analyzeCodeQuality(files, config);
    stats = result.stats;
    stats.endpoints = allEndpoints.length;
    stats.models = allModels.length;
    categories.push({
      category: 'code-quality',
      score: calculateScore(result.findings),
      findings: result.findings,
      summary: summarize(result.findings, 'Code Quality'),
    });
    log(`Found ${result.findings.length} code quality issues`);
  }

  // Dependencies Analysis
  if (shouldRun('dependencies')) {
    console.log('  📦 Analyzing dependencies...');
    const result = analyzeDependencies(config);
    allDependencies = result.dependencies;
    categories.push({
      category: 'dependencies',
      score: calculateScore(result.findings),
      findings: result.findings,
      summary: summarize(result.findings, 'Dependencies'),
    });
    log(`Found ${result.dependencies.length} packages, ${result.findings.length} issues`);
  }

  // ── Build report ───────────────────────────────────────────────────
  const executionTimeMs = Date.now() - startTime;
  const overallScore =
    categories.length > 0
      ? Math.round(categories.reduce((s, c) => s + c.score, 0) / categories.length)
      : 0;

  const allFindings = categories.flatMap((c) => c.findings);
  const criticalCount = allFindings.filter((f) => f.severity === 'critical').length;
  const highCount = allFindings.filter((f) => f.severity === 'high').length;

  let overallSummary = `Overall score: ${overallScore}/100. `;
  if (criticalCount > 0)
    overallSummary += `${criticalCount} critical and ${highCount} high-priority issues need immediate attention.`;
  else if (highCount > 0)
    overallSummary += `${highCount} high-priority issues found. No critical issues.`;
  else
    overallSummary += `No critical or high-priority issues. ${allFindings.length} total findings.`;

  // Ensure stats is populated
  if (!stats.totalFiles) {
    stats = {
      totalFiles: files.length,
      totalLines: files.reduce((s, f) => s + f.lineCount, 0),
      controllers: files.filter((f) => f.relative.endsWith('.controller.ts')).length,
      services: files.filter((f) => f.relative.endsWith('.service.ts')).length,
      modules: files.filter((f) => f.relative.endsWith('.module.ts')).length,
      endpoints: allEndpoints.length,
      models: allModels.length,
      entities: 0,
      testFiles: files.filter((f) => /\.(spec|test|e2e-spec)\.ts$/.test(f.relative)).length,
      dtoFiles: files.filter((f) => f.relative.endsWith('.dto.ts')).length,
    };
  }

  const report: AnalysisReport = {
    projectName,
    analyzedAt: new Date().toISOString(),
    version: '1.0.0',
    overallScore,
    executionTimeMs,
    summary: overallSummary,
    categories,
    endpoints: allEndpoints,
    models: allModels,
    modules: allModules,
    dependencies: allDependencies,
    stats,
  };

  // ── Generate reports ───────────────────────────────────────────────
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('');
  console.log('  📊 Generating reports...');

  if (outputFormat === 'all' || outputFormat === 'json') {
    const p = path.join(outputDir, 'analysis-report.json');
    generateJsonReport(report, p);
    console.log(`  ✅ JSON  → ${p}`);
  }

  if (outputFormat === 'all' || outputFormat === 'md') {
    const p = path.join(outputDir, 'analysis-report.md');
    generateMarkdownReport(report, p);
    console.log(`  ✅ MD    → ${p}`);
  }

  if (outputFormat === 'all' || outputFormat === 'html') {
    const p = path.join(outputDir, 'analysis-report.html');
    generateHtmlReport(report, p);
    console.log(`  ✅ HTML  → ${p}`);
  }

  if (outputFormat === 'all' || outputFormat === 'csv') {
    const p = path.join(outputDir, 'analysis-findings.csv');
    generateCsvReport(report, p);
    console.log(`  ✅ CSV   → ${p}`);
  }

  // ── Print summary ─────────────────────────────────────────────────
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════╗');
  console.log(
    `  ║  Overall Score: ${String(overallScore).padStart(3)} / 100${overallScore >= 80 ? '  ✅ Healthy' : overallScore >= 60 ? '  ⚠️  Needs Work' : '  🔴 Critical'}${''.padEnd(17 - (overallScore >= 80 ? 10 : overallScore >= 60 ? 13 : 12))}║`,
  );
  console.log('  ╠══════════════════════════════════════════════════════╣');

  for (const cat of categories) {
    const label = cat.category.replace(/-/g, ' ').padEnd(16);
    const scoreStr = `${cat.score}/100`.padStart(7);
    const findingsStr = `${cat.findings.length} issues`.padStart(10);
    console.log(`  ║  ${label} ${scoreStr}  ${findingsStr}${''.padEnd(14)}║`);
  }

  console.log('  ╠══════════════════════════════════════════════════════╣');
  console.log(
    `  ║  Total findings: ${String(allFindings.length).padStart(4)}  (${criticalCount} critical, ${highCount} high)${''.padEnd(Math.max(0, 11 - String(criticalCount).length - String(highCount).length))}║`,
  );
  console.log(
    `  ║  Execution time: ${executionTimeMs}ms${''.padEnd(Math.max(0, 31 - String(executionTimeMs).length))}║`,
  );
  console.log('  ╚══════════════════════════════════════════════════════╝');
  console.log('');

  // CI/CD exit code
  if (criticalCount > 0) {
    process.exit(2); // Critical issues
  } else if (highCount > 0) {
    process.exit(1); // High issues
  }
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error('❌ Analyzer failed:', err);
  process.exit(3);
}
