import { EmailCategory } from '../modules/emails/email-category.enum';

/** Injection token. Services use @Inject(AI_PROVIDER). */
export const AI_PROVIDER = Symbol('AI_PROVIDER');

/** The parts of an email the model is allowed to see. */
export interface EmailForAI {
  subject: string;
  senderName: string;
  senderAddress: string;
  bodyText: string;
}

/** Job details pulled from the email. null = the email doesn't say. */
export interface ExtractedDetails {
  company: string | null;
  jobTitle: string | null;
  location: string | null;
  salary: string | null;
  recruiterName: string | null;
}

export interface ClassificationResult {
  category: EmailCategory;
  confidence: number;
  requiresAction: boolean;
  reason: string;
  extracted: ExtractedDetails;
  /** True when confidence is below CLASSIFICATION_REVIEW_THRESHOLD. */
  needsReview: boolean;
  modelName: string;
  promptVersion: string;
  durationMs: number;
}

export interface AIProvider {
  /**
   * Classify one email. Throws AiUnavailableException if the model can't be
   * reached, or AiInvalidOutputException if it keeps returning bad output.
   */
  classifyEmail(input: EmailForAI): Promise<ClassificationResult>;
}
