// Platform feature flags (generated into dist/env.js at build time).
import {
  FACEBOOK_EXTENSION_PUBLISHING_ENABLED,
  INSTAGRAM_EXTENSION_PUBLISHING_ENABLED,
  TIKTOK_EXTENSION_PUBLISHING_ENABLED,
} from './env.js';
import './posting-timing.js';

export const PLATFORM_FEATURE_FLAGS = {
  FACEBOOK: FACEBOOK_EXTENSION_PUBLISHING_ENABLED,
  INSTAGRAM: INSTAGRAM_EXTENSION_PUBLISHING_ENABLED,
  TIKTOK: TIKTOK_EXTENSION_PUBLISHING_ENABLED,
} as const;

export function isPlatformEnabled(platform: 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK'): boolean {
  return PLATFORM_FEATURE_FLAGS[platform] === true;
}
