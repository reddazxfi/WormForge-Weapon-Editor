import React, { useRef, useEffect, useState } from 'react';
import {
  WeaponProject,
  HandType,
  MissileAnimType,
  BehaviorArtKey,
  FlightRoleArt,
  RoamSheetAsset,
} from '../types/weapon';
import {
  sanitizeModFolder,
  bitFlightSheetPath,
  behaviorStateSheetPath,
  roamSheetPath,
} from '../utils/luaGenerator';
import { StockSpriteInput } from './StockSpriteInput';
import { stockSpriteName } from '../data/stockSprites';
import { assetUrl } from '../utils/assetUrl';
import { defaultArtFor } from '../utils/defaultArt';
import { buildRotationSheet } from '../utils/rotateSheet';
import { FlightRoleEditor } from './FlightRoleEditor';
import {
  DEFAULT_ROLE_ART,
  availableBehaviorArt,
  bitBuilderMode,
  primaryBuilderOn,
  resolveBehaviorStates,
} from '../data/spriteBuilder';
import mapBackgroundSrc from '../../spec/pre_weapon_preview.png';
import {
  Upload,
  Play,
  Pause,
  RefreshCw,
  ZoomIn,
  Eye,
  Sparkles,
  Sliders,
  ArrowLeftRight,
  Compass,
  Rocket,
  Image as ImageIcon,
  CheckCircle2,
  Loader2,
  Package,
  RotateCw,
} from 'lucide-react';

interface HoldPreviewProps {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
}

/**
 * One of a roaming animal's two flying sheets (`sheep_sprites`). WA installs
 * each as a WA sprite and rotates the flying animal itself, so the art has to
 * carry the rotation: a vertical strip of up to 32 direction frames (frame 0
 * pointing up, turning clockwise), exactly like PX's `ghstshp1/2.png`
 * (60x1920). Upload a single frame and bake the strip, or upload a strip and
 * set its frame count.
 */
const RoamSheetField: React.FC<{
  id: string;
  label: string;
  asset?: RoamSheetAsset;
  path: string;
  onChange: (asset: RoamSheetAsset) => void;
}> = ({ id, label, asset, path, onChange }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [rotateFrames, setRotateFrames] = useState(32);
  const frames = asset?.frames ?? 1;
  const isGif = /\.gif$/i.test(asset?.fileName || asset?.file?.name || '');

  const handleUpload = (file: File) => {
    if (asset?.preview) URL.revokeObjectURL(asset.preview);
    onChange({
      file,
      fileName: file.name,
      preview: URL.createObjectURL(file),
      frames: 1,
      rotationFrames: undefined,
      sourceFile: undefined,
      sourceName: undefined,
    });
    setRotateError(null);
  };

  const makeRotationSheet = async () => {
    if (!asset?.file) return;
    setRotating(true);
    setRotateError(null);
    try {
      const sheet = await buildRotationSheet(asset.file, rotateFrames);
      if (asset.preview) URL.revokeObjectURL(asset.preview);
      onChange({
        file: sheet.file,
        fileName: sheet.file.name,
        preview: sheet.previewUrl,
        frames: sheet.frames,
        rotationFrames: sheet.frames,
        sourceFile: asset.sourceFile ?? asset.file,
        sourceName: asset.sourceName ?? asset.fileName ?? asset.file.name,
      });
    } catch (err) {
      setRotateError((err as Error)?.message || String(err));
    } finally {
      setRotating(false);
    }
  };

  const restoreOriginal = () => {
    const source = asset?.sourceFile;
    if (!source) return;
    if (asset?.preview) URL.revokeObjectURL(asset.preview);
    onChange({
      file: source,
      fileName: asset?.sourceName || source.name,
      preview: URL.createObjectURL(source),
      frames: 1,
      rotationFrames: undefined,
      sourceFile: undefined,
      sourceName: undefined,
    });
  };

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-900">
          {asset?.preview ? (
            <img
              src={asset.preview}
              alt=""
              className={`h-8 w-8 ${frames > 1 ? 'object-cover object-top' : 'object-contain'}`}
              style={{ imageRendering: 'pixelated' }}
            />
          ) : (
            <span className="text-[10px] text-stone-400">none</span>
          )}
        </div>
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept="image/png,image/gif"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="px-2.5 py-1.5 text-[11px] font-semibold bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-700"
        >
          {asset?.file ? 'Change' : 'Upload'}
        </button>
        {asset?.file && (
          <button
            type="button"
            onClick={() => {
              if (asset.preview) URL.revokeObjectURL(asset.preview);
              onChange({});
              setRotateError(null);
              if (inputRef.current) inputRef.current.value = '';
            }}
            className="text-[11px] text-rose-500 hover:text-rose-600 font-medium"
          >
            Remove
          </button>
        )}
      </div>

      {asset?.file && !isGif && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={`${label} rotation frame count`}
            value={rotateFrames}
            onChange={(e) => setRotateFrames(Number(e.target.value))}
            className="text-[11px] px-2 py-1 rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
          >
            <option value={16}>16 frames</option>
            <option value={32}>32 frames</option>
            <option value={64}>64 frames</option>
          </select>
          <button
            type="button"
            onClick={makeRotationSheet}
            disabled={rotating || frames > 1}
            className="px-2.5 py-1.5 text-[11px] font-semibold bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 border border-stone-300 dark:border-stone-700 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
            title={
              frames > 1
                ? 'Already a strip: remove it and upload the single frame again to rebuild.'
                : 'Bake a full 360° strip, frame 0 pointing up, clockwise.'
            }
          >
            {rotating ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RotateCw className="w-3 h-3 text-forge-600 dark:text-forge-400" />
            )}
            <span>{frames > 1 ? `Strip (${frames} frames)` : 'Rotate into strip'}</span>
          </button>
          {asset.rotationFrames && (
            <button
              type="button"
              onClick={restoreOriginal}
              className="text-[11px] text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200 font-medium underline"
            >
              Use original frame
            </button>
          )}
        </div>
      )}

      {asset?.file && (
        <div className="flex items-center gap-2">
          <label htmlFor={`${id}-frames`} className="text-[10px] text-stone-500 dark:text-stone-400">
            Frames
          </label>
          <input
            id={`${id}-frames`}
            type="number"
            min={1}
            max={64}
            value={frames}
            disabled={isGif || !!asset.rotationFrames}
            title={
              asset.rotationFrames
                ? 'Baked strip: remove the sheet and upload the single frame again to change its frame count.'
                : undefined
            }
            onChange={(e) => {
              const next = Math.max(1, Math.min(64, Number(e.target.value) || 1));
              onChange({ frames: next, rotationFrames: next > 1 ? asset.rotationFrames : undefined });
            }}
            className="w-16 text-[11px] font-mono px-2 py-1 rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white disabled:opacity-50"
          />
          <span className="text-[10px] text-stone-400">
            {asset.rotationFrames
              ? 'Baked strip: one cell per direction.'
              : 'WA picks the frame from the flight direction; 32 = a full turn.'}
          </span>
        </div>
      )}

      {rotateError && <p className="text-[10px] text-rose-500">{rotateError}</p>}
      <p className="font-mono text-[10px] text-stone-400 truncate" title={path}>
        {path}
      </p>
    </div>
  );
};

const WORM_AIM_SRC = assetUrl('assets/worm/aim.png');
const HAND_MID_SRC = assetUrl('assets/worm/hand_rad.png');
const HAND_LOWER_SRC = assetUrl('assets/worm/hand_rad_lower.png');
const HAND_UPPER_SRC = assetUrl('assets/worm/hand_rad_upper.png');

