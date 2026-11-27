import { Module } from '@nestjs/common';
import { EmailsController } from './emails.controller';
import { EmailsRepository } from './emails.repository';
import { EmailsService } from './emails.service';

@Module({
  controllers: [EmailsController],
  providers: [EmailsService, EmailsRepository],
  exports: [EmailsService],
})
export class EmailsModule {}
