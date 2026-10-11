// Read at each creation/claim boundary so rollback stops new work immediately.
// Existing jobs can still report terminal results through the status endpoint.
export function isTikTokPublishingEnabled(): boolean {
  return process.env.TIKTOK_EXTENSION_PUBLISHING_ENABLED === 'true';
}
