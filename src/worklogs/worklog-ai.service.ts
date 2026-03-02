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

const TECHNICAL_RULES: ScoringRule[] = [
  {
    pattern:
      /\b(api|endpoint|route|controller|service|module|component|hook|util|helper|middleware|handler|resolver|interceptor)\b/gi,
    pts: 8,
    label: 'architecture',
  },
  {
    pattern:
      /\b(bug|fix|patch|issue|ticket|pr|pull request|merge|refactor|optimize|implement|integrate|deploy|release)\b/gi,
    pts: 8,
    label: 'engineering action',
  },
  {
    pattern: /\b(test|spec|unit test|integration test|e2e|coverage|mock|stub|assertion)\b/gi,
    pts: 6,
    label: 'testing',
  },
  {
    pattern: /\b(database|query|schema|migration|index|model|prisma|sql|orm|seed)\b/gi,
    pts: 6,
    label: 'data layer',
  },
  {
    pattern:
      /\b(auth|authentication|authorization|token|jwt|oauth|session|permission|guard|rbac|acl)\b/gi,
    pts: 6,
    label: 'auth/security',
  },
  {
    pattern:
      /\b(ui|ux|layout|component|responsive|animation|modal|form|button|style|css|tailwind|design)\b/gi,
    pts: 5,
    label: 'UI/UX',
  },
  {
    pattern: /\b(performance|cach(e|ing)|redis|queue|async|await|concurren(t|cy)|memory|optim)\b/gi,
    pts: 6,
    label: 'performance',
  },
  {
    pattern:
      /\b(ci|cd|pipeline|docker|kubernetes|k8s|aws|gcp|azure|deploy|infra|environment|config)\b/gi,
    pts: 5,
    label: 'devops',
  },
];

const VAGUE_PATTERNS: RegExp[] = [
  /\bworked\s+on\s+(the\s+)?(project|stuff|things?|tasks?|various|features?)\b/gi,
  /\bdid\s+(some|misc|various|general|a\s+few)\b/gi,
  /\bgeneral\s+(tasks?|work|development|coding|programming)\b/gi,
  /\bmisc(ellaneous)?\s+tasks?\b/gi,
  /\bvarious\s+(tasks?|things?|stuff)\b/gi,
  /\bjust\s+(coding|developing|working)\b/gi,
];

const SPECIFIC_REF_PATTERN =
  /([A-Z][A-Za-z0-9]+Service|[A-Z][A-Za-z0-9]+Component|[A-Z][A-Za-z0-9]+Controller|#\d+|v\d+\.\d+|\w+\.\w{2,4}|`[^`]+`|\[\w+\])/;

@Injectable()
export class WorklogAiService {
  private readonly logger = new Logger(WorklogAiService.name);
  private readonly SCORE_THRESHOLD = 50;

  evaluate(content: string): AiEvaluation {
    try {
      return this.heuristicEvaluate(content.trim());
    } catch (err) {
      this.logger.warn('AI evaluation failed, applying default score');
      return {
        score: 0,
        feedback:
          'AI evaluation was unavailable. Please add more specific technical details about your work.',
        verdict: 'Needs Review',
      };
    }
  }

  private heuristicEvaluate(content: string): AiEvaluation {
    let score = 0;
    const strengths: string[] = [];
    const issues: string[] = [];

    // ── 1. Word count (0–20 pts) ─────────────────────────────────────────────
    const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;
    if (wordCount < 10) {
      return {
        score: 0,
        feedback: 'Log is too short. Describe what you worked on with at least a few sentences.',
        verdict: 'Needs Review',
      };
    }
    const wordPts = Math.min(20, Math.floor((wordCount / 60) * 20));
    score += wordPts;
    if (wordCount >= 60) strengths.push('good detail length');
    else issues.push('add more detail — aim for 60+ words');

    // ── 2. Technical keyword coverage (0–40 pts) ─────────────────────────────
    const matchedLabels: string[] = [];
    let techPts = 0;
    for (const rule of TECHNICAL_RULES) {
      const matches = content.match(rule.pattern);
      if (matches && matches.length > 0) {
        techPts += rule.pts;
        matchedLabels.push(rule.label);
      }
    }
    techPts = Math.min(40, techPts);
    score += techPts;
    if (matchedLabels.length >= 3) strengths.push(`covers ${matchedLabels.slice(0, 3).join(', ')}`);
    else if (matchedLabels.length === 0) issues.push('mention specific technical areas worked on');
    else issues.push('add more technical context (e.g. component names, endpoints, ticket refs)');

    // ── 3. Specific artifact references (0–15 pts) ───────────────────────────
    if (SPECIFIC_REF_PATTERN.test(content)) {
      score += 15;
      strengths.push('references specific artifacts');
    } else if (/\d+/.test(content)) {
      score += 5;
    } else {
      issues.push('reference specific items like component names, ticket numbers, or file names');
    }

    // ── 4. Length bonus (0–10 pts) ────────────────────────────────────────────
    if (wordCount >= 100) {
      score += 10;
      strengths.push('comprehensive log');
    } else if (wordCount >= 80) {
      score += 5;
    }

    // ── 5. Vague language penalty (–15 pts per phrase, max –30) ──────────────
    let vagueCount = 0;
    for (const pattern of VAGUE_PATTERNS) {
      if (pattern.test(content)) {
        vagueCount++;
      }
    }
    if (vagueCount > 0) {
      score -= Math.min(30, vagueCount * 15);
      issues.push('avoid vague phrases — be specific about what you built, fixed, or reviewed');
    }

    score = Math.max(0, Math.min(100, score));
    const verdict = score >= this.SCORE_THRESHOLD ? 'Valid' : 'Needs Review';

    const feedback = this.buildFeedback(score, strengths, issues);
    return { score, feedback, verdict };
  }

  private buildFeedback(score: number, strengths: string[], issues: string[]): string {
    const parts: string[] = [];

    if (strengths.length > 0) {
      parts.push(`Good: ${strengths.join(', ')}.`);
    }

    if (issues.length > 0) {
      parts.push(`To improve: ${issues.join('; ')}.`);
    }

    if (parts.length === 0) {
      if (score >= 80) return 'Excellent worklog! Great technical detail and specificity.';
      if (score >= 60)
        return 'Solid log. Adding component names or ticket references would boost your score.';
      return 'Decent start. Add technical specifics — component names, endpoints, or bug ticket numbers.';
    }

    return parts.join(' ');
  }
}
