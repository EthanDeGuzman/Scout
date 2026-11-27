import { Injectable } from '@nestjs/common';
import { EmailCategory } from '../modules/emails/email-category.enum';
import {
  AIProvider,
  ClassificationResult,
  EmailForAI,
} from './ai-provider.interface';

/** Test double: classifies by keyword, instantly, with no model involved. */
@Injectable()
export class FakeAIProvider implements AIProvider {
  classifyEmail(input: EmailForAI): Promise<ClassificationResult> {
    const text = `${input.subject} ${input.bodyText}`.toLowerCase();

    const category = text.includes('interview')
      ? EmailCategory.INTERVIEW
      : text.includes('unsubscribe')
        ? EmailCategory.NEWSLETTER
        : text.includes('role') || text.includes('opening')
          ? EmailCategory.JOB_OPPORTUNITY
          : EmailCategory.OTHER;

    return Promise.resolve({
      category,
      confidence: 0.9,
      requiresAction: category !== EmailCategory.NEWSLETTER,
      reason: 'fake classification',
      extracted: {
        company: null,
        jobTitle: null,
        location: null,
        salary: null,
        recruiterName: null,
      },
      needsReview: false,
      modelName: 'fake',
      promptVersion: 'fake_v1',
      durationMs: 0,
    });
  }
}
