export type PublishingPlatform = 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK';

export type PublishingTargetType =
  | 'GROUP'
  | 'PROFILE_FEED'
  | 'INSTAGRAM_FEED'
  | 'INSTAGRAM_REEL'
  | 'TIKTOK_VIDEO'
  | 'TIKTOK_PHOTO';

export function getPlatformForTargetType(targetType: PublishingTargetType): PublishingPlatform {
  switch (targetType) {
    case 'GROUP':
    case 'PROFILE_FEED':
      return 'FACEBOOK';
    case 'INSTAGRAM_FEED':
    case 'INSTAGRAM_REEL':
      return 'INSTAGRAM';
    case 'TIKTOK_VIDEO':
    case 'TIKTOK_PHOTO':
      return 'TIKTOK';
  }
}

export type GroupPublishTarget = {
  type: 'GROUP';
  groupId: string;
  externalId?: string;
  name?: string;
  url: string;
};

export type ProfileFeedPublishTarget = {
  type: 'PROFILE_FEED';
  facebookConnectionId: string;
  facebookUserId: string;
  name?: string;
  url: string;
};

export type InstagramFeedPublishTarget = {
  type: 'INSTAGRAM_FEED';
  platformConnectionId: string;
  instagramAccountId?: string;
  instagramUsername?: string;
  url: string;
};

export type InstagramReelPublishTarget = {
  type: 'INSTAGRAM_REEL';
  platformConnectionId: string;
  instagramAccountId?: string;
  instagramUsername?: string;
  url: string;
};

export type TikTokVideoPublishTarget = {
  type: 'TIKTOK_VIDEO';
  platformConnectionId: string;
  tiktokUsername?: string;
  url: string;
};

export type TikTokPhotoPublishTarget = Omit<TikTokVideoPublishTarget, 'type'> & {
  type: 'TIKTOK_PHOTO';
};

export type PublishTarget =
  | GroupPublishTarget
  | ProfileFeedPublishTarget
  | InstagramFeedPublishTarget
  | InstagramReelPublishTarget
  | TikTokVideoPublishTarget
  | TikTokPhotoPublishTarget;

export type PublishJob = {
  id: string;
  platform: PublishingPlatform;
  post: Record<string, unknown>;
  target: PublishTarget;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function groupTargetFrom(value: unknown): GroupPublishTarget | null {
  if (!isRecord(value)) return null;
  const groupId = stringValue(value.groupId) ?? stringValue(value._id) ?? stringValue(value.id);
  const url = stringValue(value.url);
  if (!groupId || !url) return null;
  return {
    type: 'GROUP',
    groupId,
    ...(stringValue(value.externalId) ? { externalId: stringValue(value.externalId)! } : {}),
    ...(stringValue(value.name) ? { name: stringValue(value.name)! } : {}),
    url,
  };
}

function profileTargetFrom(value: unknown): ProfileFeedPublishTarget | null {
  if (!isRecord(value)) return null;
  const facebookConnectionId = stringValue(value.facebookConnectionId);
  const facebookUserId = stringValue(value.facebookUserId);
  const url = stringValue(value.url);
  if (!facebookConnectionId || !facebookUserId || !url) return null;
  return {
    type: 'PROFILE_FEED',
    facebookConnectionId,
    facebookUserId,
    ...(stringValue(value.name) ? { name: stringValue(value.name)! } : {}),
    url,
  };
}

function instagramFeedTargetFrom(value: unknown): InstagramFeedPublishTarget | null {
  if (!isRecord(value)) return null;
  const platformConnectionId = stringValue(value.platformConnectionId);
  const url = stringValue(value.url);
  if (!platformConnectionId || !url) return null;
  return {
    type: 'INSTAGRAM_FEED',
    platformConnectionId,
    ...(stringValue(value.instagramAccountId) ? { instagramAccountId: stringValue(value.instagramAccountId)! } : {}),
    ...(stringValue(value.instagramUsername) ? { instagramUsername: stringValue(value.instagramUsername)! } : {}),
    url,
  };
}

function instagramReelTargetFrom(value: unknown): InstagramReelPublishTarget | null {
  if (!isRecord(value)) return null;
  const platformConnectionId = stringValue(value.platformConnectionId);
  const url = stringValue(value.url);
  if (!platformConnectionId || !url) return null;
  return {
    type: 'INSTAGRAM_REEL',
    platformConnectionId,
    ...(stringValue(value.instagramAccountId) ? { instagramAccountId: stringValue(value.instagramAccountId)! } : {}),
    ...(stringValue(value.instagramUsername) ? { instagramUsername: stringValue(value.instagramUsername)! } : {}),
    url,
  };
}

function tiktokVideoTargetFrom(value: unknown): TikTokVideoPublishTarget | null {
  if (!isRecord(value)) return null;
  const platformConnectionId = stringValue(value.platformConnectionId);
  const url = stringValue(value.url);
  if (!platformConnectionId || !url) return null;
  return {
    type: 'TIKTOK_VIDEO',
    platformConnectionId,
    ...(stringValue(value.tiktokUsername) ? { tiktokUsername: stringValue(value.tiktokUsername)! } : {}),
    url,
  };
}

function tiktokPhotoTargetFrom(value: unknown): TikTokPhotoPublishTarget | null {
  const target = tiktokVideoTargetFrom(value);
  return target ? { ...target, type: 'TIKTOK_PHOTO' } : null;
}

// Normalizes the new queue payload while keeping already-claimed group jobs usable.
export function normalizePublishJob(value: unknown): PublishJob | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id) ?? stringValue(value._id);
  const post = isRecord(value.post) ? value.post : isRecord(value.postId) ? value.postId : null;
  const platformValue = stringValue(value.platform);
  if (!id || !post || !platformValue) return null;

  const platform: PublishingPlatform = platformValue as PublishingPlatform;
  const targetValue = isRecord(value.target) ? value.target : null;

  // Handle legacy jobs without platform field - default to FACEBOOK
  let target: PublishTarget | null = null;
  if (targetValue) {
    switch (targetValue.type) {
      case 'PROFILE_FEED':
        target = profileTargetFrom(targetValue);
        break;
      case 'GROUP':
        target = groupTargetFrom(targetValue);
        break;
      case 'INSTAGRAM_FEED':
        target = instagramFeedTargetFrom(targetValue);
        break;
      case 'INSTAGRAM_REEL':
        target = instagramReelTargetFrom(targetValue);
        break;
      case 'TIKTOK_VIDEO':
        target = tiktokVideoTargetFrom(targetValue);
        break;
      case 'TIKTOK_PHOTO':
        target = tiktokPhotoTargetFrom(targetValue);
        break;
    }
  }

  // Fallback for legacy GROUP jobs that have groupId at root level
  if (!target && platform === 'FACEBOOK') {
    target = groupTargetFrom(value.groupId);
  }

  return target ? { id, platform, post, target } : null;
}

// Profile jobs only accept the canonical Facebook-owned URL derived by the API.
export function getSafeFacebookProfileUrl(target: ProfileFeedPublishTarget): string | null {
  if (!/^\d+$/.test(target.facebookUserId)) return null;
  try {
    const url = new URL(target.url);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      (hostname !== 'www.facebook.com' && hostname !== 'facebook.com') ||
      url.pathname !== '/profile.php' ||
      url.searchParams.get('id') !== target.facebookUserId
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return `https://www.facebook.com/profile.php?id=${encodeURIComponent(target.facebookUserId)}`;
}
