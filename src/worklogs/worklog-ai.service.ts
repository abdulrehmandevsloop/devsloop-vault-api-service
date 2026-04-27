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

// Dimension 2 — technical keyword coverage (0–35 pts, sum of all rules = 50 → capped at 35)
const TECHNICAL_RULES: ScoringRule[] = [
  {
    pattern:
      /\b(api|endpoint|route|controller|service|module|component|hook|util|helper|middleware|handler|resolver|interceptor|repository|provider)\b/gi,
    pts: 8,
    label: 'architecture',
  },
  {
    pattern:
      /\b(bug|fix|patch|issue|ticket|pr|pull request|merge|refactor|optimize|implement|integrate|deploy|release|hotfix|revert)\b/gi,
    pts: 8,
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
      /\b(database|query|schema|migration|index|model|prisma|sql|orm|seed|relation|transaction)\b/gi,
    pts: 6,
    label: 'data layer',
  },
  {
    pattern:
      /\b(auth|authentication|authorization|token|jwt|oauth|session|permission|guard|rbac|acl|2fa|mfa)\b/gi,
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
];

// Dimension 3 — specific artifact references (0–15 pts)
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

// Dimension 4 — action verbs (0–10 pts from verbs; +5 bonus for structured formatting)
// NOTE: no /g flag — .test() on a global regex is stateful (persists lastIndex across calls)
const ACTION_VERB_GROUPS: RegExp[] = [
  /\b(implemented|built|created|developed|wrote|coded|scaffolded)\b/i,
  /\b(fixed|resolved|patched|debugged|investigated|diagnosed|traced)\b/i,
  /\b(refactored|optimized|improved|cleaned|reorganized|simplified|extracted)\b/i,
  /\b(reviewed|tested|verified|validated|audited|checked|inspected)\b/i,
  /\b(deployed|released|shipped|merged|integrated|migrated|upgraded)\b/i,
  /\b(designed|planned|architected|documented|researched|analyzed|scoped)\b/i,
];

// Matches bullet-point or numbered-list structure
const HAS_STRUCTURE_PATTERN = /^[ \t]*[-*•]\s+\w|^[ \t]*\d+[.)]\s+\w/m;

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

  // Score budget: 20 + 35 + 15 + 15 + 15 = 100 (before vague penalty)
  evaluate(content: string): AiEvaluation {
    try {
      return this.heuristicEvaluate(content.trim());
    } catch (err) {
      this.logger.warn('Worklog evaluation failed, applying default score');
      return {
        score: 0,
        feedback:
          'Evaluation was unavailable. Please add more specific technical details about your work.',
        verdict: 'Needs Review',
      };
    }
  }

  private heuristicEvaluate(content: string): AiEvaluation {
    let score = 0;
    const strengths: string[] = [];
    const issues: string[] = [];

    // ── 1. Word count (0–20 pts) ─────────────────────────────────────────────
    // Full 20 pts at ≥ 80 words; linear below that.
    const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;
    if (wordCount < 10) {
      return {
        score: 0,
        feedback: 'Log is too short. Describe what you worked on with at least a few sentences.',
        verdict: 'Needs Review',
      };
    }
    const wordPts = Math.min(20, Math.floor((wordCount / 80) * 20));
    score += wordPts;
    if (wordCount >= 80) strengths.push('good detail length');
    else issues.push('aim for 80+ words for a full word-count score');

    // ── 2. Technical keyword coverage (0–35 pts) ─────────────────────────────
    const matchedLabels: string[] = [];
    let techPts = 0;
    for (const rule of TECHNICAL_RULES) {
      if (content.match(rule.pattern)) {
        techPts += rule.pts;
        matchedLabels.push(rule.label);
      }
    }
    techPts = Math.min(35, techPts);
    score += techPts;
    if (matchedLabels.length >= 3) {
      strengths.push(`covers ${matchedLabels.slice(0, 3).join(', ')}`);
    } else if (matchedLabels.length === 0) {
      issues.push(
        'mention specific technical areas (architecture, data layer, auth, testing, etc.)',
      );
    } else {
      issues.push('add more technical context — cover at least 3 domains for full marks');
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
    // Up to 10 pts from action verb groups (3 pts each, capped at 10).
    // +5 bonus pts when the log uses a bullet / numbered list.
    const verbGroupHits = ACTION_VERB_GROUPS.filter((p) => p.test(content)).length;
    let actionPts = Math.min(10, verbGroupHits * 3);
    if (HAS_STRUCTURE_PATTERN.test(content)) {
      actionPts = Math.min(15, actionPts + 5);
      strengths.push('well-structured log');
    }
    score += actionPts;
    if (verbGroupHits === 0) {
      issues.push('use specific action verbs — implemented, fixed, refactored, deployed, etc.');
    } else if (verbGroupHits >= 3) {
      strengths.push('strong action verbs');
    }

    // ── 5. Length bonus (0–15 pts) ────────────────────────────────────────────
    // Rewards logs that go beyond the 80-word baseline.
    if (wordCount >= 150) {
      score += 15;
      strengths.push('comprehensive log');
    } else if (wordCount >= 120) {
      score += 10;
    } else if (wordCount >= 100) {
      score += 7;
    } else if (wordCount >= 80) {
      score += 3;
    }

    // ── 6. Vague language penalty (–15 per phrase, max –30) ──────────────────
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
      return 'Decent start. Add technical specifics — component names, endpoints, or bug ticket numbers.';
    }

    return parts.join(' ');
  }
}
