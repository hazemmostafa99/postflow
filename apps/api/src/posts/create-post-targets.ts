import { PublishingTargetType } from '../schemas/publishing-target';

export type CreatePostTarget =
  | {
      type: PublishingTargetType.GROUP;
      groupId: string;
    }
  | {
      type: PublishingTargetType.PROFILE_FEED;
      facebookConnectionId: string;
    }
  | {
      type: PublishingTargetType.INSTAGRAM_FEED | PublishingTargetType.INSTAGRAM_REEL;
      platformConnectionId: string;
    };

export type VerifiableFacebookConnection = {
  status: string;
  facebookSessionDetected: boolean;
  facebookUserId?: string;
  detectedFacebookUserId?: string;
};

export type VerifiablePlatformConnection = {
  platform: string;
  status: string;
  sessionDetected: boolean;
  externalUsername?: string;
  detectedExternalUsername?: string;
};

const MONGODB_OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

export function normalizeCreatePostTargets(
  targets: unknown,
  targetGroupIds: unknown,
): CreatePostTarget[] {
  if (targets !== undefined && !Array.isArray(targets)) {
    throw new Error('Targets must be an array');
  }
  if (targetGroupIds !== undefined && !Array.isArray(targetGroupIds)) {
    throw new Error('Target group IDs must be an array');
  }

  const normalizedTargets: CreatePostTarget[] = [];
  for (const target of targets ?? []) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      throw new Error('Each publishing target must be an object');
    }

    const candidate = target as Record<string, unknown>;
    if (candidate.type === PublishingTargetType.GROUP) {
      if (candidate.facebookConnectionId !== undefined) {
        throw new Error('GROUP targets must not include a Facebook connection');
      }
      normalizedTargets.push({
        type: PublishingTargetType.GROUP,
        groupId: normalizeObjectId(candidate.groupId, 'group'),
      });
      continue;
    }

    if (candidate.type === PublishingTargetType.PROFILE_FEED) {
      if (candidate.groupId !== undefined) {
        throw new Error('PROFILE_FEED targets must not include a group');
      }
      normalizedTargets.push({
        type: PublishingTargetType.PROFILE_FEED,
        facebookConnectionId: normalizeObjectId(
          candidate.facebookConnectionId,
          'Facebook connection',
        ),
      });
      continue;
    }

    if (
      candidate.type === PublishingTargetType.INSTAGRAM_FEED ||
      candidate.type === PublishingTargetType.INSTAGRAM_REEL
    ) {
      if (candidate.groupId !== undefined || candidate.facebookConnectionId !== undefined) {
        throw new Error('Instagram targets must not include Facebook destinations');
      }
      normalizedTargets.push({
        type: candidate.type,
        platformConnectionId: normalizeObjectId(
          candidate.platformConnectionId,
          'platform connection',
        ),
      });
      continue;
    }

    throw new Error('Unsupported publishing target type');
  }

  for (const groupId of targetGroupIds ?? []) {
    normalizedTargets.push({
      type: PublishingTargetType.GROUP,
      groupId: normalizeObjectId(groupId, 'group'),
    });
  }

  if (!normalizedTargets.length) {
    throw new Error('At least one publishing target must be selected');
  }

  const targetKeys = new Set<string>();
  for (const target of normalizedTargets) {
    const targetId =
      target.type === PublishingTargetType.GROUP
        ? target.groupId
        : target.type === PublishingTargetType.PROFILE_FEED
          ? target.facebookConnectionId
          : target.platformConnectionId;
    const key = `${target.type}:${targetId}`;
    if (targetKeys.has(key)) {
      throw new Error('Duplicate publishing targets are not allowed');
    }
    targetKeys.add(key);
  }

  return normalizedTargets;
}

export function isVerifiedProfileConnection(
  connection: VerifiableFacebookConnection,
): boolean {
  return Boolean(
    connection.status === 'CONNECTED' &&
    connection.facebookSessionDetected &&
    connection.facebookUserId &&
    connection.detectedFacebookUserId &&
    connection.facebookUserId === connection.detectedFacebookUserId,
  );
}

export function isVerifiedInstagramConnection(
  connection: VerifiablePlatformConnection,
): boolean {
  return Boolean(
    connection.platform === 'INSTAGRAM' &&
    connection.status === 'CONNECTED' &&
    connection.sessionDetected &&
    connection.externalUsername &&
    connection.detectedExternalUsername &&
    connection.externalUsername.toLowerCase() ===
      connection.detectedExternalUsername.toLowerCase(),
  );
}

function normalizeObjectId(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`A valid ${label} ID is required`);
  }
  const normalized = value.trim();
  if (!MONGODB_OBJECT_ID_PATTERN.test(normalized)) {
    throw new Error(`A valid ${label} ID is required`);
  }
  return normalized.toLowerCase();
}
