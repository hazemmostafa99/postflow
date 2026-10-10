/**
 * Result of inspecting Facebook after the final Post action.
 *
 * These types intentionally describe submission state only. Engagement,
 * approval re-checking, and historical analytics belong to later phases.
 */
type FacebookPostStatus =
  | "PUBLISHING"
  | "PUBLISHED"
  | "PENDING_APPROVAL"
  | "TEMPORARY_BLOCK"
  | "CAPTCHA_OR_CHALLENGE"
  | "CHECKPOINT_OR_VERIFICATION"
  | "LOGIN_REQUIRED"
  | "UNEXPECTED_INTERRUPTION"
  | "UNKNOWN";

type FacebookPublishInterruptionStatus =
  | "TEMPORARY_BLOCK"
  | "CAPTCHA_OR_CHALLENGE"
  | "CHECKPOINT_OR_VERIFICATION"
  | "LOGIN_REQUIRED"
  | "UNEXPECTED_INTERRUPTION";

interface FacebookPublishInterruption {
  status: FacebookPublishInterruptionStatus;
  reason: string;
  source: "dom" | "navigation" | "composer" | "network" | "unknown";
  detector: string;
  shouldPauseQueue: boolean;
  diagnosticText?: string;
}

type FacebookPostSubmissionResult =
  | {
      status: "PUBLISHED";
      postUrl?: string;
    }
  | {
      status: "PENDING_APPROVAL";
      postUrl?: string;
    }
  | {
      status: "UNKNOWN";
      reason?: string;
    }
  | {
      status: FacebookPublishInterruptionStatus;
      reason: string;
      source?: FacebookPublishInterruption["source"];
      detector?: string;
      shouldPauseQueue?: boolean;
    };

/** Minimal backend record needed to re-check a pending Facebook submission. */
interface PendingFacebookPost {
  id: string;
  groupId: string;
  groupExternalId?: string;
  groupUrl: string;
  status: "PENDING_APPROVAL";
  postUrl?: string;
  content?: string;
  submittedAt: string;
  mediaCount?: number;
  videoIds?: string[];
  textFingerprint?: string;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  syncAttempts?: number;
  lastSyncError?: string;
  claimToken?: string;
  englishGroupVideo?: boolean;
  englishPendingApprovalLookup?: boolean;
}

type PendingPostSyncResult =
  | {
      status: "CONTENT_MATCHED";
      copiedShareUrl?: string;
    }
  | {
      status: "PUBLISHED";
      postUrl?: string;
    }
  | {
      status: "STILL_PENDING";
      postUrl?: string;
    }
  | {
      status: "CHECK_FAILED";
      reason?: string;
    };

interface PublishedPlatformPost {
  id: string;
  status: "PUBLISHED";
  platform?: "FACEBOOK" | "INSTAGRAM" | "TIKTOK";
  targetType?: "GROUP" | "PROFILE_FEED" | "INSTAGRAM_FEED" | "INSTAGRAM_REEL" | "TIKTOK_VIDEO" | "TIKTOK_PHOTO";
  postUrl: string;
  lastEngagementSyncAt?: string;
  claimToken?: string;
}

type PublishedFacebookPost = PublishedPlatformPost;

interface FacebookPostEngagement {
  reactionCount: number;
  commentCount: number;
  lastSyncedAt: string;
}

type PostEngagementSyncResult =
  | { status: "SUCCESS"; reactionCount?: number; commentCount?: number; favoriteCount?: number; shareCount?: number }
  | { status: "PARTIAL"; reactionCount?: number; commentCount?: number; favoriteCount?: number; shareCount?: number; reason?: string }
  | { status: "CHECK_FAILED"; reason?: string; emptySurface?: boolean };
