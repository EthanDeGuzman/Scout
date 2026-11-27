import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { AiInvalidOutputException } from '../../../../src/ai/ai-invalid-output.exception';
import { ClassificationResult } from '../../../../src/ai/ai-provider.interface';
import { AiUnavailableException } from '../../../../src/common/errors/ai-unavailable.exception';
import { GetEmailResponseDto } from '../../../../src/modules/emails/dto/get-email-response.dto';
import { EmailsService } from '../../../../src/modules/emails/emails.service';
import {
  ClaimedEmail,
  ClassificationRepository,
} from '../../../../src/modules/classification/classification.repository';
import { ClassificationService } from '../../../../src/modules/classification/classification.service';
import { EmailCategory } from '../../../../src/modules/emails/email-category.enum';

const claimed: ClaimedEmail = {
  id: 'e1',
  subject: 'Backend role',
  senderName: 'Sarah',
  senderAddress: 'sarah@acme.example',
  bodyText: 'Interested?',
};

const result: ClassificationResult = {
  category: EmailCategory.JOB_OPPORTUNITY,
  confidence: 0.9,
  requiresAction: true,
  reason: 'recruiter outreach',
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
  durationMs: 1,
};

describe('ClassificationService', () => {
  let repo: Record<keyof ClassificationRepository, jest.Mock>;
  let getById: jest.Mock;
  let classifyEmail: jest.Mock;
  let service: ClassificationService;

  beforeEach(() => {
    repo = {
      claim: jest.fn(),
      findPendingIds: jest.fn(),
      saveResult: jest.fn(),
      markFailed: jest.fn(),
      release: jest.fn(),
      resetStuck: jest.fn(),
      findStatus: jest.fn(),
      saveManualCategory: jest.fn(),
    };
    getById = jest.fn();
    classifyEmail = jest.fn();

    service = new ClassificationService(
      repo as unknown as ClassificationRepository,
      { getById } as unknown as EmailsService,
      { classifyEmail },
    );
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('onModuleInit', () => {
    it('resets emails stuck in PROCESSING', async () => {
      repo.resetStuck.mockResolvedValue(2);

      await service.onModuleInit();

      expect(repo.resetStuck).toHaveBeenCalledTimes(1);
    });
  });

  describe('classifyOne', () => {
    it('claims, classifies, saves and returns the updated email', async () => {
      const detail = { id: 'e1' } as GetEmailResponseDto;
      repo.claim.mockResolvedValue(claimed);
      classifyEmail.mockResolvedValue(result);
      getById.mockResolvedValue(detail);

      await expect(service.classifyOne('u1', 'e1')).resolves.toBe(detail);

      // An explicit request may re-run an already classified email.
      expect(repo.claim).toHaveBeenCalledWith('u1', 'e1', true);
      expect(classifyEmail).toHaveBeenCalledWith(claimed);
      expect(repo.saveResult).toHaveBeenCalledWith('e1', result);
    });

    it('throws NotFoundException when the email does not exist', async () => {
      repo.claim.mockResolvedValue(null);
      repo.findStatus.mockResolvedValue(null);

      await expect(service.classifyOne('u1', 'nope')).rejects.toThrow(
        NotFoundException,
      );
      expect(classifyEmail).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the email is already being processed', async () => {
      repo.claim.mockResolvedValue(null);
      repo.findStatus.mockResolvedValue('PROCESSING');

      await expect(service.classifyOne('u1', 'e1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('records a failed attempt and still returns the email when the output is invalid', async () => {
      const detail = { id: 'e1' } as GetEmailResponseDto;
      repo.claim.mockResolvedValue(claimed);
      classifyEmail.mockRejectedValue(new AiInvalidOutputException());
      getById.mockResolvedValue(detail);

      await expect(service.classifyOne('u1', 'e1')).resolves.toBe(detail);

      expect(repo.markFailed).toHaveBeenCalledWith(
        'e1',
        'AI output failed validation',
      );
      expect(repo.saveResult).not.toHaveBeenCalled();
    });

    it('stores the exception message, such as a timeout, as the error', async () => {
      repo.claim.mockResolvedValue(claimed);
      classifyEmail.mockRejectedValue(
        new AiInvalidOutputException('AI request timed out'),
      );
      getById.mockResolvedValue({ id: 'e1' });

      await service.classifyOne('u1', 'e1');

      expect(repo.markFailed).toHaveBeenCalledWith(
        'e1',
        'AI request timed out',
      );
    });

    it('releases the email without counting an attempt when the AI is unavailable', async () => {
      repo.claim.mockResolvedValue(claimed);
      classifyEmail.mockRejectedValue(new AiUnavailableException());

      await expect(service.classifyOne('u1', 'e1')).rejects.toThrow(
        AiUnavailableException,
      );

      expect(repo.release).toHaveBeenCalledWith('e1');
      expect(repo.markFailed).not.toHaveBeenCalled();
    });

    it('releases the email and rethrows when saving fails', async () => {
      repo.claim.mockResolvedValue(claimed);
      classifyEmail.mockResolvedValue(result);
      repo.saveResult.mockRejectedValue(new Error('db down'));

      await expect(service.classifyOne('u1', 'e1')).rejects.toThrow('db down');

      expect(repo.release).toHaveBeenCalledWith('e1');
    });
  });

  describe('classifyPending', () => {
    it('classifies every pending email and counts the results', async () => {
      repo.findPendingIds.mockResolvedValue(['a', 'b', 'c']);
      repo.claim.mockImplementation((_user: string, id: string) =>
        Promise.resolve({ ...claimed, id }),
      );
      classifyEmail
        .mockResolvedValueOnce(result)
        .mockRejectedValueOnce(new AiInvalidOutputException())
        .mockResolvedValueOnce(result);

      await expect(service.classifyPending('u1')).resolves.toEqual({
        found: 3,
        classified: 2,
        failed: 1,
      });
    });

    it('only claims emails that are still pending, never re-runs classified ones', async () => {
      repo.findPendingIds.mockResolvedValue(['a']);
      repo.claim.mockResolvedValue({ ...claimed, id: 'a' });
      classifyEmail.mockResolvedValue(result);

      await service.classifyPending('u1');

      // Exactly two arguments: no `allowRerun` flag.
      expect(repo.claim).toHaveBeenCalledWith('u1', 'a');
    });

    it('skips emails that another request already claimed', async () => {
      repo.findPendingIds.mockResolvedValue(['a', 'b']);
      repo.claim
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...claimed, id: 'b' });
      classifyEmail.mockResolvedValue(result);

      await expect(service.classifyPending('u1')).resolves.toEqual({
        found: 2,
        classified: 1,
        failed: 0,
      });
      expect(classifyEmail).toHaveBeenCalledTimes(1);
    });

    it('returns zeros when nothing is pending', async () => {
      repo.findPendingIds.mockResolvedValue([]);

      await expect(service.classifyPending('u1')).resolves.toEqual({
        found: 0,
        classified: 0,
        failed: 0,
      });
    });

    it('stops at the first outage and leaves the rest pending', async () => {
      repo.findPendingIds.mockResolvedValue(['a', 'b', 'c']);
      repo.claim.mockImplementation((_user: string, id: string) =>
        Promise.resolve({ ...claimed, id }),
      );
      classifyEmail
        .mockResolvedValueOnce(result)
        .mockRejectedValueOnce(new AiUnavailableException());

      await expect(service.classifyPending('u1')).rejects.toThrow(
        AiUnavailableException,
      );

      expect(repo.saveResult).toHaveBeenCalledTimes(1);
      expect(repo.release).toHaveBeenCalledWith('b');
      expect(repo.claim).toHaveBeenCalledTimes(2); // 'c' was never touched
    });
  });

  describe('setCategory', () => {
    it('saves the correction and returns the updated email', async () => {
      const detail = { id: 'e1' } as GetEmailResponseDto;
      repo.saveManualCategory.mockResolvedValue(true);
      getById.mockResolvedValue(detail);

      await expect(
        service.setCategory('u1', 'e1', EmailCategory.PERSONAL),
      ).resolves.toBe(detail);

      expect(repo.saveManualCategory).toHaveBeenCalledWith(
        'u1',
        'e1',
        EmailCategory.PERSONAL,
      );
    });

    it('throws NotFoundException when the email is not found', async () => {
      repo.saveManualCategory.mockResolvedValue(false);
      repo.findStatus.mockResolvedValue(null);

      await expect(
        service.setCategory('u1', 'nope', EmailCategory.PERSONAL),
      ).rejects.toThrow(NotFoundException);
      expect(getById).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the email is being classified right now', async () => {
      repo.saveManualCategory.mockResolvedValue(false);
      repo.findStatus.mockResolvedValue('PROCESSING');

      await expect(
        service.setCategory('u1', 'e1', EmailCategory.PERSONAL),
      ).rejects.toThrow(ConflictException);
      expect(getById).not.toHaveBeenCalled();
    });
  });
});
