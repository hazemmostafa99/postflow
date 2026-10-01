interface ProcessedProfileVideoNotification {
  key: string;
  notificationId?: string;
  postUrl: string;
}

function parseProcessedProfileVideoNotificationUrl(
  value: string,
): ProcessedProfileVideoNotification | null {
  try {
    const url = new URL(value, 'https://www.facebook.com/');
    if (
      url.protocol !== 'https:' ||
      !['facebook.com', 'www.facebook.com'].includes(url.hostname.toLowerCase()) ||
      url.searchParams.get('notif_t') !== 'fb_shorts_video_processed'
    ) return null;

    const reelId = url.pathname.match(/^\/reel\/(\d+)\/?$/i)?.[1];
    if (!reelId) return null;

    const notificationId = url.searchParams.get('notif_id')?.trim() || undefined;
    const postUrl = `https://www.facebook.com/reel/${reelId}/`;
    return {
      key: notificationId ? `notification:${notificationId}` : `reel:${reelId}`,
      ...(notificationId ? { notificationId } : {}),
      postUrl,
    };
  } catch {
    return null;
  }
}

function getProcessedProfileVideoNotifications(
  root: ParentNode = document,
): ProcessedProfileVideoNotification[] {
  const notifications: ProcessedProfileVideoNotification[] = [];
  const seenKeys = new Set<string>();

  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href*="/reel/"]')) {
    const notification = parseProcessedProfileVideoNotificationUrl(anchor.href || anchor.getAttribute('href') || '');
    if (!notification || seenKeys.has(notification.key)) continue;
    seenKeys.add(notification.key);
    notifications.push(notification);
  }

  return notifications;
}

function findNewProcessedProfileVideoNotification(
  root: ParentNode,
  baselineIdentities: ReadonlySet<string>,
): ProcessedProfileVideoNotification | null {
  return getProcessedProfileVideoNotifications(root).find((notification) =>
    !baselineIdentities.has(notification.key) &&
    !baselineIdentities.has(`post:${notification.postUrl}`),
  ) ?? null;
}
