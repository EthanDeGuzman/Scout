import {
  EmailForAI,
  ExtractedDetails,
} from '../../../src/ai/ai-provider.interface';
import { groundExtraction } from '../../../src/ai/extraction-grounding';

const email: EmailForAI = {
  subject: 'Backend role at Acme',
  senderName: 'Sarah Lee',
  senderAddress: 'sarah@acme.example',
  bodyText: 'We are hiring a Senior Engineer in Dublin. Salary: 90k.',
};

const none: ExtractedDetails = {
  company: null,
  jobTitle: null,
  location: null,
  salary: null,
  recruiterName: null,
};

describe('groundExtraction', () => {
  it('keeps values that appear in the email', () => {
    const result = groundExtraction(
      { ...none, company: 'Acme', location: 'Dublin', salary: '90k' },
      email,
    );

    expect(result).toEqual({
      ...none,
      company: 'Acme',
      location: 'Dublin',
      salary: '90k',
    });
  });

  it("matches case-insensitively and keeps the model's casing", () => {
    const result = groundExtraction({ ...none, location: 'DUBLIN' }, email);

    expect(result.location).toBe('DUBLIN');
  });

  it('nulls values that are not in the email', () => {
    const result = groundExtraction(
      { ...none, company: 'Globex', jobTitle: 'Staff Engineer' },
      email,
    );

    expect(result.company).toBeNull();
    expect(result.jobTitle).toBeNull();
  });

  it('nulls empty and whitespace-only values', () => {
    const result = groundExtraction(
      { ...none, company: '', salary: '   ' },
      email,
    );

    expect(result.company).toBeNull();
    expect(result.salary).toBeNull();
  });

  it('finds values in the sender name', () => {
    const result = groundExtraction(
      { ...none, recruiterName: 'Sarah Lee' },
      email,
    );

    expect(result.recruiterName).toBe('Sarah Lee');
  });

  it('keeps nulls as null', () => {
    expect(groundExtraction(none, email)).toEqual(none);
  });
});
