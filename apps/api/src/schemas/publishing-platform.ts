export enum PublishingPlatform {
  FACEBOOK = 'FACEBOOK',
  INSTAGRAM = 'INSTAGRAM',
  TIKTOK = 'TIKTOK',
}

/** Legacy publishing jobs predate the platform discriminator and are Facebook jobs. */
export function resolvePublishingPlatform(
  platform?: PublishingPlatform,
): PublishingPlatform {
  return platform ?? PublishingPlatform.FACEBOOK;
}
