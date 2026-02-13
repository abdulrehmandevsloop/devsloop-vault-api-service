/* ══════════════════════════════════════════════════════════════════════════
   API Analyzer — Scans controllers, endpoints, guards, pipes, DTOs
   ══════════════════════════════════════════════════════════════════════════ */

import { findLineNumber, type SourceFile } from '../scanner';
import type { EndpointInfo, Finding, AnalyzerConfig } from '../types';

const HTTP_METHODS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options', 'All'];

export function analyzeAPIs(files: SourceFile[], config: AnalyzerConfig) {
  const findings: Finding[] = [];
  const endpoints: EndpointInfo[] = [];

  const controllerFiles = files.filter((f) => f.relative.endsWith('.controller.ts'));

  for (const file of controllerFiles) {
    // Extract controller route prefix
    const controllerMatch = file.content.match(/@Controller\(['"]([^'"]*)['"]\)/);
    const controllerPrefix = controllerMatch ? controllerMatch[1] : '';
    const controllerName = file.content.match(/export\s+class\s+(\w+)/)?.[1] || 'Unknown';

    // Check for @ApiBearerAuth
    const hasBearerAuth = /@ApiBearerAuth/.test(file.content);

    // Check for @ApiTags
    const hasApiTags = /@ApiTags/.test(file.content);
    if (!hasApiTags) {
      findings.push({
        id: `api-missing-tags-${file.relative}`,
        category: 'api',
        severity: 'low',
        title: 'Missing @ApiTags decorator',
        description: `Controller ${controllerName} is missing @ApiTags for Swagger documentation.`,
        file: file.relative,
        line: findLineNumber(file.content, /export\s+class/),
        recommendation: 'Add @ApiTags decorator for better Swagger grouping.',
      });
    }

    // Parse endpoints
    const lines = file.lines;
    for (let i = 0; i < lines.length; i++) {
      for (const httpMethod of HTTP_METHODS) {
        const re = new RegExp(`@${httpMethod}\\(([^)]*)\\)`);
        const m = lines[i].match(re);
        if (!m) continue;

        const routePath = m[1].replace(/['"]/g, '').trim();
        const fullRoute = `/${controllerPrefix}${routePath ? '/' + routePath : ''}`.replace(
          /\/+/g,
          '/',
        );

        // Look ahead for handler method name
        let handlerName = 'unknown';
        for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
          const handlerMatch = lines[j].match(/(?:async\s+)?(\w+)\s*\(/);
          if (handlerMatch && !handlerMatch[1].startsWith('@')) {
            handlerName = handlerMatch[1];
            break;
          }
        }

        // Scan surrounding lines for decorators (before AND after HTTP method, up to handler)
        // Look ahead for handler signature: a non-decorator line that looks like a method definition
        let decoratorEnd = Math.min(i + 30, lines.length);
        for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
          const trimmed = lines[j].trim();
          // Handler method: starts with `async methodName(` or `methodName(` at class indent level
          if (
            !trimmed.startsWith('@') &&
            !trimmed.startsWith('//') &&
            !trimmed.startsWith('*') &&
            !trimmed.startsWith("'") &&
            !trimmed.startsWith('"') &&
            /^\s{2,6}(?:async\s+)?\w+\s*\(/.test(lines[j])
          ) {
            decoratorEnd = j;
            break;
          }
        }
        const decoratorBlock = lines.slice(Math.max(0, i - 20), decoratorEnd).join('\n');

        const guards = [...decoratorBlock.matchAll(/@UseGuards\(([^)]+)\)/g)].map((g) =>
          g[1].trim(),
        );
        const pipes = [...decoratorBlock.matchAll(/@UsePipes\(([^)]+)\)/g)].map((p) => p[1].trim());
        const interceptors = [...decoratorBlock.matchAll(/@UseInterceptors\(([^)]+)\)/g)].map((x) =>
          x[1].trim(),
        );
        const decorators = [...decoratorBlock.matchAll(/@(\w+)\(/g)].map((d) => d[1]);

        const isPublic = /@Public\(\)/.test(decoratorBlock);
        const hasValidation =
          /ValidationPipe|CuidValidationPipe|@Body\(|@Query\(/.test(decoratorBlock) ||
          /Dto/.test(decoratorBlock);

        // Check handler body for pagination
        const handlerBlock = lines.slice(i, Math.min(i + 40, lines.length)).join('\n');
        const hasPagination = /page|limit|skip|take|offset/i.test(handlerBlock);

        // Extract DTOs
        const bodyDto = decoratorBlock.match(/@Body\([^)]*\)\s+\w+:\s*(\w+Dto)/)?.[1];
        const queryDto = decoratorBlock.match(/@Query\([^)]*\)\s+\w+:\s*(\w+Dto)/)?.[1];
        const responseDto = decoratorBlock.match(/type:\s+(\w+Dto)/)?.[1];

        endpoints.push({
          method: httpMethod.toUpperCase(),
          route: fullRoute,
          controller: controllerName,
          handler: handlerName,
          file: file.relative,
          line: i + 1,
          guards,
          pipes,
          interceptors,
          decorators,
          isPublic,
          hasValidation,
          hasPagination,
          requestDto: bodyDto || queryDto,
          responseDto,
        });

        // Missing auth check
        if (!isPublic && !hasBearerAuth && config.rules.requireAuthOnEndpoints) {
          findings.push({
            id: `api-no-auth-${file.relative}-${i}`,
            category: 'api',
            severity: 'high',
            title: 'Endpoint may lack authentication',
            description: `${httpMethod.toUpperCase()} ${fullRoute} in ${controllerName} has no @Public() decorator and controller lacks @ApiBearerAuth.`,
            file: file.relative,
            line: i + 1,
            recommendation:
              'Add @ApiBearerAuth to controller or @Public() if intentionally unauthenticated.',
          });
        }

        // Missing response documentation
        if (!/@ApiResponse/.test(decoratorBlock)) {
          findings.push({
            id: `api-no-response-doc-${file.relative}-${i}`,
            category: 'api',
            severity: 'low',
            title: 'Missing @ApiResponse documentation',
            description: `${httpMethod.toUpperCase()} ${fullRoute} lacks @ApiResponse decorators.`,
            file: file.relative,
            line: i + 1,
            recommendation: 'Add @ApiResponse decorators for proper Swagger documentation.',
          });
        }

        // POST/PATCH/PUT without body validation
        if (
          ['Post', 'Patch', 'Put'].includes(httpMethod) &&
          !hasValidation &&
          config.rules.requireDtoValidation
        ) {
          findings.push({
            id: `api-no-validation-${file.relative}-${i}`,
            category: 'api',
            severity: 'medium',
            title: 'Write endpoint may lack input validation',
            description: `${httpMethod.toUpperCase()} ${fullRoute} doesn't appear to use a DTO or ValidationPipe.`,
            file: file.relative,
            line: i + 1,
            recommendation: 'Use a DTO with class-validator decorators and ValidationPipe.',
          });
        }
      }
    }
  }

  // Check for global ValidationPipe in main.ts
  const mainFile = files.find((f) => f.relative.endsWith('main.ts'));
  if (mainFile && !/useGlobalPipes.*ValidationPipe/s.test(mainFile.content)) {
    findings.push({
      id: 'api-no-global-validation',
      category: 'api',
      severity: 'high',
      title: 'No global ValidationPipe',
      description: 'main.ts does not set a global ValidationPipe.',
      file: mainFile.relative,
      recommendation:
        'Add app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true })).',
    });
  }

  // Check for global prefix
  if (mainFile && !/setGlobalPrefix/.test(mainFile.content)) {
    findings.push({
      id: 'api-no-global-prefix',
      category: 'api',
      severity: 'low',
      title: 'No global route prefix',
      description: 'No global API prefix is set (e.g., /api/v1).',
      file: mainFile.relative,
      recommendation: "Add app.setGlobalPrefix('api/v1') for proper API versioning.",
    });
  }

  return { findings, endpoints };
}
