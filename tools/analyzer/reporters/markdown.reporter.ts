/* ══════════════════════════════════════════════════════════════════════════
   Markdown Reporter — Human-readable documentation report
   ══════════════════════════════════════════════════════════════════════════ */

import * as fs from 'fs';
import type { AnalysisReport, Finding, Severity, CategoryScore } from '../types';

const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
  info: 'ℹ️',
};

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function scoreColor(score: number): string {
  if (score >= 80) return '🟢';
  if (score >= 60) return '🟡';
  if (score >= 40) return '🟠';
  return '🔴';
}

function severityBadge(s: Severity): string {
  return `${SEVERITY_EMOJI[s]} **${s.toUpperCase()}**`;
}

function renderFindingsTable(findings: Finding[]): string {
  if (findings.length === 0) return '_No issues found._\n';

  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  let md = '| Severity | Title | File | Line | Recommendation |\n';
  md += '|----------|-------|------|------|----------------|\n';

  for (const f of sorted) {
    md += `| ${severityBadge(f.severity)} | ${f.title} | \`${f.file || '-'}\` | ${f.line || '-'} | ${f.recommendation} |\n`;
  }

  return md;
}

function renderCategorySection(cat: CategoryScore): string {
  const bySeveity = {
    critical: cat.findings.filter((f) => f.severity === 'critical').length,
    high: cat.findings.filter((f) => f.severity === 'high').length,
    medium: cat.findings.filter((f) => f.severity === 'medium').length,
    low: cat.findings.filter((f) => f.severity === 'low').length,
    info: cat.findings.filter((f) => f.severity === 'info').length,
  };

  let md = `### ${scoreColor(cat.score)} ${cat.category.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} — Score: ${cat.score}/100\n\n`;
  md += `> ${cat.summary}\n\n`;
  md += `**Findings:** ${cat.findings.length} total — `;
  md += `${bySeveity.critical} critical, ${bySeveity.high} high, ${bySeveity.medium} medium, ${bySeveity.low} low\n\n`;
  md += renderFindingsTable(cat.findings);
  md += '\n';

  return md;
}

export function generateMarkdownReport(report: AnalysisReport, outputPath: string): void {
  let md = '';

  // ── Header ──────────────────────────────────────────────────────────
  md += `# 📊 NestJS Project Analysis Report\n\n`;
  md += `**Project:** ${report.projectName}  \n`;
  md += `**Analyzed:** ${new Date(report.analyzedAt).toLocaleString()}  \n`;
  md += `**Version:** ${report.version}  \n`;
  md += `**Duration:** ${report.executionTimeMs}ms  \n\n`;
  md += `---\n\n`;

  // ── Executive Summary ───────────────────────────────────────────────
  md += `## ${scoreColor(report.overallScore)} Overall Health Score: ${report.overallScore}/100\n\n`;
  md += `${report.summary}\n\n`;

  // Score breakdown
  md += `| Category | Score | Findings |\n`;
  md += `|----------|-------|----------|\n`;
  for (const cat of report.categories) {
    md += `| ${scoreColor(cat.score)} ${cat.category.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} | ${cat.score}/100 | ${cat.findings.length} |\n`;
  }
  md += '\n---\n\n';

  // ── Project Stats ───────────────────────────────────────────────────
  md += `## 📈 Project Statistics\n\n`;
  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| Total Files | ${report.stats.totalFiles} |\n`;
  md += `| Total Lines | ${report.stats.totalLines.toLocaleString()} |\n`;
  md += `| Controllers | ${report.stats.controllers} |\n`;
  md += `| Services | ${report.stats.services} |\n`;
  md += `| Modules | ${report.stats.modules} |\n`;
  md += `| API Endpoints | ${report.stats.endpoints} |\n`;
  md += `| DB Models | ${report.stats.models} |\n`;
  md += `| Test Files | ${report.stats.testFiles} |\n`;
  md += `| DTO Files | ${report.stats.dtoFiles} |\n`;
  md += '\n---\n\n';

  // ── API Endpoints ───────────────────────────────────────────────────
  if (report.endpoints.length > 0) {
    md += `## 🌐 API Endpoints (${report.endpoints.length})\n\n`;
    md += `| Method | Route | Controller | Auth | Validation |\n`;
    md += `|--------|-------|------------|------|------------|\n`;
    for (const ep of report.endpoints) {
      md += `| \`${ep.method}\` | \`${ep.route}\` | ${ep.controller} | ${ep.isPublic ? '🔓 Public' : '🔒 Protected'} | ${ep.hasValidation ? '✅' : '❌'} |\n`;
    }
    md += '\n---\n\n';
  }

  // ── Category Details ────────────────────────────────────────────────
  md += `## 🔍 Detailed Findings\n\n`;
  for (const cat of report.categories) {
    md += renderCategorySection(cat);
  }

  // ── Actionable TODO List ────────────────────────────────────────────
  const allFindings = report.categories.flatMap((c) => c.findings);
  const critical = allFindings.filter((f) => f.severity === 'critical');
  const high = allFindings.filter((f) => f.severity === 'high');
  const medium = allFindings.filter((f) => f.severity === 'medium');

  md += `---\n\n`;
  md += `## ✅ Prioritized TODO List\n\n`;

  if (critical.length > 0) {
    md += `### 🔴 Critical (Fix immediately)\n\n`;
    critical.forEach((f) => {
      md += `- [ ] **${f.title}** — ${f.recommendation} ${f.file ? `(\`${f.file}\`)` : ''}\n`;
    });
    md += '\n';
  }

  if (high.length > 0) {
    md += `### 🟠 High Priority\n\n`;
    high.forEach((f) => {
      md += `- [ ] **${f.title}** — ${f.recommendation} ${f.file ? `(\`${f.file}\`)` : ''}\n`;
    });
    md += '\n';
  }

  if (medium.length > 0) {
    md += `### 🟡 Medium Priority\n\n`;
    medium.forEach((f) => {
      md += `- [ ] **${f.title}** — ${f.recommendation} ${f.file ? `(\`${f.file}\`)` : ''}\n`;
    });
    md += '\n';
  }

  // ── Footer ──────────────────────────────────────────────────────────
  md += `---\n\n`;
  md += `*Generated by NestJS Project Analyzer v${report.version} on ${new Date(report.analyzedAt).toLocaleString()}*\n`;

  fs.writeFileSync(outputPath, md, 'utf-8');
}
