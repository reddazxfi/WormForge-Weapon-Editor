import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import type { RibbonTrailConfig } from '../types/weapon';
import { assetUrl } from '../utils/assetUrl';
import frozenWormSrc from '../../spec/wicestnd.png';

const TICK_MS = 20; // 50 Hz WormForge simulation tick

const TRAIL_SHEETS = {
  beam: assetUrl('assets/effects/beam.png'),
  glow: assetUrl('assets/effects/beam_glow.png'),
};

function tintedSheet(image: HTMLImageElement, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(color.trim()) ? color : '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

interface RibbonTrailPreviewProps {
  config: RibbonTrailConfig;
}

/**
 * Live 50 Hz preview of `wf-lib/effects/trail`: samples an arcing projectile
 * every `every` game frames up to `max` points, draws additive `beam.png` and
 * `beam_glow.png` quads along the segments, then sheds the tail at `vanish`
 * frames per point after impact so fading behaviour is visible immediately.
 */
export function RibbonTrailPreview({ config }: RibbonTrailPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(true);
  const [showWormRef, setShowWormRef] = useState(true);
  const [replay, setReplay] = useState(0);
  const [tick, setTick] = useState(0);
  const [sheets, setSheets] = useState<Record<string, HTMLImageElement>>({});
  const [frozenWormImg, setFrozenWormImg] = useState<HTMLImageElement | null>(null);

  const maxPts = Math.max(2, Math.min(64, Math.round(config.max || 12)));
  const every = Math.max(1, Math.min(10, Math.round(config.every || 2)));
  const vanish = Math.max(1, Math.min(10, Math.round(config.vanish || 2)));

  // Flight runs 72 ticks (~1.44s at 50 Hz), then sheds all sampled points + 15-tick pause.
  const flightTicks = 72;
  const totalTicks = flightTicks + maxPts * vanish + 18;

  useEffect(() => {
    let cancelled = false;
    const loaded: Record<string, HTMLImageElement> = {};
    let pending = Object.keys(TRAIL_SHEETS).length;
    for (const [key, url] of Object.entries(TRAIL_SHEETS)) {
      const img = new Image();
      img.onload = () => {
        loaded[key] = img;
        pending -= 1;
        if (pending === 0 && !cancelled) setSheets({ ...loaded });
      };
      img.onerror = () => {
        pending -= 1;
        if (pending === 0 && !cancelled) setSheets({ ...loaded });
      };
      img.src = url;
    }
    const wormImage = new Image();
    wormImage.onload = () => {
      if (!cancelled) setFrozenWormImg(wormImage);
    };
    wormImage.src = frozenWormSrc;
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setTick(0);
  }, [config.max, config.every, config.vanish, replay]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setTick((t) => (t >= totalTicks ? 0 : t + 1));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing, totalTicks]);

  const tinted = useMemo(() => {
    const cache: Record<string, HTMLCanvasElement> = {};
    for (const [key, img] of Object.entries(sheets)) {
      cache[key] = tintedSheet(img, config.color || '#ffffff');
    }
    return cache;
  }, [sheets, config.color]);

  // Precompute current live/fading point list from 0..tick using exact trail.lua cadence.
  const { points, headPos, inFlight } = useMemo(() => {
    const pts: { nx: number; ny: number }[] = [];
    const posAt = (f: number) => {
      const u = Math.min(1, Math.max(0, f / flightTicks));
      // Smooth ballistic arc from bottom-left launch to mid-right impact
      return {
        nx: 0.1 + u * 0.8,
        ny: 0.78 - Math.sin(u * Math.PI) * 0.56 - u * 0.08,
      };
    };

    const simEnd = Math.min(tick, flightTicks);
    for (let f = 1; f <= simEnd; f += 1) {
      if (f % every === 0) {
        pts.push(posAt(f));
        if (pts.length > maxPts) pts.shift();
      }
    }

    if (tick > flightTicks) {
      const post = tick - flightTicks;
      const shed = Math.floor(post / vanish);
      for (let s = 0; s < shed && pts.length > 0; s += 1) {
        pts.shift();
      }
    }

    return {
      points: pts,
      headPos: tick <= flightTicks ? posAt(tick) : posAt(flightTicks),
      inFlight: tick <= flightTicks,
    };
  }, [tick, maxPts, every, vanish]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.clientWidth || 480;
    const height = canvas.clientHeight || 220;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Night sky background matching ExplosionPreview
    const bg = ctx.createRadialGradient(width / 2, height / 2, 10, width / 2, height / 2, width * 0.65);
    bg.addColorStop(0, '#1b2230');
    bg.addColorStop(1, '#0a0d12');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Subtle 24px reference grid
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

    // Subtle trajectory guide dotted arc
    ctx.save();
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 40; i += 1) {
      const u = i / 40;
      const gx = (0.1 + u * 0.8) * width;
      const gy = (0.78 - Math.sin(u * Math.PI) * 0.56 - u * 0.08) * height;
      if (i === 0) ctx.moveTo(gx, gy);
      else ctx.lineTo(gx, gy);
    }
    ctx.stroke();
    ctx.restore();

    // Scale reference worm in bottom-right corner
    if (showWormRef && frozenWormImg && frozenWormImg.complete && frozenWormImg.naturalWidth > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = false;
      const dx = Math.round(width - 12 - 39);
      const dy = Math.round(height - 16 - 44);
      ctx.drawImage(frozenWormImg, dx, dy);
      ctx.fillStyle = 'rgba(226, 232, 240, 0.55)';
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'right';
      ctx.fillText('worm ref', width - 10, height - 5);
      ctx.restore();
    }

    const pxPts = points.map((p) => ({ x: p.nx * width, y: p.ny * height }));

    const drawRibbonPass = (sheet: HTMLCanvasElement | undefined, baseWidth: number) => {
      if (!sheet || baseWidth <= 0 || pxPts.length < 2) return;
      const n = pxPts.length;
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n - 1; i += 1) {
        const a = pxPts[i];
        const b = pxPts[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.1) continue;
        // Matches trail.lua: `local f = math.max(0.1, (i + 1) / (n + 1))`
        const f = Math.max(0.1, (i + 2) / (n + 1));
        const segW = Math.max(0.5, f * baseWidth);
        ctx.save();
        ctx.globalAlpha = Math.min(1, f);
        ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
        ctx.rotate(Math.atan2(dy, dx));
        // Slight +0.8px seam bleed avoids subpixel dark gaps on curved quads without bar artifacts.
        ctx.drawImage(sheet, -(len + 0.8) / 2, -segW / 2, len + 0.8, segW);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    };

    const coreW = Math.max(0, Number(config.coreWidth) || 0);
    const glowW = Math.max(0, Number(config.glowWidth) || 0);

    // Core + Glow additive passes using the exact beam.png and beam_glow.png sheets
    drawRibbonPass(tinted.beam, coreW);
    if (glowW > 0) {
      drawRibbonPass(tinted.glow, glowW);
    }

    // Active projectile marker / impact flash
    const hx = headPos.nx * width;
    const hy = headPos.ny * height;
    ctx.globalCompositeOperation = 'source-over';
    if (inFlight) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(hx, hy, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = config.color || '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (tick <= flightTicks + 12) {
      const p = (tick - flightTicks) / 12;
      ctx.strokeStyle = `rgba(255, 255, 255, ${(1 - p) * 0.7})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hx, hy, 4 + p * 16, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(226, 232, 240, 0.6)';
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(inFlight ? 'in flight' : 'fading tail', 10, height - 10);
  }, [points, headPos, inFlight, tick, tinted, config.coreWidth, config.glowWidth, config.color, showWormRef, frozenWormImg]);

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        aria-label="Live action preview of the ribbon trail using beam and glow sheets"
        className="h-[220px] w-full rounded-xl border border-stone-300 bg-stone-950 dark:border-stone-700"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPlaying((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md border border-sky-300/80 bg-sky-50/80 px-2.5 py-1 text-[11px] font-semibold text-sky-800 transition-colors hover:bg-sky-100 dark:border-sky-700/60 dark:bg-sky-950/40 dark:text-sky-200 dark:hover:bg-sky-900/50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {playing ? <Pause className="h-3 w-3" aria-hidden="true" /> : <Play className="h-3 w-3" aria-hidden="true" />}
            <span>{playing ? 'Pause' : 'Play'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setReplay((v) => v + 1);
              setPlaying(true);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-amber-300/80 bg-amber-50/80 px-2.5 py-1 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            <span>Replay</span>
          </button>
          <button
            type="button"
            onClick={() => setShowWormRef((v) => !v)}
            aria-pressed={showWormRef}
            title="Toggle frozen worm sprite in the corner for 1:1 scale reference."
            className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showWormRef
                ? 'border-forge-600 bg-forge-600 text-white'
                : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300'
            }`}
          >
            Worm
          </button>
        </div>

        <span className="font-mono text-[10px] text-stone-500 dark:text-stone-400 tabular-nums">
          {points.length}/{maxPts} pts · 50 Hz
        </span>
      </div>
    </div>
  );
}