export const HoldPreview: React.FC<HoldPreviewProps> = ({ project, onChange }) => {
  // ---------------------------------------------------------------------------
  // 1. WORM HOLD REFS & STATE
  // ---------------------------------------------------------------------------
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [aimAngleIndex, setAimAngleIndex] = useState(16); // 0 (down) to 31 (up), 16 = forward horizontal
  const [facingRight, setFacingRight] = useState(true);

  const aimImgRef = useRef<HTMLImageElement | null>(null);
  const handMidImgRef = useRef<HTMLImageElement | null>(null);
  const handLowerImgRef = useRef<HTMLImageElement | null>(null);
  const handUpperImgRef = useRef<HTMLImageElement | null>(null);
  const weaponImgRef = useRef<HTMLImageElement | null>(null);
  const mapImgRef = useRef<HTMLImageElement | null>(null);
  const [weaponLoadedImg, setWeaponLoadedImg] = useState<HTMLImageElement | null>(null);
  const [assetsLoaded, setAssetsLoaded] = useState(false);

  // Default stock-style art shown while no custom sheet has been uploaded.
  const defaultHoldImgRef = useRef<HTMLImageElement | null>(null);
  const defaultMissileImgRef = useRef<HTMLImageElement | null>(null);
  const [defaultHoldLoaded, setDefaultHoldLoaded] = useState<HTMLImageElement | null>(null);
  const [defaultMissileLoaded, setDefaultMissileLoaded] = useState<HTMLImageElement | null>(null);

  // Put-away animation simulation (worm_hold.rs put_pose)
  const [putAwayCounter, setPutAwayCounter] = useState<number | null>(null);

  const triggerPutAwayDemo = () => {
    setPutAwayCounter(20);
  };

  useEffect(() => {
    if (putAwayCounter === null) return;
    if (putAwayCounter <= 0) {
      const timeout = setTimeout(() => setPutAwayCounter(null), 500);
      return () => clearTimeout(timeout);
    }
    const timer = setTimeout(() => {
      setPutAwayCounter((prev) => (prev !== null ? prev - 1 : null));
    }, 45); // 20 frames * 45ms ≈ 900ms put-away duration
    return () => clearTimeout(timer);
  }, [putAwayCounter]);

  const hold = project.hold;
  const defaultArt = defaultArtFor(project);
  const updateHold = (patch: Partial<typeof hold>) => {
    onChange({ hold: { ...hold, ...patch } });
  };

  // worm_hold.rs advances `phase` by anim_speed * 0.03 every 50 Hz game frame,
  // so the sheet plays 1.5 * frames * anim_speed frames per second. The field
  // asks for the real FPS and the generator converts it to the multiplier.
  const holdAnimFps = Math.max(1, Number(hold.fps) || 15);
  const holdAnimSpeed =
    hold.frames > 1 ? holdAnimFps / (1.5 * hold.frames) : 1;
  const holdAnimSpeedLabel = holdAnimSpeed
    .toFixed(3)
    .replace(/0+$/, '')
    .replace(/\.$/, '');

  // ---------------------------------------------------------------------------
  // 2. MISSILE SPRITE REFS & STATE
  // ---------------------------------------------------------------------------
  const missileCanvasRef = useRef<HTMLCanvasElement>(null);
  const missileFileInputRef = useRef<HTMLInputElement>(null);
  const missileImgRef = useRef<HTMLImageElement | null>(null);

  const missile = project.missileSprite || {
    enabled: true,
    mode: 'custom',
    stockSprite: 'bazooka',
    sheet: '',
    anim: 'rotation' as MissileAnimType,
    frames: 1,
    fps: 15,
    animSpeed: 1.0,
    spinRate: 1.0,
    scale: 1.0,
    mirror: true,
    z: 5.0,
    animate: false,
    spin: true,
    hideStock: true,
  };

  const updateMissile = (patch: Partial<typeof missile>) => {
    onChange({
      missileSprite: {
        ...missile,
        ...patch,
      },
    });
  };

  // WFWS roles: cluster bits and per-behaviour states share the same call.
  const bitFlight = project.bitFlight ?? DEFAULT_ROLE_ART;
  const updateBitFlight = (patch: Partial<typeof bitFlight>) => {
    onChange({ bitFlight: { ...bitFlight, ...patch } });
  };
  const behaviorArt = project.behaviorArt ?? {};
  // A behaviour row with no stored entry is inactive (inherit): the identity
  // art already covers the missile, so nothing is emitted. Native is an
  // explicit choice that hands the state back to WA.
  const defaultBehaviorRole: FlightRoleArt = { ...DEFAULT_ROLE_ART, mode: 'inherit' };
  const updateBehaviorArt = (
    key: BehaviorArtKey,
    patch: Partial<FlightRoleArt>
  ) => {
    onChange({
      behaviorArt: {
        ...behaviorArt,
        [key]: { ...(behaviorArt[key] ?? DEFAULT_ROLE_ART), ...patch },
      },
    });
  };
  const builderOn = primaryBuilderOn(project);
  const behaviorDefs = availableBehaviorArt(project);
  const behaviorSigs = new Map(
    resolveBehaviorStates(project).map((state) => [state.def.key, state.sig])
  );

  // Missile interactive simulation state
  const [isMissilePlaying, setIsMissilePlaying] = useState(true);
  const [missileZoom, setMissileZoom] = useState<number>(4);
  const [flightAngleDeg, setFlightAngleDeg] = useState<number>(25); // trajectory launch angle
  const [flightSpeed, setFlightSpeed] = useState<number>(14); // velocity magnitude
  const [flightMode, setFlightMode] = useState<'orbit' | 'arc' | 'static'>('arc');
  const [backdropTheme, setBackdropTheme] = useState<'grid' | 'sky' | 'cavern'>('grid');

  // Internal animation state refs (continuous physics & phase)
  const animStateRef = useRef<{
    phase: number;
    rotation: number;
    arcT: number;
    frame: number;
  }>({
    phase: 0,
    rotation: 0,
    arcT: 0,
    frame: 0,
  });

  const [activeFrameDisplay, setActiveFrameDisplay] = useState(0);

  // ---------------------------------------------------------------------------
  // PRELOAD WORM ASSETS
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let loadedCount = 0;
    const totalAssets = 5;
    const checkAllLoaded = () => {
      loadedCount++;
      if (loadedCount >= totalAssets) {
        setAssetsLoaded(true);
      }
    };

    const aimImg = new Image();
    aimImg.onload = checkAllLoaded;
    aimImg.src = WORM_AIM_SRC;
    aimImgRef.current = aimImg;

    const handMid = new Image();
    handMid.onload = checkAllLoaded;
    handMid.src = HAND_MID_SRC;
    handMidImgRef.current = handMid;

    const handLower = new Image();
    handLower.onload = checkAllLoaded;
    handLower.src = HAND_LOWER_SRC;
    handLowerImgRef.current = handLower;

    const handUpper = new Image();
    handUpper.onload = checkAllLoaded;
    handUpper.src = HAND_UPPER_SRC;
    handUpperImgRef.current = handUpper;

    // The landscape the user supplied in spec/: grass, flowers and the hill.
    const mapImg = new Image();
    mapImg.onload = checkAllLoaded;
    mapImg.src = mapBackgroundSrc;
    mapImgRef.current = mapImg;
  }, []);

  // Preload user weapon sheet image and immediately trigger canvas re-render on load
  useEffect(() => {
    if (hold.sheetPreview) {
      const img = new Image();
      img.onload = () => {
        weaponImgRef.current = img;
        setWeaponLoadedImg(img);
      };
      img.src = hold.sheetPreview;
    } else {
      weaponImgRef.current = null;
      setWeaponLoadedImg(null);
    }
  }, [hold.sheetPreview]);

  // Preload missile sprite image
  useEffect(() => {
    if (missile.sheetPreview) {
      const img = new Image();
      img.onload = () => {
        missileImgRef.current = img;
      };
      img.src = missile.sheetPreview;
    } else {
      missileImgRef.current = null;
    }
  }, [missile.sheetPreview]);

  // The supplied stock-style defaults stand in until a PNG is uploaded. They
  // are the same files the exporter writes, so the preview is honest.
  useEffect(() => {
    if (hold.sheetPreview) {
      defaultHoldImgRef.current = null;
      setDefaultHoldLoaded(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      defaultHoldImgRef.current = img;
      setDefaultHoldLoaded(img);
    };
    img.src = defaultArt.url;
    return () => {
      cancelled = true;
    };
  }, [defaultArt.url, hold.sheetPreview]);

  useEffect(() => {
    if (missile.sheetPreview) {
      defaultMissileImgRef.current = null;
      setDefaultMissileLoaded(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      defaultMissileImgRef.current = img;
      setDefaultMissileLoaded(img);
    };
    img.src = defaultArt.url;
    return () => {
      cancelled = true;
    };
  }, [defaultArt.url, missile.sheetPreview]);

  // Worm Hold frame animation timer
  useEffect(() => {
    if (!isPlaying || hold.frames <= 1) return;
    const intervalMs = 1000 / (hold.fps || 15);
    const timer = setInterval(() => {
      setCurrentFrame((prev) => (prev + 1) % hold.frames);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isPlaying, hold.frames, hold.fps]);

  // ---------------------------------------------------------------------------
  // WORM HOLD CANVAS RENDER LOOP
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const SIZE = 60;
    const offscreen = document.createElement('canvas');
    offscreen.width = SIZE;
    offscreen.height = SIZE;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;

    offCtx.imageSmoothingEnabled = false;
    const cx = SIZE / 2;
    const cy = SIZE / 2;

    // Put-away pose calculation (worm_hold.rs `put_pose`)
    let aimT = aimAngleIndex / 31;
    let putAwayShrink = 1.0;
    if (putAwayCounter !== null) {
      const tPut = 1.0 - (putAwayCounter / 20.0);
      if (tPut < 0.5) {
        aimT = aimT + (0.5 - aimT) * (tPut * 2.0);
        putAwayShrink = 1.0;
      } else {
        aimT = 0.5 + (0.2 - 0.5) * ((tPut - 0.5) * 2.0);
        putAwayShrink = Math.max(0, 1.0 - (tPut - 0.5) * 2.0);
      }
    }

    // worm_hold.rs: `rot = (1.0 - aim) * PI`.  Aim 0 is straight down and 1
    // is straight up; level aim (16/31) is PI/2.  The posture and hold sheets
    // are drawn right-facing, so the whole cell is mirrored below for the
    // left-facing pose, exactly as `SPRITE_MIRROR_X` mirrors the hold.
    const rot = (1 - aimT) * Math.PI;
    const weapRotRad = ((Number(hold.weapRotation) || 0) * Math.PI) / 180;

    // 1. Base Worm aiming posture (PX_POSTURE.weaponlnk: 32 rows of 60x60).
    // `aim.png` is natively left-facing, while the hold math below places the
    // weapon on the left for the unmirrored cell.  Flip the posture inside the
    // cell so the worm faces the weapon; the whole cell is still mirrored for
    // the left-facing preview.
    const aimImg = aimImgRef.current;
    if (aimImg && aimImg.complete && aimImg.naturalHeight >= 60) {
      const sy = Math.min(31, Math.max(0, aimAngleIndex)) * 60;
      offCtx.save();
      offCtx.translate(SIZE, 0);
      offCtx.scale(-1, 1);
      offCtx.drawImage(aimImg, 0, sy, 60, 60, 0, 0, 60, 60);
      offCtx.restore();
    } else {
      offCtx.fillStyle = '#f472b6';
      offCtx.beginPath();
      offCtx.arc(cx, cy, 12, 0, Math.PI * 2);
      offCtx.fill();
    }

    // 2. Weapon Sprite
    const weapRadius = Number(hold.weapRadius ?? 6);
    const scale = (Number(hold.scale) || 1) * putAwayShrink;

    // worm_hold.rs: `rot_w = rot + PI * weap_radial_rotation`; the generator
    // emits `weap_radial_rotation = 1`.
    const rotW = rot + Math.PI;
    const weapX = cx + Math.sin(rotW) * weapRadius;
    const weapY = cy - Math.cos(rotW) * weapRadius;
    // worm_hold.rs: `PI - PI*aim - PI*(1 - weap_rotation)`, which is
    // `(1 - aim)*PI + weapRotation`.  PX hold art points up natively, so at
    // level aim this is 90 degrees clockwise and the barrel points forward.
    const weapAngle = rot + weapRotRad;

    offCtx.save();
    offCtx.imageSmoothingEnabled = false;
    offCtx.translate(weapX, weapY);
    offCtx.rotate(weapAngle);
    offCtx.scale(scale, scale);

    const weaponImg = weaponLoadedImg || weaponImgRef.current;
    if (weaponImg && weaponImg.complete && weaponImg.naturalWidth > 0) {
      const totalFrames = Math.max(1, hold.frames || 1);
      const frameHeight = weaponImg.naturalHeight / totalFrames;
      const frameWidth = weaponImg.naturalWidth;
      const sy = (currentFrame % totalFrames) * frameHeight;

      offCtx.drawImage(
        weaponImg,
        0,
        sy,
        frameWidth,
        frameHeight,
        -frameWidth / 2,
        -frameHeight / 2,
        frameWidth,
        frameHeight
      );
    } else if (defaultHoldLoaded && defaultHoldLoaded.complete && defaultHoldLoaded.naturalWidth > 0) {
      // Stock-style default art (spec/default_*.png), drawn like an uploaded
      // single-frame sheet.
      offCtx.drawImage(
        defaultHoldLoaded,
        -defaultHoldLoaded.naturalWidth / 2,
        -defaultHoldLoaded.naturalHeight / 2
      );
    } else {
      // Placeholder in PX's orientation: barrel up, grip at the bottom.
      offCtx.fillStyle = '#d65443';
      offCtx.strokeStyle = '#85271e';
      offCtx.lineWidth = 1;
      offCtx.fillRect(-3, -10, 6, 20);
      offCtx.strokeRect(-3, -10, 6, 20);

      offCtx.fillStyle = '#f0a99e';
      offCtx.beginPath();
      offCtx.moveTo(-3, -10);
      offCtx.lineTo(0, -15);
      offCtx.lineTo(3, -10);
      offCtx.closePath();
      offCtx.fill();
    }
    offCtx.restore();

    // 3. Hand Sprite
    if (hold.drawHand !== false) {
      const handRadius = Number(hold.handRadius ?? 10);
      // worm_hold.rs: `rot_h = rot - PI * hand_radial_rotation`; the
      // generator emits `hand_radial_rotation = 1`.
      const rotH = rot - Math.PI;
      const handX = cx + Math.sin(rotH) * handRadius;
      const handY = cy - Math.cos(rotH) * handRadius;

      let handImg = handMidImgRef.current;
      if (hold.handType === 'lower') handImg = handLowerImgRef.current;
      else if (hold.handType === 'upper') handImg = handUpperImgRef.current;

      if (handImg && handImg.complete && handImg.naturalWidth > 0) {
        const handScale = (Number(hold.handScale) || 1) * putAwayShrink;
        offCtx.save();
        offCtx.imageSmoothingEnabled = false;
        offCtx.translate(handX, handY);
        // worm_hold.rs: `rot + PI * hand_rotation` (hand_rotation = 1).
        offCtx.rotate(rot + Math.PI);
        offCtx.scale(handScale, handScale);
        offCtx.drawImage(handImg, -handImg.naturalWidth / 2, -handImg.naturalHeight / 2);
        offCtx.restore();
      } else {
        offCtx.fillStyle = '#f472b6';
        offCtx.beginPath();
        offCtx.arc(handX, handY, 2.5, 0, Math.PI * 2);
        offCtx.fill();
      }
    }

    // Compose the same 300x300 scene the retired physics preview used, then
    // draw it at 2x: the simulator's default `Scale: 2x`.  The worm cell and
    // the hold art are drawn together at native size before that one scene
    // scale, so the hold stays pixel-aligned with the worm instead of being
    // zoomed on its own.
    const MAP_SIZE = 300;
    const VIEW_SCALE = 2;
    const WORM_X = 184; // `WORM_SITE_X` in the old simulator
    const WORM_Y = 176; // feet, `WORM_SITE_Y`
    const CELL_FEET_Y = 43; // feet row inside the 60x60 aim cell
    const cellX = WORM_X - SIZE / 2;
    const cellY = WORM_Y - CELL_FEET_Y;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(VIEW_SCALE, VIEW_SCALE);
    ctx.imageSmoothingEnabled = false;

    // The simulator's sky.
    const sky = ctx.createLinearGradient(0, 0, 0, MAP_SIZE);
    sky.addColorStop(0, '#0c4a6e');
    sky.addColorStop(0.5, '#0284c7');
    sky.addColorStop(1, '#38bdf8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    const mapImg = mapImgRef.current;
    if (mapImg && mapImg.complete && mapImg.naturalWidth > 0) {
      ctx.drawImage(mapImg, 0, 0, MAP_SIZE, MAP_SIZE);
    }

    if (!facingRight) {
      // The whole cell is right-facing; mirror it for the left-facing pose.
      ctx.translate(cellX + SIZE, cellY);
      ctx.scale(-1, 1);
      ctx.drawImage(offscreen, 0, 0, SIZE, SIZE, 0, 0, SIZE, SIZE);
    } else {
      ctx.drawImage(offscreen, 0, 0, SIZE, SIZE, cellX, cellY, SIZE, SIZE);
    }
    ctx.restore();
  }, [hold, aimAngleIndex, currentFrame, facingRight, assetsLoaded, weaponLoadedImg, defaultHoldLoaded, putAwayCounter]);

  // ---------------------------------------------------------------------------
  // 3. MISSILE FLIGHT SPRITE RENDER & ANIMATION LOOP (px_sprite_builder.lua exact)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();
    let accumulator = 0;
    const STEP = 1 / 50; // `wa.on.missile_frame` runs at 50 Hz

    const ANIM_SPEED_TABLE: Record<string, number> = {
      slow: 0.5,
      medium: 0.8,
      fast: 1.35,
    };

    const canvas = missileCanvasRef.current;
    const width = canvas?.width ?? 300;
    const height = canvas?.height ?? 260;

    // Per-flight state, advanced only in fixed 50 Hz steps so the rotation
    // and cyclical frame match `px_sprite_builder.lua` frame for frame.
    let posX = width / 2;
    let posY = height / 2;
    let vx = 0;
    let vy = 0;
    let rot = 0;
    let phase = 0;
    let frame = 0;
    let started = false;
    let lastFrameDisplay = -1;

    const stepMissile = () => {
      const anim = missile.anim || 'rotation';
      const numFrames = Math.max(1, missile.frames || 1);
      const userAnimSpeed = missile.animSpeed || 1.0;
      const spinMult = missile.spinRate || 1.0;

      const rad = (flightAngleDeg * Math.PI) / 180;
      const baseVx = Math.cos(rad) * flightSpeed;
      const baseVy = -Math.sin(rad) * flightSpeed;

      if (flightMode === 'arc') {
        animStateRef.current.arcT = (animStateRef.current.arcT + STEP * 0.45) % 1.0;
        const t = animStateRef.current.arcT;
        const padX = 40;
        const peakHeight = 70;
        const normX = (t - 0.5) * 2;
        posX = padX + t * (width - padX * 2);
        posY = height / 2 + 35 - (1 - normX * normX) * peakHeight;
        // Position derivative per 50 Hz frame.
        const dtT = STEP * 0.45;
        vx = (width - padX * 2) * dtT;
        vy = 4 * normX * peakHeight * dtT;
      } else if (flightMode === 'orbit') {
        animStateRef.current.arcT = (animStateRef.current.arcT + STEP * 0.8) % (Math.PI * 2);
        const angle = animStateRef.current.arcT;
        const radius = 55;
        const dAngle = STEP * 0.8;
        posX = width / 2 + Math.cos(angle) * radius;
        posY = height / 2 + Math.sin(angle) * radius;
        vx = -Math.sin(angle) * radius * dAngle;
        vy = Math.cos(angle) * radius * dAngle;
      } else {
        posX = width / 2;
        posY = height / 2;
        vx = baseVx;
        vy = baseVy;
      }

      // Rotation, verbatim from px_sprite_builder.lua.  Its sheets point up
      // natively, so `track_angle` is the velocity angle plus 90 degrees.
      const signVx = vx > 0 ? 1 : vx < 0 ? -1 : 0;
      if (anim === 'track') {
        rot = Math.atan2(vy, vx) + Math.PI / 2;
      } else if (anim === 'rotation') {
        rot += spinMult * 0.5 * (vx * 0.15 + Math.abs(vy) * 0.01 * signVx);
      } else if (anim === 'slow' || anim === 'medium' || anim === 'fast') {
        rot += (ANIM_SPEED_TABLE[anim] || 0.5) * 0.5 * signVx;
      } else {
        rot = 0;
      }

      // `cyclical_frame`: phase += anim_speed * 30 / 1000, wraps at 0.99.
      if (numFrames > 1) {
        phase += userAnimSpeed * 30 / 1000;
        if (phase > 0.99) phase = 0;
        frame = Math.floor(phase * numFrames) % numFrames;
      } else {
        phase = 0;
        frame = 0;
      }

      animStateRef.current.rotation = rot;
      animStateRef.current.phase = phase;
      animStateRef.current.frame = frame;
    };

    const renderMissile = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const liveCanvas = missileCanvasRef.current;
      if (!liveCanvas) {
        animationFrameId = requestAnimationFrame(renderMissile);
        return;
      }
      const ctx = liveCanvas.getContext('2d');
      if (!ctx) {
        animationFrameId = requestAnimationFrame(renderMissile);
        return;
      }

      if (!started) {
        started = true;
        stepMissile();
      } else if (isMissilePlaying) {
        accumulator += dt;
        // A stalled tab can accumulate seconds; cap the catch-up so the
        // preview does not spin through hundreds of frames at once.
        let steps = 0;
        while (accumulator >= STEP && steps < 8) {
          stepMissile();
          accumulator -= STEP;
          steps++;
        }
        if (steps === 8) accumulator = 0;
      }

      if (frame !== lastFrameDisplay) {
        lastFrameDisplay = frame;
        setActiveFrameDisplay(frame);
      }

      const anim = missile.anim || 'rotation';
      const numFrames = Math.max(1, missile.frames || 1);
      const scaleMult = missile.scale || 1.0;
      const mirror = missile.mirror !== false;

      // DRAW CANVAS
      ctx.clearRect(0, 0, width, height);

      // Background theme
      if (backdropTheme === 'sky') {
        const grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, '#0284c7');
        grad.addColorStop(1, '#38bdf8');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      } else if (backdropTheme === 'cavern') {
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, width, height);
      } else {
        // Checkerboard
        const tileSize = 10;
        for (let x = 0; x < width; x += tileSize) {
          for (let y = 0; y < height; y += tileSize) {
            ctx.fillStyle = (x / tileSize + y / tileSize) % 2 === 0 ? '#1e293b' : '#0f172a';
            ctx.fillRect(x, y, tileSize, tileSize);
          }
        }
      }

      // Draw faint trajectory guide in arc mode
      if (flightMode === 'arc') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        const padX = 40;
        for (let step = 0; step <= 30; step++) {
          const st = step / 30;
          const sx = padX + st * (width - padX * 2);
          const sNormX = (st - 0.5) * 2;
          const sy = height / 2 + 35 - (1 - sNormX * sNormX) * 70;
          if (step === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw simulated velocity vector arrow when in static mode
      if (flightMode === 'static') {
        ctx.save();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(posX, posY);
        ctx.lineTo(posX + vx * 2.5, posY + vy * 2.5);
        ctx.stroke();
        ctx.restore();
      }

      // Draw Missile Sprite
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(posX, posY);
      ctx.rotate(rot);

      // `b.facing = mirror and (m.vx < 0 and -1 or 1) or 1`
      const facing = mirror && vx < 0 ? -1 : 1;
      const zoom = missileZoom;
      ctx.scale(facing * scaleMult * (zoom / 4), scaleMult * (zoom / 4));

      const missileImg = missileImgRef.current;
      if (missileImg && missileImg.complete && missileImg.naturalWidth > 0) {
        // PX sheets are vertical strips of frames.
        const frameHeight = missileImg.naturalHeight / numFrames;
        const frameWidth = missileImg.naturalWidth;
        const sy = frame * frameHeight;

        ctx.drawImage(
          missileImg,
          0,
          sy,
          frameWidth,
          frameHeight,
          -frameWidth / 2,
          -frameHeight / 2,
          frameWidth,
          frameHeight
        );
      } else if (defaultMissileLoaded && defaultMissileLoaded.complete && defaultMissileLoaded.naturalWidth > 0) {
        ctx.drawImage(
          defaultMissileLoaded,
          -defaultMissileLoaded.naturalWidth / 2,
          -defaultMissileLoaded.naturalHeight / 2
        );
      } else {
        // Fallback stylized procedural missile art for immediate visual feedback
        renderProceduralMissile(ctx, anim, frame);
      }

      ctx.restore();

      animationFrameId = requestAnimationFrame(renderMissile);
    };

    animationFrameId = requestAnimationFrame(renderMissile);
    return () => cancelAnimationFrame(animationFrameId);
  }, [
    missile,
    isMissilePlaying,
    missileZoom,
    flightAngleDeg,
    flightSpeed,
    flightMode,
    backdropTheme,
    defaultMissileLoaded,
  ]);

  // Fallback high-contrast pixelated missile graphic
  const renderProceduralMissile = (
    ctx: CanvasRenderingContext2D,
    animType: MissileAnimType,
    frame: number
  ) => {
    // PX sheets point up natively; the fallback art does too so the preview
    // shows the same rotation the engine will apply.
    if (animType === 'rotation') {
      // Chilli Bomb / Grenade style
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 11, Math.PI / 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#991b1b';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Stem
      ctx.fillStyle = '#16a34a';
      ctx.fillRect(-2, -14, 4, 4);

      // Highlight
      ctx.fillStyle = '#fca5a5';
      ctx.fillRect(-2, -6, 3, 6);
    } else if (animType === 'track') {
      // Shadow Bolt / Bazooka Rocket style, nose up
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

      // Energy core pulse
      ctx.fillStyle = frame % 2 === 0 ? '#38bdf8' : '#a855f7';
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Mini Girder or spinning projectile, long axis up
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(-4, -12, 8, 24);
      ctx.strokeStyle = '#b45309';
      ctx.lineWidth = 1;
      ctx.strokeRect(-4, -12, 8, 24);
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(-2, -9, 4, 4);
      ctx.fillRect(-2, 5, 4, 4);
    }
  };

  // ---------------------------------------------------------------------------
  // HANDLERS FOR UPLOADING CUSTOM ASSETS
  // ---------------------------------------------------------------------------
  const handleUploadSheet = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    updateHold({
      enabled: true,
      sheetFile: file,
      sheetPreview: previewUrl,
      // The path is worked out when the pack is exported, from the id the
      // weapon has THEN. Baking it in here kept an old id (moon_grenade)
      // after a rename.
      sheet: '',
    });
  };

  const removeCustomSheet = () => {
    if (hold.sheetPreview) URL.revokeObjectURL(hold.sheetPreview);
    setWeaponLoadedImg(null);
    updateHold({
      sheetFile: undefined,
      sheetPreview: undefined,
      sheet: '',
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUploadMissileSheet = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    updateMissile({
      enabled: true,
      mode: 'custom',
      sheetFile: file,
      sheetPreview: previewUrl,
      sheet: '',   // worked out at export, as for the hold sheet
    });
  };

  const removeCustomMissileSheet = () => {
    if (missile.sheetPreview) URL.revokeObjectURL(missile.sheetPreview);
    updateMissile({
      sheetFile: undefined,
      sheetPreview: undefined,
      sheet: '',
    });
    if (missileFileInputRef.current) missileFileInputRef.current.value = '';
  };

  // Just the extra `sb.flight` keys the roles add, for the code preview.
  const previewRoles = builderOn
    ? [
        project.burst === 'clusters' && bitFlight.mode === 'builder'
          ? `  bits = { sheet = "sprites/${sanitizeModFolder(project.id)}/bit_flight.png", anim = "${bitFlight.anim}" },`
          : project.burst === 'clusters' && bitFlight.mode === 'inherit'
            ? '  bits = "inherit",'
            : '',
        behaviorDefs.some(
          (def) => (behaviorArt[def.key]?.mode ?? 'native') !== 'inherit'
        )
          ? '  states = { ... }  -- behaviour art (see the roles above)'
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  return (
    <div className="space-y-8">
      {/* ======================================================================= */}
      {/* 1. WORM HOLD & AIM POSTURE SECTION                                       */}
      {/* ======================================================================= */}
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 shadow-xs transition-colors">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between pb-4 mb-5 border-b border-stone-100 dark:border-stone-800 gap-3">
          <div>
            <h2 className="font-heading text-base font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-2">
              <span>Worm Aim & Hold Art Builder</span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-forge-50 dark:bg-forge-950/60 text-forge-600 dark:text-forge-400 font-semibold border border-forge-200 dark:border-forge-800/60">
                Native aim.png & hand_rad Assets
              </span>
            </h2>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
              Genuine Worms Armageddon 32-angle aim postures with authentic hand radius and weapon pivot positioning.
            </p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer bg-stone-100 dark:bg-stone-800 px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700">
            <input
              type="checkbox"
              checked={hold.enabled}
              onChange={(e) => updateHold({ enabled: e.target.checked })}
              className="rounded text-forge-600 focus:ring-forge-500"
            />
            <span className="text-xs font-semibold text-stone-900 dark:text-stone-100">
              Enable Custom Held Art
            </span>
          </label>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Pixel-Perfect Canvas Viewport */}
          <div className="lg:col-span-6 flex flex-col items-center gap-3">
            <div className="relative w-full max-w-[600px] border-2 border-stone-800 rounded-xl overflow-hidden shadow-lg bg-stone-950">
              <canvas
                ref={canvasRef}
                width={600}
                height={600}
                className="block w-full cursor-crosshair"
                style={{ imageRendering: 'pixelated' }}
              />

              <div className="absolute top-2 left-2 flex items-center gap-1.5 text-[10px] font-mono bg-black/70 backdrop-blur-xs text-stone-300 px-2 py-0.5 rounded border border-white/10">
                <span>Aim Angle: {aimAngleIndex}/31</span>
                <span>·</span>
                <span>{aimAngleIndex === 16 ? 'Horizontal' : aimAngleIndex < 16 ? 'Down' : 'Up'}</span>
              </div>

              <div className="absolute bottom-2 left-2 flex items-center gap-1 text-[10px] font-mono bg-black/70 backdrop-blur-xs text-stone-300 px-2 py-0.5 rounded border border-white/10">
                <span>Facing: {facingRight ? 'Right' : 'Left'}</span>
              </div>
            </div>

            {/* Canvas Controls: Facing */}
            <div className="flex items-center justify-center w-full max-w-[600px] gap-2">
              <button
                type="button"
                onClick={() => setFacingRight(!facingRight)}
                className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span>Flip ({facingRight ? 'Right' : 'Left'})</span>
              </button>
            </div>

            {/* Aim Angle Scrubber (0 to 31) */}
            <div className="w-full max-w-[600px] space-y-1.5 bg-stone-50 dark:bg-stone-800/50 p-3 rounded-lg border border-stone-200 dark:border-stone-800">
              <div className="flex items-center justify-between text-xs font-medium text-stone-700 dark:text-stone-300">
                <span>Worm Posture (0–31)</span>
                <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">{aimAngleIndex}</span>
              </div>
              <input
                type="range"
                min={0}
                max={31}
                step={1}
                value={aimAngleIndex}
                onChange={(e) => setAimAngleIndex(Number(e.target.value))}
                className="w-full accent-forge-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-stone-400 font-mono">
                <span>0 (Down)</span>
                <span>16 (Level)</span>
                <span>31 (Up)</span>
              </div>
            </div>
          </div>

          {/* Right: Controls & Properties */}
          <div className="lg:col-span-6 space-y-5">
            {/* Custom Sheet Upload Card */}
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Upload className="w-4 h-4 text-forge-600 dark:text-forge-400" />
                  <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                    Held Weapon Sprite Sheet
                  </span>
                </div>
                {hold.sheetPreview && (
                  <button
                    type="button"
                    onClick={removeCustomSheet}
                    className="text-xs text-rose-500 hover:text-rose-600 font-medium"
                  >
                    Remove Art
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/gif"
                  onChange={handleUploadSheet}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3.5 py-2 text-xs font-semibold text-stone-800 dark:text-stone-200 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-700 shadow-2xs transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-forge-600 dark:text-forge-400" />
                  <span>{hold.sheetFile ? 'Change PNG Sheet' : 'Upload Held Weapon PNG'}</span>
                </button>

                <div className="text-xs text-stone-500 dark:text-stone-400">
                  {hold.sheetFile ? (
                    <span className="font-mono text-forge-600 dark:text-forge-400 font-medium">
                      {hold.sheetFile.name} ({(hold.sheetFile.size / 1024).toFixed(1)} KB)
                    </span>
                  ) : (
                    <span>Using default {defaultArt.label} art — upload a PNG to replace it</span>
                  )}
                </div>
              </div>
            </div>

            {/* Positioning Parameters: Radius, Rotation, Scale */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Hand Type */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                  Hand Type (`PX_HANDS`)
                </label>
                <div className="grid grid-cols-3 gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-lg border border-stone-200 dark:border-stone-700 text-xs">
                  {(['lower', 'mid', 'upper'] as HandType[]).map((ht) => (
                    <button
                      key={ht}
                      type="button"
                      onClick={() => updateHold({ handType: ht })}
                      className={`py-1.5 font-medium rounded-md capitalize transition-colors ${
                        hold.handType === ht
                          ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs font-bold'
                          : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                      }`}
                    >
                      {ht}
                    </button>
                  ))}
                </div>
              </div>

              {/* Hand Radius */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-stone-700 dark:text-stone-300">Hand Radius</span>
                  <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">{hold.handRadius} px</span>
                </div>
                <input
                  type="range"
                  min={-10}
                  max={35}
                  step={1}
                  value={hold.handRadius}
                  onChange={(e) => updateHold({ handRadius: Number(e.target.value) })}
                  className="w-full accent-forge-500 cursor-pointer"
                />
              </div>

              {/* Weapon Radius */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-stone-700 dark:text-stone-300">Weapon Radius</span>
                  <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">{hold.weapRadius} px</span>
                </div>
                <input
                  type="range"
                  min={-10}
                  max={35}
                  step={1}
                  value={hold.weapRadius}
                  onChange={(e) => updateHold({ weapRadius: Number(e.target.value) })}
                  className="w-full accent-forge-500 cursor-pointer"
                />
              </div>

              {/* Weapon Rotation */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-stone-700 dark:text-stone-300">Weapon Rotation</span>
                  <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">{hold.weapRotation}°</span>
                </div>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={5}
                  value={hold.weapRotation}
                  onChange={(e) => updateHold({ weapRotation: Number(e.target.value) })}
                  className="w-full accent-forge-500 cursor-pointer"
                />
              </div>

              {/* Scale */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-stone-700 dark:text-stone-300">Scale Multiplier</span>
                  <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">{hold.scale}x</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2.5}
                  step={0.1}
                  value={hold.scale}
                  onChange={(e) => updateHold({ scale: Number(e.target.value) })}
                  className="w-full accent-forge-500 cursor-pointer"
                />
              </div>

              {/* Hand Scale Multiplier */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-stone-700 dark:text-stone-300">Hand Scale Multiplier</span>
                  <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">{(hold.handScale ?? 1).toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.05}
                  value={hold.handScale ?? 1}
                  onChange={(e) => updateHold({ handScale: Number(e.target.value) })}
                  className="w-full accent-forge-500 cursor-pointer"
                />
              </div>

              {/* Draw Hand Toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/40">
                <div className="text-xs">
                  <div className="font-semibold text-stone-800 dark:text-stone-200">Draw Worm Hand</div>
                  <div className="text-[11px] text-stone-500">Uncheck for hands-free weapons</div>
                </div>
                <input
                  type="checkbox"
                  checked={hold.drawHand !== false}
                  onChange={(e) => updateHold({ drawHand: e.target.checked })}
                  className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4 cursor-pointer"
                />
              </div>
            </div>

            {/* WormForge Hold Engine Lifecycle & Put-Away (worm_hold.rs) */}
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5 text-amber-500" />
                    <span>Engine Hold Lifecycle & Put-Away (`worm_hold.rs`)</span>
                  </span>
                  <p className="text-[11px] text-stone-500 mt-0.5">
                    Controls WA worm states: 0x65/0x66 retreat & backpack put-away vs 0x6A/0x6B fire poses.
                  </p>
                </div>
                {hold.putAway && !hold.thrown && (
                  <button
                    type="button"
                    disabled={putAwayCounter !== null}
                    onClick={triggerPutAwayDemo}
                    className="px-2.5 py-1 text-xs font-semibold rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 cursor-pointer flex items-center gap-1 disabled:opacity-50"
                  >
                    <Package className="w-3 h-3" />
                    <span>{putAwayCounter !== null ? 'Putting Away...' : 'Test Put-Away (0x65)'}</span>
                  </button>
                )}
              </div>

              {/* Delivery Category: Launchable vs Throwable */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                  Weapon Category (`thrown`)
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => updateHold({ thrown: false, putAway: true })}
                    className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                      !hold.thrown
                        ? 'border-forge-500 bg-forge-50/30 dark:bg-forge-950/30 ring-1 ring-forge-500'
                        : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 text-stone-600 dark:text-stone-400'
                    }`}
                  >
                    <div className="font-bold text-stone-900 dark:text-white">
                      Launchable / Firearm
                    </div>
                    <div className="text-[11px] text-stone-500">
                      Guns & bazookas (<code className="font-mono">thrown = false</code>). Held in hands; weapon can swing down into backpack on retreat.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => updateHold({ thrown: true, putAway: false })}
                    className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                      hold.thrown
                        ? 'border-forge-500 bg-forge-50/30 dark:bg-forge-950/30 ring-1 ring-forge-500'
                        : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 text-stone-600 dark:text-stone-400'
                    }`}
                  >
                    <div className="font-bold text-stone-900 dark:text-white">
                      Throwable
                    </div>
                    <div className="text-[11px] text-stone-500">
                      Grenades & bananas (<code className="font-mono">thrown = true</code>). Leaves worm hand instantly on release; skips gun put-away.
                    </div>
                  </button>
                </div>
              </div>

              {/* Toggles: put_away & keep_while_firing */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <label className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-colors ${
                  hold.thrown ? 'opacity-50 cursor-not-allowed border-stone-200 dark:border-stone-800 bg-stone-100/50 dark:bg-stone-900/50' : 'cursor-pointer border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900'
                }`}>
                  <input
                    type="checkbox"
                    disabled={hold.thrown}
                    checked={hold.putAway && !hold.thrown}
                    onChange={(e) => updateHold({ putAway: e.target.checked })}
                    className="rounded text-forge-600 focus:ring-forge-500 mt-0.5"
                  />
                  <div>
                    <div className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                      Animate Put-Away (`put_away = true`)
                    </div>
                    <div className="text-[11px] text-stone-500">
                      Gun swings down and smoothly shrinks into backpack during retreat/walking (survives WA state 0x65 & 0x66).
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hold.keepWhileFiring}
                    onChange={(e) => updateHold({ keepWhileFiring: e.target.checked })}
                    className="rounded text-forge-600 focus:ring-forge-500 mt-0.5"
                  />
                  <div>
                    <div className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                      Keep While Firing (`keep_while_firing = true`)
                    </div>
                    <div className="text-[11px] text-stone-500">
                      Weapon remains held and visible in worm hand throughout WA firing poses 0x6A & 0x6B (e.g. Crossbows, Miniguns).
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Animation & Sheet Frames */}
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                  Hold Sheet Animation & Playback
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={hold.frames <= 1}
                    onClick={() => setIsPlaying(!isPlaying)}
                    className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                      hold.frames <= 1
                        ? 'opacity-50 cursor-not-allowed bg-stone-200 dark:bg-stone-800 text-stone-400'
                        : isPlaying
                        ? 'bg-amber-600 text-white'
                        : 'bg-forge-600 text-white'
                    }`}
                  >
                    {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    <span>{isPlaying ? 'Pause' : 'Play Sheet'}</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-stone-600 dark:text-stone-400">Total Frames</label>
                  <input
                    type="number"
                    min={1}
                    max={64}
                    value={hold.frames}
                    onChange={(e) => updateHold({ frames: Math.max(1, Number(e.target.value)) })}
                    className="w-full text-xs font-mono px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-stone-600 dark:text-stone-400">In-game FPS</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={hold.fps}
                    onChange={(e) => updateHold({ fps: Math.max(1, Number(e.target.value)) })}
                    className="w-full text-xs font-mono px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-stone-600 dark:text-stone-400">Current Frame</label>
                  <div className="text-xs font-mono px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-semibold text-center">
                    {currentFrame + 1} / {Math.max(1, hold.frames)}
                  </div>
                </div>
              </div>

              <p className="text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
                {hold.frames > 1
                  ? `Plays at ${holdAnimFps} FPS in game across ${hold.frames} frames, exported as anim_speed = ${holdAnimSpeedLabel}. The engine advances 1.5 × frames × anim_speed frames per second, so this preview matches the game.`
                  : 'One frame — the sheet stays static in game.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ======================================================================= */}
      {/* 2. MISSILE / PROJECTILE FLIGHT SPRITE BUILDER (px_sprite_builder.lua)   */}
      {/* ======================================================================= */}
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 shadow-xs transition-colors">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between pb-4 mb-5 border-b border-stone-100 dark:border-stone-800 gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-base font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-2">
                <Rocket className="w-4 h-4 text-forge-600 dark:text-forge-400" />
                <span>Missile & Projectile Flight Sprite Builder</span>
              </h2>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-forge-50 dark:bg-forge-950/60 text-forge-600 dark:text-forge-400 font-semibold border border-forge-200 dark:border-forge-800/60">
                wfws_sprite_builder.lua · sb.flight
              </span>
            </div>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
              Follow flying projectiles with custom PNG sheets, animation types (<code className="font-mono text-forge-600 dark:text-forge-400">track</code>, <code className="font-mono text-forge-600 dark:text-forge-400">rotation</code>, <code className="font-mono text-forge-600 dark:text-forge-400">slow/med/fast</code>), cyclical frame playback, and <code className="font-mono text-stone-600 dark:text-stone-300">m.sprite = 0</code> native sprite hiding. Cluster bits can use their own sheet, and behaviour states (homing, dig, roam, gas) can swap art mid-flight.
            </p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer bg-stone-100 dark:bg-stone-800 px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700">
            <input
              type="checkbox"
              checked={missile.enabled}
              onChange={(e) =>
                updateMissile({
                  enabled: e.target.checked,
                  // Choosing the builder is what "enabled" means: with no
                  // upload the exporter falls back to the default missile art,
                  // but the mode still has to be custom for the generator.
                  ...(e.target.checked ? { mode: 'custom' } : {}),
                })
              }
              className="rounded text-forge-600 focus:ring-forge-500"
            />
            <span className="text-xs font-semibold text-stone-900 dark:text-stone-100">
              Enable Missile Flight Sprite
            </span>
          </label>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Interactive Missile Flight Canvas */}
          <div className="lg:col-span-5 flex flex-col items-center gap-3">
            <div className="relative border-2 border-stone-800 rounded-xl overflow-hidden shadow-lg bg-stone-950 w-full max-w-[320px]">
              <canvas
                ref={missileCanvasRef}
                width={300}
                height={260}
                className="block mx-auto cursor-pointer"
                style={{ imageRendering: 'pixelated' }}
                onClick={() => setIsMissilePlaying(!isMissilePlaying)}
                title="Click canvas to toggle Play / Pause"
              />

              {/* Status Badges Overlay */}
              <div className="absolute top-2 left-2 flex items-center gap-1.5 text-[10px] font-mono bg-black/75 backdrop-blur-xs text-stone-300 px-2 py-0.5 rounded border border-white/10">
                <span className="uppercase text-forge-400 font-bold">{missile.anim || 'rotation'}</span>
                <span>·</span>
                <span>Frame {activeFrameDisplay + 1}/{Math.max(1, missile.frames || 1)}</span>
              </div>

              <div className="absolute bottom-2 left-2 flex items-center gap-1.5 text-[10px] font-mono bg-black/75 backdrop-blur-xs text-stone-300 px-2 py-0.5 rounded border border-white/10">
                <span>{isMissilePlaying ? 'Simulating Flight' : 'Paused'}</span>
                <span>·</span>
                <span className="text-stone-400 capitalize">{flightMode}</span>
              </div>

              {/* Backdrop Theme Picker */}
              <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/70 backdrop-blur-xs p-0.5 rounded border border-white/10 text-[10px]">
                {(['grid', 'sky', 'cavern'] as const).map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    onClick={() => setBackdropTheme(theme)}
                    className={`px-1.5 py-0.5 rounded capitalize ${
                      backdropTheme === theme ? 'bg-forge-600 text-white font-bold' : 'text-stone-400 hover:text-white'
                    }`}
                  >
                    {theme}
                  </button>
                ))}
              </div>
            </div>

            {/* Flight Mode & Playback Bar */}
            <div className="flex items-center justify-between w-full max-w-[320px] gap-2">
              <button
                type="button"
                onClick={() => setIsMissilePlaying(!isMissilePlaying)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-white transition-colors cursor-pointer ${
                  isMissilePlaying ? 'bg-amber-600 hover:bg-amber-700' : 'bg-forge-600 hover:bg-forge-700'
                }`}
              >
                {isMissilePlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span>{isMissilePlaying ? 'Pause Flight' : 'Resume Flight'}</span>
              </button>

              <div className="flex items-center gap-1 bg-stone-100 dark:bg-stone-800 p-1 rounded-lg border border-stone-200 dark:border-stone-700 text-xs">
                <span className="px-1 text-[11px] font-mono text-stone-500">Zoom:</span>
                {[2, 3, 4, 5, 6].map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => setMissileZoom(z)}
                    className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold ${
                      missileZoom === z
                        ? 'bg-forge-600 text-white'
                        : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                    }`}
                  >
                    {z}x
                  </button>
                ))}
              </div>
            </div>

            {/* Flight Path Mode Toggle: Arc vs Orbit vs Static Vector */}
            <div className="w-full max-w-[320px] grid grid-cols-3 gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-lg border border-stone-200 dark:border-stone-700 text-xs font-medium">
              {(
                [
                  { id: 'arc', label: 'Parabolic Arc' },
                  { id: 'orbit', label: 'Circle Path' },
                  { id: 'static', label: 'Static Vector' },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setFlightMode(mode.id)}
                  className={`py-1 rounded text-center transition-colors cursor-pointer ${
                    flightMode === mode.id
                      ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white font-bold shadow-2xs'
                      : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {/* Velocity Vector & Angle Controls (when in static vector mode) */}
            {flightMode === 'static' && (
              <div className="w-full max-w-[320px] space-y-2 bg-stone-50 dark:bg-stone-800/50 p-3 rounded-lg border border-stone-200 dark:border-stone-800">
                <div className="flex items-center justify-between text-xs font-medium text-stone-700 dark:text-stone-300">
                  <span>Flight Angle:</span>
                  <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">{flightAngleDeg}°</span>
                </div>
                <input
                  type="range"
                  min={-90}
                  max={90}
                  step={5}
                  value={flightAngleDeg}
                  onChange={(e) => setFlightAngleDeg(Number(e.target.value))}
                  className="w-full accent-forge-500 cursor-pointer"
                />

                <div className="flex items-center justify-between text-xs font-medium text-stone-700 dark:text-stone-300 pt-1">
                  <span>Flight Speed:</span>
                  <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">{flightSpeed} px/f</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={30}
                  step={1}
                  value={flightSpeed}
                  onChange={(e) => setFlightSpeed(Number(e.target.value))}
                  className="w-full accent-forge-500 cursor-pointer"
                />
              </div>
            )}
          </div>

          {/* Right Column: Sprite Builder Properties & Controls */}
          <div className="lg:col-span-7 space-y-5">
            {/* 1. Custom Missile PNG Sheet Card */}
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Upload className="w-4 h-4 text-forge-600 dark:text-forge-400" />
                  <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                    Projectile Sprite Asset
                  </span>
                </div>
                {missile.sheetPreview && (
                  <button
                    type="button"
                    onClick={removeCustomMissileSheet}
                    className="text-xs text-rose-500 hover:text-rose-600 font-medium cursor-pointer"
                  >
                    Remove Sheet
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                <input
                  ref={missileFileInputRef}
                  type="file"
                  accept="image/png,image/gif"
                  onChange={handleUploadMissileSheet}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => missileFileInputRef.current?.click()}
                  className="px-3.5 py-2 text-xs font-semibold text-stone-800 dark:text-stone-200 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-700 shadow-2xs transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-forge-600 dark:text-forge-400" />
                  <span>{missile.sheetFile ? 'Change PNG Sheet' : 'Upload Missile PNG Sheet'}</span>
                </button>

                <div className="text-xs text-stone-500 dark:text-stone-400">
                  {missile.sheetFile ? (
                    <span className="font-mono text-forge-600 dark:text-forge-400 font-medium">
                      {missile.sheetFile.name} ({(missile.sheetFile.size / 1024).toFixed(1)} KB)
                    </span>
                  ) : (
                    <span>Using default {defaultArt.label} art — upload a PNG to replace it</span>
                  )}
                </div>
              </div>

            </div>

            {/* 1b. WFWS extra roles: cluster bits and behaviour states */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                    WFWS role art
                  </div>
                  <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">
                    Cluster bits and behaviour states are drawn by the same
                    <code className="font-mono"> sb.flight </code> call. Each role can keep WA&apos;s
                    sprite, draw your own sheet, or inherit the primary art.
                  </p>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-forge-50 dark:bg-forge-950/60 text-forge-600 dark:text-forge-400 font-semibold border border-forge-200 dark:border-forge-800/60">
                  wf-lib/wfws_sprite_builder
                </span>
              </div>

              {!builderOn && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg px-2.5 py-1.5">
                  Enable <strong>Missile Flight Sprite</strong> above first. Bits and behaviour states
                  are emitted inside that builder call; until then these rows are saved but ignored.
                </p>
              )}

              {project.burst === 'clusters' && (
                <FlightRoleEditor
                  role={bitFlight}
                  onChange={updateBitFlight}
                  title="Cluster bit art"
                  description="The child missiles after the burst. Native keeps WA's clustlet sheet; Builder draws this sheet; Inherit reuses the primary round's art."
                  path={bitFlightSheetPath(project)}
                  inheritLabel="Inherit primary"
                  disabled={!builderOn}
                  warning={
                    bitBuilderMode(project) === 'builder' && project.packArt?.cluster_sprite
                      ? 'The native `cluster.sprite` upload in Burst Payload is skipped while the bit builder owns the bits; use this sheet instead.'
                      : undefined
                  }
                />
              )}

              {behaviorDefs.length > 0 && (
                <div className="space-y-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                    Behaviour art
                  </div>
                  {behaviorDefs.map((def) => {
                    const homingArmMs =
                      (def.key === 'homing'
                        ? project.body.homing_arm_ms
                        : project.body.clustlet.homing_arm_ms) ?? 0;
                    const homingTimeMs =
                      (def.key === 'homing'
                        ? project.body.homing_time_ms
                        : project.body.clustlet.homing_time_ms) ?? 0;
                    return (
                    <FlightRoleEditor
                      key={def.key}
                      role={behaviorArt[def.key] ?? defaultBehaviorRole}
                      onChange={(patch) => updateBehaviorArt(def.key, patch)}
                      title={def.label}
                      description={
                        def.key === 'dig'
                          ? 'Terrain-probed animation. Native keeps the record dig frames; anything else zeroes them and cycles the flight sheet.'
                          : def.key === 'homing' || def.key === 'homing_bit'
                            ? `Timed from the record: art from ${homingArmMs} ms ${homingTimeMs > 0 ? `to ${homingArmMs + homingTimeMs} ms` : 'until it lands or blasts'}. The builder swaps to this sheet inside that window and zeroes WA's homing sprite.`
                            : `${def.description} Signal: ${def.record}.`
                      }
                      path={behaviorStateSheetPath(project, def.key)}
                      sig={behaviorSigs.get(def.key)}
                      inheritLabel="Inherit"
                      disabled={!builderOn}
                      sheetless={def.key === 'dig'}
                    />
                    );
                  })}
                </div>
              )}

              {project.action === 'roam' && (
                <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40 space-y-3">
                  <div>
                    <div className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                      Roaming animal sheets (`sheep_sprites`)
                    </div>
                    <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">
                      WA alternates these two sheets while you steer the animal
                      (written to `sheep.flight_1` / `sheep.flight_2`), and it
                      picks the frame from the flight direction: the sheet has to
                      be a rotation strip (PX's Ghost Sheep ships 60x1920 = 32
                      frames of 60x60). Upload one frame and hit{' '}
                      <strong>Rotate into strip</strong>, or upload an existing
                      strip and set its frame count. Nothing is detected here: the
                      walking pose is the record body, the gas pose is
                      `roam.gas.animal_sprite`, and WA picks every one of them
                      itself.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <RoamSheetField
                      id="roam-sheet-1"
                      label="Flying sheet 1 (`flight_1`)"
                      asset={project.roamSheets?.flight1}
                      path={roamSheetPath(project, 'flight1')}
                      onChange={(asset) =>
                        onChange({
                          roamSheets: { ...project.roamSheets, flight1: asset, flight2: project.roamSheets?.flight2 ?? {} },
                        })
                      }
                    />
                    <RoamSheetField
                      id="roam-sheet-2"
                      label="Flying sheet 2 (`flight_2`)"
                      asset={project.roamSheets?.flight2}
                      path={roamSheetPath(project, 'flight2')}
                      onChange={(asset) =>
                        onChange({
                          roamSheets: { ...project.roamSheets, flight2: asset, flight1: project.roamSheets?.flight1 ?? {} },
                        })
                      }
                    />
                  </div>
                  <p className="text-[10px] text-stone-400">
                    Native ids in the record: `flight_1` {project.roamConfig?.flight_1 ?? 0}
                    {' '}({stockSpriteName(project.roamConfig?.flight_1 ?? 0) ?? 'unused'}),
                    `flight_2` {project.roamConfig?.flight_2 ?? 0}
                    {' '}({stockSpriteName(project.roamConfig?.flight_2 ?? 0) ?? 'unused'}).
                    The uploads replace both, so the numeric rows are skipped while
                    they are set.
                  </p>
                  {!!project.roamSheets?.flight1?.file !== !!project.roamSheets?.flight2?.file && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300">
                      Both sheets are needed: the engine takes exactly two for
                      `sheep_sprites`, so nothing is emitted until the second is uploaded.
                    </p>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <StockSpriteInput
                      id="roam-gas-pose"
                      label="Gas pose (`roam.gas.animal_sprite`)"
                      numeric
                      placeholder="0"
                      value={project.roamConfig?.gas_animal_sprite ?? 0}
                      onChange={(v) =>
                        onChange({
                          roamConfig: {
                            ...project.roamConfig,
                            gas_animal_sprite: v === '' ? 0 : Number(v),
                          },
                        })
                      }
                      desc="Drawn instead of the animal while it emits gas (the Skunk's skunk2 is 174). A stock id, so no upload: WA has no bundle-path field here."
                    />
                    <div className="space-y-1 text-[11px] text-stone-500 dark:text-stone-400">
                      <div className="font-semibold text-stone-700 dark:text-stone-300">
                        The five PX sheep labels
                      </div>
                      <p>
                        flying / flying 2 → the two uploads (`sheep_sprites`).
                        taking off (0xE8) and during flight (0xEC) live in two
                        sheep sprite fields the engine does not name yet, so PX
                        spells them with its own ids (76 and `0x10000 + 77`).
                        farting → `roam.gas.animal_sprite`.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 2. Animation Type Selector (`ANIM_TYPE` from px_sprite_builder.lua) */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5 text-forge-600 dark:text-forge-400" />
                <span>Animation Mode (`opts.anim`)</span>
              </label>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  {
                    id: 'track',
                    name: 'Track Trajectory',
                    sub: 'Points along flight vector',
                    code: 'ANIM_TYPE.track = 2',
                  },
                  {
                    id: 'rotation',
                    name: 'Speed Rotation',
                    sub: 'Speed-based dynamic tumble',
                    code: 'ANIM_TYPE.rotation = 3',
                  },
                  {
                    id: 'slow',
                    name: 'Slow Spin',
                    sub: 'Steady spin (speed = 0.5)',
                    code: 'ANIM_TYPE.slow = 1',
                  },
                  {
                    id: 'medium',
                    name: 'Medium Spin',
                    sub: 'Steady spin (speed = 0.8)',
                    code: 'ANIM_TYPE.medium = 1',
                  },
                  {
                    id: 'fast',
                    name: 'Fast Spin',
                    sub: 'Steady spin (speed = 1.35)',
                    code: 'ANIM_TYPE.fast = 1',
                  },
                  {
                    id: 'none',
                    name: 'Fixed Upright',
                    sub: 'No rotation turn (0°)',
                    code: 'ANIM_TYPE.none = 5',
                  },
                ].map((item) => {
                  const isSelected = (missile.anim || 'rotation') === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => updateMissile({ anim: item.id as MissileAnimType })}
                      className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                        isSelected
                          ? 'border-forge-500 bg-forge-50/30 dark:bg-forge-950/30 ring-1 ring-forge-500'
                          : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 hover:border-stone-300 dark:hover:border-stone-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={`text-xs font-bold ${isSelected ? 'text-forge-700 dark:text-forge-400' : 'text-stone-800 dark:text-stone-200'}`}>
                          {item.name}
                        </span>
                        {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-forge-600 dark:text-forge-400" />}
                      </div>
                      <div className="text-[11px] text-stone-500 dark:text-stone-400 leading-tight">
                        {item.sub}
                      </div>
                      <div className="text-[10px] font-mono text-stone-400 mt-1">
                        {item.code}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Sheet Frames & Cyclical Animation Parameters */}
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4">
              <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                Cyclical Sheet Animation & Scale
              </span>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-stone-600 dark:text-stone-400">Total Frames</label>
                  <input
                    type="number"
                    min={1}
                    max={64}
                    value={missile.frames || 1}
                    onChange={(e) => updateMissile({ frames: Math.max(1, Number(e.target.value)) })}
                    className="w-full text-xs font-mono px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-stone-600 dark:text-stone-400">Anim Speed</label>
                  <input
                    type="number"
                    step={0.1}
                    min={0.1}
                    max={10.0}
                    value={missile.animSpeed || 1.0}
                    onChange={(e) => updateMissile({ animSpeed: Math.max(0.1, Number(e.target.value)) })}
                    className="w-full text-xs font-mono px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-stone-600 dark:text-stone-400">Spin Rate</label>
                  <input
                    type="number"
                    step={0.1}
                    min={0.1}
                    max={5.0}
                    value={missile.spinRate || 1.0}
                    onChange={(e) => updateMissile({ spinRate: Math.max(0.1, Number(e.target.value)) })}
                    className="w-full text-xs font-mono px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-stone-600 dark:text-stone-400">Sprite Scale</label>
                  <input
                    type="number"
                    step={0.1}
                    min={0.2}
                    max={3.0}
                    value={missile.scale || 1.0}
                    onChange={(e) => updateMissile({ scale: Math.max(0.2, Number(e.target.value)) })}
                    className="w-full text-xs font-mono px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Toggles: Mirror & HideStock */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-stone-200/50 dark:border-stone-800/50">
                <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={missile.mirror !== false}
                    onChange={(e) => updateMissile({ mirror: e.target.checked })}
                    className="rounded text-forge-600 focus:ring-forge-500 mt-0.5"
                  />
                  <div>
                    <div className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                      Mirror Facing (`vx &lt; 0`)
                    </div>
                    <div className="text-[11px] text-stone-500">
                      Flips sprite horizontally when moving left.
                    </div>
                  </div>
                </label>

                <div className="flex items-start gap-2.5 p-2.5 rounded-lg border border-forge-200 dark:border-forge-900/60 bg-forge-50/40 dark:bg-forge-950/20">
                  <CheckCircle2 className="w-4 h-4 text-forge-600 dark:text-forge-400 mt-0.5 shrink-0" aria-hidden="true" />
                  <div>
                    <div className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                      Stock Sprite Hidden (`sprite = 0`)
                    </div>
                    <div className="text-[11px] text-stone-500">
                      Always written while the builder is on: it hides WA's round.
                      Identity is the same field read backwards — with a bit sheet
                      configured, the missile whose `m.sprite` is zero is the cluster
                      bit (a bit inherits its parent's copy of the record sprite), so
                      everything else is the primary.
                    </div>
                  </div>
                </div>

                <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!project.missileSprite.logIdentity}
                    onChange={(e) =>
                      onChange({
                        missileSprite: { ...project.missileSprite, logIdentity: e.target.checked },
                      })
                    }
                    className="rounded text-forge-600 focus:ring-forge-500 mt-0.5"
                  />
                  <div>
                    <div className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                      Log Identity (`log = true`)
                    </div>
                    <div className="text-[11px] text-stone-500">
                      One log line per missile&apos;s first frames with its id,
                      `m.sprite` and the role it was classified as. Turn it off for
                      the real bundle.
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* 4. Generated Lua Code Preview */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-mono font-semibold text-stone-500 uppercase tracking-wider">
                Generated Lua `sb.flight` Call
              </span>
              <pre className="text-xs font-mono bg-stone-950 text-forge-400 p-3 rounded-lg overflow-x-auto border border-stone-800">
{`-- inside install, after wa.weapons.replace{ ... }
sb.flight(ctx, {
  weapon = ctx.id,
  sheet = "sprites/${sanitizeModFolder(project.id)}/missile.png",
  anim = "${missile.anim || 'rotation'}",${(missile.frames || 1) > 1 ? `\n  cyclical = ${missile.frames},` : ''}${
    missile.animSpeed && missile.animSpeed !== 1 ? `\n  anim_speed = ${missile.animSpeed},` : ''
  }${
    missile.spinRate && missile.spinRate !== 1 ? `\n  spin = ${missile.spinRate},` : ''
  }${
    missile.scale && missile.scale !== 1 ? `\n  scale = ${missile.scale},` : ''
  }${missile.z !== undefined && missile.z !== 5 ? `\n  z = ${missile.z},` : ''}${
    missile.mirror !== false ? '' : '\n  mirror = false,'
  }${previewRoles ? `\n${previewRoles}` : ''}
})`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
