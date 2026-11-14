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
  bitFlightSheetPath,
  behaviorStateSheetPath,
  digArtOverrideRows,
  roamSheetPath,
  missileFlightSheetPath,
  ROAM_FLY_SENTINEL,
  roamWalkPoseId,
} from '../utils/luaGenerator';
import { StockSpriteInput } from './StockSpriteInput';
import { NumberInput } from './NumberInput';
import { stockSpriteName } from '../data/stockSprites';
import { assetUrl } from '../utils/assetUrl';
import { defaultArtFor } from '../utils/defaultArt';
import { buildRotationSheet } from '../utils/rotateSheet';
import {
  DEFAULT_DIG_ROLE_ART,
  DEFAULT_ROAM_ROLE_ART,
  DEFAULT_ROAM_TILT,
  DEFAULT_ROLE_ART,
  bitActionOf,
  bitBuilderMode,
  primaryBuilderOn,
} from '../data/spriteBuilder';
import mapBackgroundSrc from '../../spec/pre_weapon_preview.png';
import normalIconSrc from '../../spec/normal.png';
import homingIconSrc from '../../spec/hmissil1.png';
import clustersIconSrc from '../../spec/clusters.png';
import homingClustletsIconSrc from '../../spec/homing_clustlets.png';
import roamIconSrc from '../../spec/sspsheep1.png';
import digIconSrc from '../../spec/dig.png';
import oildrumSrc from '../../spec/oildrum1.png';
import {
  Upload,
  Play,
  Pause,
  ArrowLeftRight,
  Compass,
  Rocket,
  CheckCircle2,
  Loader2,
  RotateCw,
  Copy,
  Check,
  AlertTriangle,
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
          <NumberInput
            id={`${id}-frames`}
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

/** Natural pixel size of an image URL (used for `px_hold_art`'s cell size). */
function imagePixelSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('That image could not be decoded.'));
    img.src = url;
  });
}
const HAND_MID_SRC = assetUrl('assets/worm/hand_rad.png');
const HAND_LOWER_SRC = assetUrl('assets/worm/hand_rad_lower.png');
const HAND_UPPER_SRC = assetUrl('assets/worm/hand_rad_upper.png');

