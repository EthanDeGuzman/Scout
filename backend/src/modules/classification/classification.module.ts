import { Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import { EmailsModule } from '../emails/emails.module';
import { ClassificationController } from './classification.controller';
import { ClassificationRepository } from './classification.repository';
import { ClassificationService } from './classification.service';

@Module({
  imports: [AiModule, EmailsModule],
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository],
})
export class ClassificationModule {}
