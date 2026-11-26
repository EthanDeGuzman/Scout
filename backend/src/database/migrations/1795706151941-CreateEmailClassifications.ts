import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEmailClassifications1795706151941 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
        CREATE TABLE email_classifications (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            email_id uuid NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
            source text NOT NULL CHECK (source IN ('AI','MANUAL')),
            category text NOT NULL CHECK (category IN (
                'JOB_OPPORTUNITY','INTERVIEW','APPLICATION_UPDATE',
                'PROFESSIONAL','PERSONAL','NEWSLETTER','OTHER')),
            confidence numeric(3,2),
            requires_action boolean NOT NULL DEFAULT false,
            needs_review boolean NOT NULL DEFAULT false,
            reason text,
            extracted jsonb,
            model_name text,
            prompt_version text,
            duration_ms integer,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_email_class_email_created ON email_classifications (email_id, created_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE email_classifications`);
  }
}
