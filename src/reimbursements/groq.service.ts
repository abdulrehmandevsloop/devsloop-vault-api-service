import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';

@Injectable()
export class GroqService {
  constructor(private configService: ConfigService) {}

  async analyzeReceiptText(text: string): Promise<{
    merchantName: string | null;
    transactionDate: string | null;
    amount: number | null;
  }> {
    const apiKey = this.configService.get<string>('GROQ_API_KEY');
    if (!apiKey) {
      return { merchantName: null, transactionDate: null, amount: null };
    }

    try {
      const groq = new Groq({ apiKey });
      const response = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        temperature: 0,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a receipt data extractor. Extract data from OCR text and return ONLY a JSON object with no extra text or markdown:
{"merchantName":"string or null","transactionDate":"YYYY-MM-DD or null","amount":number or null}
Rules: merchantName is the business/store name. transactionDate must be YYYY-MM-DD. amount is the total amount paid as a number. Use null for any field you cannot confidently identify.`,
          },
          {
            role: 'user',
            content: `Extract receipt fields from this OCR text:\n\n${text}`,
          },
        ],
      });

      const raw = response.choices[0]?.message?.content ?? '{}';
      const stripped = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
      const match = stripped.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match ? match[0] : '{}');
      return {
        merchantName: typeof parsed.merchantName === 'string' ? parsed.merchantName : null,
        transactionDate: typeof parsed.transactionDate === 'string' ? parsed.transactionDate : null,
        amount: typeof parsed.amount === 'number' ? parsed.amount : null,
      };
    } catch {
      return { merchantName: null, transactionDate: null, amount: null };
    }
  }
}
