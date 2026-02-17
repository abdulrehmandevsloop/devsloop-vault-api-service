/* ══════════════════════════════════════════════════════════════════════════
   NestJS Project Analyzer — Configuration
   ══════════════════════════════════════════════════════════════════════════ */

import * as path from 'path';
import * as fs from 'fs';
import type { AnalyzerConfig } from './types';

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_FILE = path.join(ROOT, '.analyzerrc.json');

export const DEFAULT_CONFIG: AnalyzerConfig = {
  srcDir: path.join(ROOT, 'src'),
  prismaSchemaPath: path.join(ROOT, 'prisma', 'schema.prisma'),
  packageJsonPath: path.join(ROOT, 'package.json'),
  envExamplePath: path.join(ROOT, '.env.example'),
  exclude: ['node_modules', 'dist', 'coverage', '.git'],
  rules: {
    maxCyclomaticComplexity: 15,
    maxFileLines: 500,
    maxFunctionLines: 50,
    requireTestCoverage: true,
    requireDtoValidation: true,
    requireAuthOnEndpoints: true,
  },
};

export function loadConfig(): AnalyzerConfig {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const custom = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      return { ...DEFAULT_CONFIG, ...custom, rules: { ...DEFAULT_CONFIG.rules, ...custom.rules } };
    } catch {
      console.warn('⚠  Invalid .analyzerrc.json — using defaults');
    }
  }
  return DEFAULT_CONFIG;
}
