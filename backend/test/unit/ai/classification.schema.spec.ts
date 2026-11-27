import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CLASSIFICATION_JSON_SCHEMA,
  EXTRACTED_FIELDS,
} from '../../../src/ai/classification.schema';
import { ClassificationResultDto } from '../../../src/ai/dto/classification-result.dto';
import { EmailCategory } from '../../../src/modules/emails/email-category.enum';

const validSample = {
  category: 'JOB_OPPORTUNITY',
  confidence: 0.9,
  requiresAction: true,
  reason: 'Recruiter asks about interest in a backend role',
  extracted: {
    company: 'Acme',
    jobTitle: null,
    location: null,
    salary: null,
    recruiterName: 'Sarah',
  },
};

async function errorsFor(value: unknown): Promise<number> {
  const dto = plainToInstance(ClassificationResultDto, value);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.length;
}

describe('classification schema vs ClassificationResultDto', () => {
  it('the DTO accepts a sample shaped like the schema', async () => {
    expect(await errorsFor(validSample)).toBe(0);
  });

  it('the schema requires exactly the top-level fields of the sample', () => {
    expect([...CLASSIFICATION_JSON_SCHEMA.required].sort()).toEqual(
      Object.keys(validSample).sort(),
    );
  });

  it('every required top-level field is also declared in properties', () => {
    expect(Object.keys(CLASSIFICATION_JSON_SCHEMA.properties).sort()).toEqual(
      [...CLASSIFICATION_JSON_SCHEMA.required].sort(),
    );
  });

  it('the schema lists the same extracted fields as the sample', () => {
    expect([...EXTRACTED_FIELDS].sort()).toEqual(
      Object.keys(validSample.extracted).sort(),
    );
    expect(
      [...CLASSIFICATION_JSON_SCHEMA.properties.extracted.required].sort(),
    ).toEqual([...EXTRACTED_FIELDS].sort());
  });

  it('the schema allows exactly the categories in EmailCategory', () => {
    expect(CLASSIFICATION_JSON_SCHEMA.properties.category.enum).toEqual(
      Object.values(EmailCategory),
    );
  });

  it.each([
    ['an unknown category', { ...validSample, category: 'SPAM' }],
    ['confidence above 1', { ...validSample, confidence: 1.5 }],
    ['confidence below 0', { ...validSample, confidence: -0.1 }],
    ['a string for requiresAction', { ...validSample, requiresAction: 'yes' }],
    ['an extra field', { ...validSample, apiKey: 'x' }],
    [
      'a number as an extracted value',
      {
        ...validSample,
        extracted: { ...validSample.extracted, company: 42 },
      },
    ],
  ])('the DTO rejects %s', async (_name, value) => {
    expect(await errorsFor(value)).toBeGreaterThan(0);
  });
});
