// Platform Adapter Registry
// Manages platform adapters and routes jobs to the correct adapter.

import type { PlatformPublisherAdapter, PublishingPlatform } from '../platform-adapter.js';
import { facebookAdapter } from './facebook/facebook-adapter.js';
import { instagramAdapter } from './instagram/index.js';

const adapters = new Map<PublishingPlatform, PlatformPublisherAdapter>();

// Register built-in adapters
adapters.set('FACEBOOK', facebookAdapter);
adapters.set('INSTAGRAM', instagramAdapter);
// TikTok will be registered when its adapter is implemented.

export function getPlatformAdapter(platform: PublishingPlatform): PlatformPublisherAdapter | undefined {
  return adapters.get(platform);
}

export function registerPlatformAdapter(adapter: PlatformPublisherAdapter): void {
  adapters.set(adapter.platform, adapter);
}

export function getSupportedPlatforms(): PublishingPlatform[] {
  return Array.from(adapters.keys());
}

export function isPlatformSupported(platform: PublishingPlatform): boolean {
  return adapters.has(platform);
}
