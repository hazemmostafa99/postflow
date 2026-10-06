import {
  getSalesSubscriptionAccessErrorCode,
  isIndividualSalesUser,
  SALES_TRIAL_DURATION_MS,
  SALES_SUBSCRIPTION_EXPIRED_CODE,
  SALES_SUBSCRIPTION_REVOKED_CODE,
  SalesSubscriptionStatus,
  shouldCheckSalesSubscription,
  summarizeSalesSubscription,
} from './sales-subscription-policy';

describe('sales subscription policy', () => {
  const trialStartedAt = new Date('2026-10-07T00:00:00.000Z');
  const trialEndsAt = new Date(
    trialStartedAt.getTime() + SALES_TRIAL_DURATION_MS,
  );

  it('reports all 30 days at the start of a trial', () => {
    const result = summarizeSalesSubscription(
      {
        trialStartedAt,
        trialEndsAt,
        accessUntil: trialEndsAt,
        revokedAt: null,
      },
      trialStartedAt,
    );

    expect(result.status).toBe(SalesSubscriptionStatus.TRIALING);
    expect(result.isAccessAllowed).toBe(true);
    expect(result.daysRemaining).toBe(30);
  });

  it('expires access exactly at accessUntil', () => {
    const result = summarizeSalesSubscription(
      {
        trialStartedAt,
        trialEndsAt,
        accessUntil: trialEndsAt,
        revokedAt: null,
      },
      trialEndsAt,
    );

    expect(result.status).toBe(SalesSubscriptionStatus.EXPIRED);
    expect(result.isAccessAllowed).toBe(false);
    expect(result.daysRemaining).toBe(0);
  });

  it('reports manually extended access as active after the trial', () => {
    const accessUntil = new Date(
      trialEndsAt.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    const result = summarizeSalesSubscription(
      {
        trialStartedAt,
        trialEndsAt,
        accessUntil,
        revokedAt: null,
      },
      trialEndsAt,
    );

    expect(result.status).toBe(SalesSubscriptionStatus.ACTIVE);
    expect(result.isAccessAllowed).toBe(true);
    expect(result.daysRemaining).toBe(7);
  });

  it('treats revocation as unavailable even before expiration', () => {
    const result = summarizeSalesSubscription(
      {
        trialStartedAt,
        trialEndsAt,
        accessUntil: trialEndsAt,
        revokedAt: new Date('2026-10-08T00:00:00.000Z'),
      },
      new Date('2026-10-09T00:00:00.000Z'),
    );

    expect(result.status).toBe(SalesSubscriptionStatus.REVOKED);
    expect(result.isAccessAllowed).toBe(false);
  });

  it('includes only sales users without a company team', () => {
    expect(isIndividualSalesUser({ role: 'SALES', teamId: null })).toBe(true);
    expect(isIndividualSalesUser({ role: 'SALES', teamId: 'team_1' })).toBe(
      false,
    );
    expect(isIndividualSalesUser({ role: 'ADMIN', teamId: null })).toBe(false);
  });

  it('keeps auth status available and protects extension operations', () => {
    const individual = { role: 'SALES', teamId: null };

    expect(
      shouldCheckSalesSubscription({
        path: '/api/auth/me?refresh=1',
        clerkUserId: 'user_1',
        user: individual,
      }),
    ).toBe(false);
    expect(
      shouldCheckSalesSubscription({
        path: '/api/jobs/next',
        clerkUserId: 'user_1',
        user: individual,
      }),
    ).toBe(true);
  });

  it('does not apply the individual subscription to company users', () => {
    expect(
      shouldCheckSalesSubscription({
        path: '/api/posts',
        clerkUserId: 'user_1',
        user: { role: 'SALES', teamId: 'team_1' },
      }),
    ).toBe(false);
    expect(
      shouldCheckSalesSubscription({
        path: '/api/posts',
        clerkUserId: 'admin_1',
        user: { role: 'ADMIN', teamId: null },
      }),
    ).toBe(false);
  });

  it('returns stable errors for expired and revoked access', () => {
    const baseSummary = {
      isAccessAllowed: false,
      trialStartedAt,
      trialEndsAt,
      accessUntil: trialEndsAt,
      daysRemaining: 0,
    };

    expect(
      getSalesSubscriptionAccessErrorCode({
        ...baseSummary,
        status: SalesSubscriptionStatus.EXPIRED,
      }),
    ).toBe(SALES_SUBSCRIPTION_EXPIRED_CODE);
    expect(
      getSalesSubscriptionAccessErrorCode({
        ...baseSummary,
        status: SalesSubscriptionStatus.REVOKED,
      }),
    ).toBe(SALES_SUBSCRIPTION_REVOKED_CODE);
    expect(
      getSalesSubscriptionAccessErrorCode({
        ...baseSummary,
        status: SalesSubscriptionStatus.TRIALING,
        isAccessAllowed: true,
        daysRemaining: 1,
      }),
    ).toBeNull();
  });
});
