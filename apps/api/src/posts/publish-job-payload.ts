import {
  PublishingTargetType,
  resolvePublishingTargetType,
} from '../schemas/publishing-target';

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

type PopulatedConnection = {
  _id: IdLike;
  displayName?: string;
  facebookUserId?: string;
  detectedFacebookUserId?: string;
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
    };

export type PublishJobPayload = {
  id: string;
  _id: string;
  targetType: PublishingTargetType;
  post: {
    content?: string;
    mediaUrls: string[];
  };
  target: PublishJobTarget;
  postId: PopulatedPost;
  groupId?: PopulatedGroup;
};

export type PublishJobSource = {
  _id: IdLike;
  targetType?: PublishingTargetType;
  postId?: PopulatedPost;
  groupId?: unknown;
  facebookConnectionId?: IdLike | PopulatedConnection;
};

function isPopulatedConnection(
  value: PublishJobSource['facebookConnectionId'],
): value is PopulatedConnection {
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

export function toPublishJobPayload(
  job: PublishJobSource,
): PublishJobPayload | null {
  const id = job._id.toString();
  const targetType = resolvePublishingTargetType(job.targetType);
  const post = {
    content: job.postId?.content,
    mediaUrls: Array.isArray(job.postId?.mediaUrls) ? job.postId.mediaUrls : [],
  };

  if (targetType === PublishingTargetType.PROFILE_FEED) {
    const connection = job.facebookConnectionId;
    if (!isPopulatedConnection(connection) || !connection.facebookUserId) {
      return null;
    }

    return {
      id,
      _id: id,
      targetType,
      post,
      postId: post,
      target: {
        type: PublishingTargetType.PROFILE_FEED,
        facebookConnectionId: connection._id.toString(),
        facebookUserId: connection.facebookUserId,
        name: connection.displayName ?? 'Profile feed',
        url: getFacebookProfileUrl(connection.facebookUserId),
      },
    };
  }

  const group = job.groupId;
  if (!isPopulatedGroup(group)) return null;

  return {
    id,
    _id: id,
    targetType: PublishingTargetType.GROUP,
    post,
    postId: post,
    groupId: group,
    target: {
      type: PublishingTargetType.GROUP,
      groupId: group._id.toString(),
      ...(group.name ? { name: group.name } : {}),
      ...(group.externalId ? { externalId: group.externalId } : {}),
      url: group.url ?? '',
    },
  };
}
