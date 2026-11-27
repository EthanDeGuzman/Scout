import { Injectable, NotFoundException } from '@nestjs/common';
import { GetEmailResponseDto } from './dto/get-email-response.dto';
import { ListEmailsRequestDto } from './dto/list-emails-request.dto';
import { ListEmailsResponseDto } from './dto/list-emails-response.dto';
import { EmailsRepository } from './emails.repository';

@Injectable()
export class EmailsService {
  constructor(private readonly repo: EmailsRepository) {}

  async list(
    userId: string,
    query: ListEmailsRequestDto,
  ): Promise<ListEmailsResponseDto> {
    const { rows, total } = await this.repo.findAll(userId, query);
    return { data: rows, page: query.page, pageSize: query.pageSize, total };
  }

  async getById(userId: string, id: string): Promise<GetEmailResponseDto> {
    const email = await this.repo.findById(userId, id);
    if (!email) throw new NotFoundException('Email not found');
    return email;
  }
}
