import { Injectable, Logger } from '@nestjs/common';

export interface WorklogNotificationPayload {
  userName: string;
  userEmail: string;
  projectId: string;
  projectName: string;
  date: Date;
  content: string;
  isLeave: boolean;
  aiScore: number | null;
  status: string;
  /** True when this is the first entry of the day (any project/type) across the channel. */
  isFirstOfDay: boolean;
  /** True when this is an edit of an existing worklog (not a new submission). */
  isEdit?: boolean;
}

export interface WorklogDeletedPayload {
  userName: string;
  userEmail: string;
  projectName: string;
  date: Date;
  /** Plain-text snippet of deleted content (max 200 chars, empty for leave entries). */
  contentSnippet: string;
  isLeave: boolean;
}

@Injectable()
export class GoogleChatService {
  private readonly logger = new Logger(GoogleChatService.name);

  /** Characters of plain text shown before the "Show more" fold. */
  private static readonly FOLD_AT = 300;

  /**
   * Convert Quill-produced HTML to the limited HTML subset that Google Chat
   * card textParagraph widgets support: <b>, <i>, <u>, <s>, <font color>,
   * <a href>, <br>.  Lists and headings are rendered with plain-text prefixes.
   */
  private static toGoogleChatHtml(html: string): string {
    return (
      html
        // Headings → bold text + line break
        .replace(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gis, '<b>$1</b><br>')
        // Ordered list items — number them sequentially
        .replace(/<ol[^>]*>(.*?)<\/ol>/gis, (_, inner: string) => {
          let i = 0;
          return inner.replace(
            /<li[^>]*>(.*?)<\/li>/gis,
            (_li: string, txt: string) => `${++i}. ${txt}<br>`,
          );
        })
        // Unordered list items → bullet
        .replace(/<ul[^>]*>(.*?)<\/ul>/gis, (_, inner: string) =>
          inner.replace(/<li[^>]*>(.*?)<\/li>/gis, (_li: string, txt: string) => `• ${txt}<br>`),
        )
        // Blockquote → guillemet prefix
        .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, '▎ $1<br>')
        // Paragraphs → trailing <br>
        .replace(/<\/p>/gi, '<br>')
        // <strong> / <em> → supported equivalents
        .replace(/<strong>/gi, '<b>')
        .replace(/<\/strong>/gi, '</b>')
        .replace(/<em>/gi, '<i>')
        .replace(/<\/em>/gi, '</i>')
        // <strike> is also supported
        .replace(/<strike>/gi, '<s>')
        .replace(/<\/strike>/gi, '</s>')
        // Strip any remaining tags except the ones Google Chat supports
        .replace(/<(?!\/?(?:b|i|u|s|a|br|font)\b)[^>]+>/gi, '')
        // Entity decode
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        // Collapse 3+ consecutive <br> to 2
        .replace(/(<br>\s*){3,}/gi, '<br><br>')
        .trim()
    );
  }

  async sendWorklogNotification(
    channelUrl: string,
    payload: WorklogNotificationPayload,
  ): Promise<void> {
    try {
      const dateKey = payload.date.toISOString().split('T')[0]; // "2026-03-10"
      // Single thread per calendar day — all worklogs and leaves share it.
      const threadKey = `daily-${dateKey}`;

      // Every message (date header + cards) goes to the same thread URL.
      // REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD creates the thread on the first call
      // and replies to it on every subsequent call with the same threadKey.
      const url = new URL(channelUrl);
      url.searchParams.set('threadKey', threadKey);
      url.searchParams.set('messageReplyOption', 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD');
      const threadUrl = url.toString();

      if (payload.isFirstOfDay) {
        // Step 1 — send the date header. Fully awaited so Google Chat has created
        // and acknowledged the thread before the worklog card arrives.
        await this.sendDateHeader(threadUrl, payload.date);
        this.logger.log(`Google Chat date header sent for thread: ${threadKey}`);
      }

      // Step 2 — send the worklog / leave card into the (now existing) thread.
      const card = payload.isLeave ? this.buildLeaveCard(payload) : this.buildWorklogCard(payload);
      const res = await fetch(threadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(card),
      });

      if (!res.ok) {
        const body = await res.text();
        this.logger.warn(`Google Chat API rejected card (${res.status}): ${body}`);
      } else {
        this.logger.log(
          `Google Chat notification sent — user: ${payload.userName}, project: ${payload.projectName}, leave: ${payload.isLeave}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to send Google Chat notification: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ─── Thread opener ────────────────────────────────────────────────────────────

  private async sendDateHeader(threadUrl: string, date: Date): Promise<void> {
    const dateStr = date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const res = await fetch(threadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: dateStr }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Date header rejected (${res.status}): ${body}`);
    }
  }

  // ─── Card builders ────────────────────────────────────────────────────────────

  private formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  private buildWorklogCard(payload: WorklogNotificationPayload): Record<string, unknown> {
    const { userName, userEmail, projectName, date, content, isEdit } = payload;

    // Convert Quill HTML → Google Chat-compatible HTML (preserves bold, italic, lists, etc.).
    const chatHtml = GoogleChatService.toGoogleChatHtml(content);
    // Measure visible length without tags to decide whether to fold.
    const needsFold = chatHtml.replace(/<[^>]+>/g, '').length > GoogleChatService.FOLD_AT;

    const editBadge = isEdit ? `  <font color="#f57c00"><b>✏️ Edited</b></font>` : '';

    const contentWidgets: Record<string, unknown>[] = [{ textParagraph: { text: chatHtml } }];

    return {
      cardsV2: [
        {
          cardId: `${Date.now()}`,
          card: {
            sections: [
              {
                collapsible: needsFold,
                uncollapsibleWidgetsCount: needsFold ? 2 : undefined,
                widgets: [
                  {
                    textParagraph: {
                      text:
                        `📝 <b>${userName}</b>${editBadge}<br>` +
                        `<font color="#5f6368">${userEmail}  ·  ${projectName}  ·  ${this.formatDate(date)}</font>`,
                    },
                  },
                  ...contentWidgets,
                ],
              },
            ],
          },
        },
      ],
    };
  }

  private buildLeaveCard(payload: WorklogNotificationPayload): Record<string, unknown> {
    const { userName, userEmail, projectName, date } = payload;

    return {
      cardsV2: [
        {
          cardId: `${Date.now()}`,
          card: {
            sections: [
              {
                collapsible: false,
                widgets: [
                  {
                    textParagraph: {
                      text:
                        `🌴 <b>${userName}</b>  <font color="#e53935"><b>— On Leave</b></font><br>` +
                        `<font color="#5f6368">${userEmail}  ·  ${projectName}  ·  ${this.formatDate(date)}</font>`,
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    };
  }

  // ─── Deletion notification ────────────────────────────────────────────────────

  async sendWorklogDeletedNotification(
    channelUrl: string,
    payload: WorklogDeletedPayload,
  ): Promise<void> {
    try {
      const dateKey = payload.date.toISOString().split('T')[0];
      const threadKey = `daily-${dateKey}`;

      const url = new URL(channelUrl);
      url.searchParams.set('threadKey', threadKey);
      url.searchParams.set('messageReplyOption', 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD');
      const threadUrl = url.toString();

      const card = this.buildDeletedCard(payload);
      const res = await fetch(threadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(card),
      });

      if (!res.ok) {
        const body = await res.text();
        this.logger.warn(`Google Chat delete notification rejected (${res.status}): ${body}`);
      } else {
        this.logger.log(
          `Google Chat delete notification sent — user: ${payload.userName}, project: ${payload.projectName}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to send Google Chat delete notification: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private buildDeletedCard(payload: WorklogDeletedPayload): Record<string, unknown> {
    const { userName, userEmail, projectName, date, contentSnippet, isLeave } = payload;
    const emoji = isLeave ? '🌴' : '📝';
    const preview =
      contentSnippet.length > 150 ? contentSnippet.slice(0, 150) + '…' : contentSnippet;

    const widgets: Record<string, unknown>[] = [
      {
        textParagraph: {
          text:
            `${emoji} <b>${userName}</b>  <font color="#e53935"><b>— Deleted</b></font><br>` +
            `<font color="#5f6368">${userEmail}  ·  ${projectName}  ·  ${this.formatDate(date)}</font>`,
        },
      },
    ];

    if (preview) {
      widgets.push({
        textParagraph: {
          text: `<font color="#9e9e9e"><s>${preview}</s></font>`,
        },
      });
    }

    return {
      cardsV2: [
        {
          cardId: `del-${Date.now()}`,
          card: {
            sections: [{ collapsible: false, widgets }],
          },
        },
      ],
    };
  }
}
