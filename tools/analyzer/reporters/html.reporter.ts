/* ══════════════════════════════════════════════════════════════════════════
   HTML Reporter — Interactive dashboard
   ══════════════════════════════════════════════════════════════════════════ */

import * as fs from 'fs';
import type { AnalysisReport, CategoryScore, Severity } from '../types';

const COLORS: Record<Severity, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#3b82f6',
  info: '#6b7280',
};

function scoreGradient(score: number): string {
  if (score >= 80) return 'linear-gradient(135deg, #10b981, #059669)';
  if (score >= 60) return 'linear-gradient(135deg, #eab308, #d97706)';
  if (score >= 40) return 'linear-gradient(135deg, #f97316, #ea580c)';
  return 'linear-gradient(135deg, #ef4444, #dc2626)';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderCategoryCard(cat: CategoryScore): string {
  const bySeverity = {
    critical: cat.findings.filter((f) => f.severity === 'critical').length,
    high: cat.findings.filter((f) => f.severity === 'high').length,
    medium: cat.findings.filter((f) => f.severity === 'medium').length,
    low: cat.findings.filter((f) => f.severity === 'low').length,
  };

  const label = cat.category.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return `
    <div class="card category-card" id="cat-${cat.category}">
      <div class="card-header">
        <h3>${escapeHtml(label)}</h3>
        <div class="score-badge" style="background:${scoreGradient(cat.score)}">${cat.score}</div>
      </div>
      <p class="summary">${escapeHtml(cat.summary)}</p>
      <div class="severity-row">
        ${bySeverity.critical ? `<span class="badge" style="background:${COLORS.critical}">${bySeverity.critical} Critical</span>` : ''}
        ${bySeverity.high ? `<span class="badge" style="background:${COLORS.high}">${bySeverity.high} High</span>` : ''}
        ${bySeverity.medium ? `<span class="badge" style="background:${COLORS.medium};color:#000">${bySeverity.medium} Medium</span>` : ''}
        ${bySeverity.low ? `<span class="badge" style="background:${COLORS.low}">${bySeverity.low} Low</span>` : ''}
        ${cat.findings.length === 0 ? '<span class="badge" style="background:#10b981">✓ All Clear</span>' : ''}
      </div>
      ${
        cat.findings.length > 0
          ? `
      <details>
        <summary>${cat.findings.length} findings — click to expand</summary>
        <table class="findings-table">
          <thead><tr><th>Severity</th><th>Title</th><th>File</th><th>Recommendation</th></tr></thead>
          <tbody>
            ${cat.findings
              .sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity))
              .map(
                (f) => `<tr>
                  <td><span class="sev-dot" style="background:${COLORS[f.severity]}"></span> ${f.severity}</td>
                  <td>${escapeHtml(f.title)}</td>
                  <td><code>${escapeHtml(f.file || '-')}${f.line ? ':' + f.line : ''}</code></td>
                  <td>${escapeHtml(f.recommendation)}</td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </details>`
          : ''
      }
    </div>`;
}

function severityOrder(s: Severity): number {
  return { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[s];
}

export function generateHtmlReport(report: AnalysisReport, outputPath: string): void {
  const totalFindings = report.categories.reduce((s, c) => s + c.findings.length, 0);
  const critical = report.categories.reduce(
    (s, c) => s + c.findings.filter((f) => f.severity === 'critical').length,
    0,
  );
  const high = report.categories.reduce(
    (s, c) => s + c.findings.filter((f) => f.severity === 'high').length,
    0,
  );

  const chartData = report.categories.map((c) => ({
    label: c.category.replace(/-/g, ' '),
    score: c.score,
    findings: c.findings.length,
  }));

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NestJS Analysis — ${escapeHtml(report.projectName)}</title>
<style>
  :root { --bg: #0f172a; --card: #1e293b; --border: #334155; --text: #e2e8f0; --muted: #94a3b8; --primary: #4fb88c; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--text); line-height:1.6; padding:2rem; max-width:1200px; margin:0 auto; }
  h1 { font-size:1.75rem; margin-bottom:.25rem; }
  h2 { font-size:1.25rem; color:var(--muted); margin:2rem 0 1rem; border-bottom:1px solid var(--border); padding-bottom:.5rem; }
  h3 { font-size:1rem; }
  .header { text-align:center; margin-bottom:2rem; }
  .header .meta { color:var(--muted); font-size:.85rem; margin-top:.5rem; }
  .overall-score { width:120px; height:120px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:2.5rem; font-weight:800; margin:1.5rem auto; color:#fff; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:1rem; }
  .stats-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:.75rem; margin-bottom:2rem; }
  .stat-card { background:var(--card); border:1px solid var(--border); border-radius:.75rem; padding:1rem; text-align:center; }
  .stat-card .value { font-size:1.5rem; font-weight:700; color:var(--primary); }
  .stat-card .label { font-size:.75rem; color:var(--muted); margin-top:.25rem; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:.75rem; padding:1.25rem; }
  .card-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:.75rem; }
  .score-badge { width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:.85rem; color:#fff; }
  .summary { font-size:.85rem; color:var(--muted); margin-bottom:.75rem; }
  .severity-row { display:flex; gap:.5rem; flex-wrap:wrap; }
  .badge { font-size:.7rem; padding:.2rem .6rem; border-radius:99px; color:#fff; font-weight:600; }
  details { margin-top:1rem; }
  summary { cursor:pointer; font-size:.85rem; color:var(--primary); font-weight:500; }
  .findings-table { width:100%; border-collapse:collapse; font-size:.8rem; margin-top:.75rem; }
  .findings-table th { text-align:left; padding:.5rem; border-bottom:1px solid var(--border); color:var(--muted); font-weight:500; }
  .findings-table td { padding:.5rem; border-bottom:1px solid var(--border); vertical-align:top; }
  .findings-table code { font-size:.75rem; background:var(--bg); padding:.15rem .4rem; border-radius:.25rem; }
  .sev-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:.4rem; vertical-align:middle; }
  .endpoints-table { width:100%; border-collapse:collapse; font-size:.8rem; }
  .endpoints-table th { text-align:left; padding:.5rem; border-bottom:1px solid var(--border); color:var(--muted); }
  .endpoints-table td { padding:.5rem; border-bottom:1px solid var(--border); }
  .endpoints-table code { font-size:.8rem; background:var(--bg); padding:.1rem .3rem; border-radius:.2rem; }
  .method-badge { padding:.15rem .5rem; border-radius:.25rem; font-size:.7rem; font-weight:700; display:inline-block; min-width:50px; text-align:center; }
  .method-GET { background:#10b98120; color:#10b981; }
  .method-POST { background:#3b82f620; color:#3b82f6; }
  .method-PATCH, .method-PUT { background:#eab30820; color:#eab308; }
  .method-DELETE { background:#ef444420; color:#ef4444; }
  .chart-container { display:flex; gap:1rem; align-items:flex-end; height:180px; padding:1rem 0; }
  .chart-bar { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; }
  .bar { width:100%; max-width:60px; border-radius:.5rem .5rem 0 0; transition:height .5s ease; }
  .bar-label { font-size:.65rem; color:var(--muted); margin-top:.5rem; text-align:center; word-break:break-word; }
  .bar-value { font-size:.75rem; font-weight:700; margin-bottom:.25rem; }
</style>
</head>
<body>

<div class="header">
  <h1>NestJS Project Analysis</h1>
  <p class="meta">${escapeHtml(report.projectName)} • ${new Date(report.analyzedAt).toLocaleString()} • ${report.executionTimeMs}ms</p>
  <div class="overall-score" style="background:${scoreGradient(report.overallScore)}">${report.overallScore}</div>
  <p style="color:var(--muted);font-size:.9rem">${escapeHtml(report.summary)}</p>
</div>

<h2>📈 Project Statistics</h2>
<div class="stats-grid">
  <div class="stat-card"><div class="value">${report.stats.totalFiles}</div><div class="label">Files</div></div>
  <div class="stat-card"><div class="value">${report.stats.totalLines.toLocaleString()}</div><div class="label">Lines of Code</div></div>
  <div class="stat-card"><div class="value">${report.stats.endpoints}</div><div class="label">API Endpoints</div></div>
  <div class="stat-card"><div class="value">${report.stats.models}</div><div class="label">DB Models</div></div>
  <div class="stat-card"><div class="value">${report.stats.controllers}</div><div class="label">Controllers</div></div>
  <div class="stat-card"><div class="value">${report.stats.services}</div><div class="label">Services</div></div>
  <div class="stat-card"><div class="value">${report.stats.modules}</div><div class="label">Modules</div></div>
  <div class="stat-card"><div class="value">${report.stats.testFiles}</div><div class="label">Test Files</div></div>
</div>

<h2>📊 Category Scores</h2>
<div class="card" style="margin-bottom:1.5rem">
  <div class="chart-container">
    ${chartData
      .map(
        (d) => `
      <div class="chart-bar">
        <div class="bar-value">${report.categories.find((c) => c.category.replace(/-/g, ' ') === d.label)?.score || 0}</div>
        <div class="bar" style="height:${Math.max(5, (report.categories.find((c) => c.category.replace(/-/g, ' ') === d.label)?.score || 0) * 1.5)}px;background:${scoreGradient(report.categories.find((c) => c.category.replace(/-/g, ' ') === d.label)?.score || 0)}"></div>
        <div class="bar-label">${d.label}</div>
      </div>
    `,
      )
      .join('')}
  </div>
</div>

<h2>🔍 Analysis Results (${totalFindings} findings — ${critical} critical, ${high} high)</h2>
<div class="grid">
  ${report.categories.map(renderCategoryCard).join('')}
</div>

${
  report.endpoints.length > 0
    ? `
<h2>🌐 API Endpoints (${report.endpoints.length})</h2>
<div class="card">
  <table class="endpoints-table">
    <thead><tr><th>Method</th><th>Route</th><th>Controller</th><th>Auth</th><th>Validation</th></tr></thead>
    <tbody>
      ${report.endpoints
        .map(
          (ep) => `
        <tr>
          <td><span class="method-badge method-${ep.method}">${ep.method}</span></td>
          <td><code>${escapeHtml(ep.route)}</code></td>
          <td>${escapeHtml(ep.controller)}</td>
          <td>${ep.isPublic ? '🔓' : '🔒'}</td>
          <td>${ep.hasValidation ? '✅' : '❌'}</td>
        </tr>
      `,
        )
        .join('')}
    </tbody>
  </table>
</div>`
    : ''
}

</body>
</html>`;

  fs.writeFileSync(outputPath, html, 'utf-8');
}
