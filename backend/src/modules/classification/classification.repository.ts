import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  ClassificationResult,
  EmailForAI,
} from '../../ai/ai-provider.interface';

export const MAX_ATTEMPTS = 3;

/** An email we have claimed: the id plus what the model is allowed to see. */
export interface ClaimedEmail extends EmailForAI {
  id: string;
}

@Injectable()
export class ClassificationRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Take an email so nothing else processes it at the same time. The WHERE
   * clause makes this safe: if another request got there first, no row
   * matches and we get null back.
   */
  async claim(userId: string, id: string): Promise<ClaimedEmail | null> {
    const rows: ClaimedEmail[] = await this.dataSource.query(
      `UPDATE emails
          SET processing_status = 'PROCESSING', updated_at = now()
        WHERE id = $1 AND user_id = $2 AND processing_status <> 'PROCESSING'
        RETURNING id, subject, sender_name AS "senderName",
                  sender_address AS "senderAddress", body_text AS "bodyText"`,
      [id, userId],
    );
    return rows[0] ?? null;
  }

  /** Ids of this user's emails still waiting to be classified, oldest first. */
  async findPendingIds(userId: string): Promise<string[]> {
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT id FROM emails
        WHERE user_id = $1 AND processing_status = 'PENDING'
        ORDER BY received_at`,
      [userId],
    );
    return rows.map((r) => r.id);
  }

  /** Save the model's answer and mark the email done, as one all-or-nothing step. */
  async saveResult(
    emailId: string,
    result: ClassificationResult,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO email_classifications
           (email_id, source, category, confidence, requires_action, needs_review,
            reason, extracted, model_name, prompt_version, duration_ms)
         VALUES ($1, 'AI', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          emailId,
          result.category,
          result.confidence,
          result.requiresAction,
          result.needsReview,
          result.reason,
          JSON.stringify(result.extracted),
          result.modelName,
          result.promptVersion,
          result.durationMs,
        ],
      );
      await manager.query(
        `UPDATE emails
            SET processing_status = 'CLASSIFIED', processing_attempts = 0,
                last_error = NULL, updated_at = now()
          WHERE id = $1`,
        [emailId],
      );
    });
  }

  /**
   * The model's output was bad. Count the attempt; after MAX_ATTEMPTS the
   * email stays FAILED until someone re-runs it. Otherwise it goes back to
   * PENDING to be tried again. `error` must never contain email content.
   */
  async markFailed(emailId: string, error: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE emails
          SET processing_attempts = processing_attempts + 1,
              processing_status = CASE WHEN processing_attempts + 1 >= $2
                                       THEN 'FAILED' ELSE 'PENDING' END,
              last_error = $3, updated_at = now()
        WHERE id = $1`,
      [emailId, MAX_ATTEMPTS, error],
    );
  }

  /** Ollama was unreachable. Not the email's fault: back to PENDING, no attempt counted. */
  async release(emailId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE emails
          SET processing_status = 'PENDING', updated_at = now()
        WHERE id = $1`,
      [emailId],
    );
  }

  /** On startup: anything left PROCESSING was interrupted (e.g. a crash). */
  async resetStuck(): Promise<number> {
    const result: [unknown[], number] = await this.dataSource.query(
      `UPDATE emails SET processing_status = 'PENDING', updated_at = now()
        WHERE processing_status = 'PROCESSING'`,
    );
    return result[1];
  }

  /** The email's status, or null if it doesn't exist (or isn't this user's). */
  async findStatus(userId: string, id: string): Promise<string | null> {
    const rows: { status: string }[] = await this.dataSource.query(
      `SELECT processing_status AS status FROM emails
        WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return rows[0]?.status ?? null;
  }
}
