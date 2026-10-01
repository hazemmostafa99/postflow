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

export type PublishTarget = GroupPublishTarget | ProfileFeedPublishTarget;

export type PublishJob = {
  id: string;
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

// Normalizes the new queue payload while keeping already-claimed group jobs usable.
export function normalizePublishJob(value: unknown): PublishJob | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id) ?? stringValue(value._id);
  const post = isRecord(value.post) ? value.post : isRecord(value.postId) ? value.postId : null;
  if (!id || !post) return null;

  const targetValue = isRecord(value.target) ? value.target : null;
  const target = targetValue?.type === 'PROFILE_FEED'
    ? profileTargetFrom(targetValue)
    : targetValue?.type === 'GROUP'
      ? groupTargetFrom(targetValue)
      : groupTargetFrom(value.groupId);

  return target ? { id, post, target } : null;
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
