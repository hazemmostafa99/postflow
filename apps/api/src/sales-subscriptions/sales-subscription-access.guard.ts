import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema';
import {
  getSalesSubscriptionAccessErrorCode,
  shouldCheckSalesSubscription,
} from './sales-subscription-policy';
import { SalesSubscriptionsService } from './sales-subscriptions.service';

type SubscriptionRequest = {
  path?: string;
  originalUrl?: string;
  headers?: Record<string, string | string[] | undefined>;
};

@Injectable()
export class SalesSubscriptionAccessGuard implements CanActivate {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly salesSubscriptions: SalesSubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<SubscriptionRequest>();
    const path = request.path ?? request.originalUrl ?? '/';
    const clerkUserId = readHeader(request, 'x-clerk-user-id')?.trim();
    if (!clerkUserId || normalizePath(path) === '/api/auth/me') return true;

    const user = await this.userModel
      .findOne({ clerkUserId })
      .select('role teamId')
      .exec();

    if (!shouldCheckSalesSubscription({ path, clerkUserId, user })) return true;

    const subscription = await this.salesSubscriptions.ensureTrial(clerkUserId);
    const code = getSalesSubscriptionAccessErrorCode(subscription);
    if (!code) return true;

    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      code,
      message:
        code === 'SALES_SUBSCRIPTION_REVOKED'
          ? 'Your PostFlow sales access has been revoked.'
          : 'Your 30-day PostFlow sales trial has expired.',
      subscription,
    });
  }
}

function readHeader(
  request: SubscriptionRequest,
  name: string,
): string | undefined {
  const value = request.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function normalizePath(path: string): string {
  return path.split('?')[0].replace(/\/$/, '') || '/';
}
