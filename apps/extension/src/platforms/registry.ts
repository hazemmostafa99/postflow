// Platform Adapter Registry
// Manages platform adapters and routes jobs to the correct adapter.

import type { PlatformPublisherAdapter, PublishingPlatform } from '../platform-adapter.js';
import { facebookAdapter } from './facebook/facebook-adapter.js';

const adapters = new Map<PublishingPlatform, PlatformPublisherAdapter>();

// Register built-in adapters
adapters.set('FACEBOOK', facebookAdapter);
// Instagram and TikTok adapters will be registered when their feature flags are enabled

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