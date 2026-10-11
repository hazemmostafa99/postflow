import {
  PublishingPlatform,
  resolvePublishingPlatform,
} from './publishing-platform';

export enum PublishingTargetType {
  GROUP = 'GROUP',
  PROFILE_FEED = 'PROFILE_FEED',
  INSTAGRAM_FEED = 'INSTAGRAM_FEED',
  INSTAGRAM_REEL = 'INSTAGRAM_REEL',
  TIKTOK_VIDEO = 'TIKTOK_VIDEO',
  TIKTOK_PHOTO = 'TIKTOK_PHOTO',
}

type PublishingTargetFields = {
  platform?: PublishingPlatform;
  targetType?: PublishingTargetType;
  groupId?: unknown;
  facebookConnectionId?: unknown;
  platformConnectionId?: unknown;
};

type PublishingTargetValidationError = {
  path:
    'platform' | 'groupId' | 'facebookConnectionId' | 'platformConnectionId';
  message: string;
};

export function resolvePublishingTargetType(
  targetType?: PublishingTargetType,
): PublishingTargetType {
  return targetType ?? PublishingTargetType.GROUP;
}

export function getPublishingPlatformForTargetType(
  targetType?: PublishingTargetType,
): PublishingPlatform {
  switch (resolvePublishingTargetType(targetType)) {
    case PublishingTargetType.GROUP:
    case PublishingTargetType.PROFILE_FEED:
      return PublishingPlatform.FACEBOOK;
    case PublishingTargetType.INSTAGRAM_FEED:
    case PublishingTargetType.INSTAGRAM_REEL:
      return PublishingPlatform.INSTAGRAM;
    case PublishingTargetType.TIKTOK_VIDEO:
    case PublishingTargetType.TIKTOK_PHOTO:
      return PublishingPlatform.TIKTOK;
  }
}

export function validatePublishingTarget(
  fields: PublishingTargetFields,
): PublishingTargetValidationError | null {
  const targetType = resolvePublishingTargetType(fields.targetType);
  const platform = resolvePublishingPlatform(fields.platform);
  const expectedPlatform = getPublishingPlatformForTargetType(targetType);

  if (platform !== expectedPlatform) {
    return {
      path: 'platform',
      message: `${targetType} jobs require the ${expectedPlatform} platform`,
    };
  }

  if (targetType === PublishingTargetType.PROFILE_FEED) {
    if (fields.groupId !== undefined && fields.groupId !== null) {
      return {
        path: 'groupId',
        message: 'PROFILE_FEED jobs must not reference a group',
      };
    }
    if (
      fields.facebookConnectionId === undefined ||
      fields.facebookConnectionId === null
    ) {
      return {
        path: 'facebookConnectionId',
        message: 'PROFILE_FEED jobs require a Facebook connection',
      };
    }
    return null;
  }

  if (targetType === PublishingTargetType.GROUP) {
    if (fields.groupId === undefined || fields.groupId === null) {
      return {
        path: 'groupId',
        message: 'GROUP jobs require a group',
      };
    }
    return null;
  }

  if (fields.groupId !== undefined && fields.groupId !== null) {
    return {
      path: 'groupId',
      message: `${targetType} jobs must not reference a Facebook group`,
    };
  }
  if (
    fields.facebookConnectionId !== undefined &&
    fields.facebookConnectionId !== null
  ) {
    return {
      path: 'facebookConnectionId',
      message: `${targetType} jobs must not reference a Facebook connection`,
    };
  }
  if (
    fields.platformConnectionId === undefined ||
    fields.platformConnectionId === null
  ) {
    return {
      path: 'platformConnectionId',
      message: `${targetType} jobs require a platform connection`,
    };
  }

  return null;
}
