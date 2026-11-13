import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExplosionEffectConfig } from '../types/weapon';
import { assetUrl } from '../utils/assetUrl';

/**
 * 50 Hz playback of the effects SDK's `px_effects` burst, which is what the
 * engine draws for the electric mine (`DrawExplosion` + `DrawEllipse` in
 * `utils_red/px_effects.c`).
 *
 * The game draws the ring and the squashed lens as `wa.draw.ribbon` passes over
 * the SDK's own sheets — `beam.png` for the sharp core and `beam_glow.png` for
 * the soft halo, both additive, so the art is white-on-black. This preview
 * draws the same sheets the same way: each polygon edge becomes a textured quad
 * stretched along the edge, tinted by the effect colour and composited with
 * `lighter`. The smoke uses the SDK's `cloud.png`.
 */
const TICK_MS = 20; // WA's game frame is 20 ms.

/** The SDK's sheets, copied from `spec/lua_sdk/effects_sdk/sprites/px_effects/`. */
const SHEETS = {
  beam: assetUrl('assets/effects/beam.png'),
  glow: assetUrl('assets/effects/beam_glow.png'),
  cloud: assetUrl('assets/effects/cloud.png'),
};

/** Park-Miller hashes are stable across redraws, so the ring does not boil. */
function rand01(seed: number, epoch: number, index: number): number {
  let x = (seed ^ Math.imul(epoch + 1, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x / 0x100000000;
}

function randRange(seed: number, epoch: number, index: number, a: number, b: number): number {
  return a + (b - a) * rand01(seed, epoch, index);
}

/** `seg_count` from px_effects.lua: <10 multiplies the radius, else a count. */
function segCount(value: number, radius: number, mul: number): number {
  let n: number;
  if (!value || value <= 0) n = Math.floor(radius * mul);
  else if (value < 10) n = Math.floor(radius * value);
  else n = Math.floor(value);
  return Math.min(255, Math.max(8, n));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function rgba(r: number, g: number, b: number, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

interface SmokeParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  r: number;
  g: number;
  b: number;
}

/** `make_smoke_parts`: two kinds, seven of each, drag 0.10. */
function smokeParticles(
  seed: number,
  r: number,
  g: number,
  b: number,
  count = 7,
  kinds = 2,
): SmokeParticle[] {
  const parts: SmokeParticle[] = [];
  let index = 0;
  for (let kind = 1; kind <= kinds; kind += 1) {
    for (let i = 0; i < count; i += 1) {
      const spread = 2.0;
      const up: [number, number] = [4.5, 7.0];
      const life: [number, number] = [27, 52];
      const first = kind === 1;
      parts.push({
        x: randRange(seed, 0, index, -4, 4),
        y: randRange(seed, 0, index + 900, -4, 4),
        vx: first
          ? randRange(seed, 0, index + 1800, -spread, spread)
          : randRange(seed, 0, index + 1800, -1.5, 1.5),
        vy: first
          ? -randRange(seed, 0, index + 2700, up[0], up[1])
          : randRange(seed, 0, index + 2700, -2.3, 2.3),
        size: (first ? 32 : 28) + Math.round(randRange(seed, 0, index + 3600, -6, 6)),
        life: Math.round(randRange(seed, 0, index + 4500, life[0], life[1])),
        r: Math.floor(r * (first ? 0.91 : 1)),
        g: Math.floor(g * (first ? 0.92 : 1)),
        b: Math.floor(b * (first ? 0.92 : 1)),
      });
      index += 1;
    }
  }
  return parts;
}

function parseHex(color: string): { r: number; g: number; b: number } {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return { r: 255, g: 255, b: 255 };
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/**
 * The sheets are white-on-black and the game multiplies them by the effect
 * colour, so a tinted copy is made once per colour and reused: `multiply` keeps
 * the texture's shading, and the black background adds nothing under `lighter`.
 */
function tintedSheet(image: HTMLImageElement, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

interface ExplosionPreviewProps {
  config: ExplosionEffectConfig;
}

export function ExplosionPreview({ config }: ExplosionPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(true);
  const [frame, setFrame] = useState(0);
  const [replay, setReplay] = useState(0);
  // 1:1 by default: the game draws the ring in pixels, so the preview shows
  // the same size it will have in game. `Fit` is for radii larger than the canvas.
  const [zoom, setZoom] = useState<'fit' | '1x'>('1x');
  const [sheets, setSheets] = useState<Record<string, HTMLImageElement>>({});
  const configKey = JSON.stringify(config);
  const live = Math.max(1, Math.round(config.live));
  const total = live + 14;

  // The SDK's own art, loaded once.
  useEffect(() => {
    let cancelled = false;
    const loaded: Record<string, HTMLImageElement> = {};
    let pending = Object.keys(SHEETS).length;
    for (const [key, url] of Object.entries(SHEETS)) {
      const image = new Image();
      image.onload = () => {
        loaded[key] = image;
        pending -= 1;
        if (pending === 0 && !cancelled) setSheets({ ...loaded });
      };
      image.onerror = () => {
        pending -= 1;
        if (pending === 0 && !cancelled) setSheets({ ...loaded });
      };
      image.src = url;
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // A settings change starts a fresh burst; the loop restarts itself when the
  // envelope and its smoke have finished.
  useEffect(() => {
    setFrame(0);
  }, [configKey, replay]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setFrame((current) => (current >= total ? 0 : current + 1));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing, total]);

  const tinted = useMemo(() => {
    const cache: Record<string, HTMLCanvasElement> = {};
    for (const [key, image] of Object.entries(sheets)) {
      cache[key] = tintedSheet(image, config.color);
    }
    return cache;
  }, [sheets, config.color]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.clientWidth || 520;
    const height = canvas.clientHeight || 240;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const bg = ctx.createRadialGradient(width / 2, height / 2, 8, width / 2, height / 2, width / 2);
    bg.addColorStop(0, '#1b2230');
    bg.addColorStop(1, '#0a0d12');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)';
    ctx.lineWidth = 1;
    for (let x = 24; x < width; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
    }
    for (let y = 24; y < height; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
    }

    const radius = Math.max(1, config.radius);
    const grow = Math.max(0, config.grow);
    const ellipseX = Math.max(0.05, config.ellipseX);
    const ellipseY = Math.max(0.05, config.ellipseY);
    // The game draws in pixels. `fit` sizes the canvas to the *initial* ring so
    // the burst starts at a readable size and then grows and clips exactly as it
    // does in game; `1x` is one canvas pixel per game pixel.
    const fitExtent = radius * Math.max(1, ellipseX, ellipseY);
    const scale =
      zoom === '1x'
        ? 1
        : Math.min((width / 2 - 14) / fitExtent, (height / 2 - 14) / fitExtent);
    const cx = width / 2;
    const cy = height / 2;
    const seed = 1337 + replay * 7919;
    const age = Math.min(frame, live + 1);
    const fade = config.fade || 0.55;
    const duration = Math.max(1, Math.round(config.duration));
    const rebufferAt = Math.max(1, Math.round(config.rebuffer ? 16 : 0));
    const rebuffered = config.rebuffer && age >= rebufferAt;
    const noise = rebuffered ? Math.max(1.8, config.noise * 1.6) : config.noise;
    const color = parseHex(config.color);
    const r = color.r;
    const g = color.g;
    const b = color.b;
    // The re-buffer's own envelope is negative (fade -0.85), so the ring
    // brightens as it shrinks after frame 16 in PX's effect.
    const timer = rebuffered
      ? rebufferAt * fade + (age - rebufferAt) * -0.85
      : age * fade;
    const progress = clamp01(timer / duration);
    const env = 1 - progress;

    /** One ribbon pass: a textured quad per polygon edge, additive. */
    const ribbon = (
      points: { x: number; y: number }[],
      sheet: HTMLCanvasElement | undefined,
      lineWidth: number,
      alpha: number,
    ) => {
      if (!sheet || lineWidth <= 0 || alpha <= 0) return;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, alpha);
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const next = points[(i + 1) % points.length];
        const dx = next.x - a.x;
        const dy = next.y - a.y;
        const length = Math.hypot(dx, dy);
        if (length < 0.01) continue;
        ctx.save();
        ctx.translate((a.x + next.x) / 2, (a.y + next.y) / 2);
        ctx.rotate(Math.atan2(dy, dx));
        // No overlap: the sheets are uniform along their length, so adjacent
        // quads tile seamlessly, and an overlap would double the additive
        // brightness into a bright bar at every joint.
        ctx.drawImage(sheet, -length / 2, -lineWidth / 2, length, lineWidth);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    };

    // Smoke lives under the ring, as the SDK draws it first.
    if (config.smoke && age <= live) {
      const particles = smokeParticles(seed, color.r, color.g, color.b);
      const drag = 0.1;
      const cloud = tinted.cloud;
      for (const particle of particles) {
        if (age >= particle.life) continue;
        const travel = (1 - Math.pow(1 - drag, age)) / drag;
        const px = cx + (particle.x + particle.vx * travel) * scale;
        const py = cy + (particle.y + particle.vy * travel) * scale;
        const alpha = 1 - age / particle.life;
        const size = Math.max(2, particle.size * scale);
        if (cloud) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = alpha * 0.55;
          ctx.drawImage(cloud, px - size / 2, py - size / 2, size, size);
          ctx.globalAlpha = 1;
        } else {
          const gradient = ctx.createRadialGradient(px, py, 1, px, py, size / 2);
          gradient.addColorStop(0, rgba(particle.r, particle.g, particle.b, alpha * 0.5));
          gradient.addColorStop(1, rgba(particle.r, particle.g, particle.b, 0));
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(px, py, size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    if (frame <= live && env > 0) {
      const currentRadius = radius * (1 + grow * progress);
      const segments = segCount(config.segments, radius, rebuffered ? 1.3 : 1.2);
      const epoch = rebuffered ? rebufferAt + Math.floor((age - rebufferAt) / 3) : Math.floor(age / 3);
      const noiseValues: number[] = [];
      for (let i = 0; i <= segments; i += 1) {
        noiseValues.push(randRange(seed, epoch, i, -1, 1));
      }

      const ring = (lens: boolean): { x: number; y: number }[] => {
        const points: { x: number; y: number }[] = [];
        for (let i = 0; i <= segments; i += 1) {
          const angle = (i / segments) * Math.PI * 2;
          const jitter = (noiseValues[i % noiseValues.length] ?? 0) * currentRadius * 0.08 * noise;
          const rx = lens ? currentRadius * ellipseX + jitter : currentRadius + jitter;
          const ry = lens ? currentRadius * ellipseY + jitter : currentRadius + jitter;
          points.push({ x: cx + Math.cos(angle) * rx * scale, y: cy + Math.sin(angle) * ry * scale });
        }
        return points;
      };

      const thickness = Math.max(0.5, config.thickness);
      // The sharp core pass. The SDK derives it from `thickness` (0.9 x for the
      // ring, 1.0 x for the lens) and floors it at 1.8 / 1.4 half-width; an
      // explicit `core` replaces the derived width and keeps a 2.5 px floor,
      // below which the beam texture's bright band stops reading as a line.
      const core = config.core && config.core > 0 ? Math.max(2.5, config.core) : 0;
      const half = core > 0 ? Math.max(core * env, 1.25) : Math.max(0.9 * thickness * env, 1.8);
      const lensHalf = core > 0 ? Math.max(core * env, 1.25) : Math.max(thickness * env, 1.4);
      const ringPoints = ring(false);
      const lensPoints = ring(true);
      // The SDK's order: ring core, ring glow, lens core, lens glow.
      ribbon(ringPoints, tinted.beam, 2 * half * scale, env);
      ribbon(ringPoints, tinted.glow, 2 * thickness * env * scale, env);
      ribbon(lensPoints, tinted.beam, 2 * lensHalf * scale, env);
      ribbon(lensPoints, tinted.glow, 2 * thickness * env * scale, env);
    }

    // Centre mark and a scale readout keep the proportions honest.
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy);
    ctx.lineTo(cx + 5, cy);
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx, cy + 5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(226, 232, 240, 0.55)';
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(`${Math.round(currentRadiusForLabel(config, frame))}px`, 10, height - 10);
    if (zoom === 'fit') {
      ctx.fillText(`${scale.toFixed(2)}×`, 10, height - 24);
    }
  }, [frame, configKey, replay, live, config, total, tinted, zoom]);

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        aria-label="Preview of the effects SDK explosion burst"
        className="w-full h-[240px] rounded-xl border border-stone-300 dark:border-stone-700 bg-stone-950"
        style={{ imageRendering: 'auto' }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPlaying((value) => !value)}
            className="px-2.5 py-1 text-[11px] font-semibold rounded bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700"
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            onClick={() => {
              setReplay((value) => value + 1);
              setPlaying(true);
            }}
            className="px-2.5 py-1 text-[11px] font-semibold rounded bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700"
          >
            Replay
          </button>
          <button
            type="button"
            onClick={() => setZoom((value) => (value === 'fit' ? '1x' : 'fit'))}
            aria-pressed={zoom === '1x'}
            title="Fit sizes the canvas to the starting ring; 1× is one canvas pixel per game pixel."
            className={`px-2.5 py-1 text-[11px] font-semibold rounded border ${
              zoom === '1x'
                ? 'bg-forge-600 text-white border-forge-600'
                : 'bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700'
            }`}
          >
            {zoom === 'fit' ? 'Fit' : '1×'}
          </button>
          <span className="text-[10px] font-mono text-stone-400">
            {String(Math.min(frame, live)).padStart(2, '0')} / {live} frames · 50 Hz
          </span>
        </div>
        <p className="text-[10px] text-stone-400">
          Draws the SDK&apos;s own `beam`/`beam_glow` sheets additively, as the game does.
        </p>
      </div>
    </div>
  );
}

function currentRadiusForLabel(config: ExplosionEffectConfig, frame: number): number {
  const duration = Math.max(1, Math.round(config.duration));
  const progress = clamp01((Math.min(frame, config.live) * (config.fade || 0.55)) / duration);
  return Math.max(1, config.radius) * (1 + Math.max(0, config.grow) * progress);
}
