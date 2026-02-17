/* ══════════════════════════════════════════════════════════════════════════
   NestJS Project Analyzer — Shared Types
   ══════════════════════════════════════════════════════════════════════════ */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type Category =
  | 'api'
  | 'performance'
  | 'security'
  | 'database'
  | 'architecture'
  | 'code-quality'
  | 'dependencies';

export interface Finding {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  file?: string;
  line?: number;
  recommendation: string;
  code?: string; // snippet
}

export interface EndpointInfo {
  method: string;
  route: string;
  controller: string;
  handler: string;
  file: string;
  line: number;
  guards: string[];
  pipes: string[];
  interceptors: string[];
  decorators: string[];
  isPublic: boolean;
  hasValidation: boolean;
  hasPagination: boolean;
  responseDto?: string;
  requestDto?: string;
}

export interface PrismaModel {
  name: string;
  tableName?: string;
  fields: PrismaField[];
  indexes: PrismaIndex[];
  relations: PrismaRelation[];
}

export interface PrismaField {
  name: string;
  type: string;
  isOptional: boolean;
  isUnique: boolean;
  isId: boolean;
  hasDefault: boolean;
  dbType?: string;
}

export interface PrismaIndex {
  fields: string[];
  isUnique: boolean;
}

export interface PrismaRelation {
  name: string;
  model: string;
  fields?: string[];
  references?: string[];
  onDelete?: string;
}

export interface ModuleInfo {
  name: string;
  file: string;
  imports: string[];
  controllers: string[];
  providers: string[];
  exports: string[];
}

export interface DependencyInfo {
  name: string;
  version: string;
  isDev: boolean;
  latestVersion?: string;
  isOutdated?: boolean;
  vulnerabilities?: { severity: string; title: string }[];
}

export interface CategoryScore {
  category: Category;
  score: number; // 0-100
  findings: Finding[];
  summary: string;
}

export interface AnalysisReport {
  projectName: string;
  analyzedAt: string;
  version: string;
  overallScore: number;
  executionTimeMs: number;
  summary: string;
  categories: CategoryScore[];
  endpoints: EndpointInfo[];
  models: PrismaModel[];
  modules: ModuleInfo[];
  dependencies: DependencyInfo[];
  stats: ProjectStats;
}

export interface ProjectStats {
  totalFiles: number;
  totalLines: number;
  controllers: number;
  services: number;
  modules: number;
  endpoints: number;
  models: number;
  entities: number;
  testFiles: number;
  dtoFiles: number;
}

export interface AnalyzerConfig {
  srcDir: string;
  prismaSchemaPath: string;
  packageJsonPath: string;
  envExamplePath?: string;
  exclude: string[];
  rules: {
    maxCyclomaticComplexity: number;
    maxFileLines: number;
    maxFunctionLines: number;
    requireTestCoverage: boolean;
    requireDtoValidation: boolean;
    requireAuthOnEndpoints: boolean;
  };
}
