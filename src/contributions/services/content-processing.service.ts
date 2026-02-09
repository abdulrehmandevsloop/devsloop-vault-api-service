import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { inflateSync } from 'node:zlib';

/**
 * Marker prefix used to identify legacy compressed content stored in the database.
 * Format: "CZ:" + base64-encoded deflated content.
 * New data is no longer compressed (to support Elasticsearch full-text search),
 * but existing compressed rows are still decompressed on read for backward compat.
 */
const COMPRESSED_PREFIX = 'CZ:';

/**
 * Allowed HTML tags for rich-text content (Quill editor output).
 * Strips everything dangerous (scripts, iframes, event handlers) while
 * preserving safe formatting.
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    // Block elements
    'p',
    'br',
    'div',
    'blockquote',
    'pre',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    // Inline formatting
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'strike',
    'del',
    'sub',
    'sup',
    'code',
    'span',
    // Lists
    'ul',
    'ol',
    'li',
    // Links & images
    'a',
    'img',
    // Tables
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    span: ['class', 'style'],
    p: ['class'],
    div: ['class'],
    pre: ['class'],
    code: ['class'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
  },
  allowedStyles: {
    '*': {
      color: [/.*/],
      'background-color': [/.*/],
      'text-align': [/^(left|right|center|justify)$/],
      'font-size': [/.*/],
    },
  },
  // Force all links to open in new tab safely
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', {
      target: '_blank',
      rel: 'noopener noreferrer',
    }),
  },
  // Strip everything else (scripts, iframes, event handlers, etc.)
  disallowedTagsMode: 'discard',
};

/**
 * Sanitize options for plain-text fields (problem).
 * Strips ALL HTML tags — only plain text allowed.
 */
const PLAIN_TEXT_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
};

@Injectable()
export class ContentProcessingService {
  private readonly logger = new Logger(ContentProcessingService.name);

  // ─── Sanitization ──────────────────────────────────────────────────

  /**
   * Sanitize rich-text HTML content (solution, outcome, learnings).
   * Preserves safe formatting tags; strips scripts, event handlers, etc.
   */
  sanitizeRichText(content: string): string {
    if (!content) return content;
    return sanitizeHtml(content, SANITIZE_OPTIONS).trim();
  }

  /**
   * Sanitize plain-text content (problem).
   * Strips ALL HTML tags — only plain text is stored.
   */
  sanitizePlainText(content: string): string {
    if (!content) return content;
    return sanitizeHtml(content, PLAIN_TEXT_SANITIZE_OPTIONS).trim();
  }

  // ─── Decompression (backward compat for legacy compressed data) ────

  /**
   * Decompress a string if it has the legacy compressed prefix.
   * If the string isn't compressed, returns it as-is.
   * Kept for backward compatibility with existing compressed rows in the DB.
   */
  decompress(content: string | null): string | null {
    if (!content) return content;

    if (!content.startsWith(COMPRESSED_PREFIX)) {
      return content; // Not compressed — return as-is
    }

    try {
      const base64 = content.slice(COMPRESSED_PREFIX.length);
      const decompressed = inflateSync(Buffer.from(base64, 'base64'));
      return decompressed.toString('utf-8');
    } catch (error) {
      this.logger.error(`Decompression failed, returning raw content: ${(error as Error).message}`);
      return content; // Fail-safe: return the raw string
    }
  }

  // ─── Combined Processing ───────────────────────────────────────────

  /**
   * Sanitize rich-text HTML for storage.
   * Use for solution, outcome, and learnings fields.
   */
  processRichTextForStorage(content: string): string {
    if (!content) return content;
    return this.sanitizeRichText(content);
  }

  /**
   * Sanitize plain-text and return (no compression for short plain text like problem).
   */
  processPlainTextForStorage(content: string): string {
    if (!content) return content;
    return this.sanitizePlainText(content);
  }

  /**
   * Process content for API response.
   * Handles legacy compressed strings transparently.
   */
  processForResponse(content: string | null): string | null {
    return this.decompress(content);
  }

  /**
   * Process an entire contribution record for API response.
   * Decompresses legacy compressed solution, outcome, and learnings fields.
   * For new (uncompressed) data this is a no-op pass-through.
   */
  decompressContribution<
    T extends { solution: string; outcome: string | null; learnings: string | null },
  >(contribution: T): T {
    return {
      ...contribution,
      solution: this.decompress(contribution.solution) ?? contribution.solution,
      outcome: this.decompress(contribution.outcome),
      learnings: this.decompress(contribution.learnings),
    };
  }

  /**
   * Process an array of contribution records for API response.
   */
  decompressContributions<
    T extends { solution: string; outcome: string | null; learnings: string | null },
  >(contributions: T[]): T[] {
    return contributions.map((c) => this.decompressContribution(c));
  }

  // ─── Utility: Sanitize toolsAndTechnologies array ──────────────────

  /**
   * Sanitize each item in the tools/technologies array.
   * Strips HTML, trims whitespace, removes empty entries.
   */
  sanitizeToolsArray(tools: string[]): string[] {
    if (!tools || tools.length === 0) return tools;
    return tools
      .map((t) => sanitizeHtml(t, PLAIN_TEXT_SANITIZE_OPTIONS).trim())
      .filter((t) => t.length > 0);
  }

  // ─── Plain Text Length ─────────────────────────────────────────────

  /**
   * Strips HTML tags and entities, returns plain text length.
   * Mirrors the frontend `getPlainTextLength()` helper exactly.
   */
  getPlainTextLength(html: string): number {
    if (!html) return 0;
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&[a-z]+;/gi, '')
      .trim().length;
  }

  // ─── Post-Sanitization Validation ──────────────────────────────────

  /**
   * Validate plain text lengths of contribution fields AFTER sanitization.
   * This is a safety net — the DTO validators check pre-sanitized input,
   * but sanitization can shorten content. Throws BadRequestException
   * if any field falls outside its allowed range after sanitization.
   */
  validateSanitizedLengths(fields: {
    problem?: string;
    solution?: string;
    outcome?: string;
    learnings?: string;
  }): void {
    const errors: string[] = [];

    if (fields.problem !== undefined) {
      const len = fields.problem.length;
      if (len < 10)
        errors.push('Problem description must be at least 10 characters after sanitization');
      if (len > 1000)
        errors.push('Problem description must be less than 1000 characters after sanitization');
    }

    if (fields.solution !== undefined) {
      const len = this.getPlainTextLength(fields.solution);
      if (len < 50) errors.push('Solution must be at least 50 characters after sanitization');
      if (len > 10000)
        errors.push('Solution must be less than 10,000 characters after sanitization');
    }

    if (fields.outcome !== undefined) {
      const len = this.getPlainTextLength(fields.outcome);
      if (len < 20) errors.push('Outcome must be at least 20 characters after sanitization');
      if (len > 5000) errors.push('Outcome must be less than 5,000 characters after sanitization');
    }

    if (fields.learnings !== undefined) {
      const len = this.getPlainTextLength(fields.learnings);
      if (len < 20) errors.push('Learnings must be at least 20 characters after sanitization');
      if (len > 5000)
        errors.push('Learnings must be less than 5,000 characters after sanitization');
    }

    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }
  }
}
