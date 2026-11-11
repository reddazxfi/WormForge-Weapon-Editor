import { useEffect, useRef, useState } from 'react';
import type { ExplosionEffectConfig } from '../types/weapon';

/**
 * 50 Hz playback of the effects SDK's `px_effects` burst, which is what the
 * engine draws for the electric mine (`DrawExplosion` + `DrawEllipse` in
 * `utils_red/px_effects.c`). The real draw uses `wa.draw.ribbon` with the
 * beam/glow sheets; this preview strokes the same two noise-jittered
 * polygons additively so the envelope, thickness and ellipse read correctly.
 */
const TICK_MS = 20; // WA's game frame is 20 ms.

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

interface ExplosionPreviewProps {
  config: ExplosionEffectConfig;
}

export function ExplosionPreview({ config }: ExplosionPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(true);
  const [frame, setFrame] = useState(0);
  const [replay, setReplay] = useState(0);
  const configKey = JSON.stringify(config);
  const live = Math.max(1, Math.round(config.live));
  const total = live + 14;

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
    const extent = radius * (1 + grow) * Math.max(1, ellipseX, ellipseY);
    const scale = Math.min((width / 2 - 18) / extent, (height / 2 - 18) / extent);
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

    // Smoke lives under the ring, as the SDK draws it first.
    if (config.smoke && age <= live) {
      const particles = smokeParticles(seed, color.r, color.g, color.b);
      const drag = 0.1;
      for (const particle of particles) {
        if (age >= particle.life) continue;
        const travel = (1 - Math.pow(1 - drag, age)) / drag;
        const px = cx + (particle.x + particle.vx * travel) * scale;
        const py = cy + (particle.y + particle.vy * travel) * scale;
        const alpha = 1 - age / particle.life;
        const size = Math.max(2, particle.size * scale);
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

    if (frame <= live && env > 0) {
      const currentRadius = radius * (1 + grow * progress);
      const segments = segCount(config.segments, radius, rebuffered ? 1.3 : 1.2);
      const epoch = rebuffered ? rebufferAt + Math.floor((age - rebufferAt) / 3) : Math.floor(age / 3);
      const noiseValues: number[] = [];
      for (let i = 0; i <= segments; i += 1) {
        noiseValues.push(randRange(seed, epoch, i, -1, 1));
      }

      const path = (lens: boolean): void => {
        ctx.beginPath();
        for (let i = 0; i <= segments; i += 1) {
          const angle = (i / segments) * Math.PI * 2;
          const jitter = (noiseValues[i % noiseValues.length] ?? 0) * currentRadius * 0.08 * noise;
          const rx = lens ? currentRadius * ellipseX + jitter : currentRadius + jitter;
          const ry = lens ? currentRadius * ellipseY + jitter : currentRadius + jitter;
          const px = cx + Math.cos(angle) * rx * scale;
          const py = cy + Math.sin(angle) * ry * scale;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      };

      const thickness = Math.max(0.5, config.thickness);
      const passes: { lens: boolean; width: number; alpha: number }[] = [
        { lens: false, width: 2 * Math.max(0.9 * thickness * env, 1.8), alpha: 0.95 },
        { lens: false, width: 2 * thickness * env, alpha: 0.34 },
        { lens: true, width: 2 * Math.max(thickness * env, 1.4), alpha: 0.9 },
        { lens: true, width: 2 * thickness * env, alpha: 0.3 },
      ];
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const pass of passes) {
        path(pass.lens);
        ctx.strokeStyle = rgba(r, g, b, env * pass.alpha);
        ctx.lineWidth = Math.max(1, pass.width * scale);
        ctx.stroke();
      }
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
  }, [frame, configKey, replay, live, config, total]);

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
          <span className="text-[10px] font-mono text-stone-400">
            {String(Math.min(frame, live)).padStart(2, '0')} / {live} frames · 50 Hz
          </span>
        </div>
        <p className="text-[10px] text-stone-400">
          Approximates the beam/glow ribbon; the game draws the real sheets.
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
