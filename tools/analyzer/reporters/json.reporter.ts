/* ══════════════════════════════════════════════════════════════════════════
   JSON Reporter — Structured JSON output
   ══════════════════════════════════════════════════════════════════════════ */

import * as fs from 'fs';
import type { AnalysisReport } from '../types';

export function generateJsonReport(report: AnalysisReport, outputPath: string): void {
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
}

export function generateCsvReport(report: AnalysisReport, outputPath: string): void {
  const headers = [
    'ID',
    'Category',
    'Severity',
    'Title',
    'Description',
    'File',
    'Line',
    'Recommendation',
  ];
  const rows: string[][] = [headers];

  for (const cat of report.categories) {
    for (const finding of cat.findings) {
      rows.push([
        finding.id,
        finding.category,
        finding.severity,
        `"${finding.title.replace(/"/g, '""')}"`,
        `"${finding.description.replace(/"/g, '""')}"`,
        finding.file || '',
        String(finding.line || ''),
        `"${finding.recommendation.replace(/"/g, '""')}"`,
      ]);
    }
  }

  fs.writeFileSync(outputPath, rows.map((r) => r.join(',')).join('\n'), 'utf-8');
}
