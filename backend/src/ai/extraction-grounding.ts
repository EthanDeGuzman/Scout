import { EmailForAI, ExtractedDetails } from './ai-provider.interface';

/**
 * Sets any extracted value to null if it doesn't appear in the email
 * (case-insensitive). Stops the model inventing company names and the like.
 */
export function groundExtraction(
  extracted: ExtractedDetails,
  email: EmailForAI,
): ExtractedDetails {
  const haystack =
    `${email.subject}\n${email.senderName}\n${email.senderAddress}\n${email.bodyText}`.toLowerCase();

  const keep = (value: string | null | undefined): string | null => {
    const trimmed = value?.trim();
    return trimmed && haystack.includes(trimmed.toLowerCase()) ? trimmed : null;
  };

  return {
    company: keep(extracted.company),
    jobTitle: keep(extracted.jobTitle),
    location: keep(extracted.location),
    salary: keep(extracted.salary),
    recruiterName: keep(extracted.recruiterName),
  };
}
