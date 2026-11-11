import React, { useEffect } from 'react';
import {
  WeaponProject,
  CollisionMask,
  MissileAction,
  BurstPayload,
  HomingKind,
  ClustletConfig,
  RoamActionConfig,
  DigActionConfig,
} from '../types/weapon';
import { COLLISION_FLAGS, MISSILE_ANIM_HINT, MISSILE_ANIM_TYPES } from '../data/recordSchema';

type CollisionTargetKey = Exclude<keyof CollisionMask, 'extra_bits'>;

const COLLISION_TARGETS: { id: CollisionTargetKey; label: string; desc: string }[] = [
  { id: 'land', label: 'land', desc: 'Terrain landscape' },
  { id: 'worms', label: 'worms', desc: 'All ordinary worms (shortcut)' },
  { id: 'worms_normal', label: 'worms_normal', desc: 'Standing/walking worms' },
  { id: 'worms_acting', label: 'worms_acting', desc: 'Firing, melee, getting up' },
  { id: 'worms_jumping', label: 'worms_jumping', desc: 'Jumping / jetpacking' },
  { id: 'worms_roping', label: 'worms_roping', desc: 'Rope and bungee' },
  { id: 'worms_frozen', label: 'worms_frozen', desc: 'Stationary frozen' },
  { id: 'worms_frozen_moving', label: 'worms_frozen_moving', desc: 'Moving frozen' },
  { id: 'mines', label: 'mines', desc: 'Proximity mines' },
  { id: 'crates', label: 'crates', desc: 'Weapon & health crates' },
  { id: 'donor_cards', label: 'donor_cards', desc: 'Donor cards' },
  { id: 'graves', label: 'graves', desc: 'Dead worm tombstones' },
  { id: 'missiles', label: 'missiles', desc: 'Other airborne missiles' },
  { id: 'arrows', label: 'arrows', desc: 'Arrows' },
  { id: 'objects', label: 'objects', desc: 'Oil drums and body actors' },
  { id: 'water', label: 'water', desc: 'Ocean water boundary' },
  { id: 'canisters', label: 'canisters', desc: 'Legacy canisters' },
];

// `worms` is a native shortcut for the ordinary movement groups. The engine
// rejects a mask that selects the shortcut and any individual group together,
// so every mask toggle goes through this helper.
const WORM_GROUP_KEYS = [
  'worms_normal',
  'worms_acting',
  'worms_jumping',
  'worms_roping',
  'worms_frozen',
  'worms_frozen_moving',
] as const;

// Groups covered by the `worms` shortcut (native bits 0x3C). The frozen groups
// are separate bits and may be combined with the shortcut.
const WORM_SHORTCUT_KEYS = WORM_GROUP_KEYS.filter(
  (key) => (COLLISION_FLAGS.worms & COLLISION_FLAGS[key]) !== 0
);

function toggleMaskValue(mask: CollisionMask, key: CollisionTargetKey): CollisionMask {
  const next: CollisionMask = { ...mask };
  const isChecked = !!next[key];
  if (key === 'worms') {
    if (isChecked) {
      // Turning the shortcut off clears only what it stood for.
      delete next.worms;
    } else {
      // Selecting the shortcut clears the groups it overlaps so the mask is
      // never rejected. Frozen groups do not overlap and are left alone.
      for (const group of WORM_SHORTCUT_KEYS) delete next[group];
      next.worms = true;
    }
  } else if ((WORM_GROUP_KEYS as readonly string[]).includes(key)) {
    if (next.worms) {
      // Expand the shortcut so unchecking/adding one group keeps the rest.
      for (const group of WORM_SHORTCUT_KEYS) next[group] = true;
      delete next.worms;
    }
    next[key] = !isChecked;
  } else {
    next[key] = !isChecked;
  }
  return next;
}
import {
  Bomb,
  Sparkles,
  ShieldAlert,
  Flame,
  Zap,
  Image as ImageIcon,
  Code2,
  Cpu,
  Layers,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Check,
  AlertTriangle,
  Volume2,
  Sliders,
  HelpCircle,
} from 'lucide-react';
import { bitActionOf, type RecordTabId } from '../data/recordTabs';
import { bitBuilderMode } from '../data/spriteBuilder';
import { PackSpriteUpload } from './PackSpriteUpload';
import {
  CustomSoundsCard,
  ExplosionEffectCard,
  RibbonTrailCard,
  supportsExplosionEffect,
  supportsExplosionSound,
  supportsIntervalSound,
  supportsRibbonTrail,
} from './EffectsCards';

interface RecordEditorProps {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
  activeSubTab: RecordTabId;
}

const STOCK_MISSILE_SPRITES = [
  { id: '0', name: '0 — Custom / Hidden (PX Sprite Builder)' },
  { id: 'bazooka', name: 'Bazooka Rocket ("bazooka")' },
  { id: 'grenade', name: 'Grenade ("grenade")' },
  { id: 'cluster', name: 'Cluster Bomb ("cluster")' },
  { id: 'banana', name: 'Banana / Super Banana ("banana")' },
  { id: 'mortar', name: 'Mortar Shell ("mortar")' },
  { id: 'homing', name: 'Homing Missile ("homing")' },
  { id: 'pigeon', name: 'Homing Pigeon ("pigeon")' },
  { id: 'sheep', name: 'Sheep ("sheep")' },
  { id: 'dynamite', name: 'Dynamite Stick ("dynamite")' },
  { id: 'mine', name: 'Proximity Mine ("mine")' },
  { id: 'petrol_bomb', name: 'Petrol / Fire Bomb ("petrol_bomb")' },
  { id: 'holy_grenade', name: 'Holy Hand Grenade ("holy_grenade")' },
  { id: 'arrow', name: 'Bow Arrow ("arrow")' },
];

const BURST_BIT_TABS: RecordTabId[] = [
  'burst_bit',
  'burst_bit_bounce',
  'burst_bit_homing',
  'burst_bit_roam',
  'burst_bit_dig',
];

const DEFAULT_BIT_ROAM: RoamActionConfig = {
  walk_speed: 2,
  step_height: 4,
  terrain_offset: -10,
  edge_jump_angle_deg: 0,
  edge_jump_speed: 0,
  edge_jump_sound: 0,
  jump_angle_deg: 25,
  jump_speed: 6,
  jump_sound: 50,
  gas_start_delay_ms: 0,
  gas_poison_power: 0,
  gas_animal_sprite: 0,
  flight_1: 0,
  flight_2: 0,
  hits: { land: true, worms: true, mines: true, crates: true, water: true },
  flight_hits: { land: true, worms: true, mines: true, crates: true, water: true },
};

const DEFAULT_BIT_DIG: DigActionConfig = {
  sound: 90,
  dive_sprite: 0,
  sprite_1: 0,
  sprite_2: 0,
  sprite_3: 0,
};

export const TooltipLabel: React.FC<{
  label: string;
  code?: string;
  desc?: string;
  htmlFor?: string;
}> = ({ label, code, desc, htmlFor }) => (
  <div className="flex items-center justify-between gap-1 mb-1">
    <label htmlFor={htmlFor} className="text-xs font-semibold text-stone-700 dark:text-stone-300 truncate cursor-pointer" title={desc}>
      {label}
      {code && <span className="ml-1 text-[10px] font-mono text-stone-400 font-normal">({code})</span>}
    </label>
    {desc && (
      <span
        tabIndex={0}
        role="tooltip"
        className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-help shrink-0 transition-colors"
        title={desc}
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </span>
    )}
  </div>
);

