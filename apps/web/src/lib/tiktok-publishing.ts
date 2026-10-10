export interface TikTokConnection {
  _id: string;
  displayName?: string;
  extensionName?: string | null;
  extensionInstanceIdMasked?: string | null;
  activeExtensionInstallationId?: string | null;
  externalUsername?: string;
  detectedExternalUsername?: string;
  status: string;
  workerStatus: string;
  sessionDetected: boolean;
}

export function isTikTokConnectionReady(connection: TikTokConnection): boolean {
  return Boolean(connection.status === "CONNECTED" && connection.sessionDetected &&
    connection.externalUsername && connection.externalUsername.toLowerCase() ===
    connection.detectedExternalUsername?.toLowerCase());
}

export function getTikTokMediaError(mediaUrls: readonly string[]): string | null {
  const videos = mediaUrls.filter((url) => url.startsWith("data:video/"));
  const images = mediaUrls.filter((url) => url.startsWith("data:image/"));
  if (mediaUrls.length === 1 && videos.length === 1) return null;
  if (mediaUrls.length >= 1 && mediaUrls.length <= 4 && images.length === mediaUrls.length) return null;
  return "TikTok requires one video, or 1 to 4 images. Mixed video and photo posts are not supported.";
}

export function buildTikTokTarget(platformConnectionId: string, mediaUrls: readonly string[]) {
  const error = getTikTokMediaError(mediaUrls);
  if (error) throw new Error(error);
  return mediaUrls[0].startsWith("data:video/")
    ? { type: "TIKTOK_VIDEO" as const, platformConnectionId }
    : { type: "TIKTOK_PHOTO" as const, platformConnectionId };
}

export function getTikTokMediaLabel(mediaUrls: readonly string[]): "Video" | "Photo post" {
  return mediaUrls.length === 1 && mediaUrls[0].startsWith("data:video/") ? "Video" : "Photo post";
}
