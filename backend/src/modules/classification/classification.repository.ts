import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  ClassificationResult,
  EmailForAI,
} from '../../ai/ai-provider.interface';
import { EmailCategory } from '../emails/email-category.enum';

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
   * matches and we get null back. Normally only PENDING emails can be taken.
   * `allowRerun` also lets a CLASSIFIED or FAILED email be taken, for an
   * explicit "classify this one again" request.
   */
  async claim(
    userId: string,
    id: string,
    allowRerun = false,
  ): Promise<ClaimedEmail | null> {
    const [rows]: [ClaimedEmail[], number] = await this.dataSource.query(
      `UPDATE emails
          SET processing_status = 'PROCESSING', updated_at = now()
        WHERE id = $1 AND user_id = $2
          AND (processing_status = 'PENDING'
               OR ($3::boolean AND processing_status <> 'PROCESSING'))
        RETURNING id, subject, sender_name AS "senderName",
                  sender_address AS "senderAddress", body_text AS "bodyText"`,
      [id, userId, allowRerun],
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
   * The model's output was bad (or it timed out). Count the attempt. An email
   * that already has a classification keeps it and goes back to CLASSIFIED, so
   * a failed re-run never undoes an earlier answer, including a manual one.
   * Otherwise, after MAX_ATTEMPTS it stays FAILED until someone re-runs it, and
   * before that it goes back to PENDING to be tried again.
   * `error` must never contain email content.
   */
  async markFailed(emailId: string, error: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE emails
          SET processing_attempts = processing_attempts + 1,
              processing_status = CASE
                WHEN EXISTS (SELECT 1 FROM email_classifications
                              WHERE email_id = emails.id) THEN 'CLASSIFIED'
                WHEN processing_attempts + 1 >= $2 THEN 'FAILED'
                ELSE 'PENDING' END,
              last_error = $3, updated_at = now()
        WHERE id = $1`,
      [emailId, MAX_ATTEMPTS, error],
    );
  }

  /**
   * Ollama was unreachable. Not the email's fault: no attempt counted. It goes
   * back to CLASSIFIED if it already has an answer, otherwise to PENDING.
   */
  async release(emailId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE emails
          SET processing_status = CASE
                WHEN EXISTS (SELECT 1 FROM email_classifications
                              WHERE email_id = emails.id) THEN 'CLASSIFIED'
                ELSE 'PENDING' END,
              updated_at = now()
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

  /**
   * Record a manual correction as a new row. It copies requires_action and
   * extracted from the previous answer so nothing is lost. Returns false if
   * the email doesn't exist, isn't this user's, or is being classified right
   * now (the AI's answer would land after, and silently replace this one).
   */
  async saveManualCategory(
    userId: string,
    emailId: string,
    category: EmailCategory,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const inserted: { id: string }[] = await manager.query(
        `INSERT INTO email_classifications
           (email_id, source, category, requires_action, needs_review, extracted)
         SELECT e.id, 'MANUAL', $3::text, COALESCE(prev.requires_action, false),
                false, prev.extracted
           FROM emails e
           LEFT JOIN LATERAL (
             SELECT requires_action, extracted
               FROM email_classifications
              WHERE email_id = e.id
              ORDER BY created_at DESC
              LIMIT 1
           ) prev ON true
          WHERE e.id = $1 AND e.user_id = $2
            AND e.processing_status <> 'PROCESSING'
         RETURNING id`,
        [emailId, userId, category],
      );
      if (inserted.length === 0) return false;

      // A person has now decided, so there is nothing left for the AI to do.
      await manager.query(
        `UPDATE emails
            SET processing_status = 'CLASSIFIED', processing_attempts = 0,
                last_error = NULL, updated_at = now()
          WHERE id = $1 AND processing_status IN ('PENDING', 'FAILED')`,
        [emailId],
      );
      return true;
    });
  }
}
