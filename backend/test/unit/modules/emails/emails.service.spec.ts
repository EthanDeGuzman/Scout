import { NotFoundException } from '@nestjs/common';
import { GetEmailResponseDto } from '../../../../src/modules/emails/dto/get-email-response.dto';
import { ListEmailsRequestDto } from '../../../../src/modules/emails/dto/list-emails-request.dto';
import { EmailListItemDto } from '../../../../src/modules/emails/dto/list-emails-response.dto';
import { EmailsRepository } from '../../../../src/modules/emails/emails.repository';
import { EmailsService } from '../../../../src/modules/emails/emails.service';

describe('EmailsService', () => {
  let findAll: jest.Mock;
  let findById: jest.Mock;
  let service: EmailsService;

  beforeEach(() => {
    findAll = jest.fn();
    findById = jest.fn();
    service = new EmailsService({
      findAll,
      findById,
    } as unknown as EmailsRepository);
  });

  describe('list', () => {
    it('wraps the repository rows with paging details', async () => {
      const rows = [{ id: 'e1' }, { id: 'e2' }] as EmailListItemDto[];
      findAll.mockResolvedValue({ rows, total: 42 });
      const query = { page: 3, pageSize: 2 } as ListEmailsRequestDto;

      await expect(service.list('user-1', query)).resolves.toEqual({
        data: rows,
        page: 3,
        pageSize: 2,
        total: 42,
      });
    });

    it('passes the user id and the query to the repository', async () => {
      findAll.mockResolvedValue({ rows: [], total: 0 });
      const query = {
        page: 1,
        pageSize: 20,
        q: 'offer',
      } as ListEmailsRequestDto;

      await service.list('user-1', query);

      expect(findAll).toHaveBeenCalledWith('user-1', query);
    });

    it('returns an empty page when nothing matches', async () => {
      findAll.mockResolvedValue({ rows: [], total: 0 });
      const query = { page: 1, pageSize: 20 } as ListEmailsRequestDto;

      await expect(service.list('user-1', query)).resolves.toMatchObject({
        data: [],
        total: 0,
      });
    });
  });

  describe('getById', () => {
    it('returns the email when it exists', async () => {
      const email = { id: 'e1', subject: 'Hi' } as GetEmailResponseDto;
      findById.mockResolvedValue(email);

      await expect(service.getById('user-1', 'e1')).resolves.toBe(email);
      expect(findById).toHaveBeenCalledWith('user-1', 'e1');
    });

    it('throws NotFoundException when the repository finds nothing', async () => {
      findById.mockResolvedValue(null);

      await expect(service.getById('user-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
