/* eslint-disable @typescript-eslint/no-unsafe-assignment */
jest.mock('@nestjs/mongoose', () => ({
  InjectModel: () => () => undefined,
  Prop: () => () => undefined,
  Schema: () => (target: unknown) => target,
  SchemaFactory: {
    createForClass: () => ({ index: jest.fn() }),
  },
}));

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  normalizeGroup,
  normalizeNotes,
  normalizeQualificationStatus,
  PhoneContactsService,
  resolveNotes,
  resolveGroup,
  resolveQualificationStatus,
} from './phone-contacts.service';

describe('PhoneContactsService', () => {
  it('stores one category on every number in an extension sync', async () => {
    const bulkWrite = jest.fn().mockResolvedValue({ upsertedCount: 1 });
    const service = new PhoneContactsService({ bulkWrite } as never);

    const result = await service.syncPhoneNumbers('user-1', {
      numbers: ['01001234567'],
      category: '  Interested   buyers ',
      source: {
        type: 'facebook',
        url: 'https://facebook.com/groups/example#post',
      },
    });

    expect(result.added).toBe(1);
    expect(bulkWrite).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: {
              clerkUserId: 'user-1',
              normalizedNumber: '+201001234567',
            },
            update: expect.objectContaining({
              $set: expect.objectContaining({
                category: 'Interested buyers',
                source: {
                  type: 'facebook',
                  url: 'https://facebook.com/groups/example',
                },
              }),
              $setOnInsert: {
                clerkUserId: 'user-1',
                normalizedNumber: '+201001234567',
                group: '',
                qualificationStatus: 'UNREVIEWED',
                notes: '',
              },
            }),
          }),
        }),
      ],
      { ordered: false },
    );
  });

  it('keeps an existing category when a sync omits the optional category', async () => {
    const bulkWrite = jest.fn().mockResolvedValue({ upsertedCount: 0 });
    const service = new PhoneContactsService({ bulkWrite } as never);

    await service.syncPhoneNumbers('user-1', {
      numbers: ['01001234567'],
      source: { type: 'generic', url: 'https://example.com/leads' },
    });

    const calls = bulkWrite.mock.calls as unknown as [
      [
        Array<{
          updateOne: {
            update: {
              $set: Record<string, unknown>;
              $setOnInsert: Record<string, unknown>;
            };
          };
        }>,
      ],
    ];
    const operation = calls[0][0][0].updateOne;
    expect(operation.update.$set).not.toHaveProperty('category');
    expect(operation.update.$set).not.toHaveProperty('group');
    expect(operation.update.$setOnInsert.category).toBe('Uncategorized');
    expect(operation.update.$setOnInsert.group).toBe('');
  });

  it('creates a normalized manual contact', async () => {
    const create = jest.fn().mockResolvedValue({
      _id: { toString: () => 'contact-1' },
      normalizedNumber: '+201001234567',
      category: 'VIP',
      source: { type: 'manual' },
      lastSeenAt: new Date('2026-10-04T00:00:00Z'),
    });
    const service = new PhoneContactsService({ create } as never);

    const contact = await service.createPhoneContact('user-1', {
      number: '01001234567',
      category: 'VIP',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkUserId: 'user-1',
        normalizedNumber: '+201001234567',
        category: 'VIP',
        source: { type: 'manual' },
      }),
    );
    expect(contact._id).toBe('contact-1');
  });

  it('scopes deletes to the signed-in user', async () => {
    const deleteOne = jest.fn().mockResolvedValue({ deletedCount: 0 });
    const service = new PhoneContactsService({ deleteOne } as never);

    await expect(
      service.deletePhoneContact('user-1', '64b000000000000000000001'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(deleteOne).toHaveBeenCalledWith({
      _id: expect.anything(),
      clerkUserId: 'user-1',
    });
  });

  it('defaults a manual lead to unreviewed with empty notes', async () => {
    const create = jest.fn().mockResolvedValue({
      _id: { toString: () => 'contact-1' },
      normalizedNumber: '+201001234567',
      category: 'Uncategorized',
      qualificationStatus: 'UNREVIEWED',
      notes: '',
      source: { type: 'manual' },
      lastSeenAt: new Date('2026-10-04T00:00:00Z'),
    });
    const service = new PhoneContactsService({ create } as never);

    const contact = await service.createPhoneContact('user-1', {
      number: '01001234567',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkUserId: 'user-1',
        normalizedNumber: '+201001234567',
        qualificationStatus: 'UNREVIEWED',
        notes: '',
      }),
    );
    expect(contact.qualificationStatus).toBe('UNREVIEWED');
    expect(contact.notes).toBe('');
  });

  it('never overwrites stored status or notes during extension sync', async () => {
    const bulkWrite = jest.fn().mockResolvedValue({ upsertedCount: 0 });
    const service = new PhoneContactsService({ bulkWrite } as never);

    await service.syncPhoneNumbers('user-1', {
      numbers: ['01001234567'],
      category: 'Villas',
      source: { type: 'generic', url: 'https://example.com/leads' },
    });

    const calls = bulkWrite.mock.calls as unknown as [
      [
        Array<{
          updateOne: {
            update: {
              $set: Record<string, unknown>;
              $setOnInsert: Record<string, unknown>;
            };
          };
        }>,
      ],
    ];
    const operation = calls[0][0][0].updateOne;
    expect(operation.update.$set).not.toHaveProperty('qualificationStatus');
    expect(operation.update.$set).not.toHaveProperty('notes');
    expect(operation.update.$set).not.toHaveProperty('group');
    expect(operation.update.$setOnInsert).toEqual(
      expect.objectContaining({
        qualificationStatus: 'UNREVIEWED',
        notes: '',
      }),
    );
  });

  it('reads legacy contacts as unreviewed with empty notes when listing', async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        {
          _id: { toString: () => 'contact-1' },
          normalizedNumber: '+201001234567',
          category: 'Villas',
          source: { type: 'facebook', url: 'https://example.com' },
          lastSeenAt: new Date('2026-10-04T00:00:00Z'),
        },
      ]),
    };
    const model = {
      countDocuments: jest.fn().mockResolvedValue(1),
      distinct: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(['Villas']) }),
      find: jest.fn().mockReturnValue(query),
    };
    const service = new PhoneContactsService(model as never);

    const result = await service.listPhoneContacts('user-1');

    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0].qualificationStatus).toBe('UNREVIEWED');
    expect(result.contacts[0].notes).toBe('');
    expect(result.contacts[0].group).toBe('');
  });

  describe('qualification, group, and notes helpers', () => {
    it('normalizes optional groups and resolves legacy records as ungrouped', () => {
      expect(normalizeGroup('  New   Cairo  ')).toBe('New Cairo');
      expect(normalizeGroup('')).toBe('');
      expect(resolveGroup(undefined)).toBe('');
      expect(() => normalizeGroup('x'.repeat(81))).toThrow(BadRequestException);
    });

    it('accepts each supported qualification status', () => {
      expect(normalizeQualificationStatus('UNREVIEWED')).toBe('UNREVIEWED');
      expect(normalizeQualificationStatus('QUALIFIED')).toBe('QUALIFIED');
      expect(normalizeQualificationStatus('NOT_QUALIFIED')).toBe(
        'NOT_QUALIFIED',
      );
    });

    it('treats a missing status as not supplied', () => {
      expect(normalizeQualificationStatus(undefined)).toBeUndefined();
      expect(normalizeQualificationStatus('')).toBeUndefined();
      expect(normalizeQualificationStatus(null)).toBeUndefined();
    });

    it('rejects unsupported qualification statuses', () => {
      expect(() => normalizeQualificationStatus('PENDING')).toThrow(
        BadRequestException,
      );
      expect(() => normalizeQualificationStatus(42)).toThrow(
        BadRequestException,
      );
    });

    it('normalizes notes and keeps an explicit empty value', () => {
      expect(normalizeNotes('  Hello\r\n  world  ')).toBe('Hello\n  world');
      expect(normalizeNotes('')).toBe('');
      expect(normalizeNotes(undefined)).toBeUndefined();
      expect(normalizeNotes(null)).toBeUndefined();
    });

    it('rejects oversized or non-text notes', () => {
      expect(() => normalizeNotes('x'.repeat(2001))).toThrow(
        BadRequestException,
      );
      expect(() => normalizeNotes(123)).toThrow(BadRequestException);
    });

    it('treats legacy records as unreviewed with empty notes', () => {
      expect(resolveQualificationStatus(undefined)).toBe('UNREVIEWED');
      expect(resolveQualificationStatus('')).toBe('UNREVIEWED');
      expect(resolveQualificationStatus('QUALIFIED')).toBe('QUALIFIED');
      expect(resolveQualificationStatus('NOT_QUALIFIED')).toBe('NOT_QUALIFIED');
      expect(resolveNotes(undefined)).toBe('');
      expect(resolveNotes('Keep me')).toBe('Keep me');
    });
  });

  describe('list status filtering and counts', () => {
    function listModel(overrides: {
      contacts?: unknown[];
      countResponses?: number[];
      categories?: string[];
      groups?: string[];
    }) {
      const query = {
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(overrides.contacts ?? []),
      };
      const countDocuments: jest.Mock<
        Promise<number>,
        [Record<string, unknown>]
      > = jest.fn();
      for (const response of overrides.countResponses ?? [1, 0, 0, 0, 0, 0]) {
        countDocuments.mockResolvedValueOnce(response);
      }
      return {
        model: {
          countDocuments,
          distinct: jest.fn((field: string) => ({
            exec: jest
              .fn()
              .mockResolvedValue(
                field === 'group'
                  ? (overrides.groups ?? [])
                  : (overrides.categories ?? []),
              ),
          })),
          find: jest.fn().mockReturnValue(query),
        },
        query,
        countDocuments,
      };
    }

    it('filters by UNREVIEWED and treats legacy records as unreviewed', async () => {
      const { model, countDocuments } = listModel({
        countResponses: [0, 0, 0, 0, 0, 0],
      });
      const service = new PhoneContactsService(model as never);

      await service.listPhoneContacts('user-1', {
        qualificationStatus: 'UNREVIEWED',
      });

      const totalFilter = countDocuments.mock.calls[0][0];
      expect(totalFilter).toEqual({
        clerkUserId: 'user-1',
        $and: [
          {
            $or: [
              { qualificationStatus: 'UNREVIEWED' },
              { qualificationStatus: { $exists: false } },
              { qualificationStatus: null },
              { qualificationStatus: '' },
            ],
          },
        ],
      });
    });

    it('returns owner-scoped counts for every status under active filters', async () => {
      const { model, countDocuments } = listModel({
        countResponses: [8, 1, 2, 3, 5, 7],
      });
      const service = new PhoneContactsService(model as never);

      const result = await service.listPhoneContacts('user-1', {
        qualificationStatus: 'QUALIFIED',
      });

      expect(result.statusCounts).toEqual({
        UNREVIEWED: 3,
        QUALIFIED: 5,
        NOT_QUALIFIED: 7,
      });
      // Every count (total, uncategorized, and each status) is owner-scoped.
      for (const call of countDocuments.mock.calls) {
        expect(call[0]).toMatchObject({ clerkUserId: 'user-1' });
      }
    });

    it('applies category and group as independent filters', async () => {
      const { model, countDocuments } = listModel({
        countResponses: [0, 0, 0, 0, 0, 0],
      });
      const service = new PhoneContactsService(model as never);

      await service.listPhoneContacts('user-1', {
        category: 'Facebook Marketplace',
        group: 'Villas',
      });

      expect(countDocuments.mock.calls[0][0]).toEqual({
        clerkUserId: 'user-1',
        $and: [{ category: 'Facebook Marketplace' }, { group: 'Villas' }],
      });
    });

    it('rejects an unsupported qualification status filter', async () => {
      const { model, countDocuments } = listModel({ countResponses: [] });
      const service = new PhoneContactsService(model as never);

      await expect(
        service.listPhoneContacts('user-1', {
          qualificationStatus: 'PENDING',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(countDocuments).not.toHaveBeenCalled();
    });
  });

  describe('create status and notes', () => {
    it('accepts explicit status and notes when creating a manual lead', async () => {
      const create = jest.fn().mockResolvedValue({
        _id: { toString: () => 'contact-1' },
        normalizedNumber: '+201001234567',
        category: 'Facebook Marketplace',
        group: 'Villas',
        qualificationStatus: 'QUALIFIED',
        notes: 'Interested in New Cairo',
        source: { type: 'manual' },
        lastSeenAt: new Date('2026-10-06T00:00:00Z'),
      });
      const service = new PhoneContactsService({ create } as never);

      const contact = await service.createPhoneContact('user-1', {
        number: '01001234567',
        category: 'Facebook Marketplace',
        group: '  Villas  ',
        qualificationStatus: 'QUALIFIED',
        notes: '  Interested in New Cairo ',
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          clerkUserId: 'user-1',
          normalizedNumber: '+201001234567',
          category: 'Facebook Marketplace',
          group: 'Villas',
          qualificationStatus: 'QUALIFIED',
          notes: 'Interested in New Cairo',
        }),
      );
      expect(contact.qualificationStatus).toBe('QUALIFIED');
    });

    it('rejects an unsupported status when creating', async () => {
      const create = jest.fn();
      const service = new PhoneContactsService({ create } as never);

      await expect(
        service.createPhoneContact('user-1', {
          number: '01001234567',
          qualificationStatus: 'PENDING',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects oversized notes when creating', async () => {
      const service = new PhoneContactsService({ create: jest.fn() } as never);

      await expect(
        service.createPhoneContact('user-1', {
          number: '01001234567',
          notes: 'x'.repeat(2001),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('partial updates', () => {
    function updateModel(contact: unknown) {
      const query = {
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(contact),
      };
      const findOneAndUpdate = jest.fn().mockReturnValue(query);
      return { model: { findOneAndUpdate } as never, findOneAndUpdate };
    }

    const existingContact = {
      _id: { toString: () => 'contact-1' },
      normalizedNumber: '+201001234567',
      category: 'Villas',
      group: 'North Coast',
      qualificationStatus: 'QUALIFIED',
      notes: 'Follow up weekly',
      source: { type: 'manual' },
      lastSeenAt: new Date('2026-10-06T00:00:00Z'),
    };

    it('allows a status-only update without resending the number or group', async () => {
      const { model, findOneAndUpdate } = updateModel({
        ...existingContact,
        qualificationStatus: 'NOT_QUALIFIED',
      });
      const service = new PhoneContactsService(model);

      const result = await service.updatePhoneContact(
        'user-1',
        '64b000000000000000000001',
        { qualificationStatus: 'NOT_QUALIFIED' },
      );

      expect(findOneAndUpdate).toHaveBeenCalledWith(
        { _id: expect.anything(), clerkUserId: 'user-1' },
        { $set: { qualificationStatus: 'NOT_QUALIFIED' } },
        { new: true, runValidators: true },
      );
      expect(result.qualificationStatus).toBe('NOT_QUALIFIED');
      expect(result.notes).toBe('Follow up weekly');
    });

    it('updates or clears the group without changing category', async () => {
      const { model, findOneAndUpdate } = updateModel({
        ...existingContact,
        group: '',
      });
      const service = new PhoneContactsService(model);

      const result = await service.updatePhoneContact(
        'user-1',
        '64b000000000000000000001',
        { group: '' },
      );

      expect(findOneAndUpdate).toHaveBeenCalledWith(
        { _id: expect.anything(), clerkUserId: 'user-1' },
        { $set: { group: '' } },
        { new: true, runValidators: true },
      );
      expect(result.group).toBe('');
      expect(result.category).toBe('Villas');
    });

    it('normalizes a number and keeps omitted fields untouched', async () => {
      const { model, findOneAndUpdate } = updateModel(existingContact);
      const service = new PhoneContactsService(model);

      await service.updatePhoneContact('user-1', '64b000000000000000000001', {
        number: '01009998877',
      });

      expect(findOneAndUpdate).toHaveBeenCalledWith(
        { _id: expect.anything(), clerkUserId: 'user-1' },
        { $set: { normalizedNumber: '+201009998877' } },
        { new: true, runValidators: true },
      );
    });

    it('lets an explicit empty note clear the stored notes', async () => {
      const { model, findOneAndUpdate } = updateModel({
        ...existingContact,
        notes: '',
      });
      const service = new PhoneContactsService(model);

      const result = await service.updatePhoneContact(
        'user-1',
        '64b000000000000000000001',
        { notes: '' },
      );

      expect(findOneAndUpdate).toHaveBeenCalledWith(
        { _id: expect.anything(), clerkUserId: 'user-1' },
        { $set: { notes: '' } },
        { new: true, runValidators: true },
      );
      expect(result.notes).toBe('');
    });

    it('rejects an empty update payload and ignores unknown fields', async () => {
      const service = new PhoneContactsService({
        findOneAndUpdate: jest.fn(),
      } as never);

      await expect(
        service.updatePhoneContact('user-1', '64b000000000000000000001', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.updatePhoneContact('user-1', '64b000000000000000000001', {
          name: 'not a lead field',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an unsupported status on update', async () => {
      const service = new PhoneContactsService({
        findOneAndUpdate: jest.fn(),
      } as never);

      await expect(
        service.updatePhoneContact('user-1', '64b000000000000000000001', {
          qualificationStatus: 'HOT',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects oversized notes on update', async () => {
      const service = new PhoneContactsService({
        findOneAndUpdate: jest.fn(),
      } as never);

      await expect(
        service.updatePhoneContact('user-1', '64b000000000000000000001', {
          notes: 'x'.repeat(2001),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not update a lead owned by another user', async () => {
      const query = {
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      };
      const findOneAndUpdate = jest.fn().mockReturnValue(query);
      const service = new PhoneContactsService({ findOneAndUpdate } as never);

      await expect(
        service.updatePhoneContact('user-1', '64b000000000000000000001', {
          qualificationStatus: 'QUALIFIED',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ clerkUserId: 'user-1' }),
        { $set: { qualificationStatus: 'QUALIFIED' } },
        expect.anything(),
      );
    });

    it('preserves duplicate-number conflict handling on update', async () => {
      const query = {
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue({ code: 11000 }),
      };
      const findOneAndUpdate = jest.fn().mockReturnValue(query);
      const service = new PhoneContactsService({ findOneAndUpdate } as never);

      await expect(
        service.updatePhoneContact('user-1', '64b000000000000000000001', {
          number: '01001234567',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
