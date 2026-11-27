/**
 * The model replied, but the reply wasn't valid JSON or failed validation,
 * even after a retry. Carries no email content, so it is safe to store.
 */
export class AiInvalidOutputException extends Error {
  constructor(message = 'AI returned output that failed validation') {
    super(message);
    this.name = 'AiInvalidOutputException';
  }
}
