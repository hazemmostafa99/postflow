/**
 * Result of inspecting Facebook after the final Post action.
 *
 * These types intentionally describe submission state only. Engagement,
 * approval re-checking, and historical analytics belong to later phases.
 */
type FacebookPostStatus =
  | "PUBLISHED"
  | "PENDING_APPROVAL"
  | "UNKNOWN";

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
  textFingerprint?: string;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  syncAttempts?: number;
  lastSyncError?: string;
}

type PendingPostSyncResult =
  | {
      status: "PUBLISHED";
      postUrl?: string;
    }
  | {
      status: "STILL_PENDING";
    }
  | {
      status: "CHECK_FAILED";
      reason?: string;
    };

interface PublishedFacebookPost {
  id: string;
  status: "PUBLISHED";
  postUrl: string;
  lastEngagementSyncAt?: string;
}

interface FacebookPostEngagement {
  reactionCount: number;
  commentCount: number;
  lastSyncedAt: string;
}

type PostEngagementSyncResult =
  | { status: "SUCCESS"; reactionCount: number; commentCount: number }
  | { status: "PARTIAL"; reactionCount?: number; commentCount?: number; reason?: string }
  | { status: "CHECK_FAILED"; reason?: string };
