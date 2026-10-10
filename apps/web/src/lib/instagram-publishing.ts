export type InstagramDestinationType = "INSTAGRAM_FEED" | "INSTAGRAM_REEL";

export type InstagramMediaSelection =
  | { ready: true; targetType: InstagramDestinationType; label: "Photo post" | "Carousel" | "Reel"; error: null }
  | { ready: false; targetType: null; label: "Awaiting media" | "Invalid media"; error: string };

// Resolve from the current attachment, never from the selected account or a
// previous file. The API still validates the explicit target and media together.
export function resolveInstagramMedia(mediaUrls: readonly string[]): InstagramMediaSelection {
  if (mediaUrls.length === 0) {
    return { ready: false, targetType: null, label: "Awaiting media", error: "Attach one image or video to publish to Instagram." };
  }
  const imageCount = mediaUrls.filter((url) => url.startsWith("data:image/")).length;
  const videoCount = mediaUrls.filter((url) => url.startsWith("data:video/")).length;
  if (imageCount === mediaUrls.length && imageCount >= 1) {
    if (imageCount > 4) {
      return { ready: false, targetType: null, label: "Invalid media", error: "Instagram carousels support up to 4 images in this release." };
    }
    return { ready: true, targetType: "INSTAGRAM_FEED", label: imageCount === 1 ? "Photo post" : "Carousel", error: null };
  }
  if (videoCount === 1 && mediaUrls.length === 1) {
    return { ready: true, targetType: "INSTAGRAM_REEL", label: "Reel", error: null };
  }
  if (imageCount > 0 && videoCount > 0) {
    return { ready: false, targetType: null, label: "Invalid media", error: "Instagram carousel currently supports images only. Remove the video." };
  }
  if (videoCount > 1) {
    return { ready: false, targetType: null, label: "Invalid media", error: "Instagram supports one video per Reel in this release." };
  }
  if (imageCount > 4) {
    return { ready: false, targetType: null, label: "Invalid media", error: "Instagram carousels support up to 4 images in this release." };
  }
  if (imageCount === 1) {
    return { ready: true, targetType: "INSTAGRAM_FEED", label: "Photo post", error: null };
  }
  return { ready: false, targetType: null, label: "Invalid media", error: "Instagram requires a supported image or video attachment." };
}

export function buildInstagramTarget(platformConnectionId: string, mediaUrls: readonly string[]) {
  const selection = resolveInstagramMedia(mediaUrls);
  if (!selection.ready) throw new Error(selection.error);
  return { type: selection.targetType, platformConnectionId };
}