export const RecordEditor: React.FC<RecordEditorProps> = ({
  project,
  onChange,
  activeSubTab,
}) => {

  const body = project.body;
  const clustlet = body.clustlet;
  // Air strikes (fire type 3) have no primary missile for the sprite builder to
  // follow: their art lives on the claim's `sprite` field and in the shifted
  // munition slab.
  const isStrike = project.fireType === 'cursor' && !project.teleport;
  const bitAction = bitActionOf(clustlet);

  const updateBody = (patch: Partial<typeof body>) => {
    onChange({ body: { ...body, ...patch } });
  };

  const updateClustlet = (patch: Partial<typeof clustlet>) => {
    onChange({ body: { ...body, clustlet: { ...clustlet, ...patch } } });
  };

  const updateOverride = (path: string, value: any) => {
    const updated = { ...project.recordOverrides };
    if (value === undefined || value === '' || value === null) {
      delete updated[path];
    } else {
      updated[path] = value;
    }
    onChange({ recordOverrides: updated });
  };

  // Several keys at once. Calling `updateOverride` twice in one handler loses
  // the first write: each call spreads the same `project.recordOverrides` prop,
  // so only the last one survives (this is what made the trail checkbox look
  // dead - it enabled the trail and then overwrote it with the preset fields).
  const updateOverrides = (patch: Record<string, any>) => {
    const updated = { ...project.recordOverrides };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '' || value === null) delete updated[key];
      else updated[key] = value;
    }
    onChange({ recordOverrides: updated });
  };

  const isBurstTab = activeSubTab === 'burst' || BURST_BIT_TABS.includes(activeSubTab);

  // The burst sub-tabs are navigation helpers over one page: the whole payload
  // stays on screen and a click scrolls to its section.
  useEffect(() => {
    if (!activeSubTab.startsWith('burst')) return;
    const anchors: Record<string, string> = {
      burst: 'burst-payload',
      burst_bit: 'burst-bit',
      burst_bit_collision: 'burst-bit-collision',
      burst_bit_bounce: 'burst-bit-bounce',
      burst_bit_homing: 'burst-bit-homing',
      burst_bit_roam: 'burst-bit-roam',
      burst_bit_dig: 'burst-bit-dig',
    };
    const target = anchors[activeSubTab];
    if (!target) return;
    document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [activeSubTab]);

  // Effects-SDK cards live on the Effects tab. The ribbon trail needs a missile
  // round; the explosion burst needs a native blast (missile or mine). Custom
  // sounds split the same way: a blast sound needs `on_explode`, the interval
  // needs flight frames. None apply to strikes: their bombs are not fired from
  // a weapon-table slot.
  const effectsAvailable =
    supportsRibbonTrail(project) ||
    supportsExplosionEffect(project) ||
    supportsExplosionSound(project) ||
    supportsIntervalSound(project);

  // Two independent selections. `ends_on_contact` stops the projectile;
  // `bounce.hits` only adds targets the bounce action reacts to (the engine
  // adds it to `ends_on_contact`, it never replaces it). Sharing one grid made
  // it impossible to bounce off land while ending on a worm.
  const endsOnContactMask: CollisionMask =
    project.recordOverrides['missile.ends_on_contact'] || {
      land: true,
      worms: true,
      mines: true,
      crates: true,
      water: true,
    };
  const bounceHitsMask: CollisionMask =
    project.recordOverrides['missile.bounce.hits'] || {};

  // Start from the mask the grid is showing: when the path has no override yet
  // the grid shows the inherited defaults, and toggling one target must keep
  // the others rather than emitting a mask with only that one bit.
  const toggleMaskTarget = (path: string, key: CollisionTargetKey, current: CollisionMask) => {
    updateOverride(path, toggleMaskValue(current, key));
  };

  // Compact numeric override field for the Advanced tab.
  const numField = (
    path: string,
    label: string,
    fallback: number,
    desc: string,
    opts: { min?: number; max?: number; step?: number; unit?: string } = {}
  ) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        <label className="text-xs font-semibold text-stone-700 dark:text-stone-300 truncate" title={desc}>
          {label}
        </label>
        {desc && (
          <span className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-help shrink-0" title={desc}>
            <HelpCircle className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
      <div className="relative">
        <input
          type="number"
          min={opts.min}
          max={opts.max}
          step={opts.step}
          value={project.recordOverrides[path] ?? fallback}
          onChange={(e) => updateOverride(path, Number(e.target.value))}
          className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
        />
        {opts.unit && (
          <span className="absolute right-3 top-2 text-xs text-stone-400">{opts.unit}</span>
        )}
      </div>
    </div>
  );

  const spriteField = (path: string, label: string, fallback: string, desc: string) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        <label className="text-xs font-semibold text-stone-700 dark:text-stone-300 truncate" title={desc}>
          {label}
        </label>
        {desc && (
          <span className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-help shrink-0" title={desc}>
            <HelpCircle className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
      <input
        type="text"
        value={project.recordOverrides[path] ?? fallback}
        onChange={(e) => updateOverride(path, e.target.value)}
        className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
      />
    </div>
  );

  // WA's animation type. Shows every value with its meaning, because the
  // numbers alone are impossible to remember (1 spins, 2 tracks, 3-5 slower and
  // faster spins, 6 horizontal speed, 7 track by speed).
  const animSelect = (
    value: number,
    onChangeValue: (next: number) => void,
    label: string,
    desc: string
  ) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        <label className="text-xs font-semibold text-stone-700 dark:text-stone-300 truncate" title={desc}>
          {label}
        </label>
        {desc && (
          <span className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-help shrink-0" title={desc}>
            <HelpCircle className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
      <select
        value={value}
        onChange={(e) => onChangeValue(Number(e.target.value))}
        className="w-full text-xs px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
      >
        {!MISSILE_ANIM_TYPES.some((type) => type.value === value) && (
          <option value={value}>{value} — keep the imported value</option>
        )}
        {MISSILE_ANIM_TYPES.map((type) => (
          <option key={type.value} value={type.value}>
            {type.value} — {type.label}
          </option>
        ))}
      </select>
    </div>
  );

  const animField = (path: string, label: string, fallback: number) =>
    animSelect(
      Number(project.recordOverrides[path] ?? fallback),
      (next) => updateOverride(path, next),
      label,
      MISSILE_ANIM_HINT
    );

  const bitAnimField = (
    key: 'animation' | 'homing_animation',
    label: string,
    fallback: number
  ) =>
    animSelect(
      Number((clustlet[key] as number | undefined) ?? fallback),
      (next) => updateClustlet({ [key]: next } as Partial<ClustletConfig>),
      label,
      MISSILE_ANIM_HINT
    );

  const roamNum = (
    key:
      | 'walk_speed'
      | 'step_height'
      | 'terrain_offset'
      | 'edge_jump_angle_deg'
      | 'edge_jump_speed'
      | 'edge_jump_sound'
      | 'jump_angle_deg'
      | 'jump_speed'
      | 'jump_sound'
      | 'gas_start_delay_ms'
      | 'gas_poison_power'
      | 'gas_animal_sprite'
      | 'flight_1'
      | 'flight_2',
    label: string,
    desc: string,
    opts: { min?: number; max?: number; step?: number; unit?: string } = {}
  ) => (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">{label}</label>
      <div className="relative">
        <input
          type="number"
          min={opts.min}
          max={opts.max}
          step={opts.step}
          value={project.roamConfig[key]}
          onChange={(e) =>
            onChange({ roamConfig: { ...project.roamConfig, [key]: Number(e.target.value) } })
          }
          className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
        />
        {opts.unit && (
          <span className="absolute right-3 top-2 text-xs text-stone-400">{opts.unit}</span>
        )}
      </div>
      <p className="text-[10px] text-stone-400">{desc}</p>
    </div>
  );

  const roamMaskGrid = (key: 'hits' | 'flight_hits', mask: CollisionMask) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {COLLISION_TARGETS.map((flag) => {
        const isChecked = !!mask[flag.id];
        return (
          <label
            key={flag.id}
            className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
              isChecked
                ? 'border-forge-500/50 bg-forge-50/20 dark:bg-forge-950/20 text-stone-900 dark:text-stone-100 font-semibold'
                : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-800/40 text-stone-500 dark:text-stone-400'
            }`}
          >
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() =>
                onChange({
                  roamConfig: {
                    ...project.roamConfig,
                    [key]: toggleMaskValue(mask, flag.id),
                  },
                })
              }
              className="rounded text-forge-600 focus:ring-forge-500 mt-0.5"
            />
            <div>
              <div className="text-xs font-mono">{flag.label}</div>
              <div className="text-[10px] text-stone-400 font-normal">{flag.desc}</div>
            </div>
          </label>
        );
      })}
    </div>
  );

  // Compact numeric field for the cluster bit body (`clusters.bit.*`).
  const bitNum = (
    key: keyof ClustletConfig,
    label: string,
    fallback: number,
    desc: string,
    opts: { min?: number; max?: number; step?: number; unit?: string } = {}
  ) => (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">{label}</label>
      <div className="relative">
        <input
          type="number"
          min={opts.min}
          max={opts.max}
          step={opts.step}
          value={(clustlet[key] as number | undefined) ?? fallback}
          onChange={(e) =>
            updateClustlet({ [key]: Number(e.target.value) } as Partial<ClustletConfig>)
          }
          className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
        />
        {opts.unit && (
          <span className="absolute right-3 top-2 text-xs text-stone-400">{opts.unit}</span>
        )}
      </div>
      <p className="text-[10px] text-stone-400">{desc}</p>
    </div>
  );

  const bitMaskGrid = (key: 'ends_on_contact' | 'bounce_hits', mask?: CollisionMask) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {COLLISION_TARGETS.map((flag) => {
        const current = mask ?? {};
        const isChecked = !!current[flag.id];
        return (
          <label
            key={flag.id}
            className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
              isChecked
                ? 'border-forge-500/50 bg-forge-50/20 dark:bg-forge-950/20 text-stone-900 dark:text-stone-100 font-semibold'
                : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-800/40 text-stone-500 dark:text-stone-400'
            }`}
          >
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() =>
                updateClustlet({
                  [key]: toggleMaskValue(current, flag.id),
                } as Partial<ClustletConfig>)
              }
              className="rounded text-forge-600 focus:ring-forge-500 mt-0.5"
            />
            <div>
              <div className="text-xs font-mono">{flag.label}</div>
              <div className="text-[10px] text-stone-400 font-normal">{flag.desc}</div>
            </div>
          </label>
        );
      })}
    </div>
  );

  const bitRoamNum = (
    key: keyof RoamActionConfig,
    label: string,
    desc: string,
    opts: { min?: number; max?: number; step?: number; unit?: string } = {}
  ) => {
    const r = clustlet.roam ?? DEFAULT_BIT_ROAM;
    return (
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">{label}</label>
        <div className="relative">
          <input
            type="number"
            min={opts.min}
            max={opts.max}
            step={opts.step}
            value={(r[key] as number | undefined) ?? 0}
            onChange={(e) =>
              updateClustlet({
                roam: { ...r, [key]: Number(e.target.value) },
              } as Partial<ClustletConfig>)
            }
            className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
          />
          {opts.unit && (
            <span className="absolute right-3 top-2 text-xs text-stone-400">{opts.unit}</span>
          )}
        </div>
        <p className="text-[10px] text-stone-400">{desc}</p>
      </div>
    );
  };

  const bitRoamMaskGrid = (key: 'hits' | 'flight_hits') => {
    const r = clustlet.roam ?? DEFAULT_BIT_ROAM;
    const mask = r[key] ?? {};
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {COLLISION_TARGETS.map((flag) => {
          const isChecked = !!mask[flag.id];
          return (
            <label
              key={flag.id}
              className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                isChecked
                  ? 'border-forge-500/50 bg-forge-50/20 dark:bg-forge-950/20 text-stone-900 dark:text-stone-100 font-semibold'
                  : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-800/40 text-stone-500 dark:text-stone-400'
              }`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() =>
                  updateClustlet({
                    roam: { ...r, [key]: toggleMaskValue(mask, flag.id) },
                  } as Partial<ClustletConfig>)
                }
                className="rounded text-forge-600 focus:ring-forge-500 mt-0.5"
              />
              <div>
                <div className="text-xs font-mono">{flag.label}</div>
                <div className="text-[10px] text-stone-400 font-normal">{flag.desc}</div>
              </div>
            </label>
          );
        })}
      </div>
    );
  };

  const bitDigNum = (
    key: keyof DigActionConfig,
    label: string,
    desc: string,
    opts: { min?: number; max?: number; step?: number; unit?: string } = {}
  ) => {
    const d = clustlet.dig ?? DEFAULT_BIT_DIG;
    return (
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">{label}</label>
        <div className="relative">
          <input
            type="number"
            min={opts.min}
            max={opts.max}
            step={opts.step}
            value={(d[key] as number | undefined) ?? 0}
            onChange={(e) =>
              updateClustlet({
                dig: { ...d, [key]: Number(e.target.value) },
              } as Partial<ClustletConfig>)
            }
            className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
          />
          {opts.unit && (
            <span className="absolute right-3 top-2 text-xs text-stone-400">{opts.unit}</span>
          )}
        </div>
        <p className="text-[10px] text-stone-400">{desc}</p>
      </div>
    );
  };

  const maskGrid = (path: string, mask: CollisionMask) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {COLLISION_TARGETS.map((flag) => {
        const isChecked = !!mask[flag.id];
        return (
          <label
            key={flag.id}
            className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
              isChecked
                ? 'border-forge-500/50 bg-forge-50/20 dark:bg-forge-950/20 text-stone-900 dark:text-stone-100 font-semibold'
                : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-800/40 text-stone-500 dark:text-stone-400'
            }`}
          >
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => toggleMaskTarget(path, flag.id, mask)}
              className="rounded text-forge-600 focus:ring-forge-500 mt-0.5"
            />
            <div>
              <div className="text-xs font-mono">{flag.label}</div>
              <div className="text-[10px] text-stone-400 font-normal">{flag.desc}</div>
            </div>
          </label>
        );
      })}
    </div>
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-sm transition-colors dark:border-stone-800 dark:bg-stone-900">
      {/* Tab 1: Flight & Physics */}
      {activeSubTab === 'missile' && (
        <div className="p-6 space-y-6">
          <div>
            <h3 className="font-heading text-sm font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
              Ballistic Flight & Explosion Record
            </h3>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
              Configures `missile.gravity_pct`, `missile.wind_pct`, timer fuse, explosion damage, and push percentage.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {/* Explosion Power / Damage */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                Explosion Power (`explosion.power`)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={body.damage}
                  onChange={(e) => updateBody({ damage: Number(e.target.value) })}
                  className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-white"
                />
                <span className="absolute right-3 top-2 text-xs text-stone-400">dmg / radius</span>
              </div>
              <p className="text-[11px] text-stone-500">Sets both health damage and terrain crater radius.</p>
            </div>

            {/* Knockback Push */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                Push Percentage (`explosion.push_pct`)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={400}
                  value={project.recordOverrides['missile.explosion.push_pct'] ?? 100}
                  onChange={(e) => updateOverride('missile.explosion.push_pct', Number(e.target.value))}
                  className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-white"
                />
                <span className="absolute right-3 top-2 text-xs text-stone-400">%</span>
              </div>
              <p className="text-[11px] text-stone-500">0 removes knockback while preserving damage.</p>
            </div>

            {/* Gravity Multiplier */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                Gravity Multiplier (`gravity_pct`)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={-200}
                  max={500}
                  value={body.gravity_pct}
                  onChange={(e) => updateBody({ gravity_pct: Number(e.target.value) })}
                  className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-white"
                />
                <span className="absolute right-3 top-2 text-xs text-stone-400">%</span>
              </div>
              <p className="text-[11px] text-stone-500">100% is normal gravity. Moon Grenade uses 35%.</p>
            </div>

            {/* Wind Response */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                Wind Response (`wind_pct`)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={300}
                  value={body.wind_pct}
                  onChange={(e) => updateBody({ wind_pct: Number(e.target.value) })}
                  className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-white"
                />
                <span className="absolute right-3 top-2 text-xs text-stone-400">%</span>
              </div>
              <p className="text-[11px] text-stone-500">Bazooka has 100%, Grenade has 0%.</p>
            </div>

            {/* Fuse Timer (ms) */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                Explosion Fuse (`fuse`)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={body.fuse_time_ms}
                  onChange={(e) => updateBody({ fuse_time_ms: Number(e.target.value), fuse: Number(e.target.value) > 0 })}
                  className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-white"
                />
                <span className="absolute right-3 top-2 text-xs text-stone-400">ms</span>
              </div>
              <p className="text-[11px] text-stone-500">Native `fuse` timer. 0 = impact detonation.</p>
            </div>

            {/* Countdown (ms) */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                Countdown (`countdown`)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={body.countdown_ms}
                  onChange={(e) => updateBody({ countdown_ms: Number(e.target.value) })}
                  className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-white"
                />
                <span className="absolute right-3 top-2 text-xs text-stone-400">ms</span>
              </div>
              <p className="text-[11px] text-stone-500">Separate native `countdown`; its interaction with `fuse` depends on the base.</p>
            </div>

            {/* Launch Speed Multiplier */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                Speed Multiplier (`speed_pct`)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={10}
                  max={400}
                  value={project.recordOverrides['missile.speed_pct'] ?? 100}
                  onChange={(e) => updateOverride('missile.speed_pct', Number(e.target.value))}
                  className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-white"
                />
                <span className="absolute right-3 top-2 text-xs text-stone-400">%</span>
              </div>
              <p className="text-[11px] text-stone-500">Initial projectile flight velocity percentage.</p>
            </div>
          </div>

          {/* Space Trigger & Flags */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <label className="flex items-center gap-3 p-3 rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/40 cursor-pointer">
              <input
                type="checkbox"
                checked={!!project.recordOverrides['missile.explode_on_space']}
                onChange={(e) => updateOverride('missile.explode_on_space', e.target.checked)}
                className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4"
              />
              <div className="text-xs">
                <span className="font-semibold text-stone-900 dark:text-stone-100">Explode on Space (`explode_on_space`)</span>
                <p className="text-[11px] text-stone-500">Allows detonating the projectile mid-flight with Space key (e.g. Super Banana, Chilli children).</p>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3 rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/40 cursor-pointer">
              <input
                type="checkbox"
                checked={!!project.recordOverrides['missile.alarm_worms']}
                onChange={(e) => updateOverride('missile.alarm_worms', e.target.checked)}
                className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4"
              />
              <div className="text-xs">
                <span className="font-semibold text-stone-900 dark:text-stone-100">Alarm Nearby Worms (`alarm_worms`)</span>
                <p className="text-[11px] text-stone-500">Triggers nearby worms panic animations shortly before explosion.</p>
              </div>
            </label>
          </div>
        </div>
      )}

      {/* Tab 2: Missile Action (SINGLE THING: None | Bounce | Homing | Roam | Dig) */}
      {activeSubTab === 'action' && (
        <div className="p-6 space-y-6">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-heading text-sm font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                Missile Action Selection (`action`)
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold border border-amber-500/20">
                Single Choice · Mutually Exclusive
              </span>
            </div>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
              Per `weapon-records.md`, missiles have an action: `none`, `bounce`, `homing`, `roam`, or `dig`. Only one action can be active, preventing conflicting table declarations.
            </p>
          </div>

          {/* Action Selector Buttons */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-1.5 bg-stone-100 dark:bg-stone-800/80 rounded-xl border border-stone-200 dark:border-stone-700">
            {(
              [
                { id: 'none', label: 'None (Direct)', desc: 'Standard ballistic flight' },
                { id: 'bounce', label: 'Bounce', desc: 'Grenades, Banana Bombs' },
                { id: 'homing', label: 'Homing', desc: 'Target lock or dodge' },
                { id: 'roam', label: 'Roam', desc: 'Sheep, Skunk' },
                { id: 'dig', label: 'Dig', desc: 'Drills and burrows' },
              ] as const
            ).map((act) => {
              const isSelected = (project.action || 'none') === act.id;
              return (
                <button
                  key={act.id}
                  type="button"
                  onClick={() => onChange({ action: act.id })}
                  className={`flex flex-col items-start p-3 rounded-lg text-left transition-all ${
                    isSelected
                      ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs font-bold border border-forge-500/40'
                      : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white hover:bg-stone-200/50 dark:hover:bg-stone-700/50'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-bold uppercase">{act.label}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-forge-500" />}
                  </div>
                  <span className="text-[10px] text-stone-400 font-normal mt-0.5">{act.desc}</span>
                </button>
              );
            })}
          </div>

          {/* Dynamic Configuration based on selected action */}
          {project.action === 'bounce' && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4 animate-in fade-in">
              <div className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                Bounce Configuration (`missile.bounce`)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <TooltipLabel label="Bounciness" code="bounciness" desc="0 is standard grenade bounciness; Banana Bomb uses 60." />
                    <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">{body.bounce_pct}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={body.bounce_pct}
                    onChange={(e) => updateBody({ bounce_pct: Number(e.target.value) })}
                    className="w-full accent-forge-500 cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <TooltipLabel label="Terrain Speed Keep" code="terrain_keep_speed_pct" desc="Percentage of momentum preserved when ricocheting off soil." />
                    <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">
                      {project.recordOverrides['missile.bounce.terrain_keep_speed_pct'] ?? 75}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    value={project.recordOverrides['missile.bounce.terrain_keep_speed_pct'] ?? 75}
                    onChange={(e) => updateOverride('missile.bounce.terrain_keep_speed_pct', Number(e.target.value))}
                    className="w-full accent-forge-500 cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <TooltipLabel label="Max Bounces" code="max_bounces" desc="0 leaves normal fuse timing. > 0 detonates on Nth bounce." />
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={project.recordOverrides['missile.bounce.max_bounces'] ?? 0}
                    onChange={(e) => updateOverride('missile.bounce.max_bounces', Number(e.target.value))}
                    className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                </div>

                {numField('missile.bounce.sound', 'Bounce Sound (`sound`)', 0, 'Native sound identifier (0 = none).')}
                {numField('missile.bounce.contact_sides', 'Contact Sides (`contact_sides`)', 0, 'Native side mask for the bounce limit and contact explosion.')}
                {numField('missile.bounce.extra_reverse_chance_pct', 'Extra Reverse Chance (`extra_reverse_chance_pct`)', 0, 'Chance of an extra horizontal reversal before normal collision.', { min: 0, max: 100, unit: '%' })}
              </div>

              <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(project.recordOverrides['missile.bounce.explosion.power'] ?? 0) > 0}
                  onChange={(e) =>
                    updateOverride(
                      'missile.bounce.explosion.power',
                      e.target.checked
                        ? project.recordOverrides['missile.bounce.explosion.power'] || body.damage || 20
                        : 0
                    )
                  }
                  className="rounded text-forge-600 focus:ring-forge-500 mt-0.5"
                />
                <div>
                  <div className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                    Explode on Bounce (`bounce.explosion`)
                  </div>
                  <div className="text-[11px] text-stone-500">
                    Adds a contact explosion when the projectile bounces. Power 0 disables it.
                  </div>
                </div>
              </label>

              {(project.recordOverrides['missile.bounce.explosion.power'] ?? 0) > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pl-2 border-l-2 border-forge-500/30">
                  {numField('missile.bounce.explosion.power', 'Bounce Explosion Power (`explosion.power`)', 20, 'Contact-explosion power.', { min: 0, max: 500 })}
                  {numField('missile.bounce.explosion.push_pct', 'Bounce Push (`explosion.push_pct`)', 100, 'Contact-explosion knockback percentage.', { min: 0, max: 400, unit: '%' })}
                  {numField('missile.bounce.explosion.bias', 'Bounce Bias (`explosion.bias`)', 0, 'Contact-explosion bias.')}
                  {numField('missile.bounce.explosion.variation', 'Bounce Variation (`explosion.variation`)', 0, 'Random variation applied to the contact explosion.')}
                </div>
              )}
            </div>
          )}

          {project.action === 'homing' && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4 animate-in fade-in">
              <div className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                Homing Guidance Configuration (`missile.homing`)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Homing Kind (`kind`)</label>
                  <select
                    value={body.homing === 'off' ? 'lock' : body.homing}
                    onChange={(e) => updateBody({ homing: e.target.value as HomingKind })}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  >
                    <option value="lock">Lock (Direct tracking to target cursor)</option>
                    <option value="dodge">Dodge (Wavy evasive homing flight)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Arm Delay (`arm`)</label>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      step={250}
                      value={body.homing_arm_ms || 1000}
                      onChange={(e) => updateBody({ homing_arm_ms: Number(e.target.value) })}
                      className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                    />
                    <span className="absolute right-3 top-2 text-xs text-stone-400">ms</span>
                  </div>
                  <p className="text-[10px] text-stone-400">Time drifting in ballistic arc before rocket fires.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Tracking Duration (`time`)</label>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      step={500}
                      value={body.homing_time_ms || 8000}
                      onChange={(e) => updateBody({ homing_time_ms: Number(e.target.value) })}
                      className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                    />
                    <span className="absolute right-3 top-2 text-xs text-stone-400">ms</span>
                  </div>
                  <p className="text-[10px] text-stone-400">Total propelled guidance duration.</p>
                </div>
              </div>
            </div>
          )}

          {project.action === 'roam' && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4 animate-in fade-in">
              <div className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                Roaming Animal Configuration (`missile.roam`)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {roamNum('walk_speed', 'Walk Speed (`walk_speed`)', 'Grounded walk speed in pixels/frame (PX 100 = 2.0).', { min: 0, max: 10, step: 0.02, unit: 'px/f' })}
                {roamNum('step_height', 'Step Height (`step_height`)', 'Vertical terrain search limit in whole pixels; can be negative.', { step: 1, unit: 'px' })}
                {roamNum('terrain_offset', 'Terrain Offset (`terrain_offset`)', 'Signed vertical drawing adjustment while grounded.', { step: 1, unit: 'px' })}
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-3">
                <div className="text-[11px] font-bold text-stone-700 dark:text-stone-300 uppercase tracking-wide">
                  Jump At Edge (`roam.edge_jump`)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {roamNum('edge_jump_angle_deg', 'Jump Angle At Edge (`angle_deg`)', 'Native edge-jump angle; negative values can explode.', { step: 1, unit: 'deg' })}
                  {roamNum('edge_jump_speed', 'Jump Velocity At Edge (`speed`)', 'Nominal pixels/frame; WA varies it by about one sixth.', { min: 0, max: 10, step: 0.06, unit: 'px/f' })}
                  {roamNum('edge_jump_sound', 'Jump Sound At Edge (`sound`)', 'Native sound identifier (0 = none).')}
                </div>
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-3">
                <div className="text-[11px] font-bold text-stone-700 dark:text-stone-300 uppercase tracking-wide">
                  Jump (`roam.jump`)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {roamNum('jump_angle_deg', 'Jump Angle (`angle_deg`)', 'Native jump angle; negative values can explode.', { step: 1, unit: 'deg' })}
                  {roamNum('jump_speed', 'Jump Velocity (`speed`)', 'Nominal pixels/frame; WA varies it by about one sixth.', { min: 0, max: 10, step: 0.06, unit: 'px/f' })}
                  {roamNum('jump_sound', 'Jump Sound (`sound`)', 'Native sound identifier (0 = none).')}
                </div>
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-3">
                <div className="text-[11px] font-bold text-stone-700 dark:text-stone-300 uppercase tracking-wide">
                  Gas / Fart (`roam.gas`)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {roamNum('gas_start_delay_ms', 'Start Delay (`start_delay_ms`)', 'Nonzero arms the emission countdown; 0 leaves it unarmed.', { min: 0, step: 100, unit: 'ms' })}
                  {roamNum('gas_poison_power', 'Disease Power (`poison_power`)', 'Native poison-message amount.', { min: 0 })}
                  {roamNum('gas_animal_sprite', 'Sprite When Farting (`animal_sprite`)', 'Emitting animal pose; 0 = none.')}
                </div>
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-3">
                <div className="text-[11px] font-bold text-stone-700 dark:text-stone-300 uppercase tracking-wide">
                  Sheep Flight Art (`sheep`)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {roamNum('flight_1', 'Sprite When Flying (`sheep.flight_1`)', 'First native flying sprite.')}
                  {roamNum('flight_2', 'Sprite When Flying 2 (`sheep.flight_2`)', 'Second native flying sprite.')}
                </div>
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-2">
                <div className="text-[11px] font-bold text-stone-700 dark:text-stone-300 uppercase tracking-wide">
                  Movement Collision Targets (`roam.hits`)
                </div>
                {roamMaskGrid('hits', project.roamConfig.hits)}
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-2">
                <div className="text-[11px] font-bold text-stone-700 dark:text-stone-300 uppercase tracking-wide">
                  Steered Flight Collision Targets (`roam.flight_hits`)
                </div>
                {roamMaskGrid('flight_hits', project.roamConfig.flight_hits)}
              </div>
            </div>
          )}

          {project.action === 'dig' && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4 animate-in fade-in">
              <div className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                Digging Configuration (`missile.dig`)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Digging Sound (`sound`)</label>
                  <input
                    type="number"
                    value={project.digConfig.sound}
                    onChange={(e) =>
                      onChange({ digConfig: { ...project.digConfig, sound: Number(e.target.value) } })
                    }
                    className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Dive Sprite (`dive_sprite`)</label>
                  <input
                    type="number"
                    value={project.digConfig.dive_sprite}
                    onChange={(e) =>
                      onChange({ digConfig: { ...project.digConfig, dive_sprite: Number(e.target.value) } })
                    }
                    className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                  <p className="text-[10px] text-stone-400">PX “Sprite while jumping”.</p>
                </div>

                {([1, 2, 3] as const).map((n) => (
                  <div key={n} className="space-y-1.5">
                    <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                      Digging Sprite {n} (`sprite_${n}`)
                    </label>
                    <input
                      type="number"
                      value={project.digConfig[`sprite_${n}` as 'sprite_1' | 'sprite_2' | 'sprite_3']}
                      onChange={(e) =>
                        onChange({
                          digConfig: {
                            ...project.digConfig,
                            [`sprite_${n}`]: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {(!project.action || project.action === 'none') && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 text-xs text-stone-500">
              No extra action table will be declared under `missile`. The projectile flies in a classic unguided ballistic arc and detonates on impact or fuse expiration (Bazooka style).
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Burst Payload and its sub-sections */}
      {isBurstTab && (
        <div className="p-6 space-y-6">
          <div id="burst-payload" className="scroll-mt-6 space-y-6">
          <div>
            <h3 className="font-heading text-sm font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
              Burst Payload Selection (`burst`)
            </h3>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
              Select what happens at detonation: single blast (`"nothing"`), child cluster bits (`"clusters"`), or flame spread (`"fire"`).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-1.5 bg-stone-100 dark:bg-stone-800/80 rounded-xl border border-stone-200 dark:border-stone-700">
            {(
              [
                { id: 'nothing', label: 'Plain Blast', desc: 'No submunitions' },
                { id: 'clusters', label: 'Clusters', desc: 'Emits child clustlet bits' },
                { id: 'fire', label: 'Spreading Fire', desc: 'Spreads incendiary flames' },
              ] as const
            ).map((b) => {
              const isSelected = (project.burst || 'nothing') === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onChange({ burst: b.id })}
                  className={`flex flex-col items-start p-3 rounded-lg text-left transition-all ${
                    isSelected
                      ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs font-bold border border-forge-500/40'
                      : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white hover:bg-stone-200/50 dark:hover:bg-stone-700/50'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-bold uppercase">{b.label}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-forge-500" />}
                  </div>
                  <span className="text-[10px] text-stone-400 font-normal mt-0.5">{b.desc}</span>
                </button>
              );
            })}
          </div>

          {/* Clusters configuration */}
          {project.burst === 'clusters' && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4 animate-in fade-in">
              <div className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                Cluster Submunition Parameters (`clusters`)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Cluster Count (`count`)</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={clustlet.count}
                    onChange={(e) => updateClustlet({ count: Number(e.target.value) })}
                    className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Spread Angle (`spread`)</label>
                  <div className="relative">
                    <input
                      type="number"
                      min={10}
                      max={180}
                      value={clustlet.spread}
                      onChange={(e) => updateClustlet({ spread: Number(e.target.value) })}
                      className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                    />
                    <span className="absolute right-3 top-2 text-xs text-stone-400">deg</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Launch Power (`launch_power_pct`)</label>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      max={200}
                      value={clustlet.power}
                      onChange={(e) => updateClustlet({ power: Number(e.target.value) })}
                      className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                    />
                    <span className="absolute right-3 top-2 text-xs text-stone-400">%</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Clustlet Damage (`bit.explosion.power`)</label>
                  <input
                    type="number"
                    min={5}
                    max={150}
                    value={clustlet.damage}
                    onChange={(e) => updateClustlet({ damage: Number(e.target.value) })}
                    className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Clustlet Gravity (`bit.gravity_pct`)</label>
                  <input
                    type="number"
                    min={0}
                    max={200}
                    value={clustlet.gravity_pct}
                    onChange={(e) => updateClustlet({ gravity_pct: Number(e.target.value) })}
                    className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Clustlet Fuse (`bit.fuse`)</label>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      step={250}
                      value={clustlet.fuse}
                      onChange={(e) => updateClustlet({ fuse: Number(e.target.value) })}
                      className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                    />
                    <span className="absolute right-3 top-2 text-xs text-stone-400">ms</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <TooltipLabel label="Emission Angle" code="angle" desc="Native emission angle; preserve special base values." />
                  <div className="relative">
                    <input
                      type="number"
                      value={clustlet.angle}
                      onChange={(e) => updateClustlet({ angle: Number(e.target.value) })}
                      className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                    />
                    <span className="absolute right-3 top-2 text-xs text-stone-400">native</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <TooltipLabel label="Power Variation" code="power_variation_pct" desc="Random reduction applied to the launch strength." />
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={clustlet.power_variation}
                      onChange={(e) => updateClustlet({ power_variation: Number(e.target.value) })}
                      className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                    />
                    <span className="absolute right-3 top-2 text-xs text-stone-400">%</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <TooltipLabel
                    label="Bit Sprite Run"
                    code="bit.sprite_count"
                    desc="Consecutive sprite ids bits take in turn: bit.sprite + (i-1) % count. Use 1 with uploaded pack sheet."
                  />
                  <input
                    type="number"
                    min={0}
                    value={clustlet.sprite_count}
                    onChange={(e) => updateClustlet({ sprite_count: Number(e.target.value) })}
                    className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          )}
          </div>

          {project.burst === 'clusters' && (
            <div
              id="burst-bit"
              className="scroll-mt-6 p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4 animate-in fade-in"
            >
              {/* Cluster bit action & behaviour (`clusters.bit`) */}
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                    Cluster Bit Behaviour (`clusters.bit`)
                  </div>
                  <p className="text-[11px] text-stone-500 mt-0.5">
                    The child projectile is a full missile body. Impact explodes on first contact;
                    Bounce uses `bit.bounce`; Homing overrides contact. Bounce and homing bytes
                    overlap, so only the selected action&apos;s group is written.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5 sm:col-span-3">
                    <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                      Bit Action (`bit.action`)
                    </label>
                    <div className="grid grid-cols-5 gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-lg border border-stone-200 dark:border-stone-700 text-xs">
                      {(['none', 'bounce', 'homing', 'roam', 'dig'] as const).map((act) => (
                        <button
                          key={act}
                          type="button"
                          onClick={() =>
                            updateClustlet({
                              bit_action: act,
                              contact: act === 'bounce' ? 'bounce' : 'impact',
                              homing:
                                act === 'homing'
                                  ? clustlet.homing === 'off'
                                    ? 'lock'
                                    : clustlet.homing
                                  : 'off',
                              ...(act === 'roam' && !clustlet.roam
                                ? { roam: { ...DEFAULT_BIT_ROAM } }
                                : {}),
                              ...(act === 'dig' && !clustlet.dig
                                ? { dig: { ...DEFAULT_BIT_DIG } }
                                : {}),
                            })
                          }
                          className={`py-1.5 font-medium rounded-md capitalize transition-colors ${
                            bitAction === act
                              ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs font-bold'
                              : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                          }`}
                        >
                          {act === 'none' ? 'impact' : act}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-stone-400">
                      The child has its own action. Only the selected group is written; bounce,
                      homing, roam and dig share the same native body slots.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                      Bit Sprite (`bit.sprite`)
                    </label>
                    <input
                      type="text"
                      value={clustlet.sprite}
                      onChange={(e) => updateClustlet({ sprite: e.target.value })}
                      placeholder="clustlet / 54"
                      className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                    />
                    <p className="text-[10px] text-stone-400">
                      Stock name or id; an uploaded pack sheet replaces it at install.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                      Bit Trail (`bit.trail.sprite`)
                    </label>
                    <select
                      value={clustlet.trail}
                      onChange={(e) => updateClustlet({ trail: e.target.value })}
                      className="w-full text-xs px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                    >
                      <option value="">None</option>
                      <option value="smklt25">smklt25 (light smoke)</option>
                      <option value="smklt50">smklt50</option>
                      <option value="smklt75">smklt75</option>
                      <option value="smklt100">smklt100 (heavy smoke)</option>
                      <option value="skdsmoke">skdsmoke</option>
                      {!['', 'smklt25', 'smklt50', 'smklt75', 'smklt100', 'skdsmoke'].includes(clustlet.trail) && (
                        <option value={clustlet.trail}>{clustlet.trail}</option>
                      )}
                    </select>
                  </div>

                  {bitAnimField('animation', 'Bit Animation Type (`bit.animation`)', 0)}
                  {bitNum('speed_pct', 'Bit Speed (`bit.speed_pct`)', 100, 'Launch speed percentage.', { min: 0, max: 300, unit: '%' })}
                  {bitNum('wind_pct', 'Bit Wind Response (`bit.wind_pct`)', 100, 'Wind response percentage.', { min: 0, max: 300, unit: '%' })}
                  {bitNum('gravity_pct', 'Bit Gravity (`bit.gravity_pct`)', 100, 'Gravity percentage.', { min: 0, max: 300, unit: '%' })}
                  {bitNum('damage', 'Bit Explosion Power (`bit.explosion.power`)', 30, 'Child explosion damage/power.', { min: 0, max: 500 })}
                  {bitNum('explosion_bias', 'Bit Explosion Bias (`bit.explosion.bias`)', 0, 'Contact-explosion bias.')}
                  {bitNum('explosion_push_pct', 'Bit Explosion Push (`bit.explosion.push_pct`)', 100, 'Contact-explosion knockback.', { min: 0, max: 400, unit: '%' })}
                  {bitNum('explosion_variation', 'Bit Explosion Variation (`bit.explosion.variation`)', 0, 'Random variation applied to the child explosion.')}
                  {bitNum('countdown_ms', 'Bit Countdown (`bit.countdown`)', 0, 'Separate native countdown timer.', { min: 0, step: 500, unit: 'ms' })}
                  {bitNum('fuse', 'Bit Explosion Fuse (`bit.fuse`)', 5000, 'Milliseconds before detonation; 0 = impact.', { min: 0, step: 500, unit: 'ms' })}
                  {bitNum('flight_sound', 'Bit Flight Sound (`bit.flight_sound`)', 0, 'Native flight loop sound.')}
                </div>

                {/* Pack art for the child body. `cluster.sprite` and
                    `cluster.homing_sprite` are claim declarations; the trail
                    path goes straight into `clusters.bit.trail.sprite`. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <PackSpriteUpload
                    project={project}
                    onChange={onChange}
                    slot="cluster_sprite"
                    label="Bit Sprite Sheet (`cluster.sprite`)"
                    hint="Loaded as this weapon's cluster bit art and written to `clusters.bit.sprite` at install; the record field itself only takes stock ids."
                    warning={
                      bitBuilderMode(project) === 'builder'
                        ? 'The WFWS bit builder owns the cluster bits: this sheet is skipped and the bit art comes from Hold & Preview → Cluster bit art.'
                        : undefined
                    }
                    onUpload={() => {
                      // One pack sheet is installed as a single sprite id. The
                      // engine gives bit i `sprite + (i-1) % sprite_count`, so any
                      // other value would send bits 2..n to neighbouring WA
                      // sprites instead of this sheet.
                      updateClustlet({ sprite_count: 1 });
                    }}
                    rotate={{
                      // A generated direction sheet needs WA's direction mode:
                      // the frame is picked from the flight vector.
                      onRotate: () => updateClustlet({ animation: 2 }),
                    }}
                  />
                  <PackSpriteUpload
                    project={project}
                    onChange={onChange}
                    slot="cluster_trail"
                    label="Bit Trail Sheet (`clusters.bit.trail.sprite`)"
                    hint="Scoped to this weapon's child trail. The bit trail power, speed and bubbles below still apply."
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {bitNum('trail_power', 'Bit Trail Power (`bit.trail.power`)', 0, 'Trail emission strength.')}
                  {bitNum('trail_speed', 'Bit Trail Speed (`bit.trail.speed`)', 0, 'Trail emission rate.')}
                  {bitNum('trail_bubbles', 'Bit Trail Bubbles (`bit.trail.bubbles_per_second`)', 0, 'Bubble trail per second.')}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!clustlet.explode_on_space}
                      onChange={(e) => updateClustlet({ explode_on_space: e.target.checked })}
                      className="rounded text-forge-600 focus:ring-forge-500 mt-0.5"
                    />
                    <div>
                      <div className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                        Explode On Space (`bit.explode_on_space`)
                      </div>
                      <div className="text-[11px] text-stone-500">
                        Allows the bit to detonate when Space is pressed.
                      </div>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!clustlet.explosion_sound_enabled}
                      onChange={(e) => updateClustlet({ explosion_sound_enabled: e.target.checked })}
                      className="rounded text-forge-600 focus:ring-forge-500 mt-0.5"
                    />
                    <div>
                      <div className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                        Pre-Explosion Sound (`bit.explosion_sound`)
                      </div>
                      <div className="text-[11px] text-stone-500">
                        Plays a native sound before the child explosion.
                      </div>
                    </div>
                  </label>
                </div>

                {clustlet.explosion_sound_enabled && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-2 border-l-2 border-forge-500/30">
                    {bitNum('explosion_sound', 'Sound ID (`bit.explosion_sound.sound`)', 0, 'Native sound identifier.')}
                    {bitNum('explosion_sound_before', 'Lead Time (`bit.explosion_sound.before`)', 0, 'Milliseconds before the explosion.', { min: 0, step: 100, unit: 'ms' })}
                  </div>
                )}

              </div>
            </div>
          )}

          {project.burst === 'clusters' && (
            <div
              id="burst-bit-collision"
              className="scroll-mt-6 p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-3 animate-in fade-in"
            >
              <div className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                Bit Contact Ends On (`bit.ends_on_contact`)
              </div>
              <p className="text-[11px] text-stone-500">
                Targets whose contact ends the child. `bounce.hits` is separate: it only
                adds targets the bounce action reacts to.
              </p>
              {bitMaskGrid('ends_on_contact', clustlet.ends_on_contact)}
            </div>
          )}

                {project.burst === 'clusters' && bitAction === 'bounce' && (
                  <div
                    id="burst-bit-bounce"
                    className="scroll-mt-6 p-3 rounded-xl border border-forge-500/30 bg-forge-50/10 dark:bg-forge-950/10 space-y-4"
                  >
                    <div className="text-[11px] font-bold text-forge-700 dark:text-forge-300 uppercase tracking-wide">
                      Bit Bounce Configuration (`clusters.bit.bounce`)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {bitNum('bounciness', 'Bounciness (`bounce.bounciness`)', 0, '0 is standard grenade bounciness.', { min: 0, max: 100 })}
                      {bitNum('bounce_terrain_keep_speed_pct', 'Terrain Keep (`bounce.terrain_keep_speed_pct`)', 75, 'Momentum preserved when ricocheting off soil.', { min: 0, max: 100, unit: '%' })}
                      {bitNum('bounce_sound', 'Bounce Sound (`bounce.sound`)', 0, 'Native sound identifier (0 = none).')}
                      {bitNum('bounce_contact_sides', 'Contact Sides (`bounce.contact_sides`)', 0, 'Native side mask for the bounce limit and contact explosion.')}
                      {bitNum('bounce_extra_reverse_chance_pct', 'Extra Reverse (`bounce.extra_reverse_chance_pct`)', 0, 'Chance of an extra horizontal reversal.', { min: 0, max: 100, unit: '%' })}
                      {bitNum('bounces', 'Max Bounces (`bounce.max_bounces`)', 0, '0 leaves normal fuse timing.', { min: 0, max: 20 })}
                    </div>

                    <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={clustlet.bounce_explode}
                        onChange={(e) =>
                          updateClustlet({
                            bounce_explode: e.target.checked,
                            ...(e.target.checked && !clustlet.bounce_power
                              ? { bounce_power: clustlet.damage }
                              : {}),
                          })
                        }
                        className="rounded text-forge-600 focus:ring-forge-500 mt-0.5"
                      />
                      <div>
                        <div className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                          Explode on Bounce (`bounce.explosion`)
                        </div>
                        <div className="text-[11px] text-stone-500">
                          Adds a contact explosion when the child bounces.
                        </div>
                      </div>
                    </label>

                    {clustlet.bounce_explode && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pl-2 border-l-2 border-forge-500/30">
                        {bitNum('bounce_power', 'Explosion Power (`bounce.explosion.power`)', 0, 'Contact-explosion power.', { min: 0, max: 500 })}
                        {bitNum('bounce_explosion_push_pct', 'Explosion Push (`bounce.explosion.push_pct`)', 100, 'Contact-explosion knockback.', { min: 0, max: 400, unit: '%' })}
                        {bitNum('bounce_explosion_bias', 'Explosion Bias (`bounce.explosion.bias`)', 0, 'Contact-explosion bias.')}
                        {bitNum('bounce_explosion_variation', 'Explosion Variation (`bounce.explosion.variation`)', 0, 'Random variation.')}
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="text-[11px] font-bold text-stone-700 dark:text-stone-300 uppercase tracking-wide">
                        Bounce Collision Targets (`bounce.hits`)
                      </div>
                      {bitMaskGrid('bounce_hits', clustlet.bounce_hits)}
                    </div>
                  </div>
                )}

                {project.burst === 'clusters' && bitAction === 'homing' && (
                  <div
                    id="burst-bit-homing"
                    className="scroll-mt-6 p-3 rounded-xl border border-sky-500/30 bg-sky-50/10 dark:bg-sky-950/10 space-y-4"
                  >
                    <div className="text-[11px] font-bold text-sky-700 dark:text-sky-300 uppercase tracking-wide">
                      Bit Homing Configuration (`clusters.bit.homing`)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                          Homing Kind (`homing.kind`)
                        </label>
                        <select
                          value={clustlet.homing === 'off' ? 'lock' : clustlet.homing}
                          onChange={(e) =>
                            updateClustlet({ homing: e.target.value as ClustletConfig['homing'] })
                          }
                          className="w-full text-xs px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                        >
                          <option value="lock">Lock</option>
                          <option value="dodge">Dodge</option>
                        </select>
                      </div>
                      {bitNum('homing_sprite', 'Homing Sprite (`homing.sprite`)', 0, 'Native homing flight sprite.')}
                      {bitAnimField('homing_animation', 'Homing Animation Type (`homing.animation`)', 0)}
                      {bitNum('homing_arm_ms', 'Arm Delay (`homing.arm`)', 1000, 'Milliseconds before steering begins.', { min: 0, step: 250, unit: 'ms' })}
                      {bitNum('homing_time_ms', 'Duration (`homing.time`)', 8000, 'Steering duration.', { min: 0, step: 500, unit: 'ms' })}
                      {bitNum('homing_trail_sprite', 'Homing Trail (`homing.trail.sprite`)', 0, 'Homing trail sprite.')}
                      {bitNum('homing_trail_power', 'Homing Trail Power (`homing.trail.power`)', 0, 'Homing trail emission strength.')}
                      {bitNum('homing_trail_speed', 'Homing Trail Speed (`homing.trail.speed`)', 0, 'Homing trail emission rate.')}
                      {bitNum('homing_trail_bubbles', 'Homing Trail Bubbles (`homing.trail.bubbles_per_second`)', 0, 'Bubbles per second.')}
                    </div>
                    {isStrike ? (
                      <p className="text-[10px] text-stone-400">
                        Strike records are not offered a homing-bit sheet: the engine
                        applies it with set_cluster_render_timer at +0x170 without the
                        strike shift (+0x14), so it would land in the shifted cluster
                        block. A strike&apos;s munition homing art follows the claim
                        sheet instead.
                      </p>
                    ) : (
                      <PackSpriteUpload
                        project={project}
                        onChange={onChange}
                        slot="cluster_homing_sprite"
                        label="Homing Bit Sheet (`cluster.homing_sprite`)"
                        hint="Drawn by homing bits while they home (their render timer), scoped to this weapon."
                        warning={
                          bitBuilderMode(project) === 'builder'
                            ? 'The WFWS bit builder owns the bits: this claim sheet is skipped. Use Hold & Preview → Homing cluster bit art for the homing pose.'
                            : undefined
                        }
                      />
                    )}
                  </div>
                )}

                {project.burst === 'clusters' && bitAction === 'roam' && (
                  <div
                    id="burst-bit-roam"
                    className="scroll-mt-6 p-3 rounded-xl border border-amber-500/30 bg-amber-50/10 dark:bg-amber-950/10 space-y-4"
                  >
                    <div className="text-[11px] font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wide">
                      Bit Roaming Configuration (`clusters.bit.roam`)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {bitRoamNum('walk_speed', 'Walk Speed (`walk_speed`)', 'Grounded walk speed in pixels/frame (PX 100 = 2.0).', { min: 0, max: 10, step: 0.02, unit: 'px/f' })}
                      {bitRoamNum('step_height', 'Step Height (`step_height`)', 'Vertical terrain search limit in whole pixels.', { step: 1, unit: 'px' })}
                      {bitRoamNum('terrain_offset', 'Terrain Offset (`terrain_offset`)', 'Signed vertical drawing adjustment while grounded.', { step: 1, unit: 'px' })}
                    </div>

                    <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-3">
                      <div className="text-[11px] font-bold text-stone-700 dark:text-stone-300 uppercase tracking-wide">
                        Jump At Edge (`roam.edge_jump`)
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {bitRoamNum('edge_jump_angle_deg', 'Jump Angle At Edge (`angle_deg`)', 'Native edge-jump angle.', { step: 1, unit: 'deg' })}
                        {bitRoamNum('edge_jump_speed', 'Jump Velocity At Edge (`speed`)', 'Nominal pixels/frame.', { min: 0, max: 10, step: 0.06, unit: 'px/f' })}
                        {bitRoamNum('edge_jump_sound', 'Jump Sound At Edge (`sound`)', 'Native sound identifier (0 = none).')}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-3">
                      <div className="text-[11px] font-bold text-stone-700 dark:text-stone-300 uppercase tracking-wide">
                        Jump (`roam.jump`)
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {bitRoamNum('jump_angle_deg', 'Jump Angle (`angle_deg`)', 'Native jump angle.', { step: 1, unit: 'deg' })}
                        {bitRoamNum('jump_speed', 'Jump Velocity (`speed`)', 'Nominal pixels/frame.', { min: 0, max: 10, step: 0.06, unit: 'px/f' })}
                        {bitRoamNum('jump_sound', 'Jump Sound (`sound`)', 'Native sound identifier (0 = none).')}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-3">
                      <div className="text-[11px] font-bold text-stone-700 dark:text-stone-300 uppercase tracking-wide">
                        Gas / Fart (`roam.gas`)
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {bitRoamNum('gas_start_delay_ms', 'Start Delay (`start_delay_ms`)', 'Nonzero arms the emission countdown.', { min: 0, step: 100, unit: 'ms' })}
                        {bitRoamNum('gas_poison_power', 'Disease Power (`poison_power`)', 'Native poison-message amount.', { min: 0 })}
                        {bitRoamNum('gas_animal_sprite', 'Sprite When Farting (`animal_sprite`)', 'Emitting animal pose; 0 = none.')}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-2">
                      <div className="text-[11px] font-bold text-stone-700 dark:text-stone-300 uppercase tracking-wide">
                        Movement Collision Targets (`roam.hits`)
                      </div>
                      {bitRoamMaskGrid('hits')}
                    </div>

                    <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-2">
                      <div className="text-[11px] font-bold text-stone-700 dark:text-stone-300 uppercase tracking-wide">
                        Steered Flight Collision Targets (`roam.flight_hits`)
                      </div>
                      {bitRoamMaskGrid('flight_hits')}
                    </div>
                  </div>
                )}

                {project.burst === 'clusters' && bitAction === 'dig' && (
                  <div
                    id="burst-bit-dig"
                    className="scroll-mt-6 p-3 rounded-xl border border-orange-500/30 bg-orange-50/10 dark:bg-orange-950/10 space-y-4"
                  >
                    <div className="text-[11px] font-bold text-orange-700 dark:text-orange-300 uppercase tracking-wide">
                      Bit Digging Configuration (`clusters.bit.dig`)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {bitDigNum('sound', 'Digging Sound (`sound`)', 'Native digging sound identifier.')}
                      {bitDigNum('dive_sprite', 'Dive Sprite (`dive_sprite`)', 'PX “Sprite while jumping”.')}
                      {bitDigNum('sprite_1', 'Digging Sprite 1 (`sprite_1`)', 'Native digging frame 1.')}
                      {bitDigNum('sprite_2', 'Digging Sprite 2 (`sprite_2`)', 'Native digging frame 2.')}
                      {bitDigNum('sprite_3', 'Digging Sprite 3 (`sprite_3`)', 'Native digging frame 3.')}
                    </div>
                  </div>
                )}

          {/* Fire payload configuration */}
          {project.burst === 'fire' && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4 animate-in fade-in">
              <div className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                Flame Spread Configuration (`missile.fire`)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Spread Delay (`spread_delay_ms`)</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={project.fireConfig.spread_delay_ms}
                      onChange={(e) =>
                        onChange({ fireConfig: { ...project.fireConfig, spread_delay_ms: Number(e.target.value) } })
                      }
                      className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                    />
                    <span className="absolute right-3 top-2 text-xs text-stone-400">ms</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Burn Duration (`burn_time_ms`)</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={project.fireConfig.burn_time_ms}
                      onChange={(e) =>
                        onChange({ fireConfig: { ...project.fireConfig, burn_time_ms: Number(e.target.value) } })
                      }
                      className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                    />
                    <span className="absolute right-3 top-2 text-xs text-stone-400">ms</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Spread Generations (`spread_generations`)</label>
                  <input
                    type="number"
                    min={0}
                    max={25}
                    value={project.fireConfig.spread_generations}
                    onChange={(e) =>
                      onChange({ fireConfig: { ...project.fireConfig, spread_generations: Number(e.target.value) } })
                    }
                    className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Decay Mode (`decay_mode`)</label>
                  <select
                    value={project.fireConfig.decay_mode}
                    onChange={(e) =>
                      onChange({ fireConfig: { ...project.fireConfig, decay_mode: e.target.value as any } })
                    }
                    className="w-full text-xs px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  >
                    <option value="resting">Resting (decays while settled on ground)</option>
                    <option value="on_hit">On Hit (consumed through direct contact)</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Native Indices & Particles (missile.sprite, missile.trail, sounds) */}
      {activeSubTab === 'sprite' && (
        <div className="p-6 space-y-6 animate-in fade-in">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-heading text-sm font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-2">
                <Sliders className="w-4 h-4 text-cyan-500" />
                <span>Sprite & Particle Indices (`missile.sprite`, `trail`, `sounds`)</span>
              </h3>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                Configure native engine sprite indices, particle trail power/speed, impact debris, and audio sound IDs.
              </p>
            </div>
          </div>

          {/* Sprite Builder Note & Separation of Concerns Banner */}
          <div className="p-4 rounded-xl border border-cyan-200 dark:border-cyan-900/60 bg-cyan-50/50 dark:bg-cyan-950/20 text-xs text-cyan-900 dark:text-cyan-200 flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-cyan-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-cyan-950 dark:text-cyan-100">
                Notice: Sprite Builder Separation
              </div>
              <p className="text-cyan-800/90 dark:text-cyan-300/90 leading-relaxed">
                This tab configures Worms Armageddon's internal <strong>record offsets & indices</strong>. If you are uploading custom PNG missile flight sheets, tuning cyclical frame animations, or setting up trajectory tracking, use the dedicated <strong className="font-semibold underline">Hold & Sprite Builder</strong> tab above. Selecting <code className="bg-cyan-100 dark:bg-cyan-900/50 px-1 py-0.5 rounded font-mono">0 — Custom / Hidden</code> here automatically tells the engine to hide the built-in projectile so your custom Sprite Builder overlay displays cleanly without clipping.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Card 1: Missile Sprite Index & Animation */}
            <div className="p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-850/40 space-y-4">
              <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-700/80 pb-2.5">
                <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-2">
                  <Bomb className="w-4 h-4 text-rose-500" />
                  Missile Sprite Index (`missile.sprite`)
                </span>
                <span className="font-mono text-[10px] text-stone-400">Record 0x14</span>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                    Stock Sprite Preset (`sprite`)
                  </label>
                  <select
                    value={
                      project.recordOverrides['missile.sprite'] !== undefined
                        ? String(project.recordOverrides['missile.sprite'])
                        : (project.missileSprite?.hideStock ? '0' : (project.missileSprite?.stockSprite || 'bazooka'))
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '0') {
                        updateOverride('missile.sprite', 0);
                        onChange({
                          missileSprite: {
                            ...project.missileSprite,
                            hideStock: true,
                          },
                        });
                      } else {
                        updateOverride('missile.sprite', val);
                        onChange({
                          missileSprite: {
                            ...project.missileSprite,
                            stockSprite: val,
                            hideStock: false,
                          },
                        });
                      }
                    }}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  >
                    {STOCK_MISSILE_SPRITES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-stone-500">
                    Choose standard stock WA weapon art, or 0 when drawing custom Sprite Builder frames.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                    Custom / Raw Sprite Identifier Override
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 0, bazooka, or custom sprite ID"
                    value={
                      project.recordOverrides['missile.sprite'] !== undefined
                        ? String(project.recordOverrides['missile.sprite'])
                        : ''
                    }
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      if (val === '') {
                        updateOverride('missile.sprite', undefined);
                      } else if (!isNaN(Number(val))) {
                        updateOverride('missile.sprite', Number(val));
                      } else {
                        updateOverride('missile.sprite', val);
                      }
                    }}
                    className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                  <p className="text-[11px] text-stone-500">
                    Direct numeric offset or named sprite table selector in native engine record.
                  </p>
                </div>

                {animField('missile.animation', 'Native Flight Animation Type (`missile.animation`)', 0)}
              </div>
            </div>

            {/* Strike munition art. The sprite builder follows a placed weapon's
                missile, so an air strike's munition can only take pack art here. */}
            {isStrike && (
              <div className="p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-850/40 space-y-3">
                <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-700/80 pb-2.5">
                  <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-forge-500" />
                    Strike Munition Art (`sprite`)
                  </span>
                  <span className="font-mono text-[10px] text-stone-400">body 0x74</span>
                </div>
                <p className="text-[11px] text-stone-500">
                  Air strikes fire created munitions, so the sprite builder has no
                  missile to follow. The claim&apos;s `sprite` is installed as the strike
                  munition&apos;s art and carried into its homing sprite (0xC0) and cluster
                  sprite (0x138) when they share the stock body.
                </p>
                <PackSpriteUpload
                  project={project}
                  onChange={onChange}
                  slot="strike_sprite"
                  label="Munition Sheet (`sprite`)"
                  hint="Written to sprites/<mod>/body.png and installed on the strike body. A single frame is static; 32 direction frames match WA's airmisl order."
                  rotate={{
                    // `missile.animation` on a strike is the munition body's field;
                    // 2 picks the frame from the flight direction.
                    onRotate: () => updateOverride('missile.animation', 2),
                  }}
                />
              </div>
            )}

            {/* Card 2: Particle Trail Settings & Impact Particles */}
            <div className="p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-850/40 space-y-4">
              <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-700/80 pb-2.5">
                <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  Particle Trail & Effects (`missile.trail`)
                </span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!project.recordOverrides['missile.trail.enabled']}
                    onChange={(e) => {
                      if (!e.target.checked) {
                        updateOverride('missile.trail.enabled', false);
                        return;
                      }
                      updateOverrides({
                        'missile.trail.enabled': true,
                        ...(project.recordOverrides['missile.trail.power'] === undefined
                          ? {
                              'missile.trail.power': 25,
                              'missile.trail.speed': 250,
                              'missile.trail.sprite': 'smoke',
                            }
                          : {}),
                      });
                    }}
                    className="rounded text-forge-600 focus:ring-forge-500 w-3.5 h-3.5"
                  />
                  <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                    Enable Trail
                  </span>
                </label>
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-[10px] text-stone-400 font-medium mr-1 uppercase">Presets:</span>
                <button
                  type="button"
                  onClick={() =>
                    updateOverrides({
                      'missile.trail.enabled': true,
                      'missile.trail.sprite': 'smoke',
                      'missile.trail.power': 25,
                      'missile.trail.speed': 250,
                    })
                  }
                  className="px-2 py-1 text-[11px] rounded bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 font-medium transition-colors cursor-pointer"
                >
                  Smoke Trail
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateOverrides({
                      'missile.trail.enabled': true,
                      'missile.trail.sprite': 'sparks',
                      'missile.trail.power': 40,
                      'missile.trail.speed': 180,
                    })
                  }
                  className="px-2 py-1 text-[11px] rounded bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 font-medium transition-colors cursor-pointer"
                >
                  Spark Emitter
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateOverrides({
                      'missile.trail.enabled': true,
                      'missile.trail.sprite': 'fire_smoke',
                      'missile.trail.power': 50,
                      'missile.trail.speed': 320,
                    })
                  }
                  className="px-2 py-1 text-[11px] rounded bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 font-medium transition-colors cursor-pointer"
                >
                  Fire Smoke
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updateOverride('missile.trail.enabled', false);
                  }}
                  className="px-2 py-1 text-[11px] rounded bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700 text-rose-500 font-medium transition-colors cursor-pointer"
                >
                  Clear Trail
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                    Particle Power / Density (`power`)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={project.recordOverrides['missile.trail.power'] ?? 25}
                    onChange={(e) => updateOverride('missile.trail.power', Number(e.target.value))}
                    disabled={!project.recordOverrides['missile.trail.enabled']}
                    className="w-full text-xs font-mono px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white disabled:opacity-50"
                  />
                  <p className="text-[10px] text-stone-400">Emission rate / density of particles.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                    Particle Ejection Speed (`speed`)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    step={10}
                    value={project.recordOverrides['missile.trail.speed'] ?? 250}
                    onChange={(e) => updateOverride('missile.trail.speed', Number(e.target.value))}
                    disabled={!project.recordOverrides['missile.trail.enabled']}
                    className="w-full text-xs font-mono px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white disabled:opacity-50"
                  />
                  <p className="text-[10px] text-stone-400">Initial ejection velocity of trail sprites.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                    Particle Sprite Identifier (`sprite`)
                  </label>
                  <input
                    type="text"
                    value={project.recordOverrides['missile.trail.sprite'] ?? 'smoke'}
                    onChange={(e) => updateOverride('missile.trail.sprite', e.target.value)}
                    disabled={!project.recordOverrides['missile.trail.enabled']}
                    className="w-full text-xs font-mono px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white disabled:opacity-50"
                  />
                  <p className="text-[10px] text-stone-400">
                    Stock name (smoke, sparks) or numeric id. An uploaded pack sheet
                    replaces it.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                    Underwater Bubbles / sec
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    step={0.25}
                    value={project.recordOverrides['missile.trail.bubbles_per_second'] ?? 0}
                    onChange={(e) => updateOverride('missile.trail.bubbles_per_second', Number(e.target.value))}
                    disabled={!project.recordOverrides['missile.trail.enabled']}
                    className="w-full text-xs font-mono px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white disabled:opacity-50"
                  />
                  <p className="text-[10px] text-stone-400">0 disables underwater bubble emission.</p>
                </div>
              </div>

              {/* Pack trail art: `missile.trail.sprite` also accepts a bundle
                  image path, loaded and scoped to this weapon at install. */}
              <div className="pt-2 border-t border-stone-200 dark:border-stone-700/80 space-y-2">
                <div className="text-[11px] font-bold text-stone-700 dark:text-stone-300 uppercase tracking-wide">
                  Pack Trail Art
                </div>
                <PackSpriteUpload
                  project={project}
                  onChange={onChange}
                  slot="missile_trail"
                  label="Trail Sheet (`missile.trail.sprite`)"
                  hint="Replaces the stock trail sprite for this weapon only; the power and speed above still apply."
                  onUpload={() => {
                    // Uploading art means the trail should show: mirror the
                    // Enable Trail checkbox, which fills in the usual defaults.
                    const updated = { ...project.recordOverrides };
                    updated['missile.trail.enabled'] = true;
                    if (updated['missile.trail.power'] === undefined) {
                      updated['missile.trail.power'] = 25;
                    }
                    if (updated['missile.trail.speed'] === undefined) {
                      updated['missile.trail.speed'] = 250;
                    }
                    onChange({ recordOverrides: updated });
                  }}
                />
              </div>

              {/* Impact Particles check */}
              <div className="pt-2 border-t border-stone-200 dark:border-stone-700/80">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!project.recordOverrides['missile.impact_particles']}
                    onChange={(e) => updateOverride('missile.impact_particles', e.target.checked)}
                    className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4 mt-0.5"
                  />
                  <div>
                    <span className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                      Enable Impact Particles (`missile.impact_particles`)
                    </span>
                    <p className="text-[11px] text-stone-500 mt-0.5">
                      Enables the brief lingering particle burst upon impact and detonation (as seen with Holy Hand Grenade).
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Card 3: Native Sound & Sub-Action Indices */}
            <div className="md:col-span-2 p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-850/40 space-y-4">
              <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-700/80 pb-2.5">
                <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-forge-500" />
                  Native Audio & Action Indices (`flight_sound`, `launch_sound`, `bounce.sound`, `dive_sprite`)
                </span>
                <span className="font-mono text-[10px] text-stone-400">Sound & Action Table</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                    Flight Sound ID (`flight_sound`)
                  </label>
                  <input
                    type="number"
                    min={0}
                    placeholder="e.g. 95 (0 = silent)"
                    value={project.recordOverrides['missile.flight_sound'] ?? ''}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      updateOverride('missile.flight_sound', val === '' ? undefined : Number(val));
                    }}
                    className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                  <p className="text-[10px] text-stone-400">Native continuous in-flight audio loop (95 = rocket hum).</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                    Launch Sound ID (`launch_sound`)
                  </label>
                  <input
                    type="number"
                    min={0}
                    placeholder="e.g. 42 (0 = none)"
                    value={project.recordOverrides['missile.launch_sound'] ?? ''}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      updateOverride('missile.launch_sound', val === '' ? undefined : Number(val));
                    }}
                    className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                  <p className="text-[10px] text-stone-400">Positional audio played once upon projectile launch.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                    Bounce Sound ID (`bounce.sound`)
                  </label>
                  <input
                    type="number"
                    min={0}
                    placeholder="e.g. 110"
                    value={project.recordOverrides['missile.bounce.sound'] ?? ''}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      updateOverride('missile.bounce.sound', val === '' ? undefined : Number(val));
                    }}
                    className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                  <p className="text-[10px] text-stone-400">Played when contacting terrain during bounce action.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                    Dive Sprite Index (`dig.dive_sprite`)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={project.digConfig.dive_sprite ?? 0}
                    onChange={(e) =>
                      onChange({
                        digConfig: {
                          ...project.digConfig,
                          dive_sprite: Number(e.target.value),
                        },
                      })
                    }
                    className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                  <p className="text-[10px] text-stone-400">Sprite index when drilling or diving into landscape.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: Effects-SDK trail and explosion burst */}
      {activeSubTab === 'effects' && (
        <div className="p-6 space-y-6 animate-in fade-in">
          <div>
            <h3 className="font-heading text-sm font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-forge-500" />
              Effects (`wf-lib/effects`, `wa.sound`)
            </h3>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
              Claim hooks rather than native record fields: the Project X ribbon trail, the
              electric-style explosion burst, and uploaded WAVs played with `wa.sound.play` — at the
              blast or on an interval. Their colour, shape, sound and timing are free.
            </p>
          </div>

          {effectsAvailable ? (
            <>
              <RibbonTrailCard project={project} onChange={onChange} />
              <ExplosionEffectCard project={project} onChange={onChange} />
              <CustomSoundsCard project={project} onChange={onChange} />
            </>
          ) : (
            <div className="p-6 rounded-xl border border-dashed border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/20 text-center space-y-2">
              <Sparkles className="w-8 h-8 text-stone-400 mx-auto" />
              <div className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                This record family has no native effect to decorate
              </div>
              <p className="text-xs text-stone-500 max-w-xl mx-auto">
                Guns, arrows, sprays, specials and air strikes do not fire a missile this claim owns,
                so the ribbon trail, the explosion burst and the sound hooks cannot run. Air-strike
                bombs are built by the strike entity from its own record copy, which the engine never
                maps to a weapon slot.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Tab 5: Collision Bitmasks */}
      {activeSubTab === 'advanced' && (
        <div className="p-6 space-y-6">
          <div>
            <h3 className="font-heading text-sm font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
              Advanced Native Record Fields
            </h3>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
              Less common missile-body values that `.wep` files carry. Unchanged values stay
              inherited from the imported record; only edits are written as overrides.
            </p>
          </div>

          <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4">
            <div className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
              Explosion Shaping & Random Motion
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {numField(
                'missile.explosion.bias',
                'Explosion Bias (`explosion.bias`)',
                0,
                'Native explosion bias value from the base record.'
              )}
              {numField(
                'missile.explosion.variation',
                'Damage Variation (`explosion.variation`)',
                0,
                'Native random variation applied to explosion damage.'
              )}
              {numField(
                'missile.random_motion',
                'Random Motion (`random_motion`)',
                0,
                'Native random-motion parameter (base weapon dependent).'
              )}
              {numField(
                'missile.collision_shape',
                'Collision Shape (`collision_shape`)',
                0,
                'Numeric physical-outline preset; inherit unless tested.'
              )}
            </div>
          </div>

          <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4">
            <div className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
              Pre-Explosion Sound (`explosion_sound`)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!project.recordOverrides['missile.explosion_sound.enabled']}
                  onChange={(e) =>
                    updateOverride('missile.explosion_sound.enabled', e.target.checked)
                  }
                  className="rounded text-forge-600 focus:ring-forge-500 mt-0.5"
                />
                <div>
                  <div className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                    Enabled (`enabled`)
                  </div>
                  <div className="text-[11px] text-stone-500">
                    Plays a sound shortly before the timed explosion.
                  </div>
                </div>
              </label>
              {numField(
                'missile.explosion_sound.sound',
                'Sound ID (`sound`)',
                0,
                'Native sound identifier (0 = none).'
              )}
              {numField(
                'missile.explosion_sound.before',
                'Lead Time (`before`)',
                0,
                'Milliseconds before detonation to play the sound.',
                { step: 50, unit: 'ms' }
              )}
            </div>
          </div>

          {project.action === 'bounce' && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4">
              <div className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                Bounce Extras (`missile.bounce`)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {numField(
                  'missile.bounce.contact_sides',
                  'Contact Sides (`contact_sides`)',
                  0,
                  'Native side mask for bounce-limit contacts and contact explosions.'
                )}
                {numField(
                  'missile.bounce.extra_reverse_chance_pct',
                  'Extra Reverse Chance (`extra_reverse_chance_pct`)',
                  0,
                  'Chance of an extra horizontal reversal before normal collision.',
                  { min: 0, max: 100, unit: '%' }
                )}
                {numField(
                  'missile.bounce.sound',
                  'Bounce Sound (`sound`)',
                  0,
                  'Native sound identifier played on bounce (0 = none).'
                )}
                {numField(
                  'missile.bounce.explosion.bias',
                  'Bounce Explosion Bias (`explosion.bias`)',
                  0,
                  'Contact-explosion bias for the bounce action.'
                )}
                {numField(
                  'missile.bounce.explosion.push_pct',
                  'Bounce Push (`explosion.push_pct`)',
                  100,
                  'Contact-explosion knockback percentage.',
                  { min: 0, max: 400, unit: '%' }
                )}
                {numField(
                  'missile.bounce.explosion.power',
                  'Bounce Explosion Power (`explosion.power`)',
                  0,
                  'Contact-explosion power; 0 disables the contact blast.'
                )}
                {numField(
                  'missile.bounce.explosion.variation',
                  'Bounce Explosion Variation (`explosion.variation`)',
                  0,
                  'Random variation applied to the contact-explosion power.'
                )}
              </div>
            </div>
          )}

          {project.action === 'homing' && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4">
              <div className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                Homing Art & Trail (`missile.homing`)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {spriteField(
                  'missile.homing.sprite',
                  'Homing Sprite (`homing.sprite`)',
                  'homing',
                  'Stock sprite name or numeric id used while homing.'
                )}
                {animField(
                  'missile.homing.animation',
                  'Homing Animation Type (`homing.animation`)',
                  0
                )}
                {spriteField(
                  'missile.homing.trail.sprite',
                  'Homing Trail Sprite (`homing.trail.sprite`)',
                  '',
                  'Stock trail sprite name or id; empty or 0 disables it.'
                )}
                {numField(
                  'missile.homing.trail.power',
                  'Homing Trail Power (`homing.trail.power`)',
                  0,
                  'Particle density while homing.'
                )}
                {numField(
                  'missile.homing.trail.speed',
                  'Homing Trail Speed (`homing.trail.speed`)',
                  0,
                  'Particle ejection speed while homing.'
                )}
                {numField(
                  'missile.homing.trail.bubbles_per_second',
                  'Homing Trail Bubbles / sec',
                  0,
                  'Underwater bubble rate while homing, in steps of 0.25.',
                  { min: 0, max: 20, step: 0.25 }
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {activeSubTab === 'collisions' && (
        <div className="p-6 space-y-8">
          <div className="space-y-3">
            <div>
              <h3 className="font-heading text-sm font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                Ends on Contact (`ends_on_contact`)
              </h3>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                Targets whose contact ends the projectile and runs its configured payload. These always participate in collision checks.
              </p>
            </div>
            {maskGrid('missile.ends_on_contact', endsOnContactMask)}
          </div>

          <div className="space-y-3 pt-5 border-t border-stone-200/60 dark:border-stone-800/60">
            <div>
              <h3 className="font-heading text-sm font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                Bounce Hits (`bounce.hits`)
              </h3>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                Extra targets the Bounce action reacts to. Added to <code className="font-mono">ends_on_contact</code>, never a replacement; only written when Action is Bounce.
              </p>
            </div>
            {maskGrid('missile.bounce.hits', bounceHitsMask)}
            {project.action !== 'bounce' && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Action is currently <b>{project.action || 'none'}</b>, so these are kept in the editor but not emitted. Switch Action to Bounce to use them.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Tab 6: Custom Lua Callbacks (Explicit Checkbox Required!) */}
      {activeSubTab === 'callbacks' && (
        <div className="p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between pb-3 border-b border-stone-100 dark:border-stone-800 gap-3">
            <div>
              <h3 className="font-heading text-sm font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                Custom Lua Callbacks (`on_explode`, simulation hooks)
              </h3>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                Execute custom script logic during game simulation events (e.g. terrain carving, child missile launches).
              </p>
            </div>

            <label className="flex items-center gap-2 cursor-pointer bg-stone-100 dark:bg-stone-800 px-3.5 py-2 rounded-lg border border-stone-300 dark:border-stone-700">
              <input
                type="checkbox"
                checked={project.enableCustomLua || false}
                onChange={(e) => onChange({ enableCustomLua: e.target.checked })}
                className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4 cursor-pointer"
              />
              <span className="text-xs font-bold text-stone-900 dark:text-stone-100">
                Enable Custom Lua Callbacks
              </span>
            </label>
          </div>

          {!project.enableCustomLua ? (
            <div className="p-6 rounded-xl border border-dashed border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/20 text-center space-y-2">
              <Code2 className="w-8 h-8 text-stone-400 mx-auto" />
              <div className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                Custom Lua Callbacks are Currently Disabled
              </div>
              <p className="text-xs text-stone-500 max-w-md mx-auto">
                Check the &quot;Enable Custom Lua Callbacks&quot; checkbox above to inject custom simulation event hooks into your weapon component.
              </p>
            </div>
          ) : (
            <div className="space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between text-xs text-stone-500">
                <span>Lua code injected directly inside <code className="font-mono text-forge-600">wa.weapons.replace&#123; ... &#125;</code>:</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        customLuaSnippet: `on_explode = function(ev)
  -- Cut three craters in ground below detonation
  for i = 0, 2 do
    local angle = math.rad(20 + 60 * i + wa.random(0, 20))
    local distance = wa.random(60, 85)
    wa.land.cut{
      x = ev.x + distance * wa.math.cos(angle),
      y = ev.y + distance * wa.math.sin(angle),
      shape = "circle",
      radius = wa.random(12, 18),
    }
  end
  wa.log("craters cut below burst")
end,`,
                      })
                    }
                    className="text-[11px] text-forge-600 hover:underline font-mono"
                  >
                    Template: Moon Grenade (Craters)
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        customLuaSnippet: `on_explode = function(ev)
  -- Launch 5 child missiles with upward scatter
  for i = 1, 5 do
    local vx = wa.random(-196608, 196608) / 65536
    local vy = wa.random(-655360, -458752) / 65536
    wa.weapons.launch{
      weapon = ${JSON.stringify(project.id)},
      x = ev.x, y = ev.y,
      vx = vx, vy = vy,
      missile = { explosion = { power = 30 }, fuse = 5000 },
    }
  end
end,`,
                      })
                    }
                    className="text-[11px] text-forge-600 hover:underline font-mono"
                  >
                    Template: Chilli Bomb (Children)
                  </button>
                </div>
              </div>

              <textarea
                rows={12}
                value={project.customLuaSnippet || ''}
                onChange={(e) => onChange({ customLuaSnippet: e.target.value })}
                className="w-full text-xs font-mono p-4 rounded-xl border border-stone-300 dark:border-stone-700 bg-stone-950 text-forge-400 focus:ring-1 focus:ring-forge-500 leading-relaxed resize-y select-text"
                placeholder="on_explode = function(ev) ... end,"
              />
            </div>
          )}
        </div>
      )}

      {/* Tab 7: Gun / Mine / Strike Specifics */}
      {activeSubTab === 'gun_mine' && (
        <div className="p-6 space-y-6">
          <div>
            <h3 className="font-heading text-sm font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
              Gun, Mine & Air Strike Families
            </h3>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
              Parameters for hitscan firearms (`gun`), proximity explosives (`mine`), and aerial strikes (`strike`).
            </p>
          </div>

          <div className="space-y-5">
            {/* Gun */}
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4">
              <div className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                Hitscan Gun (`gun`)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {numField('gun.bullets', 'Bullets per Sequence (`bullets`)', 1, 'Rounds fired in the sequence.', { min: 0, max: 50 })}
                {numField('gun.spread_deg', 'Spread Degrees (`spread_deg`)', 0, 'Full angular spread centred on the aim.', { min: 0, max: 45, unit: 'deg' })}
                {numField('gun.shot_interval_ms', 'Shot Interval (`shot_interval_ms`)', 0, 'Delay between rounds in the sequence.', { min: 0, step: 20, unit: 'ms' })}
                {numField('gun.burst_size', 'Burst Size (`burst_size`)', 0, 'Projectiles emitted per round.', { min: 0, max: 50 })}
                {numField('gun.burst_spread_deg', 'Burst Spread (`burst_spread_deg`)', 0, 'Angular spread within one burst.', { min: 0, max: 90, unit: 'deg' })}
                {numField('gun.impact_effect', 'Impact Effect (`impact_effect`)', 0, 'Native visual effect selector.')}
                {numField('gun.explosion.bias', 'Impact Bias (`explosion.bias`)', 0, 'Native impact-explosion bias.')}
                {numField('gun.explosion.push_pct', 'Impact Push (`explosion.push_pct`)', 100, 'Knockback percentage at the impact.', { min: 0, max: 400, unit: '%' })}
                {numField('gun.explosion.variation', 'Impact Variation (`explosion.variation`)', 0, 'Random variation applied to the impact.')}
              </div>
              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">
                  Raycast Targets (`gun.hits`)
                </div>
                {maskGrid('gun.hits', (project.recordOverrides['gun.hits'] || {}) as CollisionMask)}
              </div>
            </div>

            {/* Mine */}
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4">
              <div className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                Proximity Mine (`mine`)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Proximity Radius (`proximity`)</label>
                  <input
                    type="number"
                    min={0}
                    max={150}
                    value={body.proximity ?? 25}
                    onChange={(e) => updateBody({ proximity: Number(e.target.value) })}
                    className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Arm Delay (`arm`)</label>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      step={250}
                      value={body.arm_delay_ms ?? 3000}
                      onChange={(e) => updateBody({ arm_delay_ms: Number(e.target.value) })}
                      className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                    />
                    <span className="absolute right-3 top-2 text-xs text-stone-400">ms</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Trigger Fuse (`fuse`)</label>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      step={250}
                      value={body.trigger_delay_ms ?? 2000}
                      onChange={(e) => updateBody({ trigger_delay_ms: Number(e.target.value) })}
                      className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                    />
                    <span className="absolute right-3 top-2 text-xs text-stone-400">ms</span>
                  </div>
                </div>
                {numField('mine.explosion.bias', 'Explosion Bias (`explosion.bias`)', 0, 'Native mine-explosion bias.')}
                {numField('mine.explosion.push_pct', 'Explosion Push (`explosion.push_pct`)', 100, 'Knockback percentage of the mine blast.', { min: 0, max: 400, unit: '%' })}
              </div>
              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">
                  Detection Targets (`mine.detects`)
                </div>
                {maskGrid('mine.detects', (project.recordOverrides['mine.detects'] || {}) as CollisionMask)}
              </div>
            </div>

            {/* Strike */}
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4">
              <div className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                Air Strike (`strike`)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {numField('strike.count', 'Munitions Count (`count`)', 5, 'Number of munitions dropped by the strike.', { min: 0, max: 50 })}
                {numField('strike.plane', 'Plane Sprite (`plane`)', 86, 'Stock sprite id or name of the plane that drops the munitions.')}
                {numField('strike.spacing', 'Munition Spacing (`spacing`)', 0, 'Native spacing between dropped munitions.')}
                {numField('strike.munition_speed', 'Munition Speed (`munition_speed`)', 0, 'Horizontal speed multiplier of the munition.', { step: 0.01 })}
                {numField('strike.plane_sound', 'Plane Sound (`plane_sound`)', 0, 'Native sound identifier for the strike plane.')}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Munition Type (`munition`)</label>
                  <select
                    value={String(project.recordOverrides['strike.munition'] ?? 2)}
                    onChange={(e) => updateOverride('strike.munition', Number(e.target.value))}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                  >
                    <option value="0">Mines</option>
                    <option value="2">Missiles</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
