import type { MissileAnimType, WeaponProject } from '../types/weapon';
import { assetUrl } from './assetUrl';
import {
  createPlaceholderHoldSheet,
  createPlaceholderMissileSheet,
} from './placeholderSprites';

/**
 * The two stock-style sprites supplied in `spec/` are the fallback held/flight
 * art while no PNG has been uploaded. They live in `public/` so both the
 * builder previews and the exported bundle use the exact same pixels.
 */

export type DefaultArtKey = 'blue_zook' | 'grenade';

export interface DefaultArt {
  key: DefaultArtKey;
  label: string;
  url: string;
  /** Native pixels of the supplied PNG (square, as PX's hold cells). */
  width: number;
  height: number;
}

const ART: Record<DefaultArtKey, DefaultArt> = {
  blue_zook: {
    key: 'blue_zook',
    label: 'Bazooka',
    url: assetUrl('assets/defaults/default_blue_zook.png'),
    width: 32,
    height: 32,
  },
  grenade: {
    key: 'grenade',
    label: 'Grenade',
    url: assetUrl('assets/defaults/default_grenade.png'),
    width: 46,
    height: 46,
  },
};

// Barrel weapons read better as the blue bazooka; throwables and everything
// else fall back to the grenade. Only the donor/slot names matter here, since
// the imported record does not carry art.
const BARREL_DONOR =
  /bazooka|zook|rocket|launcher|missile|minigun|uzi|shotgun|sniper|rifle|crossbow|gun/;

export function defaultArtFor(project: WeaponProject): DefaultArt {
  const donor = `${project.based_on ?? ''} ${project.slot ?? ''}`.toLowerCase();
  const barrel = BARREL_DONOR.test(donor) || project.fireType === 'hitscan';
  return barrel ? ART.blue_zook : ART.grenade;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode the sprite sheet.'));
    }, 'image/png');
  });
}

/** Stack `count` copies of `img` vertically so `frames` slices line up. */
async function stackFrames(img: HTMLImageElement, count: number): Promise<Blob> {
  const frames = Math.max(1, Math.round(count) || 1);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight * frames;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  ctx.imageSmoothingEnabled = false;
  for (let frame = 0; frame < frames; frame += 1) {
    ctx.drawImage(img, 0, frame * img.naturalHeight);
  }
  return canvasToPng(canvas);
}

/** The `hold.png` written when the hold builder has no uploaded sheet. */
export async function createDefaultHoldSheet(
  project: WeaponProject,
  frames: number
): Promise<Blob> {
  try {
    const img = await loadImage(defaultArtFor(project).url);
    return await stackFrames(img, frames);
  } catch {
    return createPlaceholderHoldSheet(frames);
  }
}

/** The `missile.png` written when custom flight art has no uploaded sheet. */
export async function createDefaultMissileSheet(
  project: WeaponProject,
  anim: MissileAnimType,
  frames: number
): Promise<Blob> {
  try {
    const img = await loadImage(defaultArtFor(project).url);
    return await stackFrames(img, frames);
  } catch {
    return createPlaceholderMissileSheet(anim, frames);
  }
}
