import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { GetEmailRequestDto } from './dto/get-email-request.dto';
import { GetEmailResponseDto } from './dto/get-email-response.dto';
import { ListEmailsRequestDto } from './dto/list-emails-request.dto';
import { ListEmailsResponseDto } from './dto/list-emails-response.dto';
import { EmailsService } from './emails.service';

@ApiTags('emails')
@Controller('emails')
export class EmailsController {
  constructor(private readonly emails: EmailsService) {}

  @Get()
  @ApiOperation({ summary: 'List emails, newest first' })
  @ApiOkResponse({ type: ListEmailsResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  list(
    @CurrentUser() userId: string,
    @Query() query: ListEmailsRequestDto,
  ): Promise<ListEmailsResponseDto> {
    return this.emails.list(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one email with its latest classification' })
  @ApiOkResponse({ type: GetEmailResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  getById(
    @CurrentUser() userId: string,
    @Param() dto: GetEmailRequestDto,
  ): Promise<GetEmailResponseDto> {
    return this.emails.getById(userId, dto.id);
  }
}
