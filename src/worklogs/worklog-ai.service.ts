import { Injectable, Logger } from '@nestjs/common';

export interface AiEvaluation {
  score: number;
  feedback: string;
  verdict: 'Valid' | 'Needs Review';
}

interface ScoringRule {
  pattern: RegExp;
  pts: number;
  label: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Score budget (max 100, before vague penalty):
//   1. Word count        0–15 pts
//   2. Domain keywords   0–30 pts
//   3. Artifact refs     0–15 pts
//   4. Action verbs      0–15 pts
//   5. Writing quality   0–15 pts  ← rewards plain-text descriptive prose
//   6. Length bonus      0–10 pts
// ─────────────────────────────────────────────────────────────────────────────

// Dimension 2 — domain keyword coverage (0–30 pts)
// Sum of all rule pts = 57; capped at 30. Any 4+ rules matched fully covers the cap.
const DOMAIN_RULES: ScoringRule[] = [
  {
    pattern:
      /\b(api|endpoint|route|controller|service|module|component|hook|util|helper|middleware|handler|resolver|interceptor|repository|provider)\b/gi,
    pts: 7,
    label: 'architecture',
  },
  {
    pattern:
      /\b(bug|fix|patch|issue|ticket|pr|pull request|merge|refactor|optimize|implement|integrate|deploy|release|hotfix|revert)\b/gi,
    pts: 7,
    label: 'engineering action',
  },
  {
    pattern:
      /\b(test|spec|unit test|integration test|e2e|coverage|mock|stub|assertion|jest|cypress|playwright)\b/gi,
    pts: 6,
    label: 'testing',
  },
  {
    pattern:
      /\b(database|query|schema|migration|index|model|prisma|sql|orm|seed|relation|transaction|metadata|versioning)\b/gi,
    pts: 6,
    label: 'data layer',
  },
  {
    pattern:
      /\b(auth|authentication|authorization|token|jwt|oauth|session|permission|guard|rbac|acl|2fa|mfa|access.control)\b/gi,
    pts: 6,
    label: 'auth/security',
  },
  {
    pattern:
      /\b(ui|ux|layout|component|responsive|animation|modal|form|button|style|css|tailwind|design|accessibility|a11y)\b/gi,
    pts: 5,
    label: 'UI/UX',
  },
  {
    pattern:
      /\b(performance|cach(e|ing)|redis|queue|async|await|concurren(t|cy)|memory|optim|throttle|debounce|lazy)\b/gi,
    pts: 6,
    label: 'performance',
  },
  {
    pattern:
      /\b(ci|cd|pipeline|docker|kubernetes|k8s|aws|gcp|azure|deploy|infra|environment|config|nginx|proxy)\b/gi,
    pts: 5,
    label: 'devops',
  },
  // Business / project-management vocabulary — rewards non-engineering roles fairly
  {
    pattern:
      /\b(backlog|user.stor(y|ies)|acceptance.criteria|roadmap|milestone|epic|sprint|standup|retrospective|kanban|scrum|agile|stakeholder|requirement|dependency|blocker|scope|estimation|priorit(y|ies)|categoriz|classif)\b/gi,
    pts: 6,
    label: 'planning/management',
  },
  // Documentation and process quality
  {
    pattern:
      /\b(documentation|workflow|process|validation|review|audit|report|specification|handover|onboarding|policy|procedure|standard|guideline|checklist|template)\b/gi,
    pts: 5,
    label: 'process/docs',
  },
];

// Dimension 3 — specific artifact references (0–15 pts)
// NOTE: no /g flag on patterns used with .test() — global flag makes .test() stateful
const ARTIFACT_PATTERNS: RegExp[] = [
  // PascalCase named constructs (e.g. UserAuthService, DashboardComponent)
  /[A-Z][a-z]+(?:[A-Z][a-z]+)+(Service|Component|Controller|Hook|Module|Guard|Pipe|Filter|Interceptor|Resolver|Repository)/,
  // Ticket / issue references: #123 or PROJ-456
  /#\d+|[A-Z]{2,}-\d+/,
  // Semantic version tags
  /v\d+\.\d+(\.\d+)?/,
  // File references with a meaningful extension
  /\b\w[\w-]*\.(ts|tsx|js|jsx|json|yaml|yml|sql|css|scss|html|env)\b/i,
  // Inline code snippets
  /`[^`]+`/,
  // Bracketed labels [BUG] [DONE] etc.
  /\[\w[\w\s-]*\]/,
  // kebab-case identifiers (route names, npm packages, branch segments)
  /\b[a-z]{2,}-[a-z]{2,}(?:-[a-z]{2,})*\b/,
  // HTTP-style URLs
  /https?:\/\/\S+/,
  // Git branch prefixes (feature/fix/chore/feat/hotfix)
  /\b(feature|fix|hotfix|chore|feat)\/[\w-]+/i,
];

// Dimension 4 — action verbs & structure (0–15 pts)
// No /g flag — .test() on a global regex is stateful (persists lastIndex across calls)
const ACTION_VERB_GROUPS: RegExp[] = [
  /\b(implemented|built|created|developed|wrote|coded|scaffolded|established)\b/i,
  /\b(fixed|resolved|patched|debugged|investigated|diagnosed|traced|identified)\b/i,
  /\b(refactored|optimized|improved|cleaned|reorganized|simplified|extracted|streamlined)\b/i,
  /\b(reviewed|tested|verified|validated|audited|checked|inspected|assessed)\b/i,
  /\b(deployed|released|shipped|merged|integrated|migrated|upgraded|delivered)\b/i,
  /\b(designed|planned|architected|documented|researched|analyzed|scoped|outlined|structured)\b/i,
];

// Matches bullet-point or numbered-list structure
const HAS_STRUCTURE_PATTERN = /^[ \t]*[-*•]\s+\w|^[ \t]*\d+[.)]\s+\w/m;

// Dimension 5 — writing quality sub-patterns (each sub-group worth 0–5 pts → max 15)
// Rewards well-reasoned plain-English prose from any role.

// 5a: Purposeful language — explains the WHY behind the work
const PURPOSEFUL_PATTERNS: RegExp[] = [
  /\bin order to\b/i,
  /\bto ensure\b/i,
  /\bthe goal was\b/i,
  /\bto address\b/i,
  /\bwith the aim\b/i,
  /\baiming to\b/i,
  /\bso that\b/i,
  /\bto improve\b/i,
  /\bto resolve\b/i,
  /\bto reduce\b/i,
  /\bto prevent\b/i,
  /\bto better understand\b/i,
  /\bthis was (to|needed)\b/i,
  /\bthis involved\b/i,
  /\bthe objective (was|is)\b/i,
];

// 5b: Analytical language — shows thinking, not just listing
const ANALYTICAL_PATTERNS: RegExp[] = [
  /\banalyz(ed|ing)\b/i,
  /\bidentif(ied|ying)\b/i,
  /\beval(uated|uating)\b/i,
  /\bexamin(ed|ing)\b/i,
  /\basses(sed|sing)\b/i,
  /\bmapp(ed|ing)\b/i,
  /\boutlin(ed|ing)\b/i,
  /\bpropos(ed|ing)\b/i,
  /\bcomparing\b/i,
  /\bprioritiz(ed|ing)\b/i,
  /\binvestigat(ed|ing)\b/i,
  /\bdiagnos(ed|ing)\b/i,
];

// 5c: Outcome / impact framing — shows what changed or was achieved
const OUTCOME_PATTERNS: RegExp[] = [
  /\bconsistency\b/i,
  /\bclarity\b/i,
  /\balign(ed|ment)\b/i,
  /\bprogress\b/i,
  /\bdelivered\b/i,
  /\bachieved\b/i,
  /\bensured\b/i,
  /\bimproved\b/i,
  /\bresolved\b/i,
  /\baddressed\b/i,
  /\bcomplet(ed|ion)\b/i,
  /\bmitigat(ed|ing)\b/i,
  /\bimpact\b/i,
  /\boutcome\b/i,
  /\bresult(ed|ing)?\b/i,
];

// Vague language — each match deducts 15 pts (max –30)
const VAGUE_PATTERNS: RegExp[] = [
  /\bworked\s+on\s+(the\s+)?(project|stuff|things?|tasks?|various|features?)\b/i,
  /\bdid\s+(some|misc|various|general|a\s+few)\b/i,
  /\bgeneral\s+(tasks?|work|development|coding|programming)\b/i,
  /\bmisc(ellaneous)?\s+tasks?\b/i,
  /\bvarious\s+(tasks?|things?|stuff)\b/i,
  /\bjust\s+(coding|developing|working)\b/i,
  /\bupdated\s+(the\s+)?(things?|stuff|tasks?)\b/i,
  /\bworked\s+today\b/i,
  /\bdone\s+with\s+(the\s+)?(tasks?|work)\b/i,
  /\bnormal\s+(day|work|tasks?)\b/i,
];

@Injectable()
export class WorklogAiService {
  private readonly logger = new Logger(WorklogAiService.name);
  private readonly SCORE_THRESHOLD = 50;

  evaluate(content: string): AiEvaluation {
    try {
      return this.heuristicEvaluate(content.trim());
    } catch (_err) {
      this.logger.warn('Worklog evaluation failed, applying default score');
      return {
        score: 0,
        feedback: 'Evaluation was unavailable. Please add more specific details about your work.',
        verdict: 'Needs Review',
      };
    }
  }

  private heuristicEvaluate(content: string): AiEvaluation {
    let score = 0;
    const strengths: string[] = [];
    const issues: string[] = [];

    // ── 1. Word count (0–15 pts) ──────────────────────────────────────────────
    // Full 15 pts at ≥ 80 words; linear below that.
    const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;
    if (wordCount < 10) {
      return {
        score: 0,
        feedback: 'Log is too short. Describe what you worked on with at least a few sentences.',
        verdict: 'Needs Review',
      };
    }
    const wordPts = Math.min(15, Math.floor((wordCount / 80) * 15));
    score += wordPts;
    if (wordCount >= 80) strengths.push('good detail length');
    else issues.push('aim for 80+ words for a full word-count score');

    // ── 2. Domain keyword coverage (0–30 pts) ────────────────────────────────
    const matchedLabels: string[] = [];
    let domainPts = 0;
    for (const rule of DOMAIN_RULES) {
      if (content.match(rule.pattern)) {
        domainPts += rule.pts;
        matchedLabels.push(rule.label);
      }
    }
    domainPts = Math.min(30, domainPts);
    score += domainPts;
    if (matchedLabels.length >= 3) {
      strengths.push(`covers ${matchedLabels.slice(0, 3).join(', ')}`);
    } else if (matchedLabels.length === 0) {
      issues.push('mention specific technical or business areas worked on');
    } else {
      issues.push('add more domain context — cover at least 3 areas for full marks');
    }

    // ── 3. Specific artifact references (0–15 pts) ───────────────────────────
    // Tiered: 2+ distinct pattern types → 15, exactly 1 → 8, bare digit → 3, none → 0.
    const artifactHits = ARTIFACT_PATTERNS.filter((p) => p.test(content)).length;
    if (artifactHits >= 2) {
      score += 15;
      strengths.push('references specific artifacts');
    } else if (artifactHits === 1) {
      score += 8;
      issues.push('add a second specific reference (ticket number, file name, or component name)');
    } else if (/\d+/.test(content)) {
      score += 3;
      issues.push('reference named artifacts — component names, ticket IDs, or file names');
    } else {
      issues.push('include specific references: ticket numbers, component names, or file names');
    }

    // ── 4. Action verbs & structure (0–15 pts) ───────────────────────────────
    // Up to 10 pts from verb groups (3 pts each, capped at 10).
    // +5 bonus pts when the log uses bullet / numbered list formatting.
    const verbGroupHits = ACTION_VERB_GROUPS.filter((p) => p.test(content)).length;
    let actionPts = Math.min(10, verbGroupHits * 3);
    if (HAS_STRUCTURE_PATTERN.test(content)) {
      actionPts = Math.min(15, actionPts + 5);
      strengths.push('well-structured log');
    }
    score += actionPts;
    if (verbGroupHits === 0) {
      issues.push(
        'use specific action verbs — implemented, fixed, reviewed, analyzed, planned, etc.',
      );
    } else if (verbGroupHits >= 3) {
      strengths.push('strong action verbs');
    }

    // ── 5. Writing quality (0–15 pts) ────────────────────────────────────────
    // Three sub-groups worth 0–5 pts each. Rewards clear, purposeful plain-English
    // prose regardless of whether the author is an engineer, PM, or designer.
    const purposefulHits = PURPOSEFUL_PATTERNS.filter((p) => p.test(content)).length;
    const analyticalHits = ANALYTICAL_PATTERNS.filter((p) => p.test(content)).length;
    const outcomeHits = OUTCOME_PATTERNS.filter((p) => p.test(content)).length;

    const purposePts =
      purposefulHits >= 3 ? 5 : purposefulHits === 2 ? 4 : purposefulHits === 1 ? 2 : 0;
    const analyticalPts =
      analyticalHits >= 3 ? 5 : analyticalHits === 2 ? 4 : analyticalHits === 1 ? 2 : 0;
    const outcomePts = outcomeHits >= 3 ? 5 : outcomeHits === 2 ? 4 : outcomeHits === 1 ? 2 : 0;

    const writingQualityPts = Math.min(15, purposePts + analyticalPts + outcomePts);
    score += writingQualityPts;

    if (writingQualityPts >= 10) strengths.push('clear purpose and outcomes described');
    else if (writingQualityPts >= 5) strengths.push('good descriptive writing');
    else issues.push('explain why you did things and what the outcome was');

    // ── 6. Length bonus (0–10 pts) ────────────────────────────────────────────
    if (wordCount >= 150) {
      score += 10;
      strengths.push('comprehensive log');
    } else if (wordCount >= 120) {
      score += 7;
    } else if (wordCount >= 100) {
      score += 4;
    } else if (wordCount >= 80) {
      score += 2;
    }

    // ── 7. Vague language penalty (–15 per phrase, max –30) ──────────────────
    let vagueCount = 0;
    for (const pattern of VAGUE_PATTERNS) {
      if (pattern.test(content)) vagueCount++;
    }
    if (vagueCount > 0) {
      score -= Math.min(30, vagueCount * 15);
      issues.push('avoid vague phrases — be specific about what you built, fixed, or reviewed');
    }

    score = Math.max(0, Math.min(100, score));
    const verdict = score >= this.SCORE_THRESHOLD ? 'Valid' : 'Needs Review';

    return { score, feedback: this.buildFeedback(score, strengths, issues), verdict };
  }

  private buildFeedback(score: number, strengths: string[], issues: string[]): string {
    const parts: string[] = [];

    if (strengths.length > 0) parts.push(`Good: ${strengths.join(', ')}.`);
    if (issues.length > 0) parts.push(`To improve: ${issues.join('; ')}.`);

    if (parts.length === 0) {
      if (score >= 80) return 'Excellent worklog! Great technical detail and specificity.';
      if (score >= 60)
        return 'Solid log. Adding component names or ticket references would boost your score.';
      return 'Decent start. Add technical specifics and explain the purpose behind your work.';
    }

    return parts.join(' ');
  }
}
