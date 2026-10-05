/* eslint-disable @typescript-eslint/no-unsafe-assignment */
jest.mock('@nestjs/mongoose', () => ({
  InjectModel: () => () => undefined,
  Prop: () => () => undefined,
  Schema: () => (target: unknown) => target,
  SchemaFactory: {
    createForClass: () => ({ index: jest.fn() }),
  },
}));

import { NotFoundException } from '@nestjs/common';
import { PhoneContactsService } from './phone-contacts.service';

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
    expect(operation.update.$setOnInsert.category).toBe('Uncategorized');
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
});
