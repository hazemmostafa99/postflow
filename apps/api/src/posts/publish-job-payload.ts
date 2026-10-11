import {
  PublishingTargetType,
  resolvePublishingTargetType,
} from '../schemas/publishing-target';
import { PublishingPlatform, resolvePublishingPlatform } from '../schemas/publishing-platform';
import {
  buildJobMediaReferences,
  JobMediaReference,
} from './job-media-delivery';

type IdLike = {
  toString(): string;
};

type PopulatedPost = {
  content?: string;
  mediaUrls?: string[];
};

type PopulatedGroup = {
  _id: IdLike;
  name?: string;
  externalId?: string;
  url?: string;
};

type PopulatedFacebookConnection = {
  _id: IdLike;
  displayName?: string;
  facebookUserId?: string;
  detectedFacebookUserId?: string;
};

type PopulatedPlatformConnection = {
  _id: IdLike;
  platform?: PublishingPlatform;
  displayName?: string;
  externalAccountId?: string;
  externalUsername?: string;
  detectedExternalAccountId?: string;
};

export type PublishJobTarget =
  | {
      type: PublishingTargetType.GROUP;
      groupId: string;
      name?: string;
      externalId?: string;
      url: string;
    }
  | {
      type: PublishingTargetType.PROFILE_FEED;
      facebookConnectionId: string;
      facebookUserId: string;
      name: string;
      url: string;
    }
  | {
      type: PublishingTargetType.INSTAGRAM_FEED;
      platformConnectionId: string;
      instagramAccountId?: string;
      /** Legacy jobs only; ID-backed jobs intentionally omit this field. */
      instagramUsername?: string;
      url: string;
    }
  | {
      type: PublishingTargetType.INSTAGRAM_REEL;
      platformConnectionId: string;
      instagramAccountId?: string;
      /** Legacy jobs only; ID-backed jobs intentionally omit this field. */
      instagramUsername?: string;
      url: string;
    }
  | {
      type: PublishingTargetType.TIKTOK_VIDEO | PublishingTargetType.TIKTOK_PHOTO;
      platformConnectionId: string;
      tiktokUsername?: string;
      url: string;
    };

export type PublishJobPayload = {
  id: string;
  _id: string;
  platform: PublishingPlatform;
  targetType: PublishingTargetType;
  post: {
    content?: string;
    mediaUrls: string[];
    media?: JobMediaReference[];
  };
  target: PublishJobTarget;
  postId: PopulatedPost;
  groupId?: PopulatedGroup;
  platformConnectionId?: string;
};

export type PublishJobSource = {
  _id: IdLike;
  targetType?: PublishingTargetType;
  platform?: PublishingPlatform;
  platformConnectionId?: IdLike | PopulatedPlatformConnection;
  postId?: PopulatedPost;
  groupId?: unknown;
  facebookConnectionId?: IdLike | PopulatedFacebookConnection;
  claimExpiresAt?: Date;
};

export type PublishJobPayloadOptions = {
  mediaAccessToken?: string;
};

function isPopulatedPlatformConnection(
  value: PublishJobSource['platformConnectionId'],
): value is PopulatedPlatformConnection {
  return Boolean(
    value &&
    typeof value === 'object' &&
    '_id' in value &&
    ('externalAccountId' in value || 'externalUsername' in value),
  );
}

function isPopulatedFacebookConnection(
  value: PublishJobSource['facebookConnectionId'],
): value is PopulatedFacebookConnection {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'facebookUserId' in value &&
    '_id' in value,
  );
}

function isPopulatedGroup(value: unknown): value is PopulatedGroup {
  return Boolean(value && typeof value === 'object' && '_id' in value);
}

export function getFacebookProfileUrl(facebookUserId: string): string {
  return `https://www.facebook.com/profile.php?id=${encodeURIComponent(
    facebookUserId,
  )}`;
}

export function getInstagramProfileUrl(instagramUsername: string): string {
  return `https://www.instagram.com/${encodeURIComponent(instagramUsername)}/`;
}

export function getTikTokProfileUrl(tiktokUsername: string): string {
  return `https://www.tiktok.com/@${encodeURIComponent(tiktokUsername)}`;
}

function getPlatformForTargetTypeLocal(targetType: PublishingTargetType): PublishingPlatform {
  switch (targetType) {
    case PublishingTargetType.GROUP:
    case PublishingTargetType.PROFILE_FEED:
      return PublishingPlatform.FACEBOOK;
    case PublishingTargetType.INSTAGRAM_FEED:
    case PublishingTargetType.INSTAGRAM_REEL:
      return PublishingPlatform.INSTAGRAM;
    case PublishingTargetType.TIKTOK_VIDEO:
    case PublishingTargetType.TIKTOK_PHOTO:
      return PublishingPlatform.TIKTOK;
    default:
      return PublishingPlatform.FACEBOOK;
  }
}

