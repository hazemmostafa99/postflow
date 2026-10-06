jest.mock('@nestjs/mongoose', () => ({
  InjectModel: () => () => undefined,
  Prop: () => () => undefined,
  Schema: () => () => undefined,
  SchemaFactory: {
    createForClass: () => ({ index: jest.fn() }),
  },
}));

import { SALES_TRIAL_DURATION_MS } from './sales-subscription-policy';
import { SalesSubscriptionsService } from './sales-subscriptions.service';

describe('SalesSubscriptionsService', () => {
  const startedAt = new Date('2026-10-07T00:00:00.000Z');
  const endsAt = new Date(startedAt.getTime() + SALES_TRIAL_DURATION_MS);
  const storedSubscription = {
    clerkUserId: 'user_1',
    trialStartedAt: startedAt,
    trialEndsAt: endsAt,
    accessUntil: endsAt,
    revokedAt: null,
  };

  it('creates a first trial with an atomic insert-only upsert', async () => {
    const exec = jest.fn().mockResolvedValue(storedSubscription);
    const findOneAndUpdate = jest.fn().mockReturnValue({ exec });
    const service = new SalesSubscriptionsService({
      findOneAndUpdate,
    } as never);

    const summary = await service.ensureTrial('user_1', startedAt);

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { clerkUserId: 'user_1' },
      {
        $setOnInsert: {
          clerkUserId: 'user_1',
          trialStartedAt: startedAt,
          trialEndsAt: endsAt,
          accessUntil: endsAt,
          revokedAt: null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    expect(summary.trialStartedAt).toEqual(startedAt);
    expect(summary.trialEndsAt).toEqual(endsAt);
    expect(summary.daysRemaining).toBe(30);
  });

  it('reuses the stored dates when a returning user signs in', async () => {
    const findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(storedSubscription),
    });
    const service = new SalesSubscriptionsService({
      findOneAndUpdate,
    } as never);
    const returningAt = new Date(startedAt.getTime() + 24 * 60 * 60 * 1000);

    const summary = await service.ensureTrial('user_1', returningAt);

    expect(summary.trialStartedAt).toEqual(startedAt);
    expect(summary.trialEndsAt).toEqual(endsAt);
    expect(summary.daysRemaining).toBe(29);
  });

  it('recovers a concurrently-created trial without creating another', async () => {
    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(storedSubscription),
    });
    const service = new SalesSubscriptionsService({
      findOneAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockRejectedValue({ code: 11000 }),
      }),
      findOne,
    } as never);

    const summary = await service.ensureTrial('user_1', startedAt);

    expect(findOne).toHaveBeenCalledWith({ clerkUserId: 'user_1' });
    expect(summary.trialStartedAt).toEqual(startedAt);
    expect(summary.trialEndsAt).toEqual(endsAt);
  });
});
