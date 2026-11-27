import { EmailCategory } from '../modules/emails/email-category.enum';

export const EXTRACTED_FIELDS = [
  'company',
  'jobTitle',
  'location',
  'salary',
  'recruiterName',
] as const;

const nullableString = { type: ['string', 'null'] };

/**
 * JSON Schema sent to Ollama as `format`. Hand-written to mirror
 * ClassificationResultDto; a unit test keeps the two from drifting apart.
 */
export const CLASSIFICATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: Object.values(EmailCategory) },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    requiresAction: { type: 'boolean' },
    reason: { type: 'string', maxLength: 500 },
    extracted: {
      type: 'object',
      properties: Object.fromEntries(
        EXTRACTED_FIELDS.map((field) => [field, nullableString]),
      ),
      required: [...EXTRACTED_FIELDS],
    },
  },
  required: ['category', 'confidence', 'requiresAction', 'reason', 'extracted'],
} as const;
