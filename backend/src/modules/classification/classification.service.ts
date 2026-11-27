import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { AiInvalidOutputException } from '../../ai/ai-invalid-output.exception';
import { AI_PROVIDER } from '../../ai/ai-provider.interface';
import type { AIProvider } from '../../ai/ai-provider.interface';
import { GetEmailResponseDto } from '../emails/dto/get-email-response.dto';
import { EmailsService } from '../emails/emails.service';
import {
  ClaimedEmail,
  ClassificationRepository,
} from './classification.repository';

export interface ClassifyPendingSummary {
  found: number;
  classified: number;
  failed: number;
}

@Injectable()
export class ClassificationService implements OnModuleInit {
  private readonly logger = new Logger(ClassificationService.name);

  constructor(
    private readonly repo: ClassificationRepository,
    private readonly emails: EmailsService,
    @Inject(AI_PROVIDER) private readonly ai: AIProvider,
  ) {}

  /** On startup, free any email a crash left stuck in PROCESSING. */
  async onModuleInit(): Promise<void> {
    const reset = await this.repo.resetStuck();
    if (reset > 0) {
      this.logger.warn(`Reset ${reset} email(s) left in PROCESSING`);
    }
  }

  /** Classify (or re-classify) one email, then return it as it now stands. */
  async classifyOne(userId: string, id: string): Promise<GetEmailResponseDto> {
    const email = await this.claimOrThrow(userId, id);
    await this.process(email);
    return this.emails.getById(userId, id);
  }

  /** Classify every pending email, one at a time. */
  async classifyPending(userId: string): Promise<ClassifyPendingSummary> {
    const ids = await this.repo.findPendingIds(userId);
    const summary: ClassifyPendingSummary = {
      found: ids.length,
      classified: 0,
      failed: 0,
    };

    for (const id of ids) {
      const email = await this.repo.claim(userId, id);
      if (!email) continue; // something else took it first

      if (await this.process(email)) summary.classified++;
      else summary.failed++;
    }
    return summary;
  }

  private async claimOrThrow(
    userId: string,
    id: string,
  ): Promise<ClaimedEmail> {
    const email = await this.repo.claim(userId, id);
    if (email) return email;

    const status = await this.repo.findStatus(userId, id);
    if (status === null) throw new NotFoundException('Email not found');
    throw new ConflictException('Email is already being classified');
  }

  /**
   * Ask the AI and save the outcome. Returns true if classified, false if the
   * model's output was bad. Anything else (Ollama down, a database error)
   * puts the email back to PENDING and is rethrown.
   */
  private async process(email: ClaimedEmail): Promise<boolean> {
    try {
      const result = await this.ai.classifyEmail(email);
      await this.repo.saveResult(email.id, result);
      return true;
    } catch (err) {
      if (err instanceof AiInvalidOutputException) {
        await this.repo.markFailed(email.id, 'AI output failed validation');
        return false;
      }
      await this.repo.release(email.id);
      throw err;
    }
  }
}
