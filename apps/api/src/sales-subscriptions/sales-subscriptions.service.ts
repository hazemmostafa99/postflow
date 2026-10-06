import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SalesSubscription,
  SalesSubscriptionDocument,
} from '../schemas/sales-subscription.schema';
import {
  SALES_TRIAL_DURATION_MS,
  SalesSubscriptionSummary,
  summarizeSalesSubscription,
} from './sales-subscription-policy';

@Injectable()
export class SalesSubscriptionsService {
  constructor(
    @InjectModel(SalesSubscription.name)
    private readonly subscriptionModel: Model<SalesSubscriptionDocument>,
  ) {}

  async ensureTrial(
    clerkUserId: string,
    now = new Date(),
  ): Promise<SalesSubscriptionSummary> {
    const trialEndsAt = new Date(now.getTime() + SALES_TRIAL_DURATION_MS);
    let subscription: SalesSubscriptionDocument | null;

    try {
      subscription = await this.subscriptionModel
        .findOneAndUpdate(
          { clerkUserId },
          {
            $setOnInsert: {
              clerkUserId,
              trialStartedAt: now,
              trialEndsAt,
              accessUntil: trialEndsAt,
              revokedAt: null,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
        .exec();
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      subscription = await this.subscriptionModel
        .findOne({ clerkUserId })
        .exec();
    }

    if (!subscription) {
      throw new InternalServerErrorException(
        'Unable to provision the sales free trial',
      );
    }

    return summarizeSalesSubscription(subscription, now);
  }
}

function isDuplicateKeyError(error: unknown): error is { code: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}
