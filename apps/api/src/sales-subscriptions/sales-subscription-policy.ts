import type { SalesSubscription } from '../schemas/sales-subscription.schema';

export const SALES_TRIAL_DAYS = 30;
export const SALES_TRIAL_DURATION_MS = SALES_TRIAL_DAYS * 24 * 60 * 60 * 1000;

export enum SalesSubscriptionStatus {
  TRIALING = 'TRIALING',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}

type SubscriptionDates = Pick<
  SalesSubscription,
  'trialStartedAt' | 'trialEndsAt' | 'accessUntil' | 'revokedAt'
>;

export type SalesSubscriptionSummary = {
  status: SalesSubscriptionStatus;
  isAccessAllowed: boolean;
  trialStartedAt: Date;
  trialEndsAt: Date;
  accessUntil: Date;
  daysRemaining: number;
};

export const SALES_SUBSCRIPTION_EXPIRED_CODE = 'SALES_SUBSCRIPTION_EXPIRED';
export const SALES_SUBSCRIPTION_REVOKED_CODE = 'SALES_SUBSCRIPTION_REVOKED';

export type SalesSubscriptionAccessErrorCode =
  | typeof SALES_SUBSCRIPTION_EXPIRED_CODE
  | typeof SALES_SUBSCRIPTION_REVOKED_CODE;

export function isIndividualSalesUser(user: {
  role: string;
  teamId?: string | null;
}): boolean {
  return user.role === 'SALES' && !user.teamId;
}

export function summarizeSalesSubscription(
  subscription: SubscriptionDates,
  now = new Date(),
): SalesSubscriptionSummary {
  const trialStartedAt = new Date(subscription.trialStartedAt);
  const trialEndsAt = new Date(subscription.trialEndsAt);
  const accessUntil = new Date(subscription.accessUntil);
  const isRevoked = Boolean(subscription.revokedAt);
  const isExpired = now.getTime() >= accessUntil.getTime();
  const isAccessAllowed = !isRevoked && !isExpired;

  let status: SalesSubscriptionStatus;
  if (isRevoked) {
    status = SalesSubscriptionStatus.REVOKED;
  } else if (isExpired) {
    status = SalesSubscriptionStatus.EXPIRED;
  } else if (now.getTime() < trialEndsAt.getTime()) {
    status = SalesSubscriptionStatus.TRIALING;
  } else {
    status = SalesSubscriptionStatus.ACTIVE;
  }

  return {
    status,
    isAccessAllowed,
    trialStartedAt,
    trialEndsAt,
    accessUntil,
    daysRemaining: isAccessAllowed
      ? Math.ceil(
          (accessUntil.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
        )
      : 0,
  };
}

export function shouldCheckSalesSubscription(input: {
  path: string;
  clerkUserId?: string;
  user?: { role: string; teamId?: string | null } | null;
}): boolean {
  if (normalizeApiPath(input.path) === '/api/auth/me') return false;
  if (!input.clerkUserId?.trim() || !input.user) return false;
  return isIndividualSalesUser(input.user);
}

export function getSalesSubscriptionAccessErrorCode(
  subscription: SalesSubscriptionSummary,
): SalesSubscriptionAccessErrorCode | null {
  if (subscription.isAccessAllowed) return null;
  return subscription.status === SalesSubscriptionStatus.REVOKED
    ? SALES_SUBSCRIPTION_REVOKED_CODE
    : SALES_SUBSCRIPTION_EXPIRED_CODE;
}

function normalizeApiPath(path: string): string {
  return path.split('?')[0].replace(/\/$/, '') || '/';
}
