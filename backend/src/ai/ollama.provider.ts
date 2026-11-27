import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AiUnavailableException } from '../common/errors/ai-unavailable.exception';
import { EnvironmentVariables } from '../config/env.validation';
import { AiInvalidOutputException } from './ai-invalid-output.exception';
import {
  AIProvider,
  ClassificationResult,
  EmailForAI,
} from './ai-provider.interface';
import { CLASSIFICATION_JSON_SCHEMA } from './classification.schema';
import { ClassificationResultDto } from './dto/classification-result.dto';
import { groundExtraction } from './extraction-grounding';

export const CLASSIFY_PROMPT_VERSION = 'classify_v1';
const MAX_BODY_CHARS = 8000;
const MAX_ATTEMPTS = 2; // the first try, plus one retry

@Injectable()
export class OllamaProvider implements AIProvider, OnModuleInit {
  private readonly logger = new Logger(OllamaProvider.name);
  private systemPrompt = '';

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** Runs once when the app starts: read the prompt file into memory. */
  async onModuleInit(): Promise<void> {
    this.systemPrompt = await readFile(
      join(__dirname, 'prompts', `${CLASSIFY_PROMPT_VERSION}.md`),
      'utf8',
    );
  }

  async classifyEmail(input: EmailForAI): Promise<ClassificationResult> {
    const startedAt = Date.now();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const content = await this.chat(input);
      const parsed = await this.parseAndValidate(content);

      if (parsed) {
        const threshold = this.config.get('CLASSIFICATION_REVIEW_THRESHOLD', {
          infer: true,
        });
        return {
          category: parsed.category,
          confidence: parsed.confidence,
          requiresAction: parsed.requiresAction,
          reason: parsed.reason,
          extracted: groundExtraction(parsed.extracted, input),
          needsReview: parsed.confidence < threshold,
          modelName: this.config.get('OLLAMA_MODEL', { infer: true }),
          promptVersion: CLASSIFY_PROMPT_VERSION,
          durationMs: Date.now() - startedAt,
        };
      }

      // Never log the model's reply: it can contain email content.
      this.logger.warn(
        `Output failed validation (attempt ${attempt}/${MAX_ATTEMPTS})`,
      );
    }

    throw new AiInvalidOutputException();
  }

  /** Sends one request to Ollama and returns the text of its reply. */
  private async chat(email: EmailForAI): Promise<string> {
    const baseUrl = this.config
      .get('OLLAMA_BASE_URL', { infer: true })
      .replace(/\/+$/, '');

    try {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(
          this.config.get('OLLAMA_TIMEOUT_MS', { infer: true }),
        ),
        body: JSON.stringify({
          model: this.config.get('OLLAMA_MODEL', { infer: true }),
          stream: false,
          think: false,
          format: CLASSIFICATION_JSON_SCHEMA,
          options: { temperature: 0, seed: 42, num_ctx: 8192 },
          messages: [
            { role: 'system', content: this.systemPrompt },
            { role: 'user', content: this.buildUserMessage(email) },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}`);

      const body = (await res.json()) as { message?: { content?: unknown } };
      return typeof body.message?.content === 'string'
        ? body.message.content
        : '';
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(`Ollama request failed: ${reason}`);
      throw new AiUnavailableException();
    }
  }

  /** The email goes only here, wrapped in <email> tags, as data. */
  private buildUserMessage(email: EmailForAI): string {
    const text =
      `Subject: ${email.subject}\n` +
      `From: ${email.senderName} <${email.senderAddress}>\n\n` +
      email.bodyText.slice(0, MAX_BODY_CHARS);
    // Stop an email from closing the tag early to sneak out of the data area.
    return `<email>\n${text.replace(/<\/email/gi, '<\\/email')}\n</email>`;
  }

  /** Turns the model's text into a checked object, or null if it's bad. */
  private async parseAndValidate(
    content: string,
  ): Promise<ClassificationResultDto | null> {
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      return null;
    }
    if (typeof raw !== 'object' || raw === null) return null;

    const dto = plainToInstance(ClassificationResultDto, raw);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return errors.length === 0 ? dto : null;
  }
}