export const HoldPreview: React.FC<HoldPreviewProps> = ({ project, onChange }) => {
  // ---------------------------------------------------------------------------
  // 1. WORM HOLD REFS & STATE
  // ---------------------------------------------------------------------------
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Firing-state sprite (`hold.flash`): the engine lights it for `frames` + 1
  // ticks after the fire message. The preview "Test" button does the same at
  // 20 ms a tick.
  const flashFileInputRef = useRef<HTMLInputElement>(null);
  const flashImgRef = useRef<HTMLImageElement | null>(null);
  const [flashLoadedImg, setFlashLoadedImg] = useState<HTMLImageElement | null>(null);
  const [flashLeft, setFlashLeft] = useState(0);

  const triggerPutAwayDemo = () => {
    setPutAwayCounter(20);
  };

  const triggerFireDemo = () => {
    setFlashLeft(Math.max(1, Math.round(project.hold.flashFrames ?? 3)) + 1);
  };

  useEffect(() => {
    if (flashLeft <= 0) return;
    const timer = setTimeout(() => setFlashLeft((left) => Math.max(0, left - 1)), 20);
    return () => clearTimeout(timer);
  }, [flashLeft]);

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

  const currentHandType = hold.handType || 'mid';
  const currentHandTypeLabel =
    currentHandType === 'lower' ? 'Lower' : currentHandType === 'upper' ? 'Upper' : 'Mid';

  const cycleHandType = () => {
    const order: HandType[] = ['lower', 'mid', 'upper'];
    const idx = order.indexOf(currentHandType);
    const next = order[(idx + 1) % order.length];
    updateHold({ handType: next });
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
    const base =
      key === 'dig'
        ? DEFAULT_DIG_ROLE_ART
        : key === 'roam'
          ? DEFAULT_ROAM_ROLE_ART
          : DEFAULT_ROLE_ART;
    onChange({
      behaviorArt: {
        ...behaviorArt,
        [key]: { ...(behaviorArt[key] ?? base), ...patch },
      },
    });
  };
  const builderOn = primaryBuilderOn(project);
  const isAirStrike = project.fireType === 'cursor' && !project.teleport;
  const hasPrimaryHoming = project.action === 'homing';
  const hasBitHoming = project.burst === 'clusters' && bitActionOf(project) === 'homing';
  const clustersEnabled = project.burst === 'clusters';
  const roamEnabled = project.action === 'roam';
  const digMainEnabled = project.action === 'dig';
  const digBitEnabled = project.burst === 'clusters' && bitActionOf(project) === 'dig';
  const digEnabled = digMainEnabled || digBitEnabled;

  type FlightSlotRole = 'primary' | 'homing' | 'clusters' | 'homing_bit' | 'roam' | 'dig';
  const [activeFlightRole, setActiveFlightRole] = useState<FlightSlotRole>('primary');
  const [copiedSbLua, setCopiedSbLua] = useState(false);

  // Auto-fallback to primary if the weapon configuration disables the active slot
  useEffect(() => {
    if (activeFlightRole === 'homing' && !hasPrimaryHoming) setActiveFlightRole('primary');
    else if (activeFlightRole === 'clusters' && !clustersEnabled) setActiveFlightRole('primary');
    else if (activeFlightRole === 'homing_bit' && !hasBitHoming) setActiveFlightRole('primary');
    else if (activeFlightRole === 'roam' && !roamEnabled) setActiveFlightRole('primary');
    else if (activeFlightRole === 'dig' && !digEnabled) setActiveFlightRole('primary');
  }, [activeFlightRole, hasPrimaryHoming, clustersEnabled, hasBitHoming, roamEnabled, digEnabled]);

  const homingRole = behaviorArt.homing ?? defaultBehaviorRole;
  const homingBitRole = behaviorArt.homing_bit ?? defaultBehaviorRole;
  const digRole = behaviorArt.dig ?? DEFAULT_DIG_ROLE_ART;
  const digRoleMode = digRole.mode;
  // A roaming animal's flown art: `inherit` (no row) keeps the round's own
  // sheet, which is what every bundle written before the role existed does;
  // `builder` gives the animal a sheet and animation of its own.
  const roamRole: FlightRoleArt =
    behaviorArt.roam ?? { ...DEFAULT_ROAM_ROLE_ART, mode: 'inherit' };
  const roamRoleMode = roamRole.mode;

  // Missile interactive simulation state
  const [isMissilePlaying, setIsMissilePlaying] = useState(true);
  const [missileZoom, setMissileZoom] = useState<number>(4);
  const [flightAngleDeg, setFlightAngleDeg] = useState<number>(25); // trajectory launch angle
  const [flightSpeed, setFlightSpeed] = useState<number>(14); // velocity magnitude
  const [flightMode, setFlightMode] = useState<'orbit' | 'arc' | 'static' | 'walk'>('arc');
  const [backdropTheme, setBackdropTheme] = useState<'grid' | 'sky' | 'cavern'>('grid');
  const [showDrumRef, setShowDrumRef] = useState(true);
  const [oildrumLoadedImg, setOildrumLoadedImg] = useState<HTMLImageElement | null>(null);

  // Internal animation state refs (continuous physics & phase)
  const animStateRef = useRef<{
    phase: number;
    rotation: number;
    arcT: number;
    frame: number;
    drumTime: number;
    /** The last side the roaming walk faced; kept through a straight drop. */
    roamLeft: boolean;
  }>({
    phase: 0,
    rotation: 0,
    arcT: 0,
    frame: 0,
    drumTime: 0,
    roamLeft: false,
  });

  const [activeFrameDisplay, setActiveFrameDisplay] = useState(0);
  const roleImgRef = useRef<HTMLImageElement | null>(null);
  const [roleLoadedImg, setRoleLoadedImg] = useState<HTMLImageElement | null>(null);
  const roleFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setOildrumLoadedImg(img);
    };
    img.src = oildrumSrc;
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Preload the firing-state sprite, so the muzzle flash can be drawn at once.
  useEffect(() => {
    if (hold.flashPreview) {
      const img = new Image();
      img.onload = () => {
        flashImgRef.current = img;
        setFlashLoadedImg(img);
      };
      img.src = hold.flashPreview;
    } else {
      flashImgRef.current = null;
      setFlashLoadedImg(null);
    }
  }, [hold.flashPreview]);

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

  // Preload the active secondary role's preview sheet when switching hotbar slots
  const secondarySheetPreview =
    activeFlightRole === 'clusters'
      ? bitFlight.mode === 'builder'
        ? bitFlight.sheetPreview
        : bitFlight.mode === 'inherit'
          ? missile.sheetPreview
          : undefined
      : activeFlightRole === 'homing'
        ? homingRole.mode === 'builder'
          ? homingRole.sheetPreview
          : homingRole.mode === 'inherit'
            ? missile.sheetPreview
            : undefined
        : activeFlightRole === 'homing_bit'
          ? homingBitRole.mode === 'builder'
            ? homingBitRole.sheetPreview
            : homingBitRole.mode === 'inherit'
              ? bitFlight.mode === 'builder'
                ? bitFlight.sheetPreview
                : missile.sheetPreview
              : undefined
          : activeFlightRole === 'roam'
            ? roamRoleMode === 'builder'
              ? roamRole.sheetPreview
              : builderOn
                ? missile.sheetPreview
                : project.roamSheets?.flight1?.preview
            : activeFlightRole === 'dig'
              ? digRoleMode !== 'native'
                ? digBitEnabled && !digMainEnabled && bitFlight.mode === 'builder'
                  ? bitFlight.sheetPreview
                  : missile.sheetPreview
                : undefined
              : missile.sheetPreview;

  useEffect(() => {
    if (secondarySheetPreview) {
      let cancelled = false;
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        roleImgRef.current = img;
        setRoleLoadedImg(img);
      };
      img.src = secondarySheetPreview;
      return () => {
        cancelled = true;
      };
    } else {
      roleImgRef.current = null;
      setRoleLoadedImg(null);
    }
  }, [secondarySheetPreview]);

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

  // Worm Hold frame animation timer (always plays when hold.frames > 1)
  useEffect(() => {
    if (hold.frames <= 1) {
      setCurrentFrame(0);
      return;
    }
    const intervalMs = 1000 / (hold.fps || 15);
    const timer = setInterval(() => {
      setCurrentFrame((prev) => (prev + 1) % hold.frames);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [hold.frames, hold.fps]);

  // ---------------------------------------------------------------------------
  // WORM HOLD CANVAS RENDER LOOP
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // The offscreen scratch cell is 2x the 60x60 worm cell (120x120), with the
    // worm cell centred in it, so a weapon/hand at a large radius or a scaled-up
    // sprite is no longer clipped by the square.
    const CELL = 60;
    const SIZE = CELL * 2;
    const CELL_OFF = (SIZE - CELL) / 2;
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
      offCtx.translate(CELL_OFF + CELL, CELL_OFF);
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

    // 3b. Firing-state sprite. PX's FAMAS pattern, which the generator emits: a
    // second hold entry (`px_hold_art`) drawn in WA's firing states with the
    // same placement as the gun — same pivot, radius, rotation and `weap_scale`,
    // mirrored by the worm's facing with the rest of the cell. It has its own
    // picture, so it is drawn at its own pixel size, not stretched to the gun.
    const flashImg = flashLoadedImg || flashImgRef.current;
    if (flashLeft > 0 && flashImg && flashImg.complete && flashImg.naturalWidth > 0) {
      offCtx.save();
      offCtx.imageSmoothingEnabled = false;
      offCtx.translate(weapX, weapY);
      offCtx.rotate(weapAngle);
      offCtx.scale(scale, scale);
      offCtx.drawImage(
        flashImg,
        -flashImg.naturalWidth / 2,
        -flashImg.naturalHeight / 2
      );
      offCtx.restore();
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
    const cellY = WORM_Y - CELL_FEET_Y - CELL_OFF;

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
  }, [hold, aimAngleIndex, currentFrame, facingRight, assetsLoaded, weaponLoadedImg, defaultHoldLoaded, putAwayCounter, flashLoadedImg, flashLeft]);

  // Derive active preview role settings for the 50 Hz simulation canvas
  const activeRolePreviewCfg = (() => {
    if (activeFlightRole === 'clusters') {
      if (bitFlight.mode === 'builder') return bitFlight;
      if (bitFlight.mode === 'inherit') return missile;
      return { ...bitFlight, anim: 'rotation' as MissileAnimType, frames: 1 };
    }
    if (activeFlightRole === 'homing') {
      if (homingRole.mode === 'builder') return homingRole;
      if (homingRole.mode === 'inherit') return missile;
      return { ...homingRole, anim: 'track' as MissileAnimType, frames: 1 };
    }
    if (activeFlightRole === 'homing_bit') {
      if (homingBitRole.mode === 'builder') return homingBitRole;
      if (homingBitRole.mode === 'inherit') {
        return bitFlight.mode === 'builder' ? bitFlight : missile;
      }
      return { ...homingBitRole, anim: 'track' as MissileAnimType, frames: 1 };
    }
    if (activeFlightRole === 'roam') {
      // Own sheet: the role's own art and animation. Round's sheet: the primary
      // row is what flies (and what the export keeps), so preview that.
      if (roamRoleMode === 'builder') return roamRole;
      if (!builderOn && project.roamSheets?.flight1?.preview) {
        return {
          ...missile,
          anim: 'none' as MissileAnimType,
          frames: project.roamSheets.flight1.frames || 1,
        };
      }
      return missile;
    }
    if (activeFlightRole === 'dig') {
      if (digRoleMode === 'native') {
        return { ...DEFAULT_ROLE_ART, anim: 'track' as MissileAnimType, frames: 1 };
      }
      const ownerCfg =
        digBitEnabled && !digMainEnabled && bitFlight.mode === 'builder' ? bitFlight : missile;
      return {
        ...digRole,
        frames: digRole.frames > 1 ? digRole.frames : ownerCfg.frames || 1,
      };
    }
    return missile;
  })();

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
    let rot = animStateRef.current.rotation || 0;
    let roamLeft = animStateRef.current.roamLeft;
    let phase = animStateRef.current.phase || 0;
    let frame = animStateRef.current.frame || 0;
    let started = false;
    let lastFrameDisplay = -1;

    const stepMissile = () => {
      const anim = activeRolePreviewCfg.anim || 'rotation';
      const numFrames = Math.max(1, activeRolePreviewCfg.frames || 1);
      const userAnimSpeed = activeRolePreviewCfg.animSpeed || 1.0;
      const spinMult = activeRolePreviewCfg.spinRate || 1.0;

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
      } else if (flightMode === 'walk') {
        // The roaming animal's own two states, on one loop: it ambles in place
        // (no velocity — WA walks it, so the art has to rest), then hops (up
        // leaning back, down leaning forward). This is what makes `roam` tilt
        // readable in the editor.
        animStateRef.current.arcT = (animStateRef.current.arcT + STEP) % 1.0;
        const u = animStateRef.current.arcT;
        const baseY = height * 0.78;
        const hopStart = 0.55;
        const riding = u >= hopStart ? Math.sin(((u - hopStart) / (1 - hopStart)) * Math.PI) : 0;
        posX = width / 2;
        posY = baseY - riding * (height * 0.46) - (u < hopStart ? Math.abs(Math.sin(u * 14)) * 2 : 0);
        // A hair of vx keeps the facing stable; the hop's own slope is the tilt.
        vx = 0.02;
        vy =
          u < hopStart
            ? 0
            : -Math.cos(((u - hopStart) / (1 - hopStart)) * Math.PI) *
              (height * 0.46) *
              ((Math.PI / (1 - hopStart)) * STEP);
      } else {
        posX = width / 2;
        posY = height / 2;
        vx = baseVx;
        vy = baseVy;
      }

      // Rotation calculation. In static preview mode, smoothly rotate without
      // freezing at 90/270 degrees or strobing at 3000 deg/s.
      if (anim === 'roam') {
        // `M.roam_angle`: on the ground (Walk mode) the art holds `rest` and
        // leans at most `up`/`down` from it while the animal steps; in the air
        // it tracks the velocity exactly like `track`. Everything here is the
        // right-facing pose; the left side is a true mirror at draw time (the
        // sheet's `facing = -1` plus a negated drawn angle, as the builder
        // does). A bare mirror without the negation is a top-to-bottom flip
        // once the walking pose lies flat.
        const tilt = {
          up: Math.abs(missile.roamTilt?.up ?? DEFAULT_ROAM_TILT.up),
          down: Math.abs(missile.roamTilt?.down ?? DEFAULT_ROAM_TILT.down),
          rest: missile.roamTilt?.rest ?? DEFAULT_ROAM_TILT.rest,
        };
        const restRad = (tilt.rest * Math.PI) / 180;
        const up = (tilt.up * Math.PI) / 180;
        const down = (tilt.down * Math.PI) / 180;
        const speed = Math.hypot(vx, vy);
        const grounded = flightMode === 'walk';
        // Keep the side through a straight drop, as `roam_side` does in the
        // builder, instead of snapping back to the right. The builder only
        // mirrors when the role's Mirror toggle is on, so match that too.
        const roamMirrorOn = activeRolePreviewCfg.mirror !== false;
        if (roamMirrorOn) {
          if (vx < 0) roamLeft = true;
          else if (vx > 0) roamLeft = false;
        }
        const hx = roamMirrorOn ? Math.abs(vx) : vx;
        if (!grounded) {
          if (speed >= 0.05) rot = Math.atan2(vy, hx) + Math.PI / 2;
        } else if (speed < 0.05) {
          rot = restRad;
        } else {
          const want = Math.atan2(vy, hx) + Math.PI / 2;
          let delta = want - restRad;
          delta = Math.atan2(Math.sin(delta), Math.cos(delta));
          rot = restRad + Math.min(down, Math.max(-up, delta));
        }
      } else if (anim === 'track') {
        rot = Math.atan2(vy, vx) + Math.PI / 2;
      } else if (flightMode === 'static') {
        const dir = baseVx < 0 ? -1 : 1;
        if (anim === 'rotation') {
          rot += dir * spinMult * 0.08 * Math.max(0.3, flightSpeed / 14);
        } else if (anim === 'slow' || anim === 'medium' || anim === 'fast') {
          rot += dir * (ANIM_SPEED_TABLE[anim] || 0.5) * spinMult * 0.1;
        } else {
          rot = 0;
        }
      } else {
        const signVx = vx > 0 ? 1 : vx < 0 ? -1 : 0;
        const effSignVx = signVx || (activeFlightRole === 'dig' ? 1 : 0);
        const effVx = activeFlightRole === 'dig' && vx === 0 && vy !== 0 ? 0.001 : vx;
        if (anim === 'rotation') {
          rot += spinMult * 0.5 * (effVx * 0.15 + Math.abs(vy) * 0.01 * effSignVx);
        } else if (anim === 'slow' || anim === 'medium' || anim === 'fast') {
          rot += (ANIM_SPEED_TABLE[anim] || 0.5) * spinMult * 0.5 * effSignVx;
        } else {
          rot = 0;
        }
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
      animStateRef.current.roamLeft = roamLeft;
      animStateRef.current.drumTime = (animStateRef.current.drumTime + STEP) % 1.0;
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

      const anim = activeRolePreviewCfg.anim || 'rotation';
      const numFrames = Math.max(1, activeRolePreviewCfg.frames || 1);
      const scaleMult = (activeRolePreviewCfg.scale || 1.0) * (missile.size ?? 1);
      const mirror = activeRolePreviewCfg.mirror !== false;
      // `anim = roam` walks left as a true horizontal mirror: the sheet is
      // mirrored (`facing = -1`) and the whole drawn angle is negated. A bare
      // mirror, or a bare angle turn, is a top-to-bottom flip once the walk
      // lies flat. This is exactly the builder's `roam_side` pose.
      const roamAnim = anim === 'roam';
      const roamMirror = roamAnim && mirror && roamLeft;
      const facing = roamAnim ? (roamMirror ? -1 : 1) : mirror && vx < 0 ? -1 : 1;
      // `angle` is added to the drawn rotation, negated on a mirrored sheet (or
      // on a left-mirrored roam pose), as the builder does it.
      const angleOffset =
        (((missile.angle ?? 0) * Math.PI) / 180) * (roamMirror || facing < 0 ? -1 : 1);
      const drawRot = roamMirror ? -rot : rot;

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
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(posX, posY);
        ctx.lineTo(posX + vx * 2.5, posY + vy * 2.5);
        ctx.stroke();
        ctx.restore();
      }

      // Animated oil drum scale reference (`spec/oildrum1.png`, 20 frames @ 20 fps,
      // 90x90 cells with visible body at x=33..56, y=24..59) drawn at 1:1 WA scale
      // (`zoom / 4`) in the bottom-right corner so projectile size/scale is clear.
      if (
        showDrumRef &&
        oildrumLoadedImg &&
        oildrumLoadedImg.complete &&
        oildrumLoadedImg.naturalWidth > 0
      ) {
        const drumFrames = 20;
        const cellW = oildrumLoadedImg.naturalWidth;
        const cellH = oildrumLoadedImg.naturalHeight / drumFrames;
        const drumFrame = Math.floor(animStateRef.current.drumTime * 20) % drumFrames;
        const drumScale = missileZoom / 4;
        const dx = Math.round(width - 10 - 57 * drumScale);
        const dy = Math.round(height - 16 - 60 * drumScale);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          oildrumLoadedImg,
          0,
          drumFrame * cellH,
          cellW,
          cellH,
          dx,
          dy,
          cellW * drumScale,
          cellH * drumScale
        );
        ctx.fillStyle = 'rgba(226, 232, 240, 0.55)';
        ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textAlign = 'right';
        ctx.fillText('oildrum 1×', width - 8, height - 5);
        ctx.restore();
      }

      // Draw Missile Sprite
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(posX, posY);
      ctx.rotate(drawRot + angleOffset);

      // `b.facing = mirror and (m.vx < 0 and -1 or 1) or 1`; a roam pose uses
      // its remembered side instead (`roamMirror`).
      const zoom = missileZoom;
      ctx.scale(facing * scaleMult * (zoom / 4), scaleMult * (zoom / 4));

      const activeImg =
        activeFlightRole === 'primary'
          ? missileImgRef.current
          : roleLoadedImg || roleImgRef.current;

      if (activeImg && activeImg.complete && activeImg.naturalWidth > 0) {
        // PX sheets are vertical strips of frames.
        const frameHeight = activeImg.naturalHeight / numFrames;
        const frameWidth = activeImg.naturalWidth;
        const sy = frame * frameHeight;

        ctx.drawImage(
          activeImg,
          0,
          sy,
          frameWidth,
          frameHeight,
          -frameWidth / 2,
          -frameHeight / 2,
          frameWidth,
          frameHeight
        );
      } else if (
        (activeFlightRole === 'primary' ||
          (activeFlightRole === 'clusters' && bitFlight.mode === 'inherit') ||
          (activeFlightRole === 'homing' && homingRole.mode === 'inherit') ||
          (activeFlightRole === 'homing_bit' &&
            homingBitRole.mode === 'inherit' &&
            bitFlight.mode === 'inherit') ||
          (activeFlightRole === 'roam' && roamRoleMode === 'builder') ||
          (activeFlightRole === 'dig' &&
            digRoleMode !== 'native' &&
            (!digBitEnabled || digMainEnabled || bitFlight.mode === 'inherit'))) &&
        defaultMissileLoaded &&
        defaultMissileLoaded.complete &&
        defaultMissileLoaded.naturalWidth > 0
      ) {
        ctx.drawImage(
          defaultMissileLoaded,
          -defaultMissileLoaded.naturalWidth / 2,
          -defaultMissileLoaded.naturalHeight / 2
        );
      } else {
        // Fallback stylized procedural missile art tailored per role
        renderProceduralMissile(ctx, anim, frame, activeFlightRole);
      }

      ctx.restore();

      animationFrameId = requestAnimationFrame(renderMissile);
    };

    animationFrameId = requestAnimationFrame(renderMissile);
    return () => cancelAnimationFrame(animationFrameId);
  }, [
    missile,
    bitFlight,
    homingRole,
    homingBitRole,
    digRole,
    digRoleMode,
    digMainEnabled,
    digBitEnabled,
    activeFlightRole,
    builderOn,
    roamRoleMode,
    roamRole.sheetPreview,
    roamRole.anim,
    roamRole.frames,
    roamRole.animSpeed,
    roamRole.spinRate,
    roamRole.scale,
    roamRole.mirror,
    roamRole.z,
    project.roamSheets?.flight1?.frames,
    project.roamSheets?.flight1?.preview,
    roleLoadedImg,
    isMissilePlaying,
    missileZoom,
    flightAngleDeg,
    flightSpeed,
    flightMode,
    backdropTheme,
    defaultMissileLoaded,
    showDrumRef,
    oildrumLoadedImg,
  ]);

  // Fallback high-contrast pixelated missile graphic per role
  const renderProceduralMissile = (
    ctx: CanvasRenderingContext2D,
    animType: MissileAnimType,
    frame: number,
    role: FlightSlotRole
  ) => {
    if (role === 'homing') {
      ctx.fillStyle = '#2563eb';
      ctx.beginPath();
      ctx.moveTo(0, -15);
      ctx.lineTo(6, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#1d4ed8';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = frame % 2 === 0 ? '#60a5fa' : '#93c5fd';
      ctx.beginPath();
      ctx.arc(0, 8, 3, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (role === 'homing_bit') {
      ctx.fillStyle = '#4f46e5';
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.lineTo(4.5, 4);
      ctx.lineTo(0, 2);
      ctx.lineTo(-4.5, 4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#312e81';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = frame % 2 === 0 ? '#a5b4fc' : '#38bdf8';
      ctx.beginPath();
      ctx.arc(0, 6, 2.5, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (role === 'clusters') {
      ctx.fillStyle = '#9333ea';
      ctx.beginPath();
      ctx.ellipse(0, 0, 5.5, 7.5, Math.PI / 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#6b21a8';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(-1.5, -2, 2.2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (role === 'roam') {
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.moveTo(-3, -2);
      ctx.lineTo(-11, 9);
      ctx.lineTo(-1, 6);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#f5f5f4';
      ctx.beginPath();
      ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#27272a';
      ctx.beginPath();
      ctx.arc(5, -3, 3.2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (role === 'dig') {
      ctx.fillStyle = '#ea580c';
      ctx.beginPath();
      ctx.moveTo(0, -15);
      ctx.lineTo(6.5, 0);
      ctx.lineTo(4.5, 10);
      ctx.lineTo(-4.5, 10);
      ctx.lineTo(-6.5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#9a3412';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.strokeStyle = frame % 2 === 0 ? '#fde047' : '#fed7aa';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-4, -4);
      ctx.lineTo(4, -7);
      ctx.moveTo(-5, 2);
      ctx.lineTo(5, -1);
      ctx.stroke();
      return;
    }

    // PX sheets point up natively; the fallback art does too so the preview
    // shows the same rotation the engine will apply.
    if (animType === 'rotation') {
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 11, Math.PI / 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#991b1b';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#eab308';
      ctx.fillRect(-2, -14, 4, 4);

      ctx.fillStyle = '#fca5a5';
      ctx.fillRect(-2, -6, 3, 6);
    } else if (animType === 'track') {
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(6, 6);
      ctx.lineTo(0, 4);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#991b1b';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = frame % 2 === 0 ? '#38bdf8' : '#f59e0b';
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
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
  const handleUploadSheet = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    // `px_hold_art` (sequential fire) draws a quad of the sheet's pixel cell,
    // so keep the natural size beside the file.
    let sheetWidth: number | undefined;
    let sheetHeight: number | undefined;
    try {
      const px = await imagePixelSize(previewUrl);
      sheetWidth = px.width;
      sheetHeight = px.height;
    } catch {
      // The preview will show whatever the browser can draw; the size falls
      // back to the stock art's, like an imported project.
    }
    updateHold({
      enabled: true,
      sheetFile: file,
      sheetPreview: previewUrl,
      sheetWidth,
      sheetHeight,
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
      sheetWidth: undefined,
      sheetHeight: undefined,
      sheet: '',
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUploadFlash = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    let flashWidth: number | undefined;
    let flashHeight: number | undefined;
    try {
      const px = await imagePixelSize(previewUrl);
      flashWidth = px.width;
      flashHeight = px.height;
    } catch {
      // The browser still draws it; the cell just falls back to square.
    }
    updateHold({
      enabled: true,
      flashFile: file,
      flashPreview: previewUrl,
      flashWidth,
      flashHeight,
      flashFrames: Math.max(1, Math.round(hold.flashFrames ?? 3)),
      flashOut: hold.flashOut ?? 0,
      flashSide: hold.flashSide ?? 0,
      flashScale: hold.flashScale ?? 1,
    });
  };

  const removeFlash = () => {
    if (hold.flashPreview) URL.revokeObjectURL(hold.flashPreview);
    setFlashLoadedImg(null);
    setFlashLeft(0);
    updateHold({
      flashFile: undefined,
      flashPreview: undefined,
      flashWidth: undefined,
      flashHeight: undefined,
    });
    if (flashFileInputRef.current) flashFileInputRef.current.value = '';
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

  const handleUploadRoleSheet = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    if (activeFlightRole === 'clusters') {
      if (bitFlight.sheetPreview) URL.revokeObjectURL(bitFlight.sheetPreview);
      updateBitFlight({ sheetFile: file, sheetPreview: previewUrl, mode: 'builder' });
    } else if (activeFlightRole === 'homing') {
      if (homingRole.sheetPreview) URL.revokeObjectURL(homingRole.sheetPreview);
      updateBehaviorArt('homing', { sheetFile: file, sheetPreview: previewUrl, mode: 'builder' });
    } else if (activeFlightRole === 'homing_bit') {
      if (homingBitRole.sheetPreview) URL.revokeObjectURL(homingBitRole.sheetPreview);
      updateBehaviorArt('homing_bit', { sheetFile: file, sheetPreview: previewUrl, mode: 'builder' });
    } else if (activeFlightRole === 'roam') {
      if (roamRole.sheetPreview) URL.revokeObjectURL(roamRole.sheetPreview);
      updateBehaviorArt('roam', { sheetFile: file, sheetPreview: previewUrl, mode: 'builder' });
    }
  };

  const removeCustomRoleSheet = () => {
    if (activeFlightRole === 'clusters') {
      if (bitFlight.sheetPreview) URL.revokeObjectURL(bitFlight.sheetPreview);
      updateBitFlight({ sheetFile: undefined, sheetPreview: undefined, mode: 'native' });
    } else if (activeFlightRole === 'homing') {
      if (homingRole.sheetPreview) URL.revokeObjectURL(homingRole.sheetPreview);
      updateBehaviorArt('homing', { sheetFile: undefined, sheetPreview: undefined, mode: 'native' });
    } else if (activeFlightRole === 'homing_bit') {
      if (homingBitRole.sheetPreview) URL.revokeObjectURL(homingBitRole.sheetPreview);
      updateBehaviorArt('homing_bit', { sheetFile: undefined, sheetPreview: undefined, mode: 'native' });
    } else if (activeFlightRole === 'roam') {
      if (roamRole.sheetPreview) URL.revokeObjectURL(roamRole.sheetPreview);
      // Back to the round's own sheet: the roam role only exists when it owns art.
      updateBehaviorArt('roam', { sheetFile: undefined, sheetPreview: undefined, mode: 'inherit' });
    }
    if (roleFileInputRef.current) roleFileInputRef.current.value = '';
  };

  // Accurate `sb.flight` Lua preview matching `luaGenerator.ts`
  const roleRowsForPreview = (r: FlightRoleArt, indent: string) => {
    const out: string[] = [`${indent}anim = "${r.anim || 'rotation'}",`];
    if ((r.frames || 1) > 1) out.push(`${indent}cyclical = ${r.frames},`);
    if (r.animSpeed && r.animSpeed !== 1) out.push(`${indent}anim_speed = ${r.animSpeed},`);
    if (r.spinRate && r.spinRate !== 1) out.push(`${indent}spin = ${r.spinRate},`);
    if (r.scale && r.scale !== 1) out.push(`${indent}scale = ${r.scale},`);
    if (r.mirror === false) out.push(`${indent}mirror = false,`);
    if (r.z !== undefined && r.z !== 5) out.push(`${indent}z = ${r.z},`);
    return out;
  };

  const homingBuilderOn =
    builderOn && hasPrimaryHoming && (behaviorArt.homing?.mode ?? 'native') === 'builder';
  const bitHomingBuilderOn =
    builderOn &&
    bitBuilderMode(project) === 'builder' &&
    hasBitHoming &&
    (behaviorArt.homing_bit?.mode ?? 'native') === 'builder';
  const digActiveInBuilder =
    builderOn &&
    digRoleMode !== 'native' &&
    (digMainEnabled || (digBitEnabled && bitBuilderMode(project) !== null));

  const sbFlightLuaPreview = (() => {
    if (isAirStrike) {
      return `-- Air strikes use native strike munitions (no sb.flight path).\n-- Configure the body sprite in Pack Art / Record Editor.`;
    }
    const modLines: string[] = [
      `-- inside install, after wa.weapons.replace{ ... }`,
      `sb.flight(ctx, {`,
      `  weapon = ctx.id,`,
      `  sheet = "${missileFlightSheetPath(project)}",`,
      `  anim = "${missile.anim || 'rotation'}",`,
    ];
    if ((missile.frames || 1) > 1) modLines.push(`  cyclical = ${missile.frames},`);
    if (missile.animSpeed && missile.animSpeed !== 1) modLines.push(`  anim_speed = ${missile.animSpeed},`);
    if (missile.spinRate && missile.spinRate !== 1) modLines.push(`  spin = ${missile.spinRate},`);
    if (missile.scale && missile.scale !== 1) modLines.push(`  scale = ${missile.scale},`);
    if (missile.mirror === false) modLines.push(`  mirror = false,`);
    if (missile.z !== undefined && missile.z !== 5) modLines.push(`  z = ${missile.z},`);
    if (missile.size !== undefined && missile.size !== 1) modLines.push(`  size = ${missile.size},`);
    if (missile.angle) modLines.push(`  angle = ${missile.angle},`);

    if (clustersEnabled && bitFlight.mode === 'builder') {
      modLines.push(`  bits = {`);
      modLines.push(`    sheet = "${bitFlightSheetPath(project)}",`);
      modLines.push(...roleRowsForPreview(bitFlight, '    '));
      if (bitHomingBuilderOn && behaviorArt.homing_bit) {
        modLines.push(`    homing = {`);
        modLines.push(`      sheet = "${behaviorStateSheetPath(project, 'homing_bit')}",`);
        modLines.push(
          `      arm = ${project.body.clustlet.homing_arm_ms ?? 0}, time = ${project.body.clustlet.homing_time_ms ?? 0},`,
        );
        modLines.push(...roleRowsForPreview(behaviorArt.homing_bit, '      '));
        modLines.push(`    },`);
      }
      modLines.push(`  },`);
    } else if (clustersEnabled && bitFlight.mode === 'inherit') {
      modLines.push(`  bits = "inherit",`);
    }

    if (homingBuilderOn && behaviorArt.homing) {
      modLines.push(`  homing = {`);
      modLines.push(`    sheet = "${behaviorStateSheetPath(project, 'homing')}",`);
      modLines.push(
        `    arm = ${project.body.homing_arm_ms ?? 0}, time = ${project.body.homing_time_ms ?? 0},`,
      );
      modLines.push(...roleRowsForPreview(behaviorArt.homing, '    '));
      modLines.push(`  },`);
    }

    if (digActiveInBuilder) {
      const digRows = digArtOverrideRows(project.behaviorArt?.dig, '    ');
      if (digRows.length > 0) {
        modLines.push(`  dig = {`);
        modLines.push(...digRows);
        modLines.push(`  },`);
      } else {
        modLines.push(`  dig = true,`);
      }
    }
    if (roamEnabled) {
      const roamWalkPose = roamWalkPoseId(
        project.recordOverrides['missile.sprite'] ?? project.body.sprite,
      );
      if (roamRoleMode === 'builder') {
        modLines.push(`  roam = {`);
        modLines.push(`    sheet = "${behaviorStateSheetPath(project, 'roam')}",`);
        modLines.push(...roleRowsForPreview(roamRole, '    '));
        modLines.push(
          roamWalkPose !== 0
            ? `    walk = ${roamWalkPose}, fly = ${ROAM_FLY_SENTINEL},`
            : `    fly = ${ROAM_FLY_SENTINEL},`,
        );
        modLines.push(`  },`);
      } else {
        modLines.push(
          roamWalkPose !== 0
            ? `  roam = { walk = ${roamWalkPose}, fly = ${ROAM_FLY_SENTINEL} },`
            : `  roam = true,`,
        );
      }
    }
    if (project.missileSprite.logIdentity) modLines.push(`  log = true,`);
    modLines.push(`})`);
    return modLines.join('\n');
  })();

  const handleCopySbLua = async () => {
    try {
      await navigator.clipboard.writeText(sbFlightLuaPreview);
      setCopiedSbLua(true);
      setTimeout(() => setCopiedSbLua(false), 1800);
    } catch {
      // Fallback if clipboard API is unavailable
    }
  };

  return (
    <div className="space-y-8">
      {/* ======================================================================= */}
      {/* 1. WORM HOLD & AIM POSTURE SECTION                                       */}
      {/* ======================================================================= */}
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 shadow-xs transition-colors">
        {/* Header */}
        <div className="pb-3 mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-base font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
              Worm Aim & Hold Art Builder
            </h2>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-forge-50 dark:bg-forge-950/60 text-forge-600 dark:text-forge-400 font-semibold border border-forge-200 dark:border-forge-800/60">
              Native aim.png & hand_rad Assets
            </span>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
            Genuine Worms Armageddon 32-angle aim postures with authentic hand radius and weapon pivot positioning.
          </p>
        </div>

        {/* Row 2: Held Sprite Sheet Bar + Enable Custom Held Art Pill */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-5">
          {/* Bordered Bar */}
          <div className="flex-1 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 px-3.5 py-2 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40 min-w-0">
            <div className="flex items-center gap-2 min-w-0 truncate">
              <Upload className="w-4 h-4 text-forge-600 dark:text-forge-400 shrink-0" />
              <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide shrink-0">
                Held Sprite Sheet
              </span>
              {hold.sheetFile ? (
                <span
                  className="font-mono text-xs text-forge-600 dark:text-forge-400 font-medium truncate"
                  title={`${hold.sheetFile.name} (${(hold.sheetFile.size / 1024).toFixed(1)} KB)`}
                >
                  {hold.sheetFile.name} ({(hold.sheetFile.size / 1024).toFixed(1)} KB)
                </span>
              ) : (
                <span
                  className="text-xs text-stone-500 dark:text-stone-400 truncate"
                  title={`Using default ${defaultArt.label} art`}
                >
                  Using default {defaultArt.label} art
                </span>
              )}
              {hold.sheetPreview && (
                <button
                  type="button"
                  onClick={removeCustomSheet}
                  className="text-xs text-rose-500 hover:text-rose-600 font-medium shrink-0 ml-1 cursor-pointer"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="shrink-0">
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
                className="px-3 py-1.5 text-xs font-semibold text-stone-800 dark:text-stone-200 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-700 shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-forge-600 dark:text-forge-400" />
                <span>{hold.sheetFile ? 'Change PNG Sheet' : 'Upload PNG'}</span>
              </button>
            </div>
          </div>

          {/* Bordered Pill with Enable Custom Held Art */}
          <label
            htmlFor="hold-enable-custom-art"
            className="flex items-center gap-2 cursor-pointer bg-white dark:bg-stone-800 px-3.5 py-2.5 rounded-xl border border-stone-200 dark:border-stone-700 shadow-2xs shrink-0 self-start sm:self-auto"
          >
            <input
              id="hold-enable-custom-art"
              type="checkbox"
              checked={hold.enabled}
              onChange={(e) => updateHold({ enabled: e.target.checked })}
              className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4 cursor-pointer"
            />
            <span className="text-xs font-semibold text-stone-900 dark:text-stone-100 whitespace-nowrap">
              Enable Custom Held Art
            </span>
          </label>
        </div>

        {/* 3-Column Main Area: lg:grid-cols-[1fr_1.4fr_1.9fr] */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr_1.9fr] gap-4 items-start">
          {/* LEFT COLUMN: Hand controls (order-3 on mobile, order-1 on lg) */}
          <div className="order-3 lg:order-1 flex flex-col gap-4">
            {/* Draw Hand checkbox card + Hand Type cycling box */}
            <div className="grid grid-cols-2 gap-3 items-end">
              <label
                htmlFor="hold-draw-hand"
                className="h-10 flex items-center justify-between px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 cursor-pointer shadow-2xs hover:bg-stone-50 dark:hover:bg-stone-750 transition-colors"
              >
                <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 select-none">
                  Draw Hand
                </span>
                <input
                  id="hold-draw-hand"
                  type="checkbox"
                  checked={hold.drawHand !== false}
                  onChange={(e) => updateHold({ drawHand: e.target.checked })}
                  className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4 cursor-pointer"
                />
              </label>

              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                  Hand Type
                </span>
                <button
                  type="button"
                  onClick={cycleHandType}
                  aria-label={`Hand type: ${currentHandTypeLabel}. Click to change`}
                  title={`Hand type: ${currentHandTypeLabel}. Click to change`}
                  className="h-10 px-3 flex items-center justify-center text-xs font-semibold rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 hover:bg-stone-50 dark:hover:bg-stone-750 transition-colors shadow-2xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forge-500"
                >
                  {currentHandTypeLabel}
                </button>
              </div>
            </div>

            {/* Hand Scale Multiplier Slider */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-xs">
                <label htmlFor="hold-hand-scale" className="font-semibold text-stone-700 dark:text-stone-300">
                  Hand Scale Multiplier
                </label>
                <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">
                  {(hold.handScale ?? 1).toFixed(2)}x
                </span>
              </div>
              <input
                id="hold-hand-scale"
                type="range"
                min={0.5}
                max={2.0}
                step={0.05}
                value={hold.handScale ?? 1}
                onChange={(e) => updateHold({ handScale: Number(e.target.value) })}
                className="w-full accent-forge-500 cursor-pointer"
              />
            </div>

            {/* Hand Radius Slider */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-xs">
                <label htmlFor="hold-hand-radius" className="font-semibold text-stone-700 dark:text-stone-300">
                  Hand Radius
                </label>
                <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">
                  {hold.handRadius} px
                </span>
              </div>
              <input
                id="hold-hand-radius"
                type="range"
                min={-35}
                max={35}
                step={1}
                value={hold.handRadius}
                onChange={(e) => updateHold({ handRadius: Number(e.target.value) })}
                className="w-full accent-forge-500 cursor-pointer"
              />
            </div>
          </div>

          {/* CENTER COLUMN: Canvas + Posture + Flip (order-1 on mobile, order-2 on lg) */}
          <div className="order-1 lg:order-2 flex flex-col items-center gap-3 w-full">
            {/* 600x600 Pixel-Perfect Canvas Viewport */}
            <div className="relative w-full max-w-[600px] aspect-square border-2 border-stone-800 rounded-xl overflow-hidden shadow-lg bg-stone-950">
              <canvas
                ref={canvasRef}
                width={600}
                height={600}
                className="block w-full h-full cursor-crosshair"
                style={{ imageRendering: 'pixelated' }}
              />

              <div className="absolute top-2 left-2 flex items-center gap-1.5 text-[10px] font-mono bg-black/70 backdrop-blur-xs text-stone-300 px-2 py-0.5 rounded border border-white/10">
                <span>Aim Angle: {aimAngleIndex}/31</span>
                <span>·</span>
                <span>{aimAngleIndex === 16 ? 'Horizontal' : aimAngleIndex < 16 ? 'Down' : 'Up'}</span>
              </div>
            </div>

            {/* Worm Posture Card (0 to 31) */}
            <div className="w-full max-w-[600px] space-y-1.5 bg-stone-50 dark:bg-stone-800/50 p-3 rounded-lg border border-stone-200 dark:border-stone-800">
              <div className="flex items-center justify-between text-xs font-medium text-stone-700 dark:text-stone-300">
                <label htmlFor="hold-aim-angle" className="font-semibold">
                  Worm Posture (0–31)
                </label>
                <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">{aimAngleIndex}</span>
              </div>
              <input
                id="hold-aim-angle"
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

            {/* Flip Button */}
            <button
              type="button"
              onClick={() => setFacingRight(!facingRight)}
              aria-label={`Flip worm facing direction. Currently facing ${facingRight ? 'Right' : 'Left'}`}
              className="w-full max-w-[600px] flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-700 shadow-2xs transition-colors cursor-pointer"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span>Flip ({facingRight ? 'Right' : 'Left'})</span>
            </button>
          </div>

          {/* RIGHT COLUMN: Controls & Properties (order-2 on mobile, order-3 on lg) */}
          <div className="order-2 lg:order-3 flex flex-col gap-4">
            {/* Row: Launchable / Throwable buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => updateHold({ thrown: false, putAway: true })}
                title="Guns & bazookas (thrown = false). Held in hands; weapon can swing down into backpack on retreat."
                aria-label="Launchable: Guns and bazookas (thrown = false). Held in hands; weapon can swing down into backpack on retreat."
                className={`h-10 px-3 flex items-center justify-center text-xs rounded-lg border transition-all cursor-pointer ${
                  !hold.thrown
                    ? 'border-forge-500 bg-forge-50/40 dark:bg-forge-950/40 ring-1 ring-forge-500 text-stone-900 dark:text-white font-bold shadow-xs'
                    : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-medium hover:bg-stone-50 dark:hover:bg-stone-750'
                }`}
              >
                Launchable
              </button>
              <button
                type="button"
                onClick={() => updateHold({ thrown: true, putAway: false })}
                title="Grenades & bananas (thrown = true). Leaves worm hand instantly on release; skips gun put-away."
                aria-label="Throwable: Grenades and bananas (thrown = true). Leaves worm hand instantly on release; skips gun put-away."
                className={`h-10 px-3 flex items-center justify-center text-xs rounded-lg border transition-all cursor-pointer ${
                  hold.thrown
                    ? 'border-forge-500 bg-forge-50/40 dark:bg-forge-950/40 ring-1 ring-forge-500 text-stone-900 dark:text-white font-bold shadow-xs'
                    : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-medium hover:bg-stone-50 dark:hover:bg-stone-750'
                }`}
              >
                Throwable
              </button>
            </div>

            {/* Row: Weapon Radius and Weapon Rotation side-by-side */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="flex justify-between items-center text-xs">
                  <label htmlFor="hold-weap-radius" className="font-semibold text-stone-700 dark:text-stone-300">
                    Weapon Radius
                  </label>
                  <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">
                    {hold.weapRadius} px
                  </span>
                </div>
                <input
                  id="hold-weap-radius"
                  type="range"
                  min={-35}
                  max={35}
                  step={1}
                  value={hold.weapRadius}
                  onChange={(e) => updateHold({ weapRadius: Number(e.target.value) })}
                  className="w-full accent-forge-500 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center text-xs">
                  <label htmlFor="hold-weap-rotation" className="font-semibold text-stone-700 dark:text-stone-300">
                    Weapon Rotation
                  </label>
                  <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">
                    {hold.weapRotation}°
                  </span>
                </div>
                <input
                  id="hold-weap-rotation"
                  type="range"
                  min={-180}
                  max={180}
                  step={5}
                  value={hold.weapRotation}
                  onChange={(e) => updateHold({ weapRotation: Number(e.target.value) })}
                  className="w-full accent-forge-500 cursor-pointer"
                />
              </div>
            </div>

            {/* Scale Multiplier Slider */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-xs">
                <label htmlFor="hold-scale" className="font-semibold text-stone-700 dark:text-stone-300">
                  Scale Multiplier
                </label>
                <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">
                  {hold.scale}x
                </span>
              </div>
              <input
                id="hold-scale"
                type="range"
                min={0.5}
                max={2.5}
                step={0.1}
                value={hold.scale}
                onChange={(e) => updateHold({ scale: Number(e.target.value) })}
                className="w-full accent-forge-500 cursor-pointer"
              />
            </div>

            {/* Row: Animate Put-Away and Keep While Firing checkboxes */}
            <div className="grid grid-cols-2 gap-3">
              <div
                title="Gun swings down and smoothly shrinks into backpack during retreat/walking (survives WA state 0x65 & 0x66) (put_away = true)"
                className={`h-10 flex items-center justify-between px-3 rounded-lg border transition-colors ${
                  hold.thrown
                    ? 'opacity-50 cursor-not-allowed border-stone-200 dark:border-stone-800 bg-stone-100/50 dark:bg-stone-900/50'
                    : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <label
                    htmlFor="hold-put-away"
                    className={`text-xs font-semibold text-stone-800 dark:text-stone-200 select-none ${
                      hold.thrown ? 'cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  >
                    Animate Put-Away
                  </label>
                  {hold.putAway && !hold.thrown && (
                    <button
                      type="button"
                      disabled={putAwayCounter !== null}
                      onClick={triggerPutAwayDemo}
                      title="Test put-away in preview canvas (0x65)"
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 cursor-pointer disabled:opacity-50 shrink-0"
                    >
                      {putAwayCounter !== null ? '...' : 'Test'}
                    </button>
                  )}
                </div>
                <input
                  id="hold-put-away"
                  type="checkbox"
                  disabled={hold.thrown}
                  checked={hold.putAway && !hold.thrown}
                  onChange={(e) => updateHold({ putAway: e.target.checked })}
                  className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4 cursor-pointer shrink-0 ml-2"
                />
              </div>

              <label
                htmlFor="hold-keep-firing"
                title="Weapon remains held and visible in worm hand throughout WA firing poses 0x6A & 0x6B (e.g. Crossbows, Miniguns) (keep_while_firing = true)"
                className="h-10 flex items-center justify-between px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 cursor-pointer shadow-2xs hover:bg-stone-50 dark:hover:bg-stone-750 transition-colors"
              >
                <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 select-none">
                  Keep While Firing
                </span>
                <input
                  id="hold-keep-firing"
                  type="checkbox"
                  checked={hold.keepWhileFiring}
                  onChange={(e) => updateHold({ keepWhileFiring: e.target.checked })}
                  className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4 cursor-pointer shrink-0 ml-2"
                />
              </label>
            </div>

            {/* Hold Animation Card */}
            <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-2.5">
              <div className="text-center">
                <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wider">
                  Hold Animation
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1 text-center">
                  <label htmlFor="hold-total-frames" className="block text-xs font-medium text-stone-600 dark:text-stone-400">
                    Total Frames
                  </label>
                  <NumberInput
                    id="hold-total-frames"
                    min={1}
                    max={64}
                    value={hold.frames}
                    onChange={(e) => updateHold({ frames: Math.max(1, Number(e.target.value)) })}
                    className="w-full text-xs font-mono text-center px-2 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1 text-center">
                  <label
                    htmlFor="hold-fps"
                    className="block text-xs font-medium text-stone-600 dark:text-stone-400"
                    title="In-game FPS: the engine advances 1.5 × frames × anim_speed frames per second"
                  >
                    FPS
                  </label>
                  <NumberInput
                    id="hold-fps"
                    min={1}
                    max={60}
                    value={hold.fps}
                    title="In-game FPS: the engine advances 1.5 × frames × anim_speed frames per second"
                    onChange={(e) => updateHold({ fps: Math.max(1, Number(e.target.value)) })}
                    className="w-full text-xs font-mono text-center px-2 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1 text-center">
                  <span className="block text-xs font-medium text-stone-600 dark:text-stone-400">
                    Current
                  </span>
                  <div className="w-full text-xs font-mono text-center px-2 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-semibold">
                    {currentFrame + 1} / {Math.max(1, hold.frames)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Firing-state sprite: `hold.flash`. The engine draws it over the worm
            on WA's firing states, at the gun's muzzle. */}
        <div className="mt-4 p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wider">
                Firing Sprite (`hold.flash`)
              </span>
              <p className="mt-0.5 max-w-2xl text-[11px] text-stone-500 dark:text-stone-400">
                Optional still drawn over the worm while WA is in its firing states
                (0x6A / 0x6B), at the gun&apos;s muzzle — a muzzle flash, or an extra
                overlay on the firing frame. It only shows while{' '}
                <span className="font-mono">keep_while_firing</span> holds the gun on those
                frames.
              </p>
              {hold.flashFile && !hold.keepWhileFiring && (
                <p className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  Turn on “Keep While Firing” above, or WA hides the hold (and this sprite)
                  on the firing frames.
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {hold.flashPreview && (
                <button
                  type="button"
                  onClick={triggerFireDemo}
                  disabled={flashLeft > 0}
                  title="Light the flash in the preview for frames + 1 ticks (20 ms each)"
                  className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900/50"
                >
                  {flashLeft > 0 ? 'Firing…' : 'Test fire'}
                </button>
              )}
              <input
                ref={flashFileInputRef}
                type="file"
                accept="image/png,image/gif"
                onChange={handleUploadFlash}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => flashFileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-800 shadow-2xs hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
              >
                <Upload className="h-3.5 w-3.5 text-forge-600 dark:text-forge-400" />
                {hold.flashFile ? 'Change PNG' : 'Upload PNG'}
              </button>
              {hold.flashPreview && (
                <button
                  type="button"
                  onClick={removeFlash}
                  className="text-xs font-medium text-rose-500 hover:text-rose-600"
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          {hold.flashPreview && (
            <p className="rounded-lg border border-stone-200 bg-white/70 px-2.5 py-2 text-[11px] text-stone-600 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-400">
              Drawn like PX&apos;s FAMAS firing sheet: the same pivot, radius, rotation and
              scale as the held art above, on WA&apos;s two firing frames (0x6A / 0x6B) — so
              it needs no offset or scale of its own. Its own picture is drawn at its own
              pixel size; a <span className="font-mono">90×90</span> sheet with the gun is
              the usual case.
            </p>
          )}
        </div>
      </div>

      {/* ======================================================================= */}
      {/* 2. MISSILE / PROJECTILE FLIGHT SPRITE BUILDER (wfws_sprite_builder.lua) */}
      {/* ======================================================================= */}
      {(() => {
        const hotbarSlots: {
          id: FlightSlotRole;
          slotNum: number;
          label: string;
          icon: string;
          badge: string;
          title: string;
          desc: string;
          enabled: boolean;
          disabledHint: string;
          activeClass: string;
          bannerClass: string;
          pillClass: string;
        }[] = [
          {
            id: 'primary',
            slotNum: 1,
            label: 'Main',
            icon: normalIconSrc,
            badge: 'Primary Round (normal.png)',
            title: 'Editing Role: Primary Missile',
            desc: 'Initial flight round fired from the launcher. All secondary phases (homing, cluster bits, dig state) build on top of this.',
            enabled: true,
            disabledHint: '',
            activeClass:
              'border-amber-500 bg-amber-500/15 ring-2 ring-amber-500/70 shadow-sm',
            bannerClass:
              'border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/25 text-amber-900 dark:text-amber-200',
            pillClass:
              'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800',
          },
          {
            id: 'homing',
            slotNum: 2,
            label: 'Home',
            icon: homingIconSrc,
            badge: 'Primary Homing (hmissil1.png)',
            title: 'Editing Role: Primary Homing Guidance',
            desc: 'Timed guidance art swapped into the main round between homing arm delay and expiry, zeroing WA’s missile.homing.sprite.',
            enabled: hasPrimaryHoming,
            disabledHint: 'Requires Missile Action = Homing in Record Editor',
            activeClass:
              'border-sky-500 bg-sky-500/15 ring-2 ring-sky-500/70 shadow-sm',
            bannerClass:
              'border-sky-200 dark:border-sky-800/60 bg-sky-50/70 dark:bg-sky-950/25 text-sky-900 dark:text-sky-200',
            pillClass:
              'bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border-sky-300 dark:border-sky-800',
          },
          {
            id: 'clusters',
            slotNum: 3,
            label: 'Bits',
            icon: clustersIconSrc,
            badge: 'Cluster Bits (clusters.png)',
            title: 'Editing Role: Cluster Bits Payload',
            desc: 'Child bomblets spawned when the primary round bursts. Can use their own sheet, inherit primary art, or stay native.',
            enabled: clustersEnabled,
            disabledHint: 'Requires Burst Payload = Clusters in Record Editor',
            activeClass:
              'border-purple-500 bg-purple-500/15 ring-2 ring-purple-500/70 shadow-sm',
            bannerClass:
              'border-purple-200 dark:border-purple-800/60 bg-purple-50/70 dark:bg-purple-950/25 text-purple-900 dark:text-purple-200',
            pillClass:
              'bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border-purple-300 dark:border-purple-800',
          },
          {
            id: 'homing_bit',
            slotNum: 4,
            label: 'HomeBit',
            icon: homingClustletsIconSrc,
            badge: 'Homing Clustlets (homing_clustlets.png)',
            title: 'Editing Role: Homing Cluster Bits',
            desc: 'Timed guidance art for cluster bomblets after bit arming, emitted as bits.homing while Cluster Bits is in Builder mode.',
            enabled: hasBitHoming,
            disabledHint: 'Requires Burst = Clusters and Bit Action = Homing in Record Editor',
            activeClass:
              'border-indigo-500 bg-indigo-500/15 ring-2 ring-indigo-500/70 shadow-sm',
            bannerClass:
              'border-indigo-200 dark:border-indigo-800/60 bg-indigo-50/70 dark:bg-indigo-950/25 text-indigo-900 dark:text-indigo-200',
            pillClass:
              'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800',
          },
          {
            id: 'roam',
            slotNum: 5,
            label: 'Sheep',
            icon: roamIconSrc,
            badge: 'Roaming Action (sspsheep1.png)',
            title: 'Editing Role: Super Sheep / Roaming Animal',
            desc: 'Steerable flying animal. Own sheet makes the flown state its own role (its own animation, frames, spin, scale); the round’s sheet keeps Slot 1’s art. WA walks the animal until Space either way, and the two native rotation strips only apply with the flight builder off.',
            enabled: roamEnabled,
            disabledHint: 'Requires Missile Action = Roam in Record Editor',
            activeClass:
              'border-forge-500 bg-forge-500/15 ring-2 ring-forge-500/70 shadow-sm',
            bannerClass:
              'border-forge-200 dark:border-forge-800/60 bg-forge-50/70 dark:bg-forge-950/25 text-forge-900 dark:text-forge-200',
            pillClass:
              'bg-forge-100 dark:bg-forge-950/60 text-forge-800 dark:text-forge-300 border-forge-300 dark:border-forge-800',
          },
          {
            id: 'dig',
            slotNum: 6,
            label: 'Dig',
            icon: digIconSrc,
            badge: 'Digging Probe (dig.png)',
            title: 'Editing Role: Digging Terrain Probes',
            desc: 'Sheetless state: zeroes WA dig sprites and cycles the owning flight sheet while 4 terrain probes detect solid land (dig = true).',
            enabled: digEnabled,
            disabledHint: 'Requires Missile Action = Dig or Bit Action = Dig in Record Editor',
            activeClass:
              'border-orange-500 bg-orange-500/15 ring-2 ring-orange-500/70 shadow-sm',
            bannerClass:
              'border-orange-200 dark:border-orange-800/60 bg-orange-50/70 dark:bg-orange-950/25 text-orange-900 dark:text-orange-200',
            pillClass:
              'bg-orange-100 dark:bg-orange-950/60 text-orange-800 dark:text-orange-300 border-orange-300 dark:border-orange-800',
          },
        ];

        const activeSlotMeta =
          hotbarSlots.find((s) => s.id === activeFlightRole) ?? hotbarSlots[0];

        const isSecondaryRole =
          activeFlightRole === 'clusters' ||
          activeFlightRole === 'homing' ||
          activeFlightRole === 'homing_bit' ||
          activeFlightRole === 'roam';
        const isDigRole = activeFlightRole === 'dig';
        const secondaryRoleObj =
          activeFlightRole === 'clusters'
            ? bitFlight
            : activeFlightRole === 'homing'
              ? homingRole
              : activeFlightRole === 'homing_bit'
                ? homingBitRole
              : activeFlightRole === 'roam'
                ? roamRole
                : null;
        const updateSecondaryRole = (patch: Partial<FlightRoleArt>) => {
          if (activeFlightRole === 'clusters') updateBitFlight(patch);
          else if (activeFlightRole === 'homing') updateBehaviorArt('homing', patch);
          else if (activeFlightRole === 'homing_bit') updateBehaviorArt('homing_bit', patch);
          else if (activeFlightRole === 'roam') updateBehaviorArt('roam', patch);
        };

        // The roam slot in `inherit` mode shows the round's own flight row: the
        // animal keeps the primary sheet, so every parameter here belongs to
        // Slot 1 and editing it there is the only thing that changes the export.
        const roamInheritsPrimary = activeFlightRole === 'roam' && roamRoleMode !== 'builder';
        const activeSheetLocked =
          (isDigRole && digRoleMode === 'native') ||
          (isSecondaryRole && secondaryRoleObj?.mode !== 'builder') ||
          roamInheritsPrimary;

        const digOwningSheetIsBit =
          digBitEnabled && !digMainEnabled && bitFlight.mode === 'builder';
        const digOwningFrames = (digOwningSheetIsBit ? bitFlight.frames : missile.frames) || 1;
        const activeAnim: MissileAnimType = isDigRole
          ? digRole.anim || 'track'
          : isSecondaryRole && !roamInheritsPrimary
            ? secondaryRoleObj!.anim || 'rotation'
            : missile.anim || 'rotation';
        const activeFrames = isDigRole
          ? digRole.frames > 1
            ? digRole.frames
            : digOwningFrames
          : isSecondaryRole && !roamInheritsPrimary
            ? secondaryRoleObj!.frames || 1
            : missile.frames || 1;
        const activeAnimSpeed = isDigRole
          ? digRole.animSpeed || 1.0
          : isSecondaryRole && !roamInheritsPrimary
            ? secondaryRoleObj!.animSpeed || 1.0
            : missile.animSpeed || 1.0;
        const activeSpinRate = isDigRole
          ? digRole.spinRate || 1.0
          : isSecondaryRole && !roamInheritsPrimary
            ? secondaryRoleObj!.spinRate || 1.0
            : missile.spinRate || 1.0;
        const activeScale = isDigRole
          ? digRole.scale || 1.0
          : isSecondaryRole && !roamInheritsPrimary
            ? secondaryRoleObj!.scale || 1.0
            : missile.scale || 1.0;
        const activeMirror = isDigRole
          ? digRole.mirror !== false
          : isSecondaryRole && !roamInheritsPrimary
            ? secondaryRoleObj!.mirror !== false
            : missile.mirror !== false;
        const activeZ = isDigRole
          ? digRole.z ?? 5.0
          : isSecondaryRole && !roamInheritsPrimary
            ? secondaryRoleObj!.z ?? 5.0
            : missile.z ?? 5.0;

        const updateActiveRoleParams = (
          patch: Partial<Pick<FlightRoleArt, 'anim' | 'frames' | 'animSpeed' | 'spinRate' | 'scale' | 'mirror' | 'z'>>
        ) => {
          if (isDigRole) {
            updateBehaviorArt('dig', patch);
            return;
          }
          // A secondary role always edits its own row. The roam slot in
          // "Round's sheet" mode is read-only (the controls are locked) because
          // its values are Slot 1's; routing it here anyway means a stray edit
          // can never overwrite the primary weapon's flight parameters.
          if (isSecondaryRole) {
            updateSecondaryRole(patch);
          } else {
            updateMissile(patch);
          }
        };

        const animCodeMap: Record<MissileAnimType, string> = {
          track: 'track = 2',
          rotation: 'rotation = 3',
          slow: 'slow = 1',
          medium: 'medium = 1',
          fast: 'fast = 1',
          roam: 'roam = 4',
          none: 'none = 5',
        };

        const assetLabel =
          activeFlightRole === 'clusters'
            ? 'Cluster Bit Sprite Sheet'
            : activeFlightRole === 'homing'
              ? 'Primary Homing Sheet'
              : activeFlightRole === 'homing_bit'
                ? 'Homing Bit Sheet'
                : activeFlightRole === 'roam'
                  ? 'Roaming Flight Sheet'
                  : activeFlightRole === 'dig'
                    ? 'Digging Animation'
                    : 'Projectile Sprite Sheet';

        const assetPathHint =
          activeFlightRole === 'clusters'
            ? bitFlightSheetPath(project)
            : activeFlightRole === 'homing'
              ? behaviorStateSheetPath(project, 'homing')
              : activeFlightRole === 'homing_bit'
                ? behaviorStateSheetPath(project, 'homing_bit')
                : activeFlightRole === 'roam'
                  ? behaviorStateSheetPath(project, 'roam')
                  : activeFlightRole === 'dig'
                    ? digOwningSheetIsBit
                      ? bitFlightSheetPath(project)
                      : missileFlightSheetPath(project)
                    : missileFlightSheetPath(project);

        const activeSheetFile = isDigRole
          ? undefined
          : isSecondaryRole && !roamInheritsPrimary
            ? secondaryRoleObj?.sheetFile
            : missile.sheetFile;
        const activeSheetPreview = isDigRole
          ? undefined
          : isSecondaryRole && !roamInheritsPrimary
            ? secondaryRoleObj?.sheetPreview
            : missile.sheetPreview;

        return (
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 shadow-xs transition-colors">
            {/* Header + 6-Icon Hotbar */}
            <div className="pb-4 mb-4 border-b border-stone-100 dark:border-stone-800 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-forge-600 text-white flex items-center justify-center shadow-2xs shrink-0">
                    <Rocket className="w-4 h-4" />
                  </div>
                  <h2 className="font-heading text-base font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                    Missile & Projectile Flight Sprite Builder
                  </h2>
                  <span
                    className={`text-[11px] font-mono px-2 py-0.5 rounded border font-semibold ${activeSlotMeta.pillClass}`}
                  >
                    {activeSlotMeta.badge}
                  </span>
                </div>
                <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                  Switch projectile roles using the hotbar to configure sprite sheets, rotation modes, trajectories, and <code className="font-mono text-stone-600 dark:text-stone-300">sb.flight</code> parameters.
                </p>
              </div>

              {/* 6-Slot Pixel Icon Hotbar */}
              <div
                role="tablist"
                aria-label="Projectile flight roles"
                className="flex flex-wrap items-center gap-2 bg-stone-100 dark:bg-stone-800/80 p-1.5 rounded-2xl border border-stone-200 dark:border-stone-700 shadow-inner shrink-0 self-start xl:self-auto"
              >
                {hotbarSlots.map((slot) => {
                  const isActive = activeFlightRole === slot.id;
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      disabled={!slot.enabled}
                      onClick={() => slot.enabled && setActiveFlightRole(slot.id)}
                      title={
                        slot.enabled
                          ? `Slot ${slot.slotNum}: ${slot.badge}`
                          : `${slot.badge} — ${slot.disabledHint}`
                      }
                      className={`relative w-14 h-14 rounded-xl border-2 transition-all overflow-hidden group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forge-500 ${
                        !slot.enabled
                          ? 'opacity-35 grayscale cursor-not-allowed border-stone-200 dark:border-stone-700 bg-stone-200/70 dark:bg-stone-900/60'
                          : isActive
                            ? `${slot.activeClass} cursor-pointer`
                            : 'border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 hover:border-stone-400 dark:hover:border-stone-500 cursor-pointer'
                      }`}
                    >
                      <span
                        className={`absolute top-1 left-1 font-mono font-bold text-[9px] leading-none px-1 py-0.5 rounded border z-10 ${
                          !slot.enabled
                            ? 'bg-stone-200 dark:bg-stone-800 text-stone-400 border-stone-300 dark:border-stone-700'
                            : 'bg-white/90 dark:bg-stone-900/90 text-stone-700 dark:text-stone-200 border-stone-300 dark:border-stone-700'
                        }`}
                      >
                        {slot.slotNum}
                      </span>
                      <img
                        src={slot.icon}
                        alt={slot.label}
                        className={`w-full h-full object-contain p-1.5 transition-transform ${
                          slot.enabled ? 'group-hover:scale-110' : ''
                        }`}
                        style={{ imageRendering: 'pixelated' }}
                      />
                      <span
                        className={`absolute bottom-0.5 right-0.5 text-[9px] font-bold font-mono leading-none px-1 py-0.5 rounded shadow-2xs ${
                          !slot.enabled
                            ? 'bg-stone-200/90 dark:bg-stone-800/90 text-stone-500'
                            : 'bg-white/90 dark:bg-stone-900/90 text-stone-800 dark:text-stone-100'
                        }`}
                      >
                        {slot.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active Role Banner */}
            <div
              className={`mb-4 px-3.5 py-2.5 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 ${activeSlotMeta.bannerClass}`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src={activeSlotMeta.icon}
                  alt=""
                  className="w-7 h-7 object-contain shrink-0"
                  style={{ imageRendering: 'pixelated' }}
                />
                <div className="min-w-0">
                  <div className="font-bold leading-snug">{activeSlotMeta.title}</div>
                  <p className="text-[11px] opacity-85 leading-snug">{activeSlotMeta.desc}</p>
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-white/80 dark:bg-stone-900/80 border border-current/20 shrink-0">
                Role Slot {activeSlotMeta.slotNum} / {hotbarSlots.length}
              </span>
            </div>

            {isAirStrike && (
              <div className="mb-4 px-3.5 py-2 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  Air strikes spawn munitions from their own record copy and do not run{' '}
                  <code className="font-mono">sb.flight</code>. Use the Record / Pack Art strike body sprite instead.
                </span>
              </div>
            )}

            {/* Row 2: Projectile Asset Bar + Enable Missile Flight Sprite Pill */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-5">
              <div className="flex-1 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 px-3.5 py-2 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40 min-w-0">
                <div className="flex items-center gap-2.5 min-w-0 truncate">
                  <Upload className="w-4 h-4 text-forge-600 dark:text-forge-400 shrink-0" />
                  <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide shrink-0">
                    {assetLabel}
                  </span>
                  {isDigRole ? (
                    <span
                      className="text-xs text-stone-500 dark:text-stone-400 truncate"
                      title={assetPathHint}
                    >
                      Sheetless — cycles {digOwningSheetIsBit ? 'Cluster Bits' : 'Primary Round'} sheet on terrain contact
                    </span>
                  ) : activeSheetFile ? (
                    <span
                      className="font-mono text-xs text-forge-600 dark:text-forge-400 font-medium truncate"
                      title={`${activeSheetFile.name} (${(activeSheetFile.size / 1024).toFixed(1)} KB) → ${assetPathHint}`}
                    >
                      {activeSheetFile.name} ({(activeSheetFile.size / 1024).toFixed(1)} KB)
                    </span>
                  ) : isSecondaryRole && secondaryRoleObj?.mode !== 'builder' ? (
                    <span className="text-xs text-stone-500 dark:text-stone-400 truncate">
                      {secondaryRoleObj?.mode === 'inherit'
                        ? activeFlightRole === 'homing_bit' && bitFlight.mode === 'builder'
                          ? 'Inheriting Cluster Bits art — upload a PNG to switch to Builder'
                          : 'Inheriting Primary Round art — upload a PNG to switch to Builder'
                        : 'Using Native WA sprite — upload a PNG to switch to Builder'}
                    </span>
                  ) : (
                    <span
                      className="text-xs text-stone-500 dark:text-stone-400 truncate"
                      title={assetPathHint}
                    >
                      {isSecondaryRole
                        ? `Default fallback art → ${assetPathHint}`
                        : `Using default ${defaultArt.label} art — upload a PNG to replace it`}
                    </span>
                  )}
                  {activeSheetPreview && (
                    <button
                      type="button"
                      onClick={isSecondaryRole ? removeCustomRoleSheet : removeCustomMissileSheet}
                      className="text-xs text-rose-500 hover:text-rose-600 font-medium shrink-0 ml-1 cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div className="shrink-0">
                  {isDigRole ? (
                    <button
                      type="button"
                      onClick={() => setActiveFlightRole(digOwningSheetIsBit ? 'clusters' : 'primary')}
                      className="px-3 py-1.5 text-xs font-semibold text-stone-800 dark:text-stone-200 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-700 shadow-2xs transition-colors cursor-pointer"
                    >
                      Edit {digOwningSheetIsBit ? 'Bits' : 'Main'} Sheet
                    </button>
                  ) : (
                    <>
                      <input
                        ref={isSecondaryRole ? roleFileInputRef : missileFileInputRef}
                        type="file"
                        accept="image/png,image/gif"
                        onChange={isSecondaryRole ? handleUploadRoleSheet : handleUploadMissileSheet}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          (isSecondaryRole ? roleFileInputRef : missileFileInputRef).current?.click()
                        }
                        className="px-3 py-1.5 text-xs font-semibold text-stone-800 dark:text-stone-200 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-700 shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5 text-forge-600 dark:text-forge-400" />
                        <span>{activeSheetFile ? 'Change PNG Sheet' : 'Upload PNG'}</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              <label
                htmlFor="flight-enable-builder"
                className={`flex items-center gap-2 bg-white dark:bg-stone-800 px-3.5 py-2.5 rounded-xl border border-stone-200 dark:border-stone-700 shadow-2xs shrink-0 self-start sm:self-auto ${
                  isAirStrike ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                }`}
              >
                <input
                  id="flight-enable-builder"
                  type="checkbox"
                  disabled={isAirStrike}
                  checked={missile.enabled}
                  onChange={(e) =>
                    updateMissile({
                      enabled: e.target.checked,
                      ...(e.target.checked ? { mode: 'custom' } : {}),
                    })
                  }
                  className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4 cursor-pointer"
                />
                <span className="text-xs font-semibold text-stone-900 dark:text-stone-100 whitespace-nowrap">
                  Enable Missile Flight Sprite
                </span>
              </label>
            </div>

            {/* 3-Column Workbench Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.35fr_1.85fr] gap-4 items-start">
              {/* LEFT COLUMN: Modifiers, Role Scale, Global Size, Angle Offset */}
              <div className="order-3 lg:order-1 flex flex-col gap-3.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <label
                    htmlFor="flight-mirror-left"
                    title="Flips sprite horizontally when moving left (vx < 0)"
                    className={`h-10 flex items-center justify-between px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 shadow-2xs transition-colors ${
                      activeSheetLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-750'
                    }`}
                  >
                    <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 select-none">
                      Mirror Left
                    </span>
                    <input
                      id="flight-mirror-left"
                      type="checkbox"
                      disabled={activeSheetLocked}
                      checked={activeMirror}
                      onChange={(e) => updateActiveRoleParams({ mirror: e.target.checked })}
                      className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4 cursor-pointer"
                    />
                  </label>

                  <label
                    htmlFor="flight-log-identity"
                    title="Logs one line per missile's first frames with id, m.sprite, and classified role (log = true)."
                    className="h-10 flex items-center justify-between px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 cursor-pointer shadow-2xs hover:bg-stone-50 dark:hover:bg-stone-750 transition-colors"
                  >
                    <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 select-none">
                      Log Debug
                    </span>
                    <input
                      id="flight-log-identity"
                      type="checkbox"
                      checked={!!project.missileSprite.logIdentity}
                      onChange={(e) =>
                        onChange({
                          missileSprite: {
                            ...project.missileSprite,
                            logIdentity: e.target.checked,
                          },
                        })
                      }
                      className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4 cursor-pointer"
                    />
                  </label>
                </div>

                {/* Role Scale Slider */}
                <div
                  className={`space-y-1 p-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40 ${
                    activeSheetLocked ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex justify-between items-center text-xs">
                    <label
                      htmlFor="flight-role-scale"
                      className="font-semibold text-stone-700 dark:text-stone-300"
                    >
                      {isSecondaryRole ? 'Role Scale' : 'Primary Scale'}
                    </label>
                    <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">
                      {activeScale.toFixed(2)}x
                    </span>
                  </div>
                  <input
                    id="flight-role-scale"
                    type="range"
                    min={0.2}
                    max={3.0}
                    step={0.05}
                    disabled={activeSheetLocked}
                    value={activeScale}
                    onChange={(e) => updateActiveRoleParams({ scale: Number(e.target.value) })}
                    className="w-full accent-forge-500 cursor-pointer"
                  />
                </div>

                {/* Global Size (All Roles) Slider */}
                <div
                  className="space-y-1 p-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40"
                  title="Multiplies every role's own scale — primary, cluster bits, and behaviour sheets."
                >
                  <div className="flex justify-between items-center text-xs">
                    <label
                      htmlFor="flight-global-size"
                      className="font-semibold text-stone-700 dark:text-stone-300"
                    >
                      Global Size (All Roles)
                    </label>
                    <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">
                      {(missile.size ?? 1).toFixed(2)}x
                    </span>
                  </div>
                  <input
                    id="flight-global-size"
                    type="range"
                    min={0.25}
                    max={3.0}
                    step={0.05}
                    value={missile.size ?? 1}
                    onChange={(e) => updateMissile({ size: Number(e.target.value) })}
                    className="w-full accent-forge-500 cursor-pointer"
                  />
                </div>

                {/* Angle Offset Slider */}
                <div
                  className="space-y-1 p-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40"
                  title="Added to whatever rotation the animation asks for. Sheets drawn pointing right need -90°; mirrored automatically when vx < 0."
                >
                  <div className="flex justify-between items-center text-xs">
                    <label
                      htmlFor="flight-angle-offset"
                      className="font-semibold text-stone-700 dark:text-stone-300"
                    >
                      Angle Offset
                    </label>
                    <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">
                      {missile.angle ?? 0}°
                    </span>
                  </div>
                  <input
                    id="flight-angle-offset"
                    type="range"
                    min={-180}
                    max={180}
                    step={5}
                    value={missile.angle ?? 0}
                    onChange={(e) => updateMissile({ angle: Number(e.target.value) })}
                    className="w-full accent-forge-500 cursor-pointer"
                  />
                </div>

                {/* Roam tilt preset: `anim = "roam"` only. The ground pose is
                    side-on, so the art rests at `rest` and may lean a little as
                    the animal steps; in the air it tracks the heading. */}
                <div
                  className="space-y-1.5 p-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40"
                  title="Preset for the Roam Tilt animation (anim = roam): the angle the walking art holds while WA walks the animal, and how far it may lean up or down as it steps. In the air the art tracks its heading instead."
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-stone-700 dark:text-stone-300">
                      Roam Tilt
                    </span>
                    <code className="text-[10px] font-mono text-forge-600 dark:text-forge-400">
                      anim = roam
                    </code>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { key: 'up', label: 'Max up', min: 0, max: 180 },
                        { key: 'down', label: 'Max down', min: 0, max: 180 },
                        { key: 'rest', label: 'Rest', min: -180, max: 180 },
                      ] as const
                    ).map((field) => {
                      const tilt = missile.roamTilt ?? DEFAULT_ROAM_TILT;
                      return (
                        <div key={field.key} className="space-y-0.5">
                          <label
                            htmlFor={`flight-tilt-${field.key}`}
                            className="block text-[10px] font-medium text-stone-600 dark:text-stone-400"
                          >
                            {field.label}
                          </label>
                          <NumberInput
                            id={`flight-tilt-${field.key}`}
                            min={field.min}
                            max={field.max}
                            step={5}
                            value={tilt[field.key]}
                            onChange={(e) =>
                              updateMissile({
                                roamTilt: { ...tilt, [field.key]: Number(e.target.value) },
                              })
                            }
                            className="w-full rounded-lg border border-stone-200 bg-white px-1.5 py-1 text-center font-mono text-[11px] text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Native Sprite Hidden Badge */}
                <div
                  className="p-3 rounded-xl border border-forge-200 dark:border-forge-900/60 bg-forge-50/50 dark:bg-forge-950/20 flex items-center justify-between gap-2"
                  title="Always written while the builder is on: hides WA's native round (m.sprite = 0). Cluster bits retain a marker id and are classified as bits."
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-forge-600 dark:text-forge-400 shrink-0" />
                    <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 truncate">
                      {activeFlightRole === 'roam'
                        ? 'Zeroes sheep.flight_1/2'
                        : activeFlightRole === 'dig'
                          ? digRoleMode === 'native'
                            ? 'Keeps WA dig sprites'
                            : 'Zeroes dig sprites'
                          : activeFlightRole === 'homing'
                            ? 'Zeroes homing.sprite'
                            : activeFlightRole === 'homing_bit'
                              ? 'Zeroes bit.homing.sprite'
                              : 'Native Sprite Hidden'}
                    </span>
                  </div>
                  <code className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-white dark:bg-stone-900 border border-forge-200 dark:border-forge-800 text-forge-700 dark:text-forge-300 shrink-0">
                    {activeFlightRole === 'roam'
                      ? 'flight = 0'
                      : activeFlightRole === 'dig'
                        ? digRoleMode === 'native'
                          ? 'native'
                          : 'dig = true'
                        : 'sprite = 0'}
                  </code>
                </div>
              </div>

              {/* CENTER COLUMN: Interactive 50 Hz Pixel Viewport & Trajectory */}
              <div className="order-1 lg:order-2 flex flex-col items-center gap-3 w-full">
                <div className="relative w-full max-w-[360px] aspect-[300/260] border-2 border-stone-800 rounded-xl overflow-hidden shadow-lg bg-stone-950">
                  <canvas
                    ref={missileCanvasRef}
                    width={300}
                    height={260}
                    className="block w-full h-full cursor-pointer"
                    style={{ imageRendering: 'pixelated' }}
                    onClick={() => setIsMissilePlaying(!isMissilePlaying)}
                    title="Click canvas to toggle Play / Pause"
                  />

                  <div className="absolute top-2 left-2 flex items-center gap-1.5 text-[10px] font-mono bg-black/75 backdrop-blur-xs text-stone-300 px-2 py-0.5 rounded border border-white/10">
                    <span className="uppercase text-forge-400 font-bold">{activeAnim}</span>
                    <span>·</span>
                    <span>
                      Frame {activeFrameDisplay + 1}/{Math.max(1, activeFrames)}
                    </span>
                  </div>

                  <div className="absolute bottom-2 left-2 flex items-center gap-1.5 text-[10px] font-mono bg-black/75 backdrop-blur-xs text-stone-300 px-2 py-0.5 rounded border border-white/10">
                    <span>{isMissilePlaying ? 'Simulating Flight' : 'Paused'}</span>
                    <span>·</span>
                    <span className="text-stone-400 capitalize">{flightMode}</span>
                  </div>

                  <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/70 backdrop-blur-xs p-0.5 rounded border border-white/10 text-[10px]">
                    {(['grid', 'sky', 'cavern'] as const).map((theme) => (
                      <button
                        key={theme}
                        type="button"
                        onClick={() => setBackdropTheme(theme)}
                        className={`px-1.5 py-0.5 rounded capitalize cursor-pointer ${
                          backdropTheme === theme
                            ? 'bg-forge-600 text-white font-bold'
                            : 'text-stone-400 hover:text-white'
                        }`}
                      >
                        {theme}
                      </button>
                    ))}
                    <span className="w-px h-3 bg-white/15 mx-0.5" />
                    <button
                      type="button"
                      onClick={() => setShowDrumRef((v) => !v)}
                      aria-pressed={showDrumRef}
                      title="Toggle animated oil drum scale reference (20 frames, 20 fps)"
                      className={`px-1.5 py-0.5 rounded cursor-pointer ${
                        showDrumRef
                          ? 'bg-forge-600 text-white font-bold'
                          : 'text-stone-400 hover:text-white'
                      }`}
                    >
                      Drum
                    </button>
                  </div>
                </div>

                {/* Flight Path Selector + Inline Static Vector Sliders */}
                <div className="w-full max-w-[360px] space-y-2 bg-stone-50 dark:bg-stone-800/50 p-2 rounded-xl border border-stone-200 dark:border-stone-800">
                  <div className="grid grid-cols-4 gap-1 p-1 bg-stone-100 dark:bg-stone-900 rounded-lg text-xs font-medium">
                    {(
                      [
                        { id: 'arc', label: 'Arc', title: 'A thrown arc: heading and speed change along it.' },
                        { id: 'orbit', label: 'Orbit', title: 'A circle: every heading in turn.' },
                        { id: 'static', label: 'Static', title: 'One fixed vector, for reading the art.' },
                        {
                          id: 'walk',
                          label: 'Walk',
                          title:
                            'A roaming animal: ambling with no velocity (the art rests), then a hop up and down (the tilt clamps).',
                        },
                      ] as const
                    ).map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        title={mode.title}
                        onClick={() => setFlightMode(mode.id)}
                        className={`py-1 rounded text-[11px] text-center transition-colors cursor-pointer ${
                          flightMode === mode.id
                            ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-white font-bold shadow-2xs'
                            : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>

                  {flightMode === 'static' && (
                    <div className="grid grid-cols-2 gap-3 pt-1 px-1">
                      <div className="space-y-0.5">
                        <div className="flex items-center justify-between text-[11px] font-medium text-stone-700 dark:text-stone-300">
                          <span>Angle</span>
                          <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">
                            {flightAngleDeg}°
                          </span>
                        </div>
                        <input
                          type="range"
                          aria-label="Static flight vector angle"
                          min={-90}
                          max={90}
                          step={5}
                          value={flightAngleDeg}
                          onChange={(e) => setFlightAngleDeg(Number(e.target.value))}
                          className="w-full accent-forge-500 cursor-pointer"
                        />
                      </div>

                      <div className="space-y-0.5">
                        <div className="flex items-center justify-between text-[11px] font-medium text-stone-700 dark:text-stone-300">
                          <span>Speed</span>
                          <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">
                            {flightSpeed} px/f
                          </span>
                        </div>
                        <input
                          type="range"
                          aria-label="Static flight vector speed"
                          min={2}
                          max={30}
                          step={1}
                          value={flightSpeed}
                          onChange={(e) => setFlightSpeed(Number(e.target.value))}
                          className="w-full accent-forge-500 cursor-pointer"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Playback & Zoom Bar */}
                <div className="flex items-center justify-between w-full max-w-[360px] gap-2">
                  <button
                    type="button"
                    onClick={() => setIsMissilePlaying(!isMissilePlaying)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-white transition-colors cursor-pointer ${
                      isMissilePlaying
                        ? 'bg-amber-600 hover:bg-amber-700'
                        : 'bg-forge-600 hover:bg-forge-700'
                    }`}
                  >
                    {isMissilePlaying ? (
                      <Pause className="w-3.5 h-3.5" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    <span>{isMissilePlaying ? 'Pause Flight' : 'Resume Flight'}</span>
                  </button>

                  <div className="flex items-center gap-1 bg-stone-100 dark:bg-stone-800 p-1 rounded-lg border border-stone-200 dark:border-stone-700 text-xs">
                    {[2, 3, 4, 5, 6].map((z) => (
                      <button
                        key={z}
                        type="button"
                        onClick={() => setMissileZoom(z)}
                        className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold cursor-pointer ${
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
              </div>

              {/* RIGHT COLUMN: Role Config, Anim Mode Grid, Sheet Animation & Lua Call */}
              <div className="order-2 lg:order-3 flex flex-col gap-3.5">
                {/* 1. Role Overrides & Behavior */}
                <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-200/70 dark:border-stone-700/70">
                    <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                      Role Overrides & Behavior
                    </span>
                    <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300">
                      wf-lib/wfws_sprite_builder
                    </span>
                  </div>

                  {!builderOn && !isAirStrike && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg px-2.5 py-1.5">
                      Enable <strong>Missile Flight Sprite</strong> above to emit <code className="font-mono">sb.flight</code> in the Lua bundle.
                    </p>
                  )}

                  {activeFlightRole === 'primary' && (
                    <div className="space-y-2.5 text-xs">
                      <p className="text-[11px] text-stone-600 dark:text-stone-300">
                        <strong>Primary Weapon Round:</strong> Initial projectile sheet. Secondary roles (homing, cluster bits, digging) inherit or override from this round.
                      </p>
                      {digMainEnabled && (
                        <div className="p-2.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-stone-600 dark:text-stone-300">
                            Digging probe is{' '}
                            <strong className="font-mono">
                              {digRoleMode === 'native' ? 'native' : 'enabled (dig = true)'}
                            </strong>
                            .
                          </span>
                          <button
                            type="button"
                            onClick={() => setActiveFlightRole('dig')}
                            className="px-2 py-1 rounded text-[11px] font-semibold bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/50 cursor-pointer shrink-0"
                          >
                            Open Dig Tab
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {activeFlightRole === 'homing' && (
                    <div className="space-y-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-stone-700 dark:text-stone-300">
                          Primary Homing Art Mode
                        </span>
                        <div className="flex items-center gap-1 bg-stone-100 dark:bg-stone-800 p-0.5 rounded-lg border border-stone-200 dark:border-stone-700">
                          {(['native', 'builder', 'inherit'] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              disabled={!builderOn}
                              onClick={() => updateBehaviorArt('homing', { mode: m })}
                              className={`px-2.5 py-1 rounded text-[11px] font-semibold capitalize cursor-pointer disabled:opacity-50 ${
                                homingRole.mode === m
                                  ? 'bg-forge-600 text-white shadow-2xs'
                                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>

                      {(() => {
                        const armMs = project.body.homing_arm_ms ?? 0;
                        const timeMs = project.body.homing_time_ms ?? 0;
                        return (
                          <p className="text-[11px] text-stone-500 dark:text-stone-400">
                            Timed window from Record Editor: <strong className="font-mono">{armMs} ms</strong>{' '}
                            to{' '}
                            <strong className="font-mono">
                              {timeMs > 0 ? `${armMs + timeMs} ms` : 'impact'}
                            </strong>
                            . In <span className="font-semibold">Builder</span> mode, WA’s{' '}
                            <code className="font-mono">missile.homing.sprite</code> is zeroed and this sheet swaps in during guidance.
                          </p>
                        );
                      })()}
                    </div>
                  )}

                  {activeFlightRole === 'homing_bit' && (
                    <div className="space-y-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-stone-700 dark:text-stone-300">
                          Homing Clustlet Art Mode
                        </span>
                        <div className="flex items-center gap-1 bg-stone-100 dark:bg-stone-800 p-0.5 rounded-lg border border-stone-200 dark:border-stone-700">
                          {(['native', 'builder', 'inherit'] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              disabled={!builderOn}
                              onClick={() => updateBehaviorArt('homing_bit', { mode: m })}
                              className={`px-2.5 py-1 rounded text-[11px] font-semibold capitalize cursor-pointer disabled:opacity-50 ${
                                homingBitRole.mode === m
                                  ? 'bg-forge-600 text-white shadow-2xs'
                                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>

                      {(() => {
                        const armMs = project.body.clustlet.homing_arm_ms ?? 0;
                        const timeMs = project.body.clustlet.homing_time_ms ?? 0;
                        return (
                          <p className="text-[11px] text-stone-500 dark:text-stone-400">
                            Cluster bit homing window: <strong className="font-mono">{armMs} ms</strong>{' '}
                            to{' '}
                            <strong className="font-mono">
                              {timeMs > 0 ? `${armMs + timeMs} ms` : 'impact'}
                            </strong>
                            . Emits <code className="font-mono">bits.homing = &#123; ... &#125;</code> and zeroes{' '}
                            <code className="font-mono">clusters.bit.homing.sprite</code>.
                          </p>
                        );
                      })()}

                      {homingBitRole.mode === 'builder' && bitFlight.mode !== 'builder' && (
                        <div className="p-2.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px]">
                            <code className="font-mono">bits.homing</code> requires{' '}
                            <strong>Cluster Bits (Slot 3)</strong> in <strong>Builder</strong> mode (currently{' '}
                            <code className="font-mono">{bitFlight.mode}</code>).
                          </span>
                          <button
                            type="button"
                            onClick={() => updateBitFlight({ mode: 'builder' })}
                            className="px-2.5 py-1 rounded text-[11px] font-semibold bg-amber-600 hover:bg-amber-700 text-white cursor-pointer shrink-0"
                          >
                            Enable Bit Builder
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {activeFlightRole === 'clusters' && (
                    <div className="space-y-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-stone-700 dark:text-stone-300">
                          Cluster Bit Art Mode
                        </span>
                        <div className="flex items-center gap-1 bg-stone-100 dark:bg-stone-800 p-0.5 rounded-lg border border-stone-200 dark:border-stone-700">
                          {(['native', 'builder', 'inherit'] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              disabled={!builderOn}
                              onClick={() => updateBitFlight({ mode: m })}
                              className={`px-2.5 py-1 rounded text-[11px] font-semibold capitalize cursor-pointer disabled:opacity-50 ${
                                bitFlight.mode === m
                                  ? 'bg-forge-600 text-white shadow-2xs'
                                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>

                      <p className="text-[11px] text-stone-500 dark:text-stone-400">
                        Child bomblets after burst: <strong>Native</strong> keeps WA’s clustlet sheet, <strong>Builder</strong> draws a dedicated sheet, <strong>Inherit</strong> reuses the primary sheet.
                      </p>

                      {digBitEnabled && (
                        <div className="p-2.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-stone-600 dark:text-stone-300">
                            Bit digging probe is{' '}
                            <strong className="font-mono">
                              {digRoleMode === 'native' ? 'native' : 'enabled (dig = true)'}
                            </strong>
                            .
                          </span>
                          <button
                            type="button"
                            onClick={() => setActiveFlightRole('dig')}
                            className="px-2 py-1 rounded text-[11px] font-semibold bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/50 cursor-pointer shrink-0"
                          >
                            Open Dig Tab
                          </button>
                        </div>
                      )}

                      {bitBuilderMode(project) === 'builder' && project.packArt?.cluster_sprite && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg px-2.5 py-1.5">
                          The native <code className="font-mono">cluster.sprite</code> upload in Burst Payload is skipped while the bit builder owns the bits.
                        </p>
                      )}
                    </div>
                  )}

                  {activeFlightRole === 'dig' && (
                    <div className="space-y-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-stone-700 dark:text-stone-300">
                          Digging Terrain Probe
                        </span>
                        <div className="flex items-center gap-1 bg-stone-100 dark:bg-stone-800 p-0.5 rounded-lg border border-stone-200 dark:border-stone-700">
                          <button
                            type="button"
                            disabled={!builderOn}
                            onClick={() => updateBehaviorArt('dig', { mode: 'native' })}
                            className={`px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer disabled:opacity-50 ${
                              digRoleMode === 'native'
                                ? 'bg-forge-600 text-white shadow-2xs'
                                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                            }`}
                          >
                            Native
                          </button>
                          <button
                            type="button"
                            disabled={!builderOn}
                            onClick={() => updateBehaviorArt('dig', { mode: 'builder' })}
                            className={`px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer disabled:opacity-50 ${
                              digRoleMode !== 'native'
                                ? 'bg-forge-600 text-white shadow-2xs'
                                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                            }`}
                          >
                            Probe
                          </button>
                        </div>
                      </div>

                      <p className="text-[11px] text-stone-500 dark:text-stone-400">
                        Active for{' '}
                        <strong>
                          {digMainEnabled && digBitEnabled
                            ? 'Primary Round & Cluster Bits'
                            : digMainEnabled
                              ? 'Primary Round'
                              : 'Cluster Bits'}
                        </strong>
                        .{' '}
                        {digRoleMode === 'native'
                          ? 'Native keeps WA’s record dig sprites (dig.dive_sprite / sprite_1..3).'
                          : 'Overrides the owning sheet’s rotation, spin rate, anim speed, and scale only while 4 terrain probes detect solid land; reverts seamlessly in open air.'}
                      </p>

                      {digRoleMode !== 'native' &&
                        digArtOverrideRows(behaviorArt.dig, '').length > 0 && (
                          <div className="flex items-center justify-between gap-2 pt-0.5">
                            <span className="text-[11px] text-orange-700 dark:text-orange-300 font-medium">
                              Custom underground animation overrides active
                            </span>
                            <button
                              type="button"
                              onClick={() => updateBehaviorArt('dig', { ...DEFAULT_DIG_ROLE_ART })}
                              className="text-[11px] font-semibold text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white underline cursor-pointer"
                            >
                              Reset to defaults
                            </button>
                          </div>
                        )}

                      {digRoleMode !== 'native' &&
                        digBitEnabled &&
                        !digMainEnabled &&
                        bitFlight.mode === 'native' && (
                          <div className="p-2.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px]">
                              Cluster Bits (Slot 3) is currently <strong>Native</strong>, so bit dig sprites are left to WA.
                            </span>
                            <button
                              type="button"
                              onClick={() => updateBitFlight({ mode: 'builder' })}
                              className="px-2.5 py-1 rounded text-[11px] font-semibold bg-amber-600 hover:bg-amber-700 text-white cursor-pointer shrink-0"
                            >
                              Enable Bit Builder
                            </button>
                          </div>
                        )}
                    </div>
                  )}

                  {activeFlightRole === 'roam' && (
                    <div className="space-y-3 text-xs">
                      {/* The flying animal's art: the round's own sheet, or a
                          role of its own. WA walks the animal until Space in
                          both cases (`roam = { walk, fly }`). */}
                      <div className="space-y-1">
                        <span className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">
                          Flying art
                        </span>
                        <div className="grid grid-cols-2 gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-lg border border-stone-200 dark:border-stone-700">
                          {(
                            [
                              { id: 'inherit', label: 'Round’s sheet' },
                              { id: 'builder', label: 'Own sheet' },
                            ] as const
                          ).map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() =>
                                updateBehaviorArt('roam', { mode: option.id as FlightRoleArt['mode'] })
                              }
                              className={`py-1.5 font-medium rounded-md transition-colors ${
                                roamRoleMode === option.id
                                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs font-bold'
                                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-stone-500 dark:text-stone-400">
                          {roamRoleMode === 'builder'
                            ? 'After Space the animal draws this slot’s sheet, with the animation, frames, spin and scale below. WA still walks it on the ground.'
                            : 'After Space the animal keeps the round’s own sheet (Slot 1), so its animation, frames, spin and scale are Slot 1’s; the controls below are read-only here. Pick Own sheet to give the flown state separate art.'}
                        </p>
                      </div>
                      {builderOn && (
                        <p className="text-[11px] rounded-lg border border-amber-300/70 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5 text-amber-800 dark:text-amber-200">
                          The flight builder owns the takeoff (<code className="font-mono">roam</code>): it waits for Space and zeroes <code className="font-mono">sheep.flight_1/2</code>, so the two native strips below are not installed. Turn the builder off to export them instead.
                        </p>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <RoamSheetField
                          id="roam-sheet-1"
                          label="Flying sheet 1 (`flight_1`)"
                          asset={project.roamSheets?.flight1}
                          path={roamSheetPath(project, 'flight1')}
                          onChange={(asset) =>
                            onChange({
                              roamSheets: {
                                ...project.roamSheets,
                                flight1: asset,
                                flight2: project.roamSheets?.flight2 ?? {},
                              },
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
                              roamSheets: {
                                ...project.roamSheets,
                                flight2: asset,
                                flight1: project.roamSheets?.flight1 ?? {},
                              },
                            })
                          }
                        />
                      </div>
                      {!!project.roamSheets?.flight1?.file !== !!project.roamSheets?.flight2?.file && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300">
                          Both sheets are required for <code className="font-mono">sheep_sprites</code>.
                        </p>
                      )}
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
                        desc={`Native ids: flight_1 ${project.roamConfig?.flight_1 ?? 0} (${stockSpriteName(project.roamConfig?.flight_1 ?? 0) ?? 'unused'}), flight_2 ${project.roamConfig?.flight_2 ?? 0} (${stockSpriteName(project.roamConfig?.flight_2 ?? 0) ?? 'unused'}).`}
                      />
                    </div>
                  )}
                </div>

                {/* 2. Animation Mode 3x2 Grid */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-1.5">
                      <Compass className="w-3.5 h-3.5 text-forge-600 dark:text-forge-400" />
                      <span>Animation Mode (opts.anim)</span>
                    </span>
                    <span className="text-[10px] font-mono font-bold text-forge-700 dark:text-forge-300 bg-forge-50 dark:bg-forge-950/60 px-1.5 py-0.5 rounded border border-forge-200 dark:border-forge-800/60">
                      {animCodeMap[activeAnim]}
                    </span>
                  </div>

                  <div
                    className={`grid grid-cols-2 sm:grid-cols-3 gap-2 ${
                      activeSheetLocked ? 'opacity-50 pointer-events-none' : ''
                    }`}
                  >
                    {(
                      [
                        { id: 'track', name: 'Track Vector', sub: 'Points flight angle', code: 'track = 2' },
                        { id: 'rotation', name: 'Speed Tumble', sub: 'Velocity spin', code: 'rotation = 3' },
                        { id: 'slow', name: 'Slow Spin', sub: '0.5 rad/f spin', code: 'slow = 1' },
                        { id: 'medium', name: 'Medium Spin', sub: '0.8 rad/f spin', code: 'medium = 1' },
                        { id: 'fast', name: 'Fast Spin', sub: '1.35 rad/f spin', code: 'fast = 1' },
                        { id: 'roam', name: 'Roam Tilt', sub: 'Rests flat, tracks in flight', code: 'roam = 4' },
                        { id: 'none', name: 'Fixed Upright', sub: 'Locked 0° turn', code: 'none = 5' },
                      ] as const
                    ).map((item) => {
                      const isSelected = activeAnim === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          disabled={activeSheetLocked}
                          onClick={() => updateActiveRoleParams({ anim: item.id })}
                          className={`relative p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                            isSelected
                              ? 'border-forge-500 bg-forge-50/40 dark:bg-forge-950/30 ring-1 ring-forge-500'
                              : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 hover:border-stone-300 dark:hover:border-stone-700'
                          }`}
                        >
                          {isSelected && (
                            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-xs bg-forge-600" />
                          )}
                          <div
                            className={`text-xs font-bold leading-tight pr-3 ${
                              isSelected
                                ? 'text-forge-700 dark:text-forge-300'
                                : 'text-stone-800 dark:text-stone-200'
                            }`}
                          >
                            {item.name}
                          </div>
                          <div className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 leading-tight">
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

                {/* 3. Flight Sheet Animation Card */}
                <div
                  className={`p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-2.5 ${
                    activeSheetLocked ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wider">
                      Flight Sheet Animation
                    </span>
                    <span className="text-[10px] font-mono text-stone-400">50 Hz loop</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="space-y-1 text-center">
                      <label
                        htmlFor="flight-num-frames"
                        className="block text-[11px] font-medium text-stone-600 dark:text-stone-400"
                      >
                        Total Frames
                      </label>
                      <NumberInput
                        id="flight-num-frames"
                        min={1}
                        max={64}
                        disabled={activeSheetLocked}
                        value={activeFrames}
                        onChange={(e) =>
                          updateActiveRoleParams({ frames: Math.max(1, Number(e.target.value)) })
                        }
                        className="w-full text-xs font-mono text-center px-2 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                      />
                    </div>

                    <div className="space-y-1 text-center">
                      <label
                        htmlFor="flight-anim-speed"
                        className="block text-[11px] font-medium text-stone-600 dark:text-stone-400"
                      >
                        Anim Speed
                      </label>
                      <NumberInput
                        id="flight-anim-speed"
                        step={0.1}
                        min={0.1}
                        max={10.0}
                        disabled={activeSheetLocked}
                        value={activeAnimSpeed}
                        onChange={(e) =>
                          updateActiveRoleParams({
                            animSpeed: Math.max(0.1, Number(e.target.value)),
                          })
                        }
                        className="w-full text-xs font-mono text-center px-2 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                      />
                    </div>

                    <div className="space-y-1 text-center">
                      <label
                        htmlFor="flight-spin-rate"
                        className="block text-[11px] font-medium text-stone-600 dark:text-stone-400"
                      >
                        Spin Rate
                      </label>
                      <NumberInput
                        id="flight-spin-rate"
                        step={0.1}
                        min={0.1}
                        max={10.0}
                        disabled={activeSheetLocked}
                        value={activeSpinRate}
                        onChange={(e) =>
                          updateActiveRoleParams({
                            spinRate: Math.max(0.1, Number(e.target.value)),
                          })
                        }
                        className="w-full text-xs font-mono text-center px-2 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                      />
                    </div>

                    <div className="space-y-1 text-center">
                      <label
                        htmlFor="flight-z-depth"
                        className="block text-[11px] font-medium text-stone-600 dark:text-stone-400"
                      >
                        Depth (z)
                      </label>
                      <NumberInput
                        id="flight-z-depth"
                        step={0.5}
                        min={0}
                        max={20}
                        disabled={activeSheetLocked}
                        value={activeZ}
                        onChange={(e) =>
                          updateActiveRoleParams({ z: Math.max(0, Number(e.target.value)) })
                        }
                        className="w-full text-xs font-mono text-center px-2 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                      />
                    </div>
                  </div>
                </div>

                {/* 4. Generated Lua Code Box + Copy Button */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider">
                      Generated Lua `sb.flight` Call
                    </span>
                    <button
                      type="button"
                      onClick={handleCopySbLua}
                      className="text-[11px] font-semibold text-forge-700 dark:text-forge-300 bg-forge-50 dark:bg-forge-950/60 hover:bg-forge-100 dark:hover:bg-forge-900/60 px-2.5 py-1 rounded-lg border border-forge-200 dark:border-forge-800 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      {copiedSbLua ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedSbLua ? 'Copied' : 'Copy Lua'}</span>
                    </button>
                  </div>
                  <pre className="text-xs font-mono bg-stone-950 text-forge-400 p-3 rounded-xl overflow-x-auto border border-stone-800 leading-relaxed">
                    {sbFlightLuaPreview}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
