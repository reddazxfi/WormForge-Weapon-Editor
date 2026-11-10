// RETIRED: this was the "Launch Simulator" tab. Its terrain/collision loop
// could lock the renderer (requiring a tab close), and the weapon+aiming
// preview it duplicated now lives in the Hold & Sprite Builder. Nothing
// imports it; keep it only as reference for a future collision-safe rewrite.
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { WeaponProject, SimulationParticle } from '../types/weapon';
import {
  Play,
  RotateCcw,
  Wind,
  Crosshair,
  Sparkles,
  Flame,
  ZoomIn,
  ArrowLeftRight,
  ShieldAlert,
  Info,
  Clock,
  Activity,
  Layers,
} from 'lucide-react';

interface ProjectileSimulationProps {
  project: WeaponProject;
}

interface SimulatedBody {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  bounciness: number;
  keepSpeedPct: number;
  fuseRemainingMs: number;
  isClustlet: boolean;
  color: string;
  active: boolean;
  bounces: number;
  maxBounces: number;
  settled: boolean;
  trailType: string;
}

interface SimulatedFlame {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  burnRemainingMs: number;
  settled: boolean;
  color: string;
  size: number;
  generation: number;
}

// Worms Armageddon constants from reverse engineering
const WA_GRAVITY_BASE_TICK = 0x3d70 / 0x10000; // ≈ 0.23999 px/tick² @ 50 Hz (CM+0x22c)
const WA_THROW_MAX_SPEED_TICK = 24; // 24 px/tick at 100% launch power (1200 px/s)
const WA_THROW_SPAWN_OFFSET = 24; // 24 px offset along aim direction
const WORM_SITE_X = 184; // 187 - 3px left = 184
const WORM_SITE_Y = 176; // 164 + 12px down = 176
const MAP_WIDTH = 300;
const MAP_HEIGHT = 300;

const getAssetUrl = (rel: string): string => {
  const base = import.meta.env.BASE_URL || './';
  const cleanBase = base.endsWith('/') ? base : `${base}/`;
  return `${cleanBase}${rel.replace(/^\/+/, '')}`;
};

