/**
 * The model's reply wasn't usable: not valid JSON, failed validation even
 * after a retry, or the request timed out. The message is stored on the email
 * as `last_error`, so it must never contain email content.
 */
export class AiInvalidOutputException extends Error {
  constructor(message = 'AI output failed validation') {
    super(message);
    this.name = 'AiInvalidOutputException';
  }
}
