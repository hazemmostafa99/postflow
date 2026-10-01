export enum PublishingTargetType {
  GROUP = 'GROUP',
  PROFILE_FEED = 'PROFILE_FEED',
}

type PublishingTargetFields = {
  targetType?: PublishingTargetType;
  groupId?: unknown;
  facebookConnectionId?: unknown;
};

type PublishingTargetValidationError = {
  path: 'groupId' | 'facebookConnectionId';
  message: string;
};

export function resolvePublishingTargetType(
  targetType?: PublishingTargetType,
): PublishingTargetType {
  return targetType ?? PublishingTargetType.GROUP;
}

export function validatePublishingTarget(
  fields: PublishingTargetFields,
): PublishingTargetValidationError | null {
  const targetType = resolvePublishingTargetType(fields.targetType);

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

  if (fields.groupId === undefined || fields.groupId === null) {
    return {
      path: 'groupId',
      message: 'GROUP jobs require a group',
    };
  }

  return null;
}