export function toPublishJobPayload(
  job: PublishJobSource,
  options: PublishJobPayloadOptions = {},
): PublishJobPayload | null {
  const id = job._id.toString();
  const targetType = resolvePublishingTargetType(job.targetType);
  const platform = job.platform ?? getPlatformForTargetTypeLocal(targetType);
  const post = {
    content: job.postId?.content,
    mediaUrls: Array.isArray(job.postId?.mediaUrls) ? job.postId.mediaUrls : [],
  };

  const platformConnection = job.platformConnectionId;
  const facebookConnection = job.facebookConnectionId;

  if (targetType === PublishingTargetType.PROFILE_FEED) {
    const connection = facebookConnection;
    if (!isPopulatedFacebookConnection(connection) || !connection.facebookUserId) {
      return null;
    }

    return {
      id,
      _id: id,
      platform: PublishingPlatform.FACEBOOK,
      targetType,
      post,
      postId: post,
      ...(platformConnection
        ? {
            platformConnectionId: String(
              isPopulatedPlatformConnection(platformConnection)
                ? platformConnection._id
                : platformConnection,
            ),
          }
        : {}),
      target: {
        type: PublishingTargetType.PROFILE_FEED,
        facebookConnectionId: connection._id.toString(),
        facebookUserId: connection.facebookUserId,
        name: connection.displayName ?? 'Profile feed',
        url: getFacebookProfileUrl(connection.facebookUserId),
      },
    };
  }

  if (targetType === PublishingTargetType.GROUP) {
    const group = job.groupId;
    if (!isPopulatedGroup(group)) return null;

    return {
      id,
      _id: id,
      platform: PublishingPlatform.FACEBOOK,
      targetType: PublishingTargetType.GROUP,
      post,
      postId: post,
      groupId: group,
      ...(platformConnection
        ? {
            platformConnectionId: String(
              isPopulatedPlatformConnection(platformConnection)
                ? platformConnection._id
                : platformConnection,
            ),
          }
        : {}),
      target: {
        type: PublishingTargetType.GROUP,
        groupId: group._id.toString(),
        ...(group.name ? { name: group.name } : {}),
        ...(group.externalId ? { externalId: group.externalId } : {}),
        url: group.url ?? '',
      },
    };
  }

  if (targetType === PublishingTargetType.INSTAGRAM_FEED) {
    const pc = platformConnection;
    if (
      !isPopulatedPlatformConnection(pc) ||
      (!pc.externalAccountId && !pc.externalUsername)
    ) {
      return null;
    }

    return {
      id,
      _id: id,
      platform: PublishingPlatform.INSTAGRAM,
      targetType: PublishingTargetType.INSTAGRAM_FEED,
      post,
      postId: post,
      platformConnectionId: pc._id.toString(),
      target: {
        type: PublishingTargetType.INSTAGRAM_FEED,
        platformConnectionId: pc._id.toString(),
        ...(pc.externalAccountId ? { instagramAccountId: pc.externalAccountId } : {}),
        ...(!pc.externalAccountId && pc.externalUsername ? { instagramUsername: pc.externalUsername } : {}),
        url: pc.externalUsername
          ? getInstagramProfileUrl(pc.externalUsername)
          : 'https://www.instagram.com/',
      },
    };
  }

  if (targetType === PublishingTargetType.INSTAGRAM_REEL) {
    const pc = platformConnection;
    if (
      !isPopulatedPlatformConnection(pc) ||
      (!pc.externalAccountId && !pc.externalUsername)
    ) {
      return null;
    }

    return {
      id,
      _id: id,
      platform: PublishingPlatform.INSTAGRAM,
      targetType: PublishingTargetType.INSTAGRAM_REEL,
      post,
      postId: post,
      platformConnectionId: pc._id.toString(),
      target: {
        type: PublishingTargetType.INSTAGRAM_REEL,
        platformConnectionId: pc._id.toString(),
        ...(pc.externalAccountId ? { instagramAccountId: pc.externalAccountId } : {}),
        ...(!pc.externalAccountId && pc.externalUsername ? { instagramUsername: pc.externalUsername } : {}),
        url: pc.externalUsername
          ? getInstagramProfileUrl(pc.externalUsername)
          : 'https://www.instagram.com/',
      },
    };
  }

  if (targetType === PublishingTargetType.TIKTOK_VIDEO || targetType === PublishingTargetType.TIKTOK_PHOTO) {
    const pc = platformConnection;
    if (
      !isPopulatedPlatformConnection(pc) ||
      (!pc.externalAccountId && !pc.externalUsername) ||
      !options.mediaAccessToken ||
      !job.claimExpiresAt
    ) {
      return null;
    }

    const media = buildJobMediaReferences(
      id,
      post.mediaUrls,
      options.mediaAccessToken,
      job.claimExpiresAt,
    );
    if (media.length !== post.mediaUrls.length) return null;
    const deliveredPost = {
      content: post.content,
      mediaUrls: [],
      media,
    };

    return {
      id,
      _id: id,
      platform: PublishingPlatform.TIKTOK,
      targetType,
      post: deliveredPost,
      postId: deliveredPost,
      platformConnectionId: pc._id.toString(),
      target: {
        type: targetType,
        platformConnectionId: pc._id.toString(),
        tiktokUsername: pc.externalUsername,
        url: pc.externalUsername
          ? getTikTokProfileUrl(pc.externalUsername)
          : 'https://www.tiktok.com/',
      },
    };
  }

  return null;
}
