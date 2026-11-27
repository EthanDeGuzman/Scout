import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { GetEmailRequestDto } from '../emails/dto/get-email-request.dto';
import { GetEmailResponseDto } from '../emails/dto/get-email-response.dto';
import { ClassificationService } from './classification.service';
import { ClassifyPendingResponseDto } from './dto/classify-pending-response.dto';

@ApiTags('emails')
@Controller('emails')
export class ClassificationController {
  constructor(private readonly classification: ClassificationService) {}

  @Post('classify-pending')
  @HttpCode(200)
  @ApiOperation({ summary: 'Classify all pending emails, one at a time' })
  @ApiOkResponse({ type: ClassifyPendingResponseDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto })
  classifyPending(
    @CurrentUser() userId: string,
  ): Promise<ClassifyPendingResponseDto> {
    return this.classification.classifyPending(userId);
  }

  @Post(':id/classify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Classify (or re-classify) one email now' })
  @ApiOkResponse({ type: GetEmailResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto })
  classifyOne(
    @CurrentUser() userId: string,
    @Param() dto: GetEmailRequestDto,
  ): Promise<GetEmailResponseDto> {
    return this.classification.classifyOne(userId, dto.id);
  }
}
