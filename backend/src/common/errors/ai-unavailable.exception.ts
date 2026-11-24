import { ServiceUnavailableException } from '@nestjs/common';

/** Thrown when the local LLM (Ollama) can't be reached or fails. */
export class AiUnavailableException extends ServiceUnavailableException {
  constructor(message = 'AI service is unavailable') {
    super(message);
  }
}
