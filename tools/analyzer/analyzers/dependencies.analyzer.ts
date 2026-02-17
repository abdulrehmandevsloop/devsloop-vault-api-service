/* ══════════════════════════════════════════════════════════════════════════
   Dependencies Analyzer — Outdated packages, vulnerabilities, config
   ══════════════════════════════════════════════════════════════════════════ */

import type { Finding, DependencyInfo, AnalyzerConfig } from '../types';
import { readFileSafe } from '../scanner';
import { execSync } from 'child_process';
import * as path from 'path';

export function analyzeDependencies(config: AnalyzerConfig) {
  const findings: Finding[] = [];
  const dependencies: DependencyInfo[] = [];

  const pkgContent = readFileSafe(config.packageJsonPath);
  if (!pkgContent) {
    findings.push({
      id: 'dep-no-package-json',
      category: 'dependencies',
      severity: 'critical',
      title: 'package.json not found',
      description: 'Cannot analyze dependencies without package.json.',
      recommendation: 'Ensure package.json exists in the project root.',
    });
    return { findings, dependencies };
  }

  let pkg: any;
  try {
    pkg = JSON.parse(pkgContent);
  } catch {
    findings.push({
      id: 'dep-invalid-package-json',
      category: 'dependencies',
      severity: 'critical',
      title: 'Invalid package.json',
      description: 'Could not parse package.json.',
      recommendation: 'Fix JSON syntax in package.json.',
    });
    return { findings, dependencies };
  }

  // ══════════════════════════════════════════════════════════════════════
  // 1. Parse dependencies
  // ══════════════════════════════════════════════════════════════════════

  const allDeps: Record<string, string> = {
    ...(pkg.dependencies || {}),
  };
  const devDeps: Record<string, string> = {
    ...(pkg.devDependencies || {}),
  };

  for (const [name, version] of Object.entries(allDeps)) {
    dependencies.push({ name, version: String(version), isDev: false });
  }
  for (const [name, version] of Object.entries(devDeps)) {
    dependencies.push({ name, version: String(version), isDev: true });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 2. Check for known vulnerable patterns
  // ══════════════════════════════════════════════════════════════════════

  const riskyDeps: Record<string, string> = {
    express: 'Ensure express is up to date for security patches.',
    jsonwebtoken: 'Ensure version >=9.0.0 to avoid JWT vulnerabilities.',
    bcrypt: 'Consider bcryptjs for better cross-platform support.',
    lodash: 'Consider using native JS methods or lodash-es for tree-shaking.',
    moment: 'Deprecated — use date-fns or dayjs instead.',
    request: 'Deprecated — use axios, got, or native fetch instead.',
  };

  for (const [depName, advice] of Object.entries(riskyDeps)) {
    if (allDeps[depName]) {
      findings.push({
        id: `dep-risky-${depName}`,
        category: 'dependencies',
        severity: 'medium',
        title: `Dependency advisory: ${depName}`,
        description: `"${depName}" (${allDeps[depName]}) — ${advice}`,
        file: 'package.json',
        recommendation: advice,
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 3. Check for missing essential security packages
  // ══════════════════════════════════════════════════════════════════════

  const essentialPackages: Record<string, { purpose: string; severity: 'high' | 'medium' }> = {
    helmet: { purpose: 'Security headers middleware', severity: 'high' },
    '@nestjs/throttler': { purpose: 'Rate limiting', severity: 'high' },
    'class-validator': { purpose: 'DTO validation', severity: 'high' },
    'class-transformer': { purpose: 'DTO transformation', severity: 'medium' },
    'sanitize-html': { purpose: 'XSS prevention for HTML content', severity: 'medium' },
  };

  for (const [pkgName, info] of Object.entries(essentialPackages)) {
    if (!allDeps[pkgName] && !devDeps[pkgName]) {
      findings.push({
        id: `dep-missing-${pkgName}`,
        category: 'dependencies',
        severity: info.severity,
        title: `Missing recommended package: ${pkgName}`,
        description: `"${pkgName}" (${info.purpose}) is not installed.`,
        file: 'package.json',
        recommendation: `Install: npm install ${pkgName}`,
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 4. Run npm audit (safe — read only)
  // ══════════════════════════════════════════════════════════════════════

  try {
    const projectDir = path.dirname(config.packageJsonPath);
    const auditOutput = execSync('npm audit --json', {
      cwd: projectDir,
      encoding: 'utf-8',
      timeout: 30000,
    });

    if (auditOutput) {
      try {
        const audit = JSON.parse(auditOutput);
        const vulns = audit.vulnerabilities || {};
        let criticalCount = 0;
        let highCount = 0;

        const vulnEntries = vulns as Record<string, Record<string, unknown>>;
        for (const [name, info] of Object.entries(vulnEntries)) {
          const severity = (info.severity as string) || 'unknown';
          if (severity === 'critical') criticalCount++;
          if (severity === 'high') highCount++;

          const dep = dependencies.find((d) => d.name === name);
          if (dep) {
            if (!dep.vulnerabilities) dep.vulnerabilities = [];
            const via = info.via as Array<Record<string, unknown>> | undefined;
            dep.vulnerabilities.push({
              severity,
              title: (via?.[0]?.title as string) || 'Known vulnerability',
            });
          }
        }

        if (criticalCount > 0 || highCount > 0) {
          findings.push({
            id: 'dep-audit-vulnerabilities',
            category: 'dependencies',
            severity: criticalCount > 0 ? 'critical' : 'high',
            title: `npm audit: ${criticalCount} critical, ${highCount} high vulnerabilities`,
            description: `Run "npm audit" for details. Total vulnerable packages: ${Object.keys(vulnEntries).length}`,
            file: 'package.json',
            recommendation: 'Run "npm audit fix" or manually update vulnerable packages.',
          });
        }
      } catch {
        // audit JSON parse failed — skip
      }
    }
  } catch {
    findings.push({
      id: 'dep-audit-failed',
      category: 'dependencies',
      severity: 'info',
      title: 'npm audit could not run',
      description: 'npm audit failed or timed out.',
      recommendation: 'Run "npm audit" manually to check for vulnerabilities.',
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 5. Check for pinned vs ranged versions
  // ══════════════════════════════════════════════════════════════════════

  const unpinned = dependencies.filter((d) => !d.isDev && /^[\^~]/.test(d.version));

  if (unpinned.length > 0) {
    findings.push({
      id: 'dep-unpinned-versions',
      category: 'dependencies',
      severity: 'info',
      title: `${unpinned.length} dependencies use version ranges`,
      description: `Production deps with ^ or ~: ${unpinned
        .slice(0, 8)
        .map((d) => d.name)
        .join(', ')}${unpinned.length > 8 ? '...' : ''}`,
      file: 'package.json',
      recommendation:
        'Consider using exact versions in production for reproducible builds, or use a lockfile.',
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 6. Check for lockfile
  // ══════════════════════════════════════════════════════════════════════

  const projectDir = path.dirname(config.packageJsonPath);
  const hasLockFile =
    readFileSafe(path.join(projectDir, 'package-lock.json')) !== null ||
    readFileSafe(path.join(projectDir, 'pnpm-lock.yaml')) !== null ||
    readFileSafe(path.join(projectDir, 'yarn.lock')) !== null;

  if (!hasLockFile) {
    findings.push({
      id: 'dep-no-lockfile',
      category: 'dependencies',
      severity: 'high',
      title: 'No lockfile found',
      description: 'No package-lock.json, pnpm-lock.yaml, or yarn.lock found.',
      recommendation: 'Commit a lockfile for deterministic builds.',
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 7. Check scripts
  // ══════════════════════════════════════════════════════════════════════

  const scripts = pkg.scripts || {};
  const recommendedScripts = ['build', 'start', 'lint', 'test'];

  for (const script of recommendedScripts) {
    if (!scripts[script] && !scripts[`${script}:prod`]) {
      findings.push({
        id: `dep-missing-script-${script}`,
        category: 'dependencies',
        severity: script === 'test' ? 'high' : 'low',
        title: `Missing npm script: ${script}`,
        description: `No "${script}" script in package.json.`,
        file: 'package.json',
        recommendation: `Add a "${script}" script for standard workflow.`,
      });
    }
  }

  return { findings, dependencies };
}
