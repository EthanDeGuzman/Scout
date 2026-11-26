import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEmails1795706151755 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
        CREATE TABLE emails (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            graph_message_id text NOT NULL,
            conversation_id text,
            subject text NOT NULL DEFAULT '',
            sender_name text,
            sender_address text NOT NULL,
            to_addresses text,
            body_text text NOT NULL DEFAULT '',
            received_at timestamptz NOT NULL,
            is_read boolean NOT NULL DEFAULT false,
            processing_status text NOT NULL DEFAULT 'PENDING'
                CHECK (processing_status IN ('PENDING','PROCESSING','CLASSIFIED','FAILED')),
            processing_attempts integer NOT NULL DEFAULT 0,
            last_error text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz,
            UNIQUE (user_id, graph_message_id)
        )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_emails_user_received ON emails (user_id, received_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_emails_user_status ON emails (user_id, processing_status)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE emails`);
  }
}
