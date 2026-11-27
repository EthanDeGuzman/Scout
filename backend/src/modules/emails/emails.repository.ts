import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GetEmailResponseDto } from './dto/get-email-response.dto';
import { EmailListItemDto } from './dto/list-emails-response.dto';
import { ListEmailsRequestDto } from './dto/list-emails-request.dto';

// The newest classification per email, or NULLs if it has none.
const LATEST_CLASSIFICATION = `
  LEFT JOIN LATERAL (
    SELECT category, requires_action, needs_review, reason, extracted,
           confidence::float8 AS confidence
      FROM email_classifications
     WHERE email_id = e.id
     ORDER BY created_at DESC
     LIMIT 1
  ) c ON true`;

@Injectable()
export class EmailsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findAll(
    userId: string,
    query: ListEmailsRequestDto,
  ): Promise<{ rows: EmailListItemDto[]; total: number }> {
    const { where, params } = this.buildWhere(userId, query);
    const offset = (query.page - 1) * query.pageSize;

    const rows: EmailListItemDto[] = await this.dataSource.query(
      `SELECT e.id, e.subject, e.sender_name AS "senderName",
              e.sender_address AS "senderAddress", e.received_at AS "receivedAt",
              e.is_read AS "isRead", e.processing_status AS "processingStatus",
              c.category, c.requires_action AS "requiresAction",
              c.needs_review AS "needsReview", c.confidence
         FROM emails e ${LATEST_CLASSIFICATION}
        WHERE ${where}
        ORDER BY e.received_at DESC, e.id
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, offset],
    );

    const counted: { total: number }[] = await this.dataSource.query(
      `SELECT count(*)::int AS total
         FROM emails e ${LATEST_CLASSIFICATION}
        WHERE ${where}`,
      params,
    );
    return { rows, total: counted[0].total };
  }

  async findById(
    userId: string,
    id: string,
  ): Promise<GetEmailResponseDto | null> {
    const rows: GetEmailResponseDto[] = await this.dataSource.query(
      `SELECT e.id, e.subject, e.sender_name AS "senderName",
              e.sender_address AS "senderAddress", e.to_addresses AS "toAddresses",
              e.body_text AS "bodyText", e.received_at AS "receivedAt",
              e.is_read AS "isRead", e.processing_status AS "processingStatus",
              e.last_error AS "lastError",
              c.category, c.requires_action AS "requiresAction",
              c.needs_review AS "needsReview", c.confidence, c.reason, c.extracted
         FROM emails e ${LATEST_CLASSIFICATION}
        WHERE e.user_id = $1 AND e.id = $2`,
      [userId, id],
    );
    return rows[0] ?? null;
  }

  private buildWhere(userId: string, f: ListEmailsRequestDto) {
    const conditions = ['e.user_id = $1'];
    const params: unknown[] = [userId];
    // Pushes a value and swaps every "?" in the SQL for its $n placeholder.
    const add = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replaceAll('?', `$${params.length}`));
    };

    if (f.category) add('c.category = ?', f.category);
    if (f.requiresAction !== undefined)
      add('c.requires_action = ?', f.requiresAction);
    if (f.needsReview !== undefined) add('c.needs_review = ?', f.needsReview);
    if (f.q) {
      // Escape \ % _ so a user's "%" isn't treated as a wildcard.
      const pattern = `%${f.q.replace(/[\\%_]/g, '\\$&')}%`;
      add(
        '(e.subject ILIKE ? OR e.sender_name ILIKE ? OR e.sender_address ILIKE ?)',
        pattern,
      );
    }
    return { where: conditions.join(' AND '), params };
  }
}