export const ProjectileSimulation: React.FC<ProjectileSimulationProps> = ({ project }) => {
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const terrainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskDataRef = useRef<Uint8ClampedArray | null>(null);

  // Worm & Viewport State
  const [aimAngleDeg, setAimAngleDeg] = useState(38); // 0 (flat) to 90 (vertical)
  const [launchPowerPct, setLaunchPowerPct] = useState(85); // 10 to 100%
  const [facing, setFacing] = useState<1 | -1>(-1); // -1 = facing left (aim line flipped into map)
  const [windPct, setWindPct] = useState(25); // -100 to +100
  const [showGuide, setShowGuide] = useState(true);
  const [zoomScale, setZoomScale] = useState<1 | 2 | 3>(2); // 1x, 2x (default 600px), 3x (900px)
  const [isDraggingAim, setIsDraggingAim] = useState(false);

  // Simulation Entities
  const [projectiles, setProjectiles] = useState<SimulatedBody[]>([]);
  const [flames, setFlames] = useState<SimulatedFlame[]>([]);
  const [particles, setParticles] = useState<SimulationParticle[]>([]);
  const [stats, setStats] = useState({
    cratersCount: 0,
    totalShots: 0,
    activeBodies: 0,
    lastFlightTicks: 0,
    impactSpeed: 0,
  });

  // Assets
  const aimImgRef = useRef<HTMLImageElement | null>(null);
  const mapImgRef = useRef<HTMLImageElement | null>(null);
  const [terrainLoaded, setTerrainLoaded] = useState(false);

  const bodyConfig = project.body;
  const clustletConfig = bodyConfig.clustlet;

  // Preload map and worm aim strip
  useEffect(() => {
    // 1. Load worm aim posture strip (32 frames of 60x60)
    const aimImg = new Image();
    aimImg.onload = () => {
      aimImgRef.current = aimImg;
    };
    aimImg.onerror = () => {
      aimImg.src = getAssetUrl('assets/aistudio/aim_902140e3.png');
    };
    aimImg.src = getAssetUrl('assets/worm/aim.png');

    // 2. Load authentic launch map
    const mapImg = new Image();
    mapImg.onload = () => {
      mapImgRef.current = mapImg;
      initTerrainFromImage(mapImg);
    };
    mapImg.onerror = () => {
      // Fallback
      mapImg.src = getAssetUrl('assets/worm/pre_weapon_preview.png');
    };
    mapImg.src = getAssetUrl('pre_weapon_preview.png');
  }, []);

  // Initialize terrain canvas from authentic PNG
  const initTerrainFromImage = useCallback((img: HTMLImageElement) => {
    if (!terrainCanvasRef.current) {
      terrainCanvasRef.current = document.createElement('canvas');
      terrainCanvasRef.current.width = MAP_WIDTH;
      terrainCanvasRef.current.height = MAP_HEIGHT;
    }
    const tCanvas = terrainCanvasRef.current;
    const tCtx = tCanvas.getContext('2d');
    if (!tCtx) return;

    tCtx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
    tCtx.drawImage(img, 0, 0, MAP_WIDTH, MAP_HEIGHT);

    // Cache mask data
    const imgData = tCtx.getImageData(0, 0, MAP_WIDTH, MAP_HEIGHT);
    maskDataRef.current = imgData.data;
    setTerrainLoaded(true);
    setStats((prev) => ({ ...prev, cratersCount: 0 }));
  }, []);

  const resetTerrain = () => {
    if (mapImgRef.current && mapImgRef.current.complete) {
      initTerrainFromImage(mapImgRef.current);
      setProjectiles([]);
      setFlames([]);
      setParticles([]);
    }
  };

  // Fast pixel collision check using cached mask
  const isSolidPixel = useCallback((x: number, y: number): boolean => {
    if (x < 0 || x >= MAP_WIDTH) return false;
    // Water level at bottom
    if (y >= MAP_HEIGHT - 3) return true;
    if (y < 0) return false;

    const mask = maskDataRef.current;
    if (!mask) return false;

    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const idx = (iy * MAP_WIDTH + ix) * 4;
    // Solid if alpha is noticeable
    return mask[idx + 3] > 64;
  }, []);

  // Calculate local surface normal by sampling a 5x5 neighborhood
  const getSurfaceNormal = useCallback(
    (cx: number, cy: number): { nx: number; ny: number } => {
      let gradX = 0;
      let gradY = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (isSolidPixel(cx + dx, cy + dy)) {
            gradX -= dx;
            gradY -= dy;
          }
        }
      }
      const len = Math.hypot(gradX, gradY);
      if (len > 0.001) {
        return { nx: gradX / len, ny: gradY / len };
      }
      return { nx: 0, ny: -1 };
    },
    [isSolidPixel]
  );

  // Carve crater out of terrain canvas and update mask
  const cutCrater = useCallback((cx: number, cy: number, radius: number) => {
    const tCanvas = terrainCanvasRef.current;
    if (!tCanvas) return;
    const tCtx = tCanvas.getContext('2d');
    if (!tCtx) return;

    tCtx.save();
    tCtx.globalCompositeOperation = 'destination-out';
    tCtx.beginPath();
    tCtx.arc(cx, cy, radius, 0, Math.PI * 2);
    tCtx.fill();
    tCtx.restore();

    // Update cached mask around crater bounding box
    const x0 = Math.max(0, Math.floor(cx - radius - 2));
    const y0 = Math.max(0, Math.floor(cy - radius - 2));
    const w = Math.min(MAP_WIDTH - x0, Math.ceil(radius * 2 + 4));
    const h = Math.min(MAP_HEIGHT - y0, Math.ceil(radius * 2 + 4));

    if (w > 0 && h > 0) {
      const updatedBox = tCtx.getImageData(x0, y0, w, h);
      const mask = maskDataRef.current;
      if (mask) {
        for (let row = 0; row < h; row++) {
          const destOffset = ((y0 + row) * MAP_WIDTH + x0) * 4;
          const srcOffset = row * w * 4;
          for (let col = 0; col < w * 4; col++) {
            mask[destOffset + col] = updatedBox.data[srcOffset + col];
          }
        }
      }
    }

    setStats((prev) => ({ ...prev, cratersCount: prev.cratersCount + 1 }));
  }, []);

  // Spawn visual explosion & smoke particles
  const spawnExplosionParticles = useCallback(
    (cx: number, cy: number, count: number, isFire: boolean) => {
      const newParticles: SimulationParticle[] = [];
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 3.5 + 1;
        newParticles.push({
          id: Math.random(),
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.8,
          life: 0,
          maxLife: isFire ? Math.random() * 24 + 16 : Math.random() * 18 + 8,
          color: isFire
            ? ['#f97316', '#ef4444', '#fbbf24', '#f59e0b'][Math.floor(Math.random() * 4)]
            : ['#fbbf24', '#f97316', '#94a3b8', '#cbd5e1', '#ffffff'][Math.floor(Math.random() * 5)],
          size: Math.random() * 4 + 2,
          type: isFire ? 'fire' : 'smoke',
        });
      }
      setParticles((prev) => [...prev.slice(-140), ...newParticles]);
    },
    []
  );

  // Detonate a projectile body (parent missile or clustlet bit)
  const detonateBody = useCallback(
    (b: SimulatedBody) => {
      // 1. Crater radius scaled from power
      const power = b.isClustlet
        ? clustletConfig.damage || 30
        : bodyConfig.damage || 50;

      // WA crater radius formula ≈ power * 0.45
      const blastRadius = Math.max(6, Math.min(45, power * 0.45));
      cutCrater(b.x, b.y, blastRadius);

      // 2. Spawn visual burst
      spawnExplosionParticles(b.x, b.y, b.isClustlet ? 14 : 32, project.burst === 'fire');

      // 3. Payload Burst: Clustlets
      if (!b.isClustlet && (project.burst === 'clusters' || bodyConfig.cluster)) {
        const count = Math.max(1, clustletConfig.count || 5);
        const spreadRad = ((clustletConfig.spread || 45) * Math.PI) / 180;
        // Base launch power relative to 24 px/tick
        const baseSpeed = ((clustletConfig.power || 40) / 100) * 12 + 2;

        const newClustlets: SimulatedBody[] = [];
        for (let i = 0; i < count; i++) {
          const t = count === 1 ? 0 : i / (count - 1) - 0.5;
          // Fan directed upwards (-Math.PI / 2) with spread
          const angle = -Math.PI / 2 + t * spreadRad + (Math.random() - 0.5) * 0.12;
          const speed = baseSpeed * (0.85 + Math.random() * 0.3);

          newClustlets.push({
            id: Math.random(),
            x: b.x,
            y: b.y - 3,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            radius: 2.5,
            bounciness: (clustletConfig.bounciness || 35) / 100,
            keepSpeedPct: 0.75,
            fuseRemainingMs: clustletConfig.fuse || 3500,
            isClustlet: true,
            color: '#fbbf24',
            active: true,
            bounces: 0,
            maxBounces: 6,
            settled: false,
            trailType: clustletConfig.trail || 'smklt25',
          });
        }
        setProjectiles((prev) => [...prev.filter((p) => p.id !== b.id), ...newClustlets]);
      }
      // 4. Payload Burst: Spreading Fire
      else if (!b.isClustlet && project.burst === 'fire') {
        const fireCfg = project.fireConfig || {
          burn_time_ms: 1500,
          spread_delay_ms: 30,
          spread_generations: 10,
          decay_mode: 'resting',
        };
        const count = 10;
        const newFlames: SimulatedFlame[] = [];
        for (let i = 0; i < count; i++) {
          const angle = -Math.PI * (0.15 + Math.random() * 0.7);
          const spd = Math.random() * 4 + 1.5;
          newFlames.push({
            id: Math.random(),
            x: b.x,
            y: b.y - 2,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd,
            burnRemainingMs: fireCfg.burn_time_ms || 1500,
            settled: false,
            color: ['#f97316', '#ef4444', '#fbbf24'][Math.floor(Math.random() * 3)],
            size: Math.random() * 3 + 2,
            generation: 0,
          });
        }
        setFlames((prev) => [...prev, ...newFlames]);
        setProjectiles((prev) => prev.filter((p) => p.id !== b.id));
      } else {
        // Simple end
        setProjectiles((prev) => prev.filter((p) => p.id !== b.id));
      }
    },
    [bodyConfig, clustletConfig, project.burst, project.fireConfig, cutCrater, spawnExplosionParticles]
  );

  // Fire Weapon Button Action
  const fireWeapon = () => {
    // Worm launch anchor: origin at (WORM_SITE_X, WORM_SITE_Y - 14)
    const wormX = WORM_SITE_X;
    const wormY = WORM_SITE_Y - 14;

    const rad = (aimAngleDeg * Math.PI) / 180;
    // Launch speed based on genuine WA_THROW_MAX_SPEED_TICK (24 px/tick)
    const speed = (launchPowerPct / 100) * WA_THROW_MAX_SPEED_TICK;
    const vx = Math.cos(rad) * speed * facing;
    const vy = -Math.sin(rad) * speed;

    const spawnX = wormX + Math.cos(rad) * WA_THROW_SPAWN_OFFSET * facing;
    const spawnY = wormY - Math.sin(rad) * WA_THROW_SPAWN_OFFSET;

    const parent: SimulatedBody = {
      id: Math.random(),
      x: spawnX,
      y: spawnY,
      vx,
      vy,
      radius: 3.5,
      bounciness: (bodyConfig.bounce_pct || 0) / 100,
      keepSpeedPct: (project.recordOverrides['missile.bounce.terrain_keep_speed_pct'] ?? 80) / 100,
      fuseRemainingMs: bodyConfig.fuse ? bodyConfig.fuse_time_ms || 3000 : 15000,
      isClustlet: false,
      color: '#ef4444',
      active: true,
      bounces: 0,
      maxBounces: project.recordOverrides['missile.bounce.max_bounces'] ?? 0,
      settled: false,
      trailType: 'bazooka',
    };

    setProjectiles((prev) => [...prev, parent]);
    setStats((prev) => ({ ...prev, totalShots: prev.totalShots + 1 }));
  };

  // Main 50-FPS Simulation Loop with Fixed Timestep Accumulator
  useEffect(() => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let lastTime = performance.now();
    let tickAccumulator = 0;
    const TICK_DURATION_MS = 20; // 50 Hz = 20ms per tick

    const loop = (now: number) => {
      animId = requestAnimationFrame(loop);
      const dtMs = Math.min(100, now - lastTime);
      lastTime = now;
      tickAccumulator += dtMs;

      // Run fixed 50 Hz physics updates
      while (tickAccumulator >= TICK_DURATION_MS) {
        tickAccumulator -= TICK_DURATION_MS;

        // Physics constants for current tick
        const gravity = WA_GRAVITY_BASE_TICK * (bodyConfig.gravity_pct / 100);
        const windAcc = 0.04 * (bodyConfig.wind_pct / 100) * (windPct / 100);

        // 1. Advance Projectiles
        setProjectiles((currentList) => {
          if (currentList.length === 0) return currentList;
          const nextList: SimulatedBody[] = [];

          for (const b of currentList) {
            if (!b.active) continue;

            const fuseLeft = b.fuseRemainingMs - TICK_DURATION_MS;
            if (fuseLeft <= 0) {
              detonateBody(b);
              continue;
            }

            if (b.settled) {
              nextList.push({ ...b, fuseRemainingMs: fuseLeft });
              continue;
            }

            // Apply gravity and wind
            const nextVx = b.vx + windAcc;
            const nextVy = b.vy + gravity;

            // Sub-step movement to prevent tunneling through thin terrain
            const speed = Math.hypot(nextVx, nextVy);
            const steps = Math.max(1, Math.ceil(speed / 2));
            let currX = b.x;
            let currY = b.y;
            let hit = false;
            let hitNorm = { nx: 0, ny: -1 };

            for (let s = 1; s <= steps; s++) {
              const testX = b.x + (nextVx * s) / steps;
              const testY = b.y + (nextVy * s) / steps;
              if (isSolidPixel(testX, testY)) {
                hit = true;
                hitNorm = getSurfaceNormal(testX, testY);
                currX = testX;
                currY = testY;
                break;
              }
              currX = testX;
              currY = testY;
            }

            if (hit) {
              const shouldBounce = b.isClustlet
                ? clustletConfig.contact === 'bounce' || clustletConfig.bounciness > 0
                : project.action === 'bounce' || bodyConfig.bounce_pct > 0;

              if (shouldBounce) {
                const bounciness = b.isClustlet
                  ? clustletConfig.bounciness / 100
                  : (bodyConfig.bounce_pct || 15) / 100;
                const keepSpeed = b.keepSpeedPct || 0.8;
                const bouncesDone = b.bounces + 1;

                // Max bounce check
                if (b.maxBounces > 0 && bouncesDone >= b.maxBounces) {
                  detonateBody({ ...b, x: currX, y: currY });
                  continue;
                }

                // Surface normal velocity reflection: v' = v - 2(v · n)n
                const dot = nextVx * hitNorm.nx + nextVy * hitNorm.ny;
                let refVx = nextVx;
                let refVy = nextVy;
                if (dot < 0) {
                  refVx = (nextVx - 2 * dot * hitNorm.nx) * (0.35 + bounciness * 0.5) * keepSpeed;
                  refVy = (nextVy - 2 * dot * hitNorm.ny) * (0.35 + bounciness * 0.5) * keepSpeed;
                }

                // Push slightly away from surface to prevent sticking
                const outX = currX + hitNorm.nx * 1.5;
                const outY = currY + hitNorm.ny * 1.5;

                // Check resting condition
                const postSpeed = Math.hypot(refVx, refVy);
                const isResting = postSpeed < 0.25;

                spawnExplosionParticles(currX, currY, 3, false);

                nextList.push({
                  ...b,
                  x: outX,
                  y: outY,
                  vx: isResting ? 0 : refVx,
                  vy: isResting ? 0 : refVy,
                  fuseRemainingMs: fuseLeft,
                  bounces: bouncesDone,
                  settled: isResting,
                });
              } else {
                // Direct impact blast
                detonateBody({ ...b, x: currX, y: currY });
                continue;
              }
            } else {
              // Free flight
              // Emit subtle flight trail
              if (Math.random() < 0.5) {
                setParticles((prev) => [
                  ...prev.slice(-120),
                  {
                    id: Math.random(),
                    x: currX,
                    y: currY,
                    vx: (Math.random() - 0.5) * 0.3,
                    vy: (Math.random() - 0.5) * 0.3,
                    life: 0,
                    maxLife: b.isClustlet ? 12 : 20,
                    color: b.isClustlet ? 'rgba(251, 191, 36, 0.7)' : 'rgba(255, 255, 255, 0.75)',
                    size: b.isClustlet ? 1.5 : 2.5,
                    type: 'smoke',
                  },
                ]);
              }

              nextList.push({
                ...b,
                x: currX,
                y: currY,
                vx: nextVx,
                vy: nextVy,
                fuseRemainingMs: fuseLeft,
              });
            }
          }
          return nextList;
        });

        // 2. Advance Incendiary Flames
        setFlames((currentFlames) => {
          if (currentFlames.length === 0) return currentFlames;
          const nextFlames: SimulatedFlame[] = [];

          for (const f of currentFlames) {
            const timeLeft = f.burnRemainingMs - TICK_DURATION_MS;
            if (timeLeft <= 0) continue;

            let nx = f.x;
            let ny = f.y;
            let vx = f.vx;
            let vy = f.vy + WA_GRAVITY_BASE_TICK * 0.6; // flame fall

            if (!f.settled) {
              nx += vx;
              ny += vy;
              if (isSolidPixel(nx, ny)) {
                // Settle on terrain
                f.settled = true;
                vx = 0;
                vy = 0;
                // Scorched land
                if (Math.random() < 0.1) cutCrater(nx, ny, 3);
              }
            } else {
              // Drift/spread on ground
              if (Math.random() < 0.05) {
                nx += (Math.random() - 0.5) * 2;
              }
            }

            nextFlames.push({
              ...f,
              x: nx,
              y: ny,
              vx,
              vy,
              burnRemainingMs: timeLeft,
            });
          }
          return nextFlames;
        });
      }

      // -------------------------------------------------------------
      // RENDER PASS ON DISPLAY CANVAS
      // -------------------------------------------------------------
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // Save and scale viewport
      ctx.save();
      ctx.imageSmoothingEnabled = false; // Authentic pixel art crispness

      // Scale up 300x300 native buffer to display canvas
      const scaleX = width / MAP_WIDTH;
      const scaleY = height / MAP_HEIGHT;
      ctx.scale(scaleX, scaleY);

      // A. Sky Background
      const skyGrad = ctx.createLinearGradient(0, 0, 0, MAP_HEIGHT);
      skyGrad.addColorStop(0, '#0c4a6e'); // Deep dusk sky
      skyGrad.addColorStop(0.5, '#0284c7');
      skyGrad.addColorStop(1, '#38bdf8');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

      // B. Draw Terrain
      if (terrainCanvasRef.current) {
        ctx.drawImage(terrainCanvasRef.current, 0, 0);
      }

      // C. Draw Water Surface at bottom
      ctx.fillStyle = 'rgba(14, 165, 233, 0.65)';
      ctx.fillRect(0, MAP_HEIGHT - 6, MAP_WIDTH, 6);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.9)';
      ctx.fillRect(0, MAP_HEIGHT - 6, MAP_WIDTH, 1.5);

      // D. Draw Worm at site (WORM_SITE_X, WORM_SITE_Y) facing right
      const wormX = WORM_SITE_X;
      const wormY = WORM_SITE_Y;

      // Map elevation angle to aim frame (32 frames total in aim.png)
      // Flat (0°) ≈ frame 16; 90° ≈ frame 31; -15° ≈ frame 12
      const aimFrame = Math.min(31, Math.max(0, Math.round(16 + (aimAngleDeg / 90) * 15)));

      ctx.save();
      ctx.translate(wormX, wormY);
      // Native aim.png is left-facing: flip with -facing so worm always looks directly toward the ray
      ctx.scale(-facing, 1);

      const aimImg = aimImgRef.current;
      if (aimImg && aimImg.complete && aimImg.naturalHeight >= 60) {
        // Source frame in 60x60 strip
        const sy = aimFrame * 60;
        // Draw centered so worm feet touch ground at y=164
        // In 60x60 aim frame, feet are at y ≈ 43, pivot x ≈ 30
        ctx.drawImage(aimImg, 0, sy, 60, 60, -30, -43, 60, 60);
      } else {
        // Vector fallback
        ctx.fillStyle = '#f472b6';
        ctx.beginPath();
        ctx.ellipse(0, -10, 8, 11, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // E. Trajectory Aim Guide Arc (dotted prediction)
      if (showGuide) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();

        const rad = (aimAngleDeg * Math.PI) / 180;
        const speed = (launchPowerPct / 100) * WA_THROW_MAX_SPEED_TICK;
        let predX = wormX + Math.cos(rad) * WA_THROW_SPAWN_OFFSET * facing;
        let predY = wormY - 14 - Math.sin(rad) * WA_THROW_SPAWN_OFFSET;
        let pVx = Math.cos(rad) * speed * facing;
        let pVy = -Math.sin(rad) * speed;
        const g = WA_GRAVITY_BASE_TICK * (bodyConfig.gravity_pct / 100);
        const w = 0.04 * (bodyConfig.wind_pct / 100) * (windPct / 100);

        ctx.moveTo(predX, predY);
        for (let step = 0; step < 50; step++) {
          predX += pVx;
          predY += pVy;
          pVx += w;
          pVy += g;
          ctx.lineTo(predX, predY);
          if (isSolidPixel(predX, predY)) break;
        }
        ctx.stroke();
        ctx.restore();
      }

      // F. Draw Projectiles
      for (const b of projectiles) {
        ctx.save();
        ctx.translate(b.x, b.y);

        const angle = Math.atan2(b.vy, b.vx);
        ctx.rotate(angle);

        if (b.isClustlet) {
          // Yellow clustlet pellet
          ctx.fillStyle = '#fbbf24';
          ctx.strokeStyle = '#b45309';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          // Missile body
          ctx.fillStyle = '#ef4444';
          ctx.strokeStyle = '#7f1d1d';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(-5, -2.5, 10, 5, 1.5);
          ctx.fill();
          ctx.stroke();

          // White nose tip
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(5, -2.5);
          ctx.lineTo(8, 0);
          ctx.lineTo(5, 2.5);
          ctx.closePath();
          ctx.fill();
        }

        ctx.restore();

        // Draw active countdown timer
        if (b.fuseRemainingMs < 10000 && !b.settled) {
          ctx.save();
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1.5;
          ctx.font = 'bold 8px monospace';
          const sec = (b.fuseRemainingMs / 1000).toFixed(1);
          ctx.strokeText(`${sec}s`, b.x - 6, b.y - 7);
          ctx.fillText(`${sec}s`, b.x - 6, b.y - 7);
          ctx.restore();
        }
      }

      // G. Draw Incendiary Flames
      for (const f of flames) {
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(f.x, f.y, Math.max(1, f.size), 0, Math.PI * 2);
        ctx.fill();
      }

      // H. Draw Trail & Blast Particles
      setParticles((currentParticles) => {
        const nextParticles: SimulationParticle[] = [];
        for (const p of currentParticles) {
          p.x += p.vx;
          p.y += p.vy;
          p.life += 1;
          p.size *= 0.94;

          if (p.life < p.maxLife && p.size > 0.4) {
            nextParticles.push(p);
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        return nextParticles;
      });

      ctx.restore(); // Restore display scale
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [
    projectiles,
    flames,
    aimAngleDeg,
    launchPowerPct,
    facing,
    windPct,
    showGuide,
    bodyConfig,
    clustletConfig,
    project.action,
    project.burst,
    isSolidPixel,
    getSurfaceNormal,
    detonateBody,
    cutCrater,
    spawnExplosionParticles,
  ]);

  // Mouse interaction: drag to aim directly on canvas
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDraggingAim(true);
    handleAimDrag(e);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDraggingAim) {
      handleAimDrag(e);
    }
  };

  const handleCanvasMouseUp = () => {
    setIsDraggingAim(false);
  };

  const handleAimDrag = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * MAP_WIDTH;
    const my = ((e.clientY - rect.top) / rect.height) * MAP_HEIGHT;

    const dx = (mx - WORM_SITE_X) * facing;
    const dy = -(my - (WORM_SITE_Y - 14));

    let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    angle = Math.round(Math.min(90, Math.max(-20, angle)));
    setAimAngleDeg(angle);

    // Approximate power from drag distance
    const dist = Math.hypot(dx, dy);
    const power = Math.round(Math.min(100, Math.max(15, dist * 1.2)));
    setLaunchPowerPct(power);
  };

  // Keyboard shortcut: Spacebar fires or manually detonates in air
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        (e.target as HTMLElement).tagName !== 'INPUT' &&
        (e.target as HTMLElement).tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        if (projectiles.length > 0) {
          detonateBody(projectiles[0]);
        } else {
          fireWeapon();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [projectiles, detonateBody]);

  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 shadow-xs transition-colors">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between pb-4 mb-4 border-b border-stone-100 dark:border-stone-800 gap-3">
        <div>
          <h2 className="font-heading text-base font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-forge-600 dark:text-forge-400" />
            <span>Worms Armageddon 50 FPS Physics Simulator</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-forge-50 dark:bg-forge-950/60 text-forge-700 dark:text-forge-300 font-semibold border border-forge-200 dark:border-forge-800">
              Site: (187x, 164y) · CM+0x22c Engine Math
            </span>
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
            Real terrain pixel mask, 50 Hz ballistic integration, normal reflection bounce, clustlet scatter & crater excavation.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fireWeapon}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-forge-600 hover:bg-forge-700 dark:bg-forge-500 dark:hover:bg-forge-600 rounded-lg shadow-sm transition-all cursor-pointer"
            title="Launch projectile from worm position (Hotkey: Space)"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Launch Weapon (Space)</span>
          </button>

          <button
            type="button"
            onClick={resetTerrain}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-stone-700 dark:text-stone-300 bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 border border-stone-200 dark:border-stone-700 rounded-lg transition-colors cursor-pointer"
            title="Reset pristine terrain from pre_weapon_preview.png"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Map</span>
          </button>
        </div>
      </div>

      {/* Main Viewport Container */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* Canvas Display Viewport */}
        <div className="relative border-2 border-stone-300 dark:border-stone-700 rounded-xl overflow-hidden shadow-inner bg-slate-950 mx-auto select-none">
          <canvas
            ref={displayCanvasRef}
            width={MAP_WIDTH * zoomScale}
            height={MAP_HEIGHT * zoomScale}
            style={{
              width: `${MAP_WIDTH * zoomScale}px`,
              maxWidth: '100%',
              imageRendering: 'pixelated',
            }}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
            className="block cursor-crosshair"
          />

          {/* Wind Overlay HUD */}
          <div className="absolute top-2.5 left-2.5 bg-stone-900/85 backdrop-blur-xs border border-stone-700/70 rounded-md px-2.5 py-1 flex items-center gap-2 text-xs font-mono text-white shadow-sm">
            <Wind className="w-3.5 h-3.5 text-sky-400" />
            <span>Wind:</span>
            <span
              className={`font-bold ${
                windPct > 0
                  ? 'text-forge-400'
                  : windPct < 0
                  ? 'text-amber-400'
                  : 'text-stone-400'
              }`}
            >
              {windPct > 0 ? `→ +${windPct}%` : windPct < 0 ? `← ${windPct}%` : 'Calm (0%)'}
            </span>
          </div>

          {/* Telemetry HUD */}
          <div className="absolute top-2.5 right-2.5 bg-stone-900/85 backdrop-blur-xs border border-stone-700/70 rounded-md px-2.5 py-1 flex items-center gap-3 text-xs font-mono text-stone-300 shadow-sm">
            <span>
              Craters: <b className="text-amber-400">{stats.cratersCount}</b>
            </span>
            <span>
              Active: <b className="text-forge-400">{projectiles.length}</b>
            </span>
            <span>
              Scale: <b className="text-sky-400">{zoomScale}x</b>
            </span>
          </div>

          {/* Aim instruction badge */}
          <div className="absolute bottom-2.5 left-2.5 bg-stone-900/70 backdrop-blur-xs rounded px-2 py-0.5 text-[10px] font-mono text-stone-400">
            Click & drag to aim · Worm @ (184, 176)
          </div>
        </div>

        {/* Side Controls & Physics Panel */}
        <div className="flex-1 w-full space-y-4">
          <div className="p-4 rounded-xl bg-stone-50 dark:bg-stone-800/40 border border-stone-200 dark:border-stone-800 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-200 dark:border-stone-800 text-xs font-semibold text-stone-800 dark:text-stone-200">
              <span className="flex items-center gap-1.5">
                <Crosshair className="w-3.5 h-3.5 text-rose-500" />
                Launch Parameters
              </span>
              <span className="font-mono text-[11px] text-stone-500">WA 50 Hz Live</span>
            </div>

            {/* Aim Elevation Angle */}
            <div>
              <div className="flex justify-between items-center text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                <span>Aim Elevation Angle</span>
                <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">
                  {aimAngleDeg}°
                </span>
              </div>
              <input
                type="range"
                min={-15}
                max={90}
                value={aimAngleDeg}
                onChange={(e) => setAimAngleDeg(parseInt(e.target.value, 10))}
                className="w-full accent-forge-600"
              />
              <div className="flex justify-between text-[10px] text-stone-400 mt-0.5 font-mono">
                <span>-15° (Low)</span>
                <span>0° (Flat)</span>
                <span>45°</span>
                <span>90° (Vertical)</span>
              </div>
            </div>

            {/* Charge Power */}
            <div>
              <div className="flex justify-between items-center text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                <span>Launch Velocity (`launch_power_pct`)</span>
                <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">
                  {launchPowerPct}% ({((launchPowerPct / 100) * 24).toFixed(1)} px/tick)
                </span>
              </div>
              <input
                type="range"
                min={10}
                max={100}
                value={launchPowerPct}
                onChange={(e) => setLaunchPowerPct(parseInt(e.target.value, 10))}
                className="w-full accent-forge-600"
              />
              <div className="flex justify-between text-[10px] text-stone-400 mt-0.5 font-mono">
                <span>Tap (10%)</span>
                <span>50%</span>
                <span>Full Charge (100%)</span>
              </div>
            </div>

            {/* World Wind */}
            <div>
              <div className="flex justify-between items-center text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                <span>Environment Wind</span>
                <span className="font-mono text-sky-500 font-bold">{windPct}%</span>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                step={5}
                value={windPct}
                onChange={(e) => setWindPct(parseInt(e.target.value, 10))}
                className="w-full accent-sky-500"
              />
              <div className="flex justify-between text-[10px] text-stone-400 mt-0.5 font-mono">
                <span>Headwind (-100%)</span>
                <span>Calm (0)</span>
                <span>Tailwind (+100%)</span>
              </div>
            </div>

            {/* Facing & Trajectory guide */}
            <div className="pt-2 border-t border-stone-200 dark:border-stone-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-stone-600 dark:text-stone-400 font-semibold">Facing:</span>
                <button
                  type="button"
                  onClick={() => setFacing(-1)}
                  className={`px-2 py-1 rounded text-xs font-medium border transition-colors cursor-pointer ${
                    facing === -1
                      ? 'bg-forge-600 text-white font-bold border-forge-600'
                      : 'bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-300 border-stone-300 dark:border-stone-700'
                  }`}
                >
                  ← Left
                </button>
                <button
                  type="button"
                  onClick={() => setFacing(1)}
                  className={`px-2 py-1 rounded text-xs font-medium border transition-colors cursor-pointer ${
                    facing === 1
                      ? 'bg-forge-600 text-white font-bold border-forge-600'
                      : 'bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-300 border-stone-300 dark:border-stone-700'
                  }`}
                >
                  Right →
                </button>
              </div>

              <div className="flex items-center gap-1">
                <span className="text-stone-600 dark:text-stone-400 font-semibold mr-1">Zoom:</span>
                {([1, 2, 3] as const).map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => setZoomScale(z)}
                    className={`px-2 py-0.5 rounded text-xs font-mono transition-colors cursor-pointer ${
                      zoomScale === z
                        ? 'bg-stone-900 dark:bg-white text-white dark:text-stone-900 font-bold'
                        : 'bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-300'
                    }`}
                  >
                    {z}x
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-stone-600 dark:text-stone-400 pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showGuide}
                  onChange={(e) => setShowGuide(e.target.checked)}
                  className="rounded text-forge-600"
                />
                <span>Show Trajectory Arc</span>
              </label>

              <span className="font-mono text-[11px] text-stone-400">
                Action: <b className="capitalize text-stone-800 dark:text-stone-200">{project.action || 'None'}</b>
              </span>
            </div>
          </div>

          {/* Current Weapon Record Telemetry Summary Card */}
          <div className="p-3.5 rounded-xl bg-stone-100 dark:bg-stone-800/30 border border-stone-200 dark:border-stone-800 text-xs space-y-2">
            <div className="flex items-center justify-between font-semibold text-stone-800 dark:text-stone-200">
              <span className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-forge-500" />
                Live Physics Model Specs
              </span>
              <span className="font-mono text-[11px] text-stone-500">WormForge</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-stone-600 dark:text-stone-400">
              <div>
                Gravity: <b className="text-stone-900 dark:text-stone-100">{bodyConfig.gravity_pct}%</b>
              </div>
              <div>
                Wind Response: <b className="text-stone-900 dark:text-stone-100">{bodyConfig.wind_pct}%</b>
              </div>
              <div>
                Blast Damage / Radius: <b className="text-stone-900 dark:text-stone-100">{bodyConfig.damage}</b>
              </div>
              <div>
                Timer Fuse: <b className="text-stone-900 dark:text-stone-100">{bodyConfig.fuse ? `${bodyConfig.fuse_time_ms}ms` : 'Contact'}</b>
              </div>
              <div>
                Action: <b className="capitalize text-stone-900 dark:text-stone-100">{project.action || 'None'}</b>
              </div>
              <div>
                Payload: <b className="capitalize text-stone-900 dark:text-stone-100">{project.burst || 'Plain'}</b>
              </div>
              {(project.burst === 'clusters' || bodyConfig.cluster) && (
                <div className="col-span-2 text-amber-600 dark:text-amber-400">
                  Clustlets: <b>{clustletConfig.count || 5} bits</b> @ {clustletConfig.spread || 45}° spread fan, {clustletConfig.damage || 30} dmg each
                </div>
              )}
              {project.burst === 'fire' && (
                <div className="col-span-2 text-orange-500">
                  Fire: <b>{project.fireConfig.burn_time_ms || 1500}ms burn</b>, {project.fireConfig.spread_generations || 10} generations
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};