/* ══════════════════════════════════════════════════════════════════════════
   Security Analyzer — SQL injection, XSS, auth, secrets, CORS, rate limiting
   ══════════════════════════════════════════════════════════════════════════ */

import { findAllMatches, findLineNumber, readFileSafe, type SourceFile } from '../scanner';
import type { Finding, AnalyzerConfig } from '../types';
import * as path from 'path';

export function analyzeSecurity(files: SourceFile[], config: AnalyzerConfig) {
  const findings: Finding[] = [];

  // ══════════════════════════════════════════════════════════════════════
  // 1. SQL Injection — raw queries with string interpolation
  // ══════════════════════════════════════════════════════════════════════

  for (const file of files) {
    const rawQueryMatches = findAllMatches(file.content, /\$queryRaw\s*`/);
    for (const match of rawQueryMatches) {
      const queryBlock = file.lines
        .slice(match.line - 1, Math.min(match.line + 5, file.lineCount))
        .join('\n');
      if (/\$\{/.test(queryBlock) && !/Prisma\.sql/.test(queryBlock)) {
        findings.push({
          id: `sec-sql-injection-${file.relative}-${match.line}`,
          category: 'security',
          severity: 'critical',
          title: 'Potential SQL injection',
          description: `Raw query with string interpolation at line ${match.line}. Variables are not parameterized.`,
          file: file.relative,
          line: match.line,
          recommendation:
            'Use Prisma.sql tagged template or parameterized queries ($queryRawUnsafe is dangerous).',
        });
      }
    }

    // $queryRawUnsafe is always dangerous
    const unsafeMatches = findAllMatches(file.content, /\$queryRawUnsafe/);
    for (const match of unsafeMatches) {
      findings.push({
        id: `sec-raw-unsafe-${file.relative}-${match.line}`,
        category: 'security',
        severity: 'critical',
        title: 'Usage of $queryRawUnsafe',
        description: `$queryRawUnsafe at line ${match.line} is susceptible to SQL injection.`,
        file: file.relative,
        line: match.line,
        recommendation: 'Replace with $queryRaw using tagged template literals.',
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 2. Hardcoded secrets / credentials
  // ══════════════════════════════════════════════════════════════════════

  /* eslint-disable no-useless-escape */
  const secretPatterns = [
    {
      pattern: /(?:password|secret|token|apiKey|api_key)\s*[:=]\s*['"][^'"]{8,}['"]/i,
      name: 'Hardcoded secret',
    },
    { pattern: /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/g, name: 'Hardcoded Bearer token' },
    {
      pattern: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH)\s+PRIVATE\s+KEY-----/,
      name: 'Private key in source',
    },
    { pattern: /mongodb(\+srv)?:\/\/[^"'\s]+/g, name: 'Hardcoded MongoDB URI' },
    { pattern: /postgres(ql)?:\/\/[^"'\s]+/g, name: 'Hardcoded PostgreSQL URI' },
  ];
  /* eslint-enable no-useless-escape */

  for (const file of files) {
    // Skip test/mock files and .env
    if (/\.(spec|test|mock|e2e)\.ts$/.test(file.relative)) continue;
    if (/\.env/.test(file.relative)) continue;

    for (const sp of secretPatterns) {
      const matches = findAllMatches(file.content, sp.pattern);
      for (const match of matches) {
        // Skip ConfigService.get, process.env, or env() references
        const line = file.lines[match.line - 1] || '';
        if (/ConfigService|process\.env|env\(|\.get\(|example|default|placeholder/i.test(line))
          continue;

        findings.push({
          id: `sec-hardcoded-${file.relative}-${match.line}`,
          category: 'security',
          severity: 'critical',
          title: sp.name,
          description: `Potential ${sp.name} detected at line ${match.line}.`,
          file: file.relative,
          line: match.line,
          recommendation: 'Move secrets to environment variables. Never commit secrets to source.',
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 3. Missing authentication on controllers
  // ══════════════════════════════════════════════════════════════════════

  const controllerFiles = files.filter((f) => f.relative.endsWith('.controller.ts'));
  for (const file of controllerFiles) {
    // Skip health/app controllers
    if (/health|app\.controller/.test(file.relative)) continue;

    const hasAuth = /@ApiBearerAuth|@UseGuards\(.*Auth|JwtAuthGuard/.test(file.content);
    const hasPublicEndpoints = /@Public\(\)/.test(file.content);

    if (!hasAuth && !hasPublicEndpoints) {
      findings.push({
        id: `sec-no-auth-controller-${file.relative}`,
        category: 'security',
        severity: 'high',
        title: 'Controller without authentication',
        description: `${file.relative} has no auth guards or @Public decorators.`,
        file: file.relative,
        recommendation: 'Add JWT auth guard or explicitly mark endpoints as @Public().',
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 4. CORS configuration
  // ══════════════════════════════════════════════════════════════════════

  const mainFile = files.find((f) => f.relative.endsWith('main.ts'));
  if (mainFile) {
    if (!/enableCors/.test(mainFile.content) && !/cors/i.test(mainFile.content)) {
      findings.push({
        id: 'sec-no-cors',
        category: 'security',
        severity: 'high',
        title: 'CORS not configured',
        description: 'No CORS configuration found in main.ts.',
        file: mainFile.relative,
        recommendation: "Add app.enableCors({ origin: ['your-domain'], credentials: true }).",
      });
    } else if (/origin\s*:\s*true|origin\s*:\s*'\*'|origin\s*:\s*\*/.test(mainFile.content)) {
      findings.push({
        id: 'sec-cors-wildcard',
        category: 'security',
        severity: 'high',
        title: 'CORS allows all origins',
        description: 'CORS is configured with wildcard origin (*) or true.',
        file: mainFile.relative,
        recommendation: 'Restrict CORS origin to your frontend domains only.',
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 5. Rate limiting
  // ══════════════════════════════════════════════════════════════════════

  const hasRateLimiting = files.some((f) =>
    /ThrottlerModule|ThrottlerGuard|@Throttle/.test(f.content),
  );

  if (!hasRateLimiting) {
    findings.push({
      id: 'sec-no-rate-limiting',
      category: 'security',
      severity: 'high',
      title: 'No rate limiting detected',
      description: 'No ThrottlerModule or rate limiting guards found.',
      recommendation: 'Install @nestjs/throttler and configure rate limiting.',
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 6. Helmet / Security headers
  // ══════════════════════════════════════════════════════════════════════

  if (mainFile) {
    if (!/helmet/.test(mainFile.content)) {
      findings.push({
        id: 'sec-no-helmet',
        category: 'security',
        severity: 'medium',
        title: 'Helmet not configured',
        description: 'No helmet middleware found for security headers.',
        file: mainFile.relative,
        recommendation: 'Install and use helmet: app.use(helmet()).',
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 7. XSS — dangerouslySetInnerHTML / unescaped output
  // ══════════════════════════════════════════════════════════════════════

  for (const file of files) {
    if (/sanitize-html|sanitize|DOMPurify/.test(file.content)) continue;

    const xssPatterns = [
      { pattern: /\.innerHTML\s*=/, name: 'innerHTML assignment' },
      { pattern: /document\.write\(/, name: 'document.write' },
    ];

    for (const xp of xssPatterns) {
      const matches = findAllMatches(file.content, xp.pattern);
      for (const match of matches) {
        findings.push({
          id: `sec-xss-${file.relative}-${match.line}`,
          category: 'security',
          severity: 'high',
          title: `Potential XSS: ${xp.name}`,
          description: `${xp.name} at line ${match.line} without sanitization.`,
          file: file.relative,
          line: match.line,
          recommendation: 'Sanitize HTML content with sanitize-html or DOMPurify before rendering.',
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 8. JWT configuration strength
  // ══════════════════════════════════════════════════════════════════════

  for (const file of files) {
    // Short JWT expiry
    const jwtExpiry = file.content.match(/expiresIn\s*[:=]\s*['"](\w+)['"]/);
    if (jwtExpiry) {
      const value = jwtExpiry[1];
      // Warn if access token expires in more than 1 hour
      if (/^\d+[dw]$/.test(value)) {
        findings.push({
          id: `sec-jwt-long-expiry-${file.relative}`,
          category: 'security',
          severity: 'medium',
          title: 'Long JWT access token expiry',
          description: `JWT expiresIn is "${value}" which may be too long for an access token.`,
          file: file.relative,
          line: findLineNumber(file.content, /expiresIn/),
          recommendation:
            'Access tokens should expire in 15-60 minutes. Use refresh tokens for longer sessions.',
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 9. Error message sanitization
  // ══════════════════════════════════════════════════════════════════════

  for (const file of files) {
    const stackMatches = findAllMatches(file.content, /error\.stack|err\.stack/);
    for (const match of stackMatches) {
      const block = file.lines
        .slice(match.line - 1, Math.min(match.line + 3, file.lineCount))
        .join('\n');
      if (/response|json|send|return/.test(block) && !/logger|log|console/.test(block)) {
        findings.push({
          id: `sec-stack-exposure-${file.relative}-${match.line}`,
          category: 'security',
          severity: 'high',
          title: 'Stack trace may be exposed in response',
          description: `error.stack near line ${match.line} might be sent to client.`,
          file: file.relative,
          line: match.line,
          recommendation:
            'Never expose stack traces to clients. Log them and return generic messages.',
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 10. Sensitive data in responses
  // ══════════════════════════════════════════════════════════════════════

  for (const file of files) {
    if (!file.relative.endsWith('.service.ts')) continue;

    // Check if password field is selected
    const selectMatches = findAllMatches(file.content, /select\s*:\s*\{/);
    for (const match of selectMatches) {
      const block = file.lines
        .slice(match.line - 1, Math.min(match.line + 20, file.lineCount))
        .join('\n');
      if (/password\s*:\s*true/.test(block)) {
        findings.push({
          id: `sec-password-exposed-${file.relative}-${match.line}`,
          category: 'security',
          severity: 'critical',
          title: 'Password field selected in query',
          description: `Password is included in select at line ${match.line}.`,
          file: file.relative,
          line: match.line,
          recommendation: 'Never select password fields. Use { password: false } or omit it.',
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 11. .env.example completeness
  // ══════════════════════════════════════════════════════════════════════

  const envExample = config.envExamplePath ? readFileSafe(config.envExamplePath) : null;
  const envFile = readFileSafe(path.join(path.dirname(config.packageJsonPath), '.env'));

  if (envFile && !envExample) {
    findings.push({
      id: 'sec-no-env-example',
      category: 'security',
      severity: 'medium',
      title: 'Missing .env.example file',
      description:
        'No .env.example file found. Team members will not know what env vars are needed.',
      recommendation: 'Create .env.example with all required env vars (without actual values).',
    });
  }

  if (envFile && envExample) {
    const envVars: string[] = envFile.match(/^[A-Z_][\w]*(?==)/gm) || [];
    const exampleVars: string[] = envExample.match(/^[A-Z_][\w]*(?==)/gm) || [];
    const missing = envVars.filter((v) => !exampleVars.includes(v));

    if (missing.length > 0) {
      findings.push({
        id: 'sec-env-example-incomplete',
        category: 'security',
        severity: 'low',
        title: '.env.example is missing variables',
        description: `Variables in .env but not in .env.example: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ` (+${missing.length - 10} more)` : ''}`,
        recommendation: 'Keep .env.example in sync with .env (without actual secret values).',
      });
    }
  }

  return { findings };
}
