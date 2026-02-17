/* ══════════════════════════════════════════════════════════════════════════
   Database Analyzer — Prisma schema, indexes, relations, transactions
   ══════════════════════════════════════════════════════════════════════════ */

import { readFileSafe, type SourceFile } from '../scanner';
import type {
  Finding,
  PrismaModel,
  PrismaField,
  PrismaIndex,
  PrismaRelation,
  AnalyzerConfig,
} from '../types';

export function analyzeDatabase(files: SourceFile[], config: AnalyzerConfig) {
  const findings: Finding[] = [];
  const models: PrismaModel[] = [];

  const schemaContent = readFileSafe(config.prismaSchemaPath);
  if (!schemaContent) {
    findings.push({
      id: 'db-no-schema',
      category: 'database',
      severity: 'critical',
      title: 'Prisma schema not found',
      description: `Could not read schema at ${config.prismaSchemaPath}`,
      recommendation: 'Ensure prisma/schema.prisma exists.',
    });
    return { findings, models };
  }

  // ══════════════════════════════════════════════════════════════════════
  // 1. Parse Prisma models
  // ══════════════════════════════════════════════════════════════════════

  const modelBlocks = [...schemaContent.matchAll(/model\s+(\w+)\s*\{([^}]+)\}/g)];

  for (const [, modelName, body] of modelBlocks) {
    const fieldLines = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//') && !l.startsWith('@@'));

    const fields: PrismaField[] = [];
    const relations: PrismaRelation[] = [];
    const indexes: PrismaIndex[] = [];

    // Parse @@index and @@unique directives
    const indexRe = new RegExp('@@(index|unique)\\(\\[([^\\]]+)\\]', 'g');
    const indexMatches = [...body.matchAll(indexRe)];
    for (const [, type, fieldsStr] of indexMatches) {
      indexes.push({
        fields: fieldsStr.split(',').map((f) => f.trim()),
        isUnique: type === 'unique',
      });
    }

    // Parse table name
    const tableNameMatch = body.match(/@@map\(["'](\w+)["']\)/);
    const tableName = tableNameMatch ? tableNameMatch[1] : undefined;

    for (const line of fieldLines) {
      // Skip @@map etc
      if (line.startsWith('@@')) continue;

      // Field: name Type? @decorators
      const fieldMatch = line.match(new RegExp('^(\\w+)\\s+([\\w\\[\\]]+)(\\?)?\\s*(.*)?$'));
      if (!fieldMatch) continue;

      const [, name, type, optional, decorators = ''] = fieldMatch;

      // Skip relation fields
      if (/^[A-Z]/.test(type) && /@relation/.test(decorators)) {
        const relationRe = new RegExp(
          '@relation\\((?:["\'](\\w+)["\'],?\\s*)?.*?fields:\\s*\\[([^\\]]*)\\].*?references:\\s*\\[([^\\]]*)\\]',
        );
        const relMatch = decorators.match(relationRe);
        const onDeleteMatch = decorators.match(/onDelete:\s*(\w+)/);
        relations.push({
          name: relMatch?.[1] || name,
          model: type.replace('[]', '').replace('?', ''),
          fields: relMatch?.[2]?.split(',').map((f) => f.trim()),
          references: relMatch?.[3]?.split(',').map((f) => f.trim()),
          onDelete: onDeleteMatch?.[1],
        });
        continue;
      }

      // Skip array relation fields (e.g., contributions Contribution[])
      if (/\[\]$/.test(type)) {
        relations.push({
          name,
          model: type.replace('[]', ''),
        });
        continue;
      }

      const dbType = decorators.match(/@db\.(\w+(?:\(\d+\))?)/)?.[1];

      fields.push({
        name,
        type,
        isOptional: !!optional,
        isUnique: /@unique/.test(decorators),
        isId: /@id/.test(decorators),
        hasDefault: /@default/.test(decorators),
        dbType,
      });
    }

    models.push({ name: modelName, tableName, fields, indexes, relations });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 2. Check for missing indexes on foreign keys
  // ══════════════════════════════════════════════════════════════════════

  for (const model of models) {
    for (const relation of model.relations) {
      if (!relation.fields) continue;

      for (const fk of relation.fields) {
        const hasIndex =
          model.indexes.some((idx) => idx.fields[0] === fk) ||
          model.fields.some((f) => f.name === fk && (f.isUnique || f.isId));

        if (!hasIndex) {
          findings.push({
            id: `db-missing-fk-index-${model.name}-${fk}`,
            category: 'database',
            severity: 'high',
            title: `Missing index on foreign key: ${model.name}.${fk}`,
            description: `FK "${fk}" in model ${model.name} has no index, causing slow JOINs.`,
            file: 'prisma/schema.prisma',
            recommendation: `Add @@index([${fk}]) to the ${model.name} model.`,
          });
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 3. Check for missing cascade delete rules
  // ══════════════════════════════════════════════════════════════════════

  for (const model of models) {
    for (const relation of model.relations) {
      if (!relation.fields) continue;
      if (!relation.onDelete) {
        findings.push({
          id: `db-no-cascade-${model.name}-${relation.name}`,
          category: 'database',
          severity: 'low',
          title: `No onDelete rule: ${model.name}.${relation.name}`,
          description: `Relation "${relation.name}" in ${model.name} uses default onDelete behavior.`,
          file: 'prisma/schema.prisma',
          recommendation:
            'Explicitly set onDelete (Cascade, SetNull, Restrict) based on business rules.',
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 4. Check for large text fields without length limits
  // ══════════════════════════════════════════════════════════════════════

  for (const model of models) {
    for (const field of model.fields) {
      if (field.type === 'String' && !field.dbType && !field.isId) {
        findings.push({
          id: `db-no-length-${model.name}-${field.name}`,
          category: 'database',
          severity: 'low',
          title: `String field without length constraint: ${model.name}.${field.name}`,
          description: `"${field.name}" has no @db.VarChar or @db.Text annotation.`,
          file: 'prisma/schema.prisma',
          recommendation: 'Add @db.VarChar(N) or @db.Text to constrain storage.',
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 5. Check for soft delete patterns
  // ══════════════════════════════════════════════════════════════════════

  const hasDeletedAt = models.some((m) =>
    m.fields.some((f) => f.name === 'deletedAt' || f.name === 'isDeleted'),
  );

  const usesHardDelete = files.some((f) => /\.delete\(|\.deleteMany\(/.test(f.content));

  if (!hasDeletedAt && usesHardDelete) {
    findings.push({
      id: 'db-no-soft-delete',
      category: 'database',
      severity: 'low',
      title: 'No soft delete implementation',
      description: 'Hard deletes are used but no deletedAt/isDeleted fields exist in any model.',
      recommendation:
        'Consider adding soft delete (deletedAt DateTime?) for data recovery and audit trails.',
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 6. Check connection pool configuration
  // ══════════════════════════════════════════════════════════════════════

  if (!/connection_limit|pool_size|pool_timeout/i.test(schemaContent)) {
    findings.push({
      id: 'db-no-pool-config',
      category: 'database',
      severity: 'medium',
      title: 'No database connection pool configuration',
      description: 'DATABASE_URL does not appear to include connection pool parameters.',
      file: 'prisma/schema.prisma',
      recommendation: 'Add ?connection_limit=10&pool_timeout=30 to DATABASE_URL for production.',
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 7. Redundant indexes
  // ══════════════════════════════════════════════════════════════════════

  for (const model of models) {
    for (let i = 0; i < model.indexes.length; i++) {
      for (let j = 0; j < model.indexes.length; j++) {
        if (i === j) continue;
        const a = model.indexes[i];
        const b = model.indexes[j];

        // Check if b is a prefix of a (making b redundant)
        if (
          b.fields.length < a.fields.length &&
          b.fields.every((f, idx) => a.fields[idx] === f) &&
          !b.isUnique
        ) {
          findings.push({
            id: `db-redundant-index-${model.name}-${b.fields.join('-')}`,
            category: 'database',
            severity: 'low',
            title: `Potentially redundant index in ${model.name}`,
            description: `Index [${b.fields.join(', ')}] is a prefix of [${a.fields.join(', ')}].`,
            file: 'prisma/schema.prisma',
            recommendation:
              'The composite index covers the single-column index. Consider removing the shorter one.',
          });
        }
      }
    }
  }

  return { findings, models };
}
