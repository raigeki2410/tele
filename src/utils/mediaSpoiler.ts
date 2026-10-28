import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { config } from '../config.js';

/**
 * Spoiler mode for media forwarded from Zalo to Telegram.
 *
 * When enabled, photos and videos are sent with Telegram's "has_spoiler"
 * animation (blurred until tapped). The env flag TG_MEDIA_SPOILER only sets the
 * DEFAULT; once /spoiler is used, the persisted choice wins so it survives
 * restarts.
 */

const FILE = path.join(config.dataDir, 'media-spoiler.json');

let enabled = config.telegram.mediaSpoiler;

function load(): void {
  try {
    if (!existsSync(FILE)) return;
    const raw = JSON.parse(readFileSync(FILE, 'utf8')) as { enabled?: unknown };
    if (typeof raw.enabled === 'boolean') enabled = raw.enabled;
  } catch (err) {
    console.warn('[MediaSpoiler] Failed to load state:', err);
  }
}

load();

export function isMediaSpoilerEnabled(): boolean {
  return enabled;
}

export function setMediaSpoilerEnabled(value: boolean): boolean {
  enabled = value;
  try {
    mkdirSync(path.dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify({ enabled }, null, 2), 'utf8');
  } catch (err) {
    console.warn('[MediaSpoiler] Failed to save state:', err);
  }
  return enabled;
}
