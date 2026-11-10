import type { MissileAnimType } from '../types/weapon';

/**
 * The Hold & Sprite Builder previews generic art when no PNG has been uploaded
 * yet. These helpers render that same art into real PNG sheets so an exported
 * bundle never points `hold.sheet` / `sb.flight` at a file that does not exist.
 *
 * Keep the drawing in sync with `HoldPreview.tsx` (placeholder weapon) and
 * `renderProceduralMissile` there.
 */

const HOLD_FRAME = 60;

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode the placeholder sprite sheet.'));
    }, 'image/png');
  });
}

/** 60x60 cells, PX orientation (barrel up, grip at the bottom). */
export async function createPlaceholderHoldSheet(frames = 1): Promise<Blob> {
  const count = Math.max(1, Math.round(frames) || 1);
  const canvas = document.createElement('canvas');
  canvas.width = HOLD_FRAME;
  canvas.height = HOLD_FRAME * count;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable.');

  ctx.imageSmoothingEnabled = false;
  for (let frame = 0; frame < count; frame += 1) {
    ctx.save();
    ctx.translate(HOLD_FRAME / 2, frame * HOLD_FRAME + HOLD_FRAME / 2);

    ctx.fillStyle = '#d65443';
    ctx.strokeStyle = '#85271e';
    ctx.lineWidth = 1;
    ctx.fillRect(-3, -10, 6, 20);
    ctx.strokeRect(-3, -10, 6, 20);

    ctx.fillStyle = '#f0a99e';
    ctx.beginPath();
    ctx.moveTo(-3, -10);
    ctx.lineTo(0, -15);
    ctx.lineTo(3, -10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  return canvasToPng(canvas);
}

const MISSILE_FRAME = 32;

function drawProceduralMissile(
  ctx: CanvasRenderingContext2D,
  anim: MissileAnimType,
  frame: number
): void {
  if (anim === 'rotation') {
    // Chilli Bomb / Grenade style.
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.ellipse(0, 0, 6, 11, Math.PI / 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#991b1b';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#16a34a';
    ctx.fillRect(-2, -14, 4, 4);

    ctx.fillStyle = '#fca5a5';
    ctx.fillRect(-2, -6, 3, 6);
    return;
  }

  if (anim === 'track') {
    // Shadow Bolt / Bazooka Rocket style, nose up.
    ctx.fillStyle = '#6366f1';
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 4);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3730a3';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = frame % 2 === 0 ? '#38bdf8' : '#a855f7';
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Mini Girder or spinning projectile, long axis up.
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(-4, -12, 8, 24);
  ctx.strokeStyle = '#b45309';
  ctx.lineWidth = 1;
  ctx.strokeRect(-4, -12, 8, 24);
  ctx.fillStyle = '#fef3c7';
  ctx.fillRect(-2, -9, 4, 4);
  ctx.fillRect(-2, 5, 4, 4);
}

/** 32x32 cells stacked vertically, matching the builder's procedural preview. */
export async function createPlaceholderMissileSheet(
  anim: MissileAnimType,
  frames = 1
): Promise<Blob> {
  const count = Math.max(1, Math.round(frames) || 1);
  const canvas = document.createElement('canvas');
  canvas.width = MISSILE_FRAME;
  canvas.height = MISSILE_FRAME * count;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable.');

  ctx.imageSmoothingEnabled = false;
  for (let frame = 0; frame < count; frame += 1) {
    ctx.save();
    ctx.translate(MISSILE_FRAME / 2, frame * MISSILE_FRAME + MISSILE_FRAME / 2);
    drawProceduralMissile(ctx, anim, frame);
    ctx.restore();
  }

  return canvasToPng(canvas);
}
