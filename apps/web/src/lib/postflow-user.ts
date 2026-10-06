type PostFlowSubscriptionStatus = "TRIALING" | "ACTIVE" | "EXPIRED" | "REVOKED";

export type PostFlowSubscription = {
  status: PostFlowSubscriptionStatus;
  isAccessAllowed: boolean;
  trialStartedAt: string;
  trialEndsAt: string;
  accessUntil: string;
  daysRemaining: number;
};

export type PostFlowUser = {
  id: string;
  clerkUserId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  role: string;
  status: string;
  teamId: string | null;
  accountType: "INDIVIDUAL_SALES" | "COMPANY_MANAGED";
  subscription: PostFlowSubscription | null;
};

type PostFlowProfile = {
  clerkUserId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
};

const API_BASE = process.env.API_URL || "http://localhost:8000";

export async function fetchPostFlowUser(
  profile: PostFlowProfile,
): Promise<PostFlowUser | null> {
  try {
    const response = await fetch(`${API_BASE}/api/auth/me`, {
      headers: {
        "x-clerk-user-id": profile.clerkUserId,
        ...(profile.email ? { "x-clerk-user-email": profile.email } : {}),
        ...(profile.firstName
          ? { "x-clerk-user-first-name": profile.firstName }
          : {}),
        ...(profile.lastName
          ? { "x-clerk-user-last-name": profile.lastName }
          : {}),
      },
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(`[PostFlow access] API returned status ${response.status}`);
      return null;
    }

    return (await response.json()) as PostFlowUser;
  } catch (error) {
    console.error("[PostFlow access] Unable to reach the API", error);
    return null;
  }
}
