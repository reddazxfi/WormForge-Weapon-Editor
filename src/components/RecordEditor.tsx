import React, { useState } from 'react';
import {
  WeaponProject,
  CollisionMask,
  ClustletConfig,
  HomingKind,
  RoamActionConfig,
  DigActionConfig,
} from '../types/weapon';
import { COLLISION_FLAGS, MISSILE_ANIM_HINT, MISSILE_ANIM_TYPES } from '../data/recordSchema';
import { StockSpriteInput } from './StockSpriteInput';
import { TRAIL_SPRITES } from '../data/stockSprites';
import {
  Code2,
  Crosshair,
  Plane,
  Wrench,
  Volume2,
  Sliders,
  HelpCircle,
  Navigation,
  Flame,
  Clock,
  CircleDot,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';
import { bitActionOf, visibleRecordTabs, type RecordTabId } from '../data/recordTabs';
import { bitBuilderMode } from '../data/spriteBuilder';
import { FIRE_SUBTYPES, fireSubtypeLabel } from '../data/fireSubtypes';
import { PackSpriteUpload } from './PackSpriteUpload';
import { NumberInput, useNumberDraft } from './NumberInput';

type CollisionTargetKey = Exclude<keyof CollisionMask, 'extra_bits'>;

const COLLISION_TARGETS: { id: CollisionTargetKey; label: string; desc: string }[] = [
  { id: 'land', label: 'Terrain', desc: 'Solid map landscape' },
  { id: 'worms', label: 'All Worms', desc: 'Shortcut for standing, acting, jumping, and roping worms' },
  { id: 'worms_normal', label: 'Standing Worms', desc: 'Worms standing still or walking' },
  { id: 'worms_acting', label: 'Acting Worms', desc: 'Worms firing, swinging, or recovering' },
  { id: 'worms_jumping', label: 'Jumping Worms', desc: 'Worms mid-jump, backflipping, or using Jet Pack' },
  { id: 'worms_roping', label: 'Roping Worms', desc: 'Worms swinging on Ninja Rope or Bungee' },
  { id: 'worms_frozen', label: 'Frozen Worms', desc: 'Stationary frozen worms' },
  { id: 'worms_frozen_moving', label: 'Sliding Frozen', desc: 'Frozen worms sliding or falling' },
  { id: 'mines', label: 'Mines', desc: 'Live or dud proximity mines' },
  { id: 'crates', label: 'Crates', desc: 'Weapon, utility, and health crates' },
  { id: 'donor_cards', label: 'Donor Cards', desc: 'Dropped donor cards' },
  { id: 'graves', label: 'Graves', desc: 'Dead worm tombstones' },
  { id: 'missiles', label: 'Other Missiles', desc: 'Other airborne projectiles' },
  { id: 'arrows', label: 'Arrows', desc: 'Longbow arrows' },
  { id: 'objects', label: 'Drums & Objects', desc: 'Oil drums and physical scene objects' },
  { id: 'water', label: 'Water', desc: 'Water level at bottom of map' },
  { id: 'canisters', label: 'Canisters', desc: 'Legacy crate canisters' },
];

// `worms` is a native shortcut for ordinary movement groups. The engine rejects
// a mask that selects the shortcut and any individual group together.
const WORM_GROUP_KEYS = [
  'worms_normal',
  'worms_acting',
  'worms_jumping',
  'worms_roping',
  'worms_frozen',
  'worms_frozen_moving',
] as const;

const WORM_SHORTCUT_KEYS = WORM_GROUP_KEYS.filter(
  (key) => (COLLISION_FLAGS.worms & COLLISION_FLAGS[key]) !== 0
);

function toggleMaskValue(mask: CollisionMask, key: CollisionTargetKey): CollisionMask {
  const next: CollisionMask = { ...mask };
  const isChecked = !!next[key];
  if (key === 'worms') {
    if (isChecked) {
      delete next.worms;
    } else {
      for (const group of WORM_SHORTCUT_KEYS) delete next[group];
      next.worms = true;
    }
  } else if ((WORM_GROUP_KEYS as readonly string[]).includes(key)) {
    if (next.worms) {
      for (const group of WORM_SHORTCUT_KEYS) next[group] = true;
      delete next.worms;
    }
    next[key] = !isChecked;
  } else {
    next[key] = !isChecked;
  }
  return next;
}

const SPECIAL_SUBTYPES: { value: number; label: string }[] = [
  { value: 1, label: '1 — Fire Punch' },
  { value: 2, label: '2 — Baseball Bat' },
  { value: 8, label: '8 — Pneumatic Drill' },
  { value: 12, label: '12 — Parachute' },
  { value: 19, label: '19 — Turn Utility' },
  { value: 23, label: '23 — Jet Pack' },
  { value: 0, label: '0 — Other / Inherited' },
];

const UTILITY_EFFECTS: { value: string; label: string }[] = [
  { value: 'low_gravity', label: 'Low Gravity' },
  { value: 'fast_walk', label: 'Fast Walk' },
  { value: 'laser_sight', label: 'Laser Sight' },
  { value: 'invisibility', label: 'Invisibility' },
  { value: 'damage_x2', label: 'Double Damage (x2)' },
  { value: 'crate_spy', label: 'Crate Spy' },
  { value: 'double_turn_time', label: 'Double Turn Time' },
  { value: 'crate_shower', label: 'Crate Shower' },
  { value: 'scripted', label: 'Custom Scripted (Lua)' },
];

const STOCK_MISSILE_SPRITES = [
  { id: '0', name: 'Hidden (Use Custom Sprite Builder)' },
  { id: 'bazooka', name: 'Bazooka Rocket' },
  { id: 'grenade', name: 'Grenade' },
  { id: 'cluster', name: 'Cluster Bomb' },
  { id: 'banana', name: 'Banana / Super Banana' },
  { id: 'mortar', name: 'Mortar Shell' },
  { id: 'homing', name: 'Homing Missile' },
  { id: 'pigeon', name: 'Homing Pigeon' },
  { id: 'sheep', name: 'Sheep' },
  { id: 'dynamite', name: 'Dynamite Stick' },
  { id: 'mine', name: 'Proximity Mine' },
  { id: 'petrol_bomb', name: 'Petrol Bomb' },
  { id: 'holy_grenade', name: 'Holy Hand Grenade' },
  { id: 'arrow', name: 'Bow Arrow' },
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

interface RecordEditorProps {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
  activeSubTab: RecordTabId;
  onSelectSubTab: (tab: RecordTabId) => void;
}

export function buildTooltip(desc?: string, code?: string): string | undefined {
  const parts: string[] = [];
  if (desc) parts.push(desc);
  if (code) parts.push(`Field: ${code}`);
  return parts.length > 0 ? parts.join('\n') : undefined;
}

export const TooltipLabel: React.FC<{
  label: string;
  code?: string;
  desc?: string;
  htmlFor?: string;
}> = ({ label, code, desc, htmlFor }) => {
  const tip = buildTooltip(desc, code);
  return (
    <div className="mb-1 flex items-center justify-between gap-1">
      <label
        htmlFor={htmlFor}
        className="truncate text-xs font-semibold text-stone-700 dark:text-stone-300 cursor-pointer"
        title={tip}
      >
        {label}
      </label>
      {tip && (
        <span
          tabIndex={0}
          role="tooltip"
          className="shrink-0 cursor-help text-stone-400 transition-colors hover:text-stone-600 dark:hover:text-stone-200"
          title={tip}
        >
          <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      )}
    </div>
  );
};

/**
 * The record pages' number box. The draft handling lives in `NumberInput.tsx`
 * so an emptied box never writes a `0` into the project; this is only the
 * larger unit-suffixed styling the workbench uses.
 */
export const UnitNumberInput: React.FC<
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
    unit?: string;
    value: number | string | undefined | null;
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  }
> = ({ unit, className = '', value, onChange, onBlur, ...props }) => {
  const { shown, handleChange, handleBlur } = useNumberDraft(value, onChange, onBlur);
  if (!unit) {
    return (
      <input
        type="number"
        {...props}
        value={shown}
        onChange={handleChange}
        onBlur={handleBlur}
        className={`w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-white ${className}`}
      />
    );
  }
  return (
    <div className="flex w-full items-stretch overflow-hidden rounded-lg border border-stone-200 bg-white focus-within:border-forge-500 focus-within:ring-2 focus-within:ring-forge-500 dark:border-stone-700 dark:bg-stone-900">
      <input
        type="number"
        {...props}
        value={shown}
        onChange={handleChange}
        onBlur={handleBlur}
        className={`min-w-0 flex-1 bg-transparent px-2.5 py-1.5 font-mono text-xs tabular-nums text-stone-900 focus:outline-hidden disabled:opacity-50 dark:text-white ${className}`}
      />
      <span className="pointer-events-none flex shrink-0 select-none items-center border-l border-stone-200 bg-stone-50 px-2 font-mono text-[11px] text-stone-500 dark:border-stone-700 dark:bg-stone-800/70 dark:text-stone-400">
        {unit}
      </span>
    </div>
  );
};

export const SectionHeader: React.FC<{
  title: string;
  desc?: string;
  code?: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
}> = ({ title, desc, code, icon, right }) => {
  const tip = buildTooltip(desc, code);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2" title={tip}>
        <h3 className="flex items-center gap-1.5 font-heading text-sm font-bold uppercase tracking-wide text-stone-900 dark:text-stone-100">
          {icon}
          <span>{title}</span>
        </h3>
        {tip && (
          <span
            tabIndex={0}
            role="tooltip"
            title={tip}
            className="shrink-0 cursor-help text-stone-400 transition-colors hover:text-stone-600 dark:hover:text-stone-200"
          >
            <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        )}
      </div>
      {right}
    </div>
  );
};

export const SubSectionTitle: React.FC<{
  title: string;
  desc?: string;
  code?: string;
  tone?: string;
  right?: React.ReactNode;
}> = ({ title, desc, code, tone = 'text-stone-800 dark:text-stone-200', right }) => {
  const tip = buildTooltip(desc, code);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide ${tone}`} title={tip}>
        <span>{title}</span>
        {tip && (
          <span
            tabIndex={0}
            role="tooltip"
            title={tip}
            className="shrink-0 cursor-help font-normal normal-case text-stone-400 transition-colors hover:text-stone-600 dark:hover:text-stone-200"
          >
            <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        )}
      </div>
      {right}
    </div>
  );
};

const CheckboxCard: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  code?: string;
  desc?: string;
}> = ({ checked, onChange: onToggle, label, code, desc }) => {
  const tip = buildTooltip(desc, code);
  return (
    <label
      title={tip}
      className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50/70 px-3 py-2 transition-colors hover:border-stone-300 dark:border-stone-800 dark:bg-stone-800/40 dark:hover:border-stone-700"
    >
      <span className="flex min-w-0 items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-3.5 w-3.5 shrink-0 rounded text-forge-600 focus:ring-forge-500"
        />
        <span className="truncate text-xs font-semibold text-stone-900 dark:text-stone-100">
          {label}
        </span>
      </span>
      {tip && (
        <span
          title={tip}
          className="shrink-0 cursor-help text-stone-400 transition-colors hover:text-stone-600 dark:hover:text-stone-200"
        >
          <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      )}
    </label>
  );
};

export const RecordEditor: React.FC<RecordEditorProps> = ({
  project,
  onChange,
  activeSubTab,
  onSelectSubTab,
}) => {
  const [clusterView, setClusterView] = useState<'physics' | 'targets' | 'action'>('physics');

  const body = project.body;
  const clustlet = body.clustlet;
  const isStrike = project.fireType === 'cursor' && !project.teleport;
  const bitAction = bitActionOf(clustlet);

  const visibleTabs = visibleRecordTabs(
    project.burst,
    bitAction,
    project.fireType,
    project.teleport,
    body.fuse
  );

  // Normalize any legacy or transitional tab id cleanly so panels never blank out.
  const normalizedTab: RecordTabId = (() => {
    if (activeSubTab === 'collisions') return 'action';
    if (activeSubTab === 'strike') return 'missile';
    if (activeSubTab.startsWith('burst')) return 'burst';
    return visibleTabs.some((t) => t.id === activeSubTab)
      ? activeSubTab
      : visibleTabs[0]?.id ?? 'missile';
  })();

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

  const updateOverrides = (patch: Record<string, any>) => {
    const updated = { ...project.recordOverrides };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '' || value === null) delete updated[key];
      else updated[key] = value;
    }
    onChange({ recordOverrides: updated });
  };

  const endsOnContactMask: CollisionMask =
    project.recordOverrides['missile.ends_on_contact'] || {
      land: true,
      worms: true,
      mines: true,
      crates: true,
      water: true,
    };
  const bounceHitsMask: CollisionMask = project.recordOverrides['missile.bounce.hits'] || {};

  const toggleMaskTarget = (path: string, key: CollisionTargetKey, current: CollisionMask) => {
    updateOverride(path, toggleMaskValue(current, key));
  };

  const inputClass =
    'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-white';
  const selectClass =
    'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-white';

  const numField = (
    path: string,
    label: string,
    fallback: number,
    desc: string,
    opts: { min?: number; max?: number; step?: number; unit?: string; code?: string } = {}
  ) => (
    <div>
      <TooltipLabel label={label} code={opts.code ?? path} desc={desc} />
      <UnitNumberInput
        min={opts.min}
        max={opts.max}
        step={opts.step}
        value={project.recordOverrides[path] ?? fallback}
        onChange={(e) => updateOverride(path, Number(e.target.value))}
        title={buildTooltip(desc, opts.code ?? path)}
        unit={opts.unit}
      />
    </div>
  );

  const animSelect = (
    value: number,
    onChangeValue: (next: number) => void,
    label: string,
    code: string,
    desc: string
  ) => (
    <div>
      <TooltipLabel label={label} code={code} desc={desc} />
      <select
        value={value}
        onChange={(e) => onChangeValue(Number(e.target.value))}
        title={buildTooltip(desc, code)}
        className={selectClass}
      >
        {!MISSILE_ANIM_TYPES.some((type) => type.value === value) && (
          <option value={value}>{value} — Custom / Inherited</option>
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
      path,
      MISSILE_ANIM_HINT
    );

  const bitAnimField = (
    key: 'animation' | 'homing_animation',
    label: string,
    code: string,
    fallback: number
  ) =>
    animSelect(
      Number((clustlet[key] as number | undefined) ?? fallback),
      (next) => updateClustlet({ [key]: next } as Partial<ClustletConfig>),
      label,
      code,
      MISSILE_ANIM_HINT
    );

  const firingSubtypeField = (idPrefix: string) => (
    <div>
      <TooltipLabel
        label="Firing Animation"
        code="fires.subtype"
        desc="Selects the stock worm firing animation and sound (e.g. Minigun firing loop or Shotgun pump). Does not change projectile physics or custom held art."
        htmlFor={`${idPrefix}-subtype`}
      />
      <select
        id={`${idPrefix}-subtype`}
        value={String(project.specialSubtype ?? 0)}
        onChange={(e) => onChange({ specialSubtype: Number(e.target.value) })}
        title={buildTooltip(
          'Selects the stock worm firing animation and sound. Does not change projectile physics or custom held art.',
          'fires.subtype'
        )}
        className={selectClass}
      >
        {fireSubtypeLabel(project.specialSubtype ?? 0) === null && (
          <option value={String(project.specialSubtype ?? 0)}>
            {project.specialSubtype ?? 0} — Custom / Inherited
          </option>
        )}
        {FIRE_SUBTYPES.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.label}
          </option>
        ))}
      </select>
    </div>
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
    code: string,
    desc: string,
    opts: { min?: number; max?: number; step?: number; unit?: string } = {}
  ) => (
    <div>
      <TooltipLabel label={label} code={code} desc={desc} />
      <UnitNumberInput
        min={opts.min}
        max={opts.max}
        step={opts.step}
        value={project.roamConfig[key]}
        onChange={(e) =>
          onChange({ roamConfig: { ...project.roamConfig, [key]: Number(e.target.value) } })
        }
        title={buildTooltip(desc, code)}
        unit={opts.unit}
      />
    </div>
  );

  const renderMaskGrid = (
    isSelected: (key: CollisionTargetKey) => boolean,
    onToggle: (key: CollisionTargetKey) => void
  ) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5">
      {COLLISION_TARGETS.map((flag) => {
        const isChecked = isSelected(flag.id);
        const tip = buildTooltip(flag.desc, flag.id);
        return (
          <label
            key={flag.id}
            title={tip}
            className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-colors ${
              isChecked
                ? 'border-forge-500/60 bg-forge-50/70 font-semibold text-stone-900 dark:border-forge-500/40 dark:bg-forge-950/30 dark:text-stone-100'
                : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900/60 dark:text-stone-400 dark:hover:border-stone-700'
            }`}
          >
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => onToggle(flag.id)}
              className="h-3.5 w-3.5 shrink-0 rounded text-forge-600 focus:ring-forge-500"
            />
            <span className="truncate text-[11px]">{flag.label}</span>
          </label>
        );
      })}
    </div>
  );

  const roamMaskGrid = (key: 'hits' | 'flight_hits', mask: CollisionMask) =>
    renderMaskGrid(
      (id) => !!mask[id],
      (id) =>
        onChange({
          roamConfig: {
            ...project.roamConfig,
            [key]: toggleMaskValue(mask, id),
          },
        })
    );

  const bitNum = (
    key: keyof ClustletConfig,
    label: string,
    code: string,
    fallback: number,
    desc: string,
    opts: { min?: number; max?: number; step?: number; unit?: string } = {}
  ) => (
    <div>
      <TooltipLabel label={label} code={code} desc={desc} />
      <UnitNumberInput
        min={opts.min}
        max={opts.max}
        step={opts.step}
        value={(clustlet[key] as number | undefined) ?? fallback}
        onChange={(e) =>
          updateClustlet({ [key]: Number(e.target.value) } as Partial<ClustletConfig>)
        }
        title={buildTooltip(desc, code)}
        unit={opts.unit}
      />
    </div>
  );

  const bitMaskGrid = (key: 'ends_on_contact' | 'bounce_hits', mask?: CollisionMask) => {
    const current = mask ?? {};
    return renderMaskGrid(
      (id) => !!current[id],
      (id) =>
        updateClustlet({
          [key]: toggleMaskValue(current, id),
        } as Partial<ClustletConfig>)
    );
  };

  const bitRoamNum = (
    key: keyof RoamActionConfig,
    label: string,
    code: string,
    desc: string,
    opts: { min?: number; max?: number; step?: number; unit?: string } = {}
  ) => {
    const r = clustlet.roam ?? DEFAULT_BIT_ROAM;
    return (
      <div>
        <TooltipLabel label={label} code={code} desc={desc} />
        <UnitNumberInput
          min={opts.min}
          max={opts.max}
          step={opts.step}
          value={(r[key] as number | undefined) ?? 0}
          onChange={(e) =>
            updateClustlet({
              roam: { ...r, [key]: Number(e.target.value) },
            } as Partial<ClustletConfig>)
          }
          title={buildTooltip(desc, code)}
          unit={opts.unit}
        />
      </div>
    );
  };

  const bitRoamMaskGrid = (key: 'hits' | 'flight_hits') => {
    const r = clustlet.roam ?? DEFAULT_BIT_ROAM;
    const mask = r[key] ?? {};
    return renderMaskGrid(
      (id) => !!mask[id],
      (id) =>
        updateClustlet({
          roam: { ...r, [key]: toggleMaskValue(mask, id) },
        } as Partial<ClustletConfig>)
    );
  };

  const bitDigNum = (
    key: keyof DigActionConfig,
    label: string,
    code: string,
    desc: string,
    opts: { min?: number; max?: number; step?: number; unit?: string } = {}
  ) => {
    const d = clustlet.dig ?? DEFAULT_BIT_DIG;
    return (
      <div>
        <TooltipLabel label={label} code={code} desc={desc} />
        <UnitNumberInput
          min={opts.min}
          max={opts.max}
          step={opts.step}
          value={(d[key] as number | undefined) ?? 0}
          onChange={(e) =>
            updateClustlet({
              dig: { ...d, [key]: Number(e.target.value) },
            } as Partial<ClustletConfig>)
          }
          title={buildTooltip(desc, code)}
          unit={opts.unit}
        />
      </div>
    );
  };

  const maskGrid = (path: string, mask: CollisionMask) =>
    renderMaskGrid(
      (id) => !!mask[id],
      (id) => toggleMaskTarget(path, id, mask)
    );

  const tabWhisper = (id: RecordTabId): string | null => {
    if (id === 'action' && project.action && project.action !== 'none') {
      return project.action;
    }
    if (id === 'burst' && project.burst && project.burst !== 'nothing') {
      return project.burst;
    }
    if (id === 'callbacks' && project.enableCustomLua) {
      return 'on';
    }
    return null;
  };

  const bitActionTitle =
    bitAction === 'none'
      ? 'Impact'
      : bitAction === 'bounce'
        ? 'Bounce'
        : bitAction === 'homing'
          ? 'Homing'
          : bitAction === 'roam'
            ? 'Roam'
            : 'Dig';

  return (
    <section
      aria-label="Weapon Mechanics Workbench"
      className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900"
    >
      {/* Unified Armory Workbench Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200/80 bg-stone-50/80 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-950/60">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Weapon mechanics sections">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const active = normalizedTab === tab.id;
            const whisper = tabWhisper(tab.id);
            const activeClass =
              tab.id === 'sprite' || tab.id === 'gun' || tab.id === 'gun_mine'
                ? 'bg-sky-600 text-white shadow-xs dark:bg-sky-500'
                : tab.id === 'action' || tab.id === 'burst'
                  ? 'bg-amber-600 text-white shadow-xs dark:bg-amber-500'
                  : 'bg-forge-600 text-white shadow-xs dark:bg-forge-500';
            const inactiveIconClass =
              tab.id === 'sprite' || tab.id === 'gun' || tab.id === 'gun_mine'
                ? 'text-sky-500'
                : tab.id === 'action' || tab.id === 'burst'
                  ? 'text-amber-500'
                  : 'text-forge-500';
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                title={tab.hint}
                onClick={() => onSelectSubTab(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? activeClass
                    : 'border border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:text-white'
                }`}
              >
                <Icon
                  className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-white' : inactiveIconClass}`}
                  aria-hidden="true"
                />
                <span>{tab.label}</span>
                {whisper && (
                  <span
                    className={`font-mono text-[10px] capitalize ${
                      active ? 'text-white/85' : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    · {whisper}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Dropped Weapon Mode Switcher (Proximity Mine vs Timed Dynamite) */}
        {project.fireType === 'drop' && (
          <div className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white p-0.5 dark:border-stone-700 dark:bg-stone-900">
            <button
              type="button"
              onClick={() => updateBody({ fuse: false, fuse_time_ms: 0 })}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                !body.fuse
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'
              }`}
            >
              <CircleDot className="h-3 w-3" aria-hidden="true" />
              <span>Proximity Mine</span>
            </button>
            <button
              type="button"
              onClick={() =>
                updateBody({
                  fuse: true,
                  fuse_time_ms: body.fuse_time_ms > 0 ? body.fuse_time_ms : 5000,
                })
              }
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                body.fuse
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'
              }`}
            >
              <Clock className="h-3 w-3" aria-hidden="true" />
              <span>Timed Dynamite</span>
            </button>
          </div>
        )}
      </div>

      {/* PANEL 1: Physics & Blast (or Strike & Bombs) */}
      {normalizedTab === 'missile' && (
        <div className="p-4 sm:p-5 space-y-5">
          {isStrike && (
            <div className="space-y-3.5 border-b border-stone-200/80 pb-5 dark:border-stone-800">
              <SectionHeader
                title="Air Strike Flyover"
                code="strike"
                icon={<Plane className="h-4 w-4 text-forge-500" aria-hidden="true" />}
                desc="Aircraft pass and drop pattern settings. Individual bomb physics sit immediately below."
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {numField('strike.count', 'Munitions Dropped', 5, 'Number of bombs or mines released across the flyover.', { min: 0, max: 50 })}
                <div>
                  <TooltipLabel
                    label="Munition Type"
                    code="strike.munition"
                    desc="Whether the aircraft drops proximity Mines or falling Missiles."
                  />
                  <select
                    value={String(project.recordOverrides['strike.munition'] ?? 2)}
                    onChange={(e) => updateOverride('strike.munition', Number(e.target.value))}
                    className={selectClass}
                  >
                    <option value="0">Mines</option>
                    <option value="2">Missiles</option>
                  </select>
                </div>
                {numField('strike.plane', 'Plane Sprite ID', 86, 'Stock sprite ID or name of the aircraft (default 86).')}
                {numField('strike.spacing', 'Drop Spacing', 0, 'Distance between consecutive dropped munitions.')}
                {numField('strike.munition_speed', 'Drop Forward Speed', 0, 'Horizontal speed multiplier inherited from the aircraft.', { step: 0.01 })}
                {numField('strike.plane_sound', 'Plane Sound ID', 0, 'Native sound ID played for the flyover aircraft.')}
              </div>
            </div>
          )}

          <div className="space-y-3.5">
            <SectionHeader
              title={isStrike ? 'Dropped Bomb Physics & Blast' : 'Physics & Blast'}
              code="missile"
              desc="Core ballistic physics, fuse timers, blast damage, knockback, and launch settings."
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {firingSubtypeField('missile')}

              {(project.fireType === 'power' || project.fireType === 'drop') && (
                <div>
                  <TooltipLabel
                    label="Launch Power"
                    code="fires.launch_power_pct"
                    desc="Preset launch speed multiplier. Set to 0 to charge power manually with Space (Bazooka style); values above 100% are allowed."
                    htmlFor="fire-launch-power"
                  />
                  <UnitNumberInput
                    id="fire-launch-power"
                    min={0}
                    max={400}
                    value={project.recordOverrides['fires.launch_power_pct'] ?? 100}
                    onChange={(e) =>
                      updateOverride('fires.launch_power_pct', Number(e.target.value))
                    }
                    title={buildTooltip(
                      'Preset launch speed multiplier. 0 enables holding Space to charge power.',
                      'fires.launch_power_pct'
                    )}
                    unit="%"
                  />
                </div>
              )}

              <div>
                <TooltipLabel
                  label="Blast Power"
                  code="missile.explosion.power"
                  desc="Controls both maximum damage and terrain crater radius."
                  htmlFor="missile-blast-power"
                />
                <UnitNumberInput
                  id="missile-blast-power"
                  min={0}
                  max={500}
                  value={body.damage}
                  onChange={(e) => updateBody({ damage: Number(e.target.value) })}
                  title={buildTooltip('Controls both maximum damage and terrain crater radius.', 'missile.explosion.power')}
                  unit="dmg"
                />
              </div>

              <div>
                <TooltipLabel
                  label="Knockback Force"
                  code="missile.explosion.push_pct"
                  desc="Explosion push force percentage. 100% is normal knockback; 0% removes push while keeping damage."
                  htmlFor="missile-push-pct"
                />
                <UnitNumberInput
                  id="missile-push-pct"
                  min={0}
                  max={400}
                  value={project.recordOverrides['missile.explosion.push_pct'] ?? 100}
                  onChange={(e) => updateOverride('missile.explosion.push_pct', Number(e.target.value))}
                  title={buildTooltip('Explosion push force percentage (0% removes knockback).', 'missile.explosion.push_pct')}
                  unit="%"
                />
              </div>

              <div>
                <TooltipLabel
                  label="Gravity"
                  code="missile.gravity_pct"
                  desc="Downward gravity multiplier during flight. 100% is normal WA gravity; Moon Grenade uses 35%."
                  htmlFor="missile-gravity-pct"
                />
                <UnitNumberInput
                  id="missile-gravity-pct"
                  min={-200}
                  max={500}
                  value={body.gravity_pct}
                  onChange={(e) => updateBody({ gravity_pct: Number(e.target.value) })}
                  title={buildTooltip('Gravity multiplier (100% = normal, 35% = Moon Grenade).', 'missile.gravity_pct')}
                  unit="%"
                />
              </div>

              <div>
                <TooltipLabel
                  label="Wind Sensitivity"
                  code="missile.wind_pct"
                  desc="How strongly wind drifts the projectile. Bazooka uses 100%, Grenade uses 0%."
                  htmlFor="missile-wind-pct"
                />
                <UnitNumberInput
                  id="missile-wind-pct"
                  min={0}
                  max={300}
                  value={body.wind_pct}
                  onChange={(e) => updateBody({ wind_pct: Number(e.target.value) })}
                  title={buildTooltip('Wind response (100% = Bazooka, 0% = Grenade).', 'missile.wind_pct')}
                  unit="%"
                />
              </div>

              <div>
                <TooltipLabel
                  label="Fuse Timer"
                  code="missile.fuse"
                  desc="Milliseconds until detonation. Set to 0 for impact detonation."
                  htmlFor="missile-fuse"
                />
                <UnitNumberInput
                  id="missile-fuse"
                  min={0}
                  step={500}
                  value={body.fuse_time_ms}
                  onChange={(e) =>
                    updateBody({ fuse_time_ms: Number(e.target.value), fuse: Number(e.target.value) > 0 })
                  }
                  title={buildTooltip('Milliseconds until detonation (0 = explode on impact).', 'missile.fuse')}
                  unit="ms"
                />
              </div>

              <div>
                <TooltipLabel
                  label="Visible Countdown"
                  code="missile.countdown"
                  desc="Separate countdown shown above the projectile; interaction with Fuse Timer depends on the base weapon."
                  htmlFor="missile-countdown"
                />
                <UnitNumberInput
                  id="missile-countdown"
                  min={0}
                  step={500}
                  value={body.countdown_ms}
                  onChange={(e) => updateBody({ countdown_ms: Number(e.target.value) })}
                  title={buildTooltip('Countdown displayed above the projectile.', 'missile.countdown')}
                  unit="ms"
                />
              </div>

              <div>
                <TooltipLabel
                  label="Flight Speed"
                  code="missile.speed_pct"
                  desc="Initial projectile launch speed percentage (100% is default)."
                  htmlFor="missile-speed-pct"
                />
                <UnitNumberInput
                  id="missile-speed-pct"
                  min={10}
                  max={400}
                  value={project.recordOverrides['missile.speed_pct'] ?? 100}
                  onChange={(e) => updateOverride('missile.speed_pct', Number(e.target.value))}
                  title={buildTooltip('Initial projectile speed percentage.', 'missile.speed_pct')}
                  unit="%"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-stone-200/80 pt-3.5 dark:border-stone-800">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CheckboxCard
                checked={!!project.recordOverrides['missile.explode_on_space']}
                onChange={(v) => updateOverride('missile.explode_on_space', v)}
                label="Detonate on Space"
                code="missile.explode_on_space"
                desc="Allows triggering detonation mid-flight by pressing Space (Super Banana Bomb style)."
              />
              <CheckboxCard
                checked={!!project.recordOverrides['missile.alarm_worms']}
                onChange={(v) => updateOverride('missile.alarm_worms', v)}
                label="Panic Nearby Worms"
                code="missile.alarm_worms"
                desc="Nearby worms gasp and cower shortly before the timed explosion goes off."
              />
            </div>
          </div>

          <div className="space-y-3 border-t border-stone-200/80 pt-4 dark:border-stone-800">
            <SubSectionTitle
              title="Blast Shaping &amp; Random Motion"
              desc="Less common native fields. Left alone they keep the value the template or .wep already carries."
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {numField('missile.explosion.bias', 'Blast Bias', 0, 'Vertical elevation bias of the main explosion.')}
              {numField('missile.explosion.variation', 'Damage Randomness', 0, 'Random variation applied to explosion damage.')}
              {numField('missile.random_motion', 'Random Flight Wobble', 0, 'Native random-motion parameter (depends on base weapon).')}
              {numField('missile.collision_shape', 'Collision Outline', 0, 'Numeric physical clearance preset; keep inherited unless tested.')}
            </div>
          </div>

          <div className="space-y-3 border-t border-stone-200/80 pt-4 dark:border-stone-800">
            <SubSectionTitle title="Pre-Explosion Warning Sound" code="missile.explosion_sound" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 items-end">
              <CheckboxCard
                checked={!!project.recordOverrides['missile.explosion_sound.enabled']}
                onChange={(v) => updateOverride('missile.explosion_sound.enabled', v)}
                label="Play Warning Sound"
                code="missile.explosion_sound.enabled"
                desc="Plays a sound shortly before a timed explosion goes off."
              />
              {numField('missile.explosion_sound.sound', 'Sound ID', 0, 'Native sound ID (0 = none).')}
              {numField('missile.explosion_sound.before', 'Lead Time', 0, 'Milliseconds before detonation to play the sound.', { step: 50, unit: 'ms' })}
            </div>
          </div>
        </div>
      )}

      {/* PANEL 2: Missile Action + Collision Targets */}
      {normalizedTab === 'action' && (
        <div className="p-4 sm:p-5 space-y-5">
          <div className="space-y-3.5">
            <SectionHeader
              title="Flight Behaviour"
              code="missile.action"
              desc="Controls how the projectile moves during flight. Only one action can be active at a time."
            />

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1 rounded-xl border border-stone-200 bg-stone-100 p-1 dark:border-stone-800 dark:bg-stone-950/60">
              {(
                [
                  { id: 'none', label: 'Direct Flight', desc: 'Standard ballistic arc; explodes on impact or fuse (Bazooka style).' },
                  { id: 'bounce', label: 'Bounce', desc: 'Bounces off terrain and targets (Grenade, Banana Bomb).' },
                  { id: 'homing', label: 'Homing', desc: 'Steers toward or locks onto the target cursor mid-flight.' },
                  { id: 'roam', label: 'Roam', desc: 'Walks, jumps, or flies along terrain (Sheep, Skunk).' },
                  { id: 'dig', label: 'Dig', desc: 'Burrows through solid land instead of stopping at the surface (Mole Bomb).' },
                ] as const
              ).map((act) => {
                const isSelected = (project.action || 'none') === act.id;
                return (
                  <button
                    key={act.id}
                    type="button"
                    onClick={() => onChange({ action: act.id })}
                    title={buildTooltip(act.desc, act.id)}
                    className={`rounded-lg px-2.5 py-1.5 text-center text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isSelected
                        ? 'bg-white text-stone-900 shadow-xs ring-1 ring-forge-500/40 dark:bg-stone-800 dark:text-white'
                        : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white'
                    }`}
                  >
                    {act.label}
                  </button>
                );
              })}
            </div>

            {(!project.action || project.action === 'none') && (
              <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-500 dark:bg-stone-950/40 dark:text-stone-400">
                Unguided ballistic arc — detonates immediately on impact or when the fuse expires.
              </p>
            )}

            {project.action === 'bounce' && (
              <div className="space-y-4 rounded-xl bg-stone-50/70 p-4 dark:bg-stone-950/40">
                <SubSectionTitle title="Bounce Settings" code="missile.bounce" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <TooltipLabel
                        label="Bounciness"
                        code="missile.bounce.bounciness"
                        desc="Extra elasticity above a standard Grenade (0 = Grenade, 60 = Banana Bomb, 80 = Super Banana)."
                      />
                      <span className="mb-1 font-mono font-bold tabular-nums text-forge-600 dark:text-forge-400">
                        {body.bounce_pct}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={body.bounce_pct}
                      onChange={(e) => updateBody({ bounce_pct: Number(e.target.value) })}
                      className="w-full cursor-pointer accent-forge-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <TooltipLabel
                        label="Speed Kept on Bounce"
                        code="missile.bounce.terrain_keep_speed_pct"
                        desc="Percentage of velocity preserved when bouncing off terrain."
                      />
                      <span className="mb-1 font-mono font-bold tabular-nums text-forge-600 dark:text-forge-400">
                        {project.recordOverrides['missile.bounce.terrain_keep_speed_pct'] ?? 75}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      value={project.recordOverrides['missile.bounce.terrain_keep_speed_pct'] ?? 75}
                      onChange={(e) =>
                        updateOverride('missile.bounce.terrain_keep_speed_pct', Number(e.target.value))
                      }
                      className="w-full cursor-pointer accent-forge-500"
                    />
                  </div>

                  <div>
                    <TooltipLabel
                      label="Max Bounces"
                      code="missile.bounce.max_bounces"
                      desc="Detonate after this many bounces. 0 keeps the normal fuse timer."
                    />
                    <NumberInput
                      min={0}
                      max={20}
                      value={project.recordOverrides['missile.bounce.max_bounces'] ?? 0}
                      onChange={(e) => updateOverride('missile.bounce.max_bounces', Number(e.target.value))}
                      className={inputClass}
                    />
                  </div>

                  {numField('missile.bounce.sound', 'Bounce Sound', 0, 'Native sound ID played on bounce (0 = silent).')}
                  {numField(
                    'missile.bounce.contact_sides',
                    'Counted Impact Sides',
                    0,
                    'Native side mask controlling which hit directions count toward Max Bounces or contact blasts.'
                  )}
                  {numField(
                    'missile.bounce.extra_reverse_chance_pct',
                    'Extra Rebound Chance',
                    0,
                    'Chance for an extra horizontal direction flip before normal collision handling.',
                    { min: 0, max: 100, unit: '%' }
                  )}
                </div>

                <CheckboxCard
                  checked={(project.recordOverrides['missile.bounce.explosion.power'] ?? 0) > 0}
                  onChange={(checked) =>
                    updateOverride(
                      'missile.bounce.explosion.power',
                      checked
                        ? project.recordOverrides['missile.bounce.explosion.power'] || body.damage || 20
                        : 0
                    )
                  }
                  label="Explode on Each Bounce"
                  code="missile.bounce.explosion"
                  desc="Triggers a contact blast every time the projectile bounces. Power 0 disables it."
                />

                {(project.recordOverrides['missile.bounce.explosion.power'] ?? 0) > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
                    {numField('missile.bounce.explosion.power', 'Contact Blast Power', 20, 'Damage and crater radius per bounce.', { min: 0, max: 500 })}
                    {numField('missile.bounce.explosion.push_pct', 'Contact Knockback', 100, 'Knockback percentage per bounce.', { min: 0, max: 400, unit: '%' })}
                    {numField('missile.bounce.explosion.bias', 'Contact Blast Bias', 0, 'Vertical elevation bias for bounce blasts.')}
                    {numField('missile.bounce.explosion.variation', 'Contact Damage Spread', 0, 'Random variation applied to bounce blasts.')}
                  </div>
                )}
              </div>
            )}

            {project.action === 'homing' && (
              <div className="space-y-4 rounded-xl bg-stone-50/70 p-4 dark:bg-stone-950/40">
                <SubSectionTitle title="Homing Settings" code="missile.homing" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <TooltipLabel
                      label="Guidance Mode"
                      code="missile.homing.kind"
                      desc="How the projectile tracks the cursor target once armed."
                    />
                    <select
                      value={body.homing === 'off' ? 'lock' : body.homing}
                      onChange={(e) => updateBody({ homing: e.target.value as HomingKind })}
                      className={selectClass}
                    >
                      <option value="lock">Lock-On (Direct tracking)</option>
                      <option value="dodge">Dodge (Weaves toward target)</option>
                    </select>
                  </div>

                  <div>
                    <TooltipLabel
                      label="Arming Delay"
                      code="missile.homing.arm"
                      desc="Free-flight delay in milliseconds before homing propulsion kicks in."
                    />
                    <UnitNumberInput
                      min={0}
                      step={250}
                      value={body.homing_arm_ms ?? 1000}
                      onChange={(e) => updateBody({ homing_arm_ms: Number(e.target.value) })}
                      unit="ms"
                    />
                  </div>

                  <div>
                    <TooltipLabel
                      label="Guidance Duration"
                      code="missile.homing.time"
                      desc="Total active homing time in milliseconds (2000–5000 ms is typical; 0 leaves it unguided)."
                    />
                    <UnitNumberInput
                      min={0}
                      step={500}
                      value={body.homing_time_ms ?? 8000}
                      onChange={(e) => updateBody({ homing_time_ms: Number(e.target.value) })}
                      unit="ms"
                    />
                  </div>
                </div>

                <div className="space-y-3 border-t border-stone-200/80 pt-3 dark:border-stone-800">
                  <SubSectionTitle
                    title="Homing Art &amp; Trail"
                    desc="Stock art WA draws while the round is guiding. The WFWS builder draws its own sheet when it owns this role, and then these ids are not needed."
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    <StockSpriteInput
                      id="homing-sprite"
                      label="Homing Sprite"
                      code="missile.homing.sprite"
                      value={project.recordOverrides['missile.homing.sprite'] ?? ''}
                      onChange={(v) => updateOverride('missile.homing.sprite', v)}
                      desc="Stock sprite shown while homing."
                    />
                    {animField('missile.homing.animation', 'Homing Animation Mode', 0)}
                    <StockSpriteInput
                      id="homing-trail-sprite"
                      label="Homing Trail Sprite"
                      code="missile.homing.trail.sprite"
                      value={project.recordOverrides['missile.homing.trail.sprite'] ?? ''}
                      onChange={(v) => updateOverride('missile.homing.trail.sprite', v)}
                      options={TRAIL_SPRITES}
                      desc="Stock trail sprite emitted while homing (0 or blank disables it)."
                    />
                    {numField('missile.homing.trail.power', 'Homing Trail Density', 0, 'Particle density while homing.')}
                    {numField('missile.homing.trail.speed', 'Homing Trail Speed', 0, 'Particle ejection speed while homing.')}
                    {numField('missile.homing.trail.bubbles_per_second', 'Homing Bubbles / sec', 0, 'Underwater bubble rate while homing (0.25 steps).', { min: 0, max: 20, step: 0.25 })}
                  </div>
                </div>
              </div>
            )}

            {project.action === 'roam' && (
              <div className="space-y-4 rounded-xl bg-stone-50/70 p-4 dark:bg-stone-950/40">
                <SubSectionTitle title="Roaming Animal Settings" code="missile.roam" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  {roamNum('walk_speed', 'Walk Speed', 'walk_speed', 'Grounded walk speed in pixels/frame (PX 100 = 2.0 px/f).', { min: 0, max: 10, step: 0.02, unit: 'px/f' })}
                  {roamNum('step_height', 'Climb Step Height', 'step_height', 'Maximum vertical terrain step climbed while walking (can be negative).', { step: 1, unit: 'px' })}
                  {roamNum('terrain_offset', 'Ground Sprite Offset', 'terrain_offset', 'Vertical drawing offset in pixels while walking on terrain.', { step: 1, unit: 'px' })}
                </div>

                <div className="space-y-3 border-t border-stone-200/80 pt-3 dark:border-stone-800">
                  <SubSectionTitle title="Edge Jump" code="roam.edge_jump" />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    {roamNum('edge_jump_angle_deg', 'Edge Jump Angle', 'roam.edge_jump.angle_deg', 'Launch angle when leaping off a ledge (negative values can detonate).', { step: 1, unit: 'deg' })}
                    {roamNum('edge_jump_speed', 'Edge Jump Speed', 'roam.edge_jump.speed', 'Nominal edge-jump speed in px/frame (~1/6 variation).', { min: 0, max: 10, step: 0.06, unit: 'px/f' })}
                    {roamNum('edge_jump_sound', 'Edge Jump Sound', 'roam.edge_jump.sound', 'Native sound ID played at ledge jumps (0 = silent).')}
                  </div>
                </div>

                <div className="space-y-3 border-t border-stone-200/80 pt-3 dark:border-stone-800">
                  <SubSectionTitle title="Hop / Jump" code="roam.jump" />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    {roamNum('jump_angle_deg', 'Jump Angle', 'roam.jump.angle_deg', 'Launch angle for regular hops (negative values can detonate).', { step: 1, unit: 'deg' })}
                    {roamNum('jump_speed', 'Jump Speed', 'roam.jump.speed', 'Nominal jump speed in px/frame (~1/6 variation).', { min: 0, max: 10, step: 0.06, unit: 'px/f' })}
                    {roamNum('jump_sound', 'Jump Sound', 'roam.jump.sound', 'Native sound ID played on hop (0 = silent).')}
                  </div>
                </div>

                <div className="space-y-3 border-t border-stone-200/80 pt-3 dark:border-stone-800">
                  <SubSectionTitle title="Gas / Fart" code="roam.gas" />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    {roamNum('gas_start_delay_ms', 'Gas Start Delay', 'roam.gas.start_delay_ms', 'Delay before emitting poison gas (0 leaves gas disabled).', { min: 0, step: 100, unit: 'ms' })}
                    {roamNum('gas_poison_power', 'Poison Strength', 'roam.gas.poison_power', 'Poison strength applied by emitted clouds.', { min: 0 })}
                    <StockSpriteInput
                      id="roam-gas-sprite"
                      label="Gas Pose Sprite"
                      code="roam.gas.animal_sprite"
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
                      desc="Stock sprite pose shown while emitting gas (Skunk uses skunk2 / 174). 0 draws nothing new."
                    />
                  </div>
                </div>

                <div className="space-y-3 border-t border-stone-200/80 pt-3 dark:border-stone-800">
                  <SubSectionTitle title="Sheep Flight Sprites" code="sheep" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <StockSpriteInput
                      id="roam-flight-1"
                      label="Flying Sprite 1"
                      code="sheep.flight_1"
                      numeric
                      placeholder="0"
                      value={project.roamConfig?.flight_1 ?? 0}
                      onChange={(v) =>
                        onChange({
                          roamConfig: { ...project.roamConfig, flight_1: v === '' ? 0 : Number(v) },
                        })
                      }
                      desc="Alternates with Flying Sprite 2 every 5 frames while steering. Replaced by custom sheets uploaded on Hold & Sprite Builder."
                    />
                    <StockSpriteInput
                      id="roam-flight-2"
                      label="Flying Sprite 2"
                      code="sheep.flight_2"
                      numeric
                      placeholder="0"
                      value={project.roamConfig?.flight_2 ?? 0}
                      onChange={(v) =>
                        onChange({
                          roamConfig: { ...project.roamConfig, flight_2: v === '' ? 0 : Number(v) },
                        })
                      }
                      desc="Second flying rotation strip (Super Sheep uses 154/155, Aqua Sheep 156/157)."
                    />
                  </div>
                </div>

                <div className="space-y-2 border-t border-stone-200/80 pt-3 dark:border-stone-800">
                  <SubSectionTitle title="Walking Collision Targets" code="roam.hits" />
                  {roamMaskGrid('hits', project.roamConfig.hits)}
                </div>

                <div className="space-y-2 border-t border-stone-200/80 pt-3 dark:border-stone-800">
                  <SubSectionTitle title="Steered Flight Collision Targets" code="roam.flight_hits" />
                  {roamMaskGrid('flight_hits', project.roamConfig.flight_hits)}
                </div>
              </div>
            )}

            {project.action === 'dig' && (
              <div className="space-y-3 rounded-xl bg-stone-50/70 p-4 dark:bg-stone-950/40">
                <SubSectionTitle title="Burrowing Settings" code="missile.dig" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
                  <div>
                    <TooltipLabel label="Dig Sound" code="missile.dig.sound" desc="Native sound ID played while burrowing underground." />
                    <NumberInput
                      value={project.digConfig.sound}
                      onChange={(e) =>
                        onChange({ digConfig: { ...project.digConfig, sound: Number(e.target.value) } })
                      }
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <TooltipLabel label="Dive Sprite" code="missile.dig.dive_sprite" desc="Stock sprite ID shown while diving into terrain." />
                    <NumberInput
                      value={project.digConfig.dive_sprite}
                      onChange={(e) =>
                        onChange({ digConfig: { ...project.digConfig, dive_sprite: Number(e.target.value) } })
                      }
                      className={inputClass}
                    />
                  </div>

                  {([1, 2, 3] as const).map((n) => (
                    <div key={n}>
                      <TooltipLabel
                        label={`Digging Frame ${n}`}
                        code={`missile.dig.sprite_${n}`}
                        desc={`Native digging sprite frame ${n}.`}
                      />
                      <NumberInput
                        value={project.digConfig[`sprite_${n}` as 'sprite_1' | 'sprite_2' | 'sprite_3']}
                        onChange={(e) =>
                          onChange({
                            digConfig: {
                              ...project.digConfig,
                              [`sprite_${n}`]: Number(e.target.value),
                            },
                          })
                        }
                        className={inputClass}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Collision Targets (integrated directly below Action) */}
          <div className="space-y-3 border-t border-stone-200/80 pt-5 dark:border-stone-800">
            <SubSectionTitle
              title="Detonates On Contact"
              code="missile.ends_on_contact"
              desc="Targets whose contact immediately ends flight and triggers the payload."
            />
            {maskGrid('missile.ends_on_contact', endsOnContactMask)}
          </div>

          {project.action === 'bounce' && (
            <div className="space-y-3 border-t border-stone-200/80 pt-4 dark:border-stone-800">
              <SubSectionTitle
                title="Bounces Off"
                code="missile.bounce.hits"
                desc="Targets the projectile physically bounces off instead of exploding."
              />
              {maskGrid('missile.bounce.hits', bounceHitsMask)}
            </div>
          )}
        </div>
      )}

      {/* PANEL 3: Explodes Into */}
      {normalizedTab === 'burst' && (
        <div className="p-4 sm:p-5 space-y-5">
          <SectionHeader
            title="Explodes Into"
            code="missile.burst"
            desc="What spawns when the main projectile detonates: a single blast, cluster submunitions, or spreading fire."
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 rounded-xl border border-stone-200 bg-stone-100 p-1 dark:border-stone-800 dark:bg-stone-950/60">
            {(
              [
                { id: 'nothing', label: 'Plain Blast', icon: CircleDot, desc: 'Single explosion with no extra submunitions.' },
                { id: 'clusters', label: 'Cluster Bits', icon: Sparkles, desc: 'Splits into multiple smaller projectiles on detonation.' },
                { id: 'fire', label: 'Spreading Fire', icon: Flame, desc: 'Drops napalm flames that ignite and spread across terrain.' },
              ] as const
            ).map((b) => {
              const Icon = b.icon;
              const isSelected = (project.burst || 'nothing') === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onChange({ burst: b.id })}
                  title={buildTooltip(b.desc, `"${b.id}"`)}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isSelected
                      ? 'bg-white text-stone-900 shadow-xs ring-1 ring-forge-500/40 dark:bg-stone-800 dark:text-white'
                      : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white'
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${isSelected ? 'text-forge-500' : ''}`} aria-hidden="true" />
                  <span>{b.label}</span>
                </button>
              );
            })}
          </div>

          {(!project.burst || project.burst === 'nothing') && (
            <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-500 dark:bg-stone-950/40 dark:text-stone-400">
              Detonates in a single explosion without spawning extra cluster projectiles or fire.
            </p>
          )}

          {project.burst === 'clusters' && (
            <div className="space-y-4">
              {/* Inner Cluster Sub-Navigation Bar */}
              <div className="flex flex-wrap items-center gap-1.5 border-b border-stone-200/80 pb-3 dark:border-stone-800">
                <button
                  type="button"
                  onClick={() => setClusterView('physics')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    clusterView === 'physics'
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'border border-stone-200 bg-white text-stone-600 hover:border-sky-300 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300'
                  }`}
                >
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  <span>Ejection &amp; Bit Physics</span>
                </button>
                <button
                  type="button"
                  onClick={() => setClusterView('targets')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    clusterView === 'targets'
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'border border-stone-200 bg-white text-stone-600 hover:border-sky-300 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300'
                  }`}
                >
                  <Target className="h-3 w-3" aria-hidden="true" />
                  <span>Bit Targets</span>
                </button>
                <button
                  type="button"
                  onClick={() => setClusterView('action')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    clusterView === 'action'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'border border-stone-200 bg-white text-stone-600 hover:border-amber-300 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300'
                  }`}
                >
                  <Zap className="h-3 w-3" aria-hidden="true" />
                  <span>Bit Action: {bitActionTitle}</span>
                </button>
              </div>

              {clusterView === 'physics' && (
                <div className="space-y-5">
                  {/* Ejection parameters */}
                  <div className="space-y-3">
                    <SubSectionTitle title="Cluster Ejection" code="clusters" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                      <div>
                        <TooltipLabel label="Cluster Count" code="clusters.count" desc="Number of child projectiles spawned on detonation." />
                        <NumberInput
                          min={1}
                          max={20}
                          value={clustlet.count}
                          onChange={(e) => updateClustlet({ count: Number(e.target.value) })}
                          className={inputClass}
                        />
                      </div>

                      <div>
                        <TooltipLabel label="Spread Fan Angle" code="clusters.spread" desc="Angular fan width in degrees across which bits scatter." />
                        <UnitNumberInput
                          min={10}
                          max={180}
                          value={clustlet.spread}
                          onChange={(e) => updateClustlet({ spread: Number(e.target.value) })}
                          unit="deg"
                        />
                      </div>

                      <div>
                        <TooltipLabel label="Ejection Power" code="clusters.launch_power_pct" desc="Launch speed of ejected cluster bits relative to 24 px/frame." />
                        <UnitNumberInput
                          min={0}
                          max={200}
                          value={clustlet.power}
                          onChange={(e) => updateClustlet({ power: Number(e.target.value) })}
                          unit="%"
                        />
                      </div>

                      <div>
                        <TooltipLabel label="Speed Randomness" code="clusters.power_variation_pct" desc="Random reduction in launch strength per bit." />
                        <UnitNumberInput
                          min={0}
                          max={100}
                          value={clustlet.power_variation}
                          onChange={(e) => updateClustlet({ power_variation: Number(e.target.value) })}
                          unit="%"
                        />
                      </div>

                      <div>
                        <TooltipLabel label="Emission Angle" code="clusters.angle" desc="Native center ejection angle; keep base value unless tuning scatter bias." />
                        <UnitNumberInput
                          value={clustlet.angle}
                          onChange={(e) => updateClustlet({ angle: Number(e.target.value) })}
                          unit="native"
                        />
                      </div>

                      <div>
                        <TooltipLabel
                          label="Sprite ID Stride"
                          code="clusters.bit.sprite_count"
                          desc="Consecutive stock sprite IDs cycled across bits. Use 1 with an uploaded pack sheet."
                        />
                        <NumberInput
                          min={0}
                          value={clustlet.sprite_count}
                          onChange={(e) => updateClustlet({ sprite_count: Number(e.target.value) })}
                          className={inputClass}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Child bit physics & blast */}
                  <div className="space-y-3 border-t border-stone-200/80 pt-4 dark:border-stone-800">
                    <SubSectionTitle title="Child Bit Physics &amp; Blast" code="clusters.bit" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                      <div>
                        <TooltipLabel label="Bit Blast Power" code="clusters.bit.explosion.power" desc="Damage and crater radius of each cluster bit." />
                        <UnitNumberInput
                          min={5}
                          max={150}
                          value={clustlet.damage}
                          onChange={(e) => updateClustlet({ damage: Number(e.target.value) })}
                          unit="dmg"
                        />
                      </div>

                      {bitNum('explosion_push_pct', 'Bit Knockback', 'clusters.bit.explosion.push_pct', 100, 'Knockback percentage of child blasts.', { min: 0, max: 400, unit: '%' })}

                      <div>
                        <TooltipLabel label="Bit Gravity" code="clusters.bit.gravity_pct" desc="Gravity multiplier applied to cluster bits." />
                        <UnitNumberInput
                          min={0}
                          max={200}
                          value={clustlet.gravity_pct}
                          onChange={(e) => updateClustlet({ gravity_pct: Number(e.target.value) })}
                          unit="%"
                        />
                      </div>

                      {bitNum('wind_pct', 'Bit Wind Sensitivity', 'clusters.bit.wind_pct', 100, 'Wind response percentage.', { min: 0, max: 300, unit: '%' })}

                      <div>
                        <TooltipLabel label="Bit Fuse Timer" code="clusters.bit.fuse" desc="Milliseconds before each bit detonates (0 = impact)." />
                        <UnitNumberInput
                          min={0}
                          step={250}
                          value={clustlet.fuse}
                          onChange={(e) => updateClustlet({ fuse: Number(e.target.value) })}
                          unit="ms"
                        />
                      </div>

                      {bitNum('countdown_ms', 'Bit Countdown', 'clusters.bit.countdown', 0, 'Separate native countdown timer.', { min: 0, step: 500, unit: 'ms' })}
                      {bitNum('speed_pct', 'Bit Speed', 'clusters.bit.speed_pct', 100, 'Initial launch speed percentage.', { min: 0, max: 300, unit: '%' })}
                      {bitNum('explosion_bias', 'Bit Blast Bias', 'clusters.bit.explosion.bias', 0, 'Vertical elevation bias of child blasts.')}
                      {bitNum('explosion_variation', 'Bit Damage Spread', 'clusters.bit.explosion.variation', 0, 'Random variation applied to child damage.')}
                      {bitNum('flight_sound', 'Bit Flight Sound', 'clusters.bit.flight_sound', 0, 'Native sound ID looped in flight.')}

                      <div>
                        <TooltipLabel
                          label="Bit Sprite"
                          code="clusters.bit.sprite"
                          desc="Stock sprite name or numeric ID; replaced automatically if a pack sheet is uploaded."
                        />
                        <input
                          type="text"
                          value={clustlet.sprite}
                          onChange={(e) => updateClustlet({ sprite: e.target.value })}
                          placeholder="clustlet / 54"
                          className={inputClass}
                        />
                      </div>

                      <div>
                        <TooltipLabel
                          label="Bit Smoke Trail"
                          code="clusters.bit.trail.sprite"
                          desc="Stock particle smoke trail emitted behind each cluster bit."
                        />
                        <select
                          value={clustlet.trail}
                          onChange={(e) => updateClustlet({ trail: e.target.value })}
                          className={selectClass}
                        >
                          <option value="">None</option>
                          <option value="smklt25">Light Smoke</option>
                          <option value="smklt50">Medium Smoke</option>
                          <option value="smklt75">Dense Smoke</option>
                          <option value="smklt100">Heavy Smoke</option>
                          <option value="skdsmoke">Skid Smoke</option>
                          {!['', 'smklt25', 'smklt50', 'smklt75', 'smklt100', 'skdsmoke'].includes(clustlet.trail) && (
                            <option value={clustlet.trail}>{clustlet.trail}</option>
                          )}
                        </select>
                      </div>

                      {bitAnimField('animation', 'Bit Animation Mode', 'clusters.bit.animation', 0)}
                      {bitNum('trail_power', 'Bit Trail Density', 'clusters.bit.trail.power', 0, 'Particle trail emission density.')}
                      {bitNum('trail_speed', 'Bit Trail Speed', 'clusters.bit.trail.speed', 0, 'Particle ejection rate.')}
                      {bitNum('trail_bubbles', 'Bit Bubbles / sec', 'clusters.bit.trail.bubbles_per_second', 0, 'Underwater bubble emission rate.')}
                    </div>
                  </div>

                  {/* Bit Art & Triggers */}
                  <div className="space-y-4 border-t border-stone-200/80 pt-4 dark:border-stone-800">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <PackSpriteUpload
                        project={project}
                        onChange={onChange}
                        slot="cluster_sprite"
                        label="Bit Sprite Sheet"
                        code="cluster.sprite"
                        hint="Loaded as custom cluster bit art at install (replaces stock sprite)."
                        warning={
                          bitBuilderMode(project) === 'builder'
                            ? 'WFWS bit builder owns the cluster bits: edit bit art in Hold & Sprite Builder.'
                            : undefined
                        }
                        onUpload={() => {
                          updateClustlet({ sprite_count: 1 });
                        }}
                        rotate={{
                          onRotate: () => updateClustlet({ animation: 2 }),
                        }}
                      />
                      <PackSpriteUpload
                        project={project}
                        onChange={onChange}
                        slot="cluster_trail"
                        label="Bit Trail Sheet"
                        code="clusters.bit.trail.sprite"
                        hint="Custom trail particle sheet for this weapon's bits; power, speed, and bubbles still apply."
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <CheckboxCard
                        checked={!!clustlet.explode_on_space}
                        onChange={(v) => updateClustlet({ explode_on_space: v })}
                        label="Detonate Bits on Space"
                        code="clusters.bit.explode_on_space"
                        desc="Allows detonating airborne cluster bits by pressing Space."
                      />
                      <CheckboxCard
                        checked={!!clustlet.explosion_sound_enabled}
                        onChange={(v) => updateClustlet({ explosion_sound_enabled: v })}
                        label="Pre-Blast Warning Sound"
                        code="clusters.bit.explosion_sound"
                        desc="Plays a native sound shortly before a cluster bit's timed explosion."
                      />
                    </div>

                    {clustlet.explosion_sound_enabled && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl bg-stone-50/70 p-3.5 dark:bg-stone-950/40">
                        {bitNum('explosion_sound', 'Warning Sound ID', 'clusters.bit.explosion_sound.sound', 0, 'Native sound ID played before detonation.')}
                        {bitNum('explosion_sound_before', 'Lead Time', 'clusters.bit.explosion_sound.before', 0, 'Milliseconds before detonation to play the sound.', { min: 0, step: 100, unit: 'ms' })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {clusterView === 'targets' && (
                <div className="space-y-4">
                  <div className="space-y-2.5">
                    <SubSectionTitle
                      title="Bit Detonates On Contact"
                      code="clusters.bit.ends_on_contact"
                      desc="Targets whose contact immediately ends the bit and triggers its blast."
                    />
                    {bitMaskGrid('ends_on_contact', clustlet.ends_on_contact)}
                  </div>

                  {bitAction === 'bounce' && (
                    <div className="space-y-2.5 border-t border-stone-200/80 pt-4 dark:border-stone-800">
                      <SubSectionTitle
                        title="Bit Bounces Off"
                        code="clusters.bit.bounce.hits"
                        desc="Targets the bit physically bounces off instead of exploding."
                      />
                      {bitMaskGrid('bounce_hits', clustlet.bounce_hits)}
                    </div>
                  )}
                </div>
              )}

              {clusterView === 'action' && (
                <div className="space-y-4">
                  <div>
                    <TooltipLabel
                      label="Bit Flight Behaviour"
                      code="clusters.bit.action"
                      desc="Flight behaviour of each spawned cluster bit."
                    />
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-1 rounded-xl border border-stone-200 bg-stone-100 p-1 dark:border-stone-800 dark:bg-stone-950/60">
                      {(
                        [
                          { id: 'none', label: 'Impact' },
                          { id: 'bounce', label: 'Bounce' },
                          { id: 'homing', label: 'Homing' },
                          { id: 'roam', label: 'Roam' },
                          { id: 'dig', label: 'Dig' },
                        ] as const
                      ).map((act) => (
                        <button
                          key={act.id}
                          type="button"
                          onClick={() =>
                            updateClustlet({
                              bit_action: act.id,
                              contact: act.id === 'bounce' ? 'bounce' : 'impact',
                              homing:
                                act.id === 'homing'
                                  ? clustlet.homing === 'off'
                                    ? 'lock'
                                    : clustlet.homing
                                  : 'off',
                              ...(act.id === 'roam' && !clustlet.roam
                                ? { roam: { ...DEFAULT_BIT_ROAM } }
                                : {}),
                              ...(act.id === 'dig' && !clustlet.dig
                                ? { dig: { ...DEFAULT_BIT_DIG } }
                                : {}),
                            })
                          }
                          className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            bitAction === act.id
                              ? 'bg-white text-stone-900 shadow-xs ring-1 ring-forge-500/40 dark:bg-stone-800 dark:text-white'
                              : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white'
                          }`}
                        >
                          {act.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {bitAction === 'none' && (
                    <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-500 dark:bg-stone-950/40 dark:text-stone-400">
                      Cluster bits fly on a standard ballistic arc and detonate on impact or fuse expiration.
                    </p>
                  )}

                  {bitAction === 'bounce' && (
                    <div className="space-y-4 rounded-xl bg-stone-50/70 p-4 dark:bg-stone-950/40">
                      <SubSectionTitle title="Bit Bounce Settings" code="clusters.bit.bounce" />
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                        {bitNum('bounciness', 'Bit Bounciness', 'clusters.bit.bounce.bounciness', 0, '0 matches standard grenade bounciness.', { min: 0, max: 100 })}
                        {bitNum('bounce_terrain_keep_speed_pct', 'Speed Kept on Bounce', 'clusters.bit.bounce.terrain_keep_speed_pct', 75, 'Velocity preserved when bouncing off terrain.', { min: 0, max: 100, unit: '%' })}
                        {bitNum('bounces', 'Max Bounces', 'clusters.bit.bounce.max_bounces', 0, 'Detonate on Nth bounce (0 keeps normal fuse timing).', { min: 0, max: 20 })}
                        {bitNum('bounce_sound', 'Bounce Sound', 'clusters.bit.bounce.sound', 0, 'Native sound ID played on bounce (0 = silent).')}
                        {bitNum('bounce_contact_sides', 'Counted Impact Sides', 'clusters.bit.bounce.contact_sides', 0, 'Native side mask for bounce limit and contact blasts.')}
                        {bitNum('bounce_extra_reverse_chance_pct', 'Extra Rebound Chance', 'clusters.bit.bounce.extra_reverse_chance_pct', 0, 'Chance for an extra horizontal direction flip.', { min: 0, max: 100, unit: '%' })}
                      </div>

                      <CheckboxCard
                        checked={clustlet.bounce_explode}
                        onChange={(checked) =>
                          updateClustlet({
                            bounce_explode: checked,
                            ...(checked && !clustlet.bounce_power
                              ? { bounce_power: clustlet.damage }
                              : {}),
                          })
                        }
                        label="Explode on Each Bounce"
                        code="clusters.bit.bounce.explosion"
                        desc="Adds a contact blast whenever the cluster bit bounces."
                      />

                      {clustlet.bounce_explode && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          {bitNum('bounce_power', 'Contact Blast Power', 'clusters.bit.bounce.explosion.power', 0, 'Damage and crater radius per bounce.', { min: 0, max: 500 })}
                          {bitNum('bounce_explosion_push_pct', 'Contact Knockback', 'clusters.bit.bounce.explosion.push_pct', 100, 'Knockback percentage per bounce.', { min: 0, max: 400, unit: '%' })}
                          {bitNum('bounce_explosion_bias', 'Contact Blast Bias', 'clusters.bit.bounce.explosion.bias', 0, 'Vertical elevation bias per bounce.')}
                          {bitNum('bounce_explosion_variation', 'Contact Damage Spread', 'clusters.bit.bounce.explosion.variation', 0, 'Random damage variation per bounce.')}
                        </div>
                      )}
                    </div>
                  )}

                  {bitAction === 'homing' && (
                    <div className="space-y-4 rounded-xl bg-stone-50/70 p-4 dark:bg-stone-950/40">
                      <SubSectionTitle title="Bit Homing Settings" code="clusters.bit.homing" />
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                        <div>
                          <TooltipLabel label="Guidance Mode" code="clusters.bit.homing.kind" desc="Homing steering style for cluster bits." />
                          <select
                            value={clustlet.homing === 'off' ? 'lock' : clustlet.homing}
                            onChange={(e) =>
                              updateClustlet({ homing: e.target.value as ClustletConfig['homing'] })
                            }
                            className={selectClass}
                          >
                            <option value="lock">Lock-On</option>
                            <option value="dodge">Dodge</option>
                          </select>
                        </div>
                        {bitNum('homing_arm_ms', 'Arming Delay', 'clusters.bit.homing.arm', 1000, 'Milliseconds before homing steering begins.', { min: 0, step: 250, unit: 'ms' })}
                        {bitNum('homing_time_ms', 'Guidance Duration', 'clusters.bit.homing.time', 8000, 'How long homing steering lasts.', { min: 0, step: 500, unit: 'ms' })}
                        {bitNum('homing_sprite', 'Homing Sprite ID', 'clusters.bit.homing.sprite', 0, 'Native stock sprite ID shown while homing.')}
                        {bitAnimField('homing_animation', 'Homing Animation Mode', 'clusters.bit.homing.animation', 0)}
                        {bitNum('homing_trail_sprite', 'Homing Trail ID', 'clusters.bit.homing.trail.sprite', 0, 'Native stock trail sprite ID while homing.')}
                        {bitNum('homing_trail_power', 'Homing Trail Density', 'clusters.bit.homing.trail.power', 0, 'Particle trail density while homing.')}
                        {bitNum('homing_trail_speed', 'Homing Trail Speed', 'clusters.bit.homing.trail.speed', 0, 'Particle ejection speed while homing.')}
                        {bitNum('homing_trail_bubbles', 'Homing Bubbles / sec', 'clusters.bit.homing.trail.bubbles_per_second', 0, 'Underwater bubble rate while homing.')}
                      </div>
                      {isStrike ? (
                        <p className="text-[11px] text-stone-500">
                          Air strike bits follow the main munition sheet automatically.
                        </p>
                      ) : (
                        <PackSpriteUpload
                          project={project}
                          onChange={onChange}
                          slot="cluster_homing_sprite"
                          label="Homing Bit Sheet"
                          code="cluster.homing_sprite"
                          hint="Custom sprite sheet drawn while cluster bits are homing."
                          warning={
                            bitBuilderMode(project) === 'builder'
                              ? 'WFWS bit builder owns the bits: edit homing bit art in Hold & Sprite Builder.'
                              : undefined
                          }
                        />
                      )}
                    </div>
                  )}

                  {bitAction === 'roam' && (
                    <div className="space-y-4 rounded-xl bg-stone-50/70 p-4 dark:bg-stone-950/40">
                      <SubSectionTitle title="Bit Roaming Settings" code="clusters.bit.roam" />
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                        {bitRoamNum('walk_speed', 'Walk Speed', 'clusters.bit.roam.walk_speed', 'Grounded walk speed in pixels/frame (PX 100 = 2.0 px/f).', { min: 0, max: 10, step: 0.02, unit: 'px/f' })}
                        {bitRoamNum('step_height', 'Climb Step Height', 'clusters.bit.roam.step_height', 'Maximum vertical terrain step climbed while walking.', { step: 1, unit: 'px' })}
                        {bitRoamNum('terrain_offset', 'Ground Sprite Offset', 'clusters.bit.roam.terrain_offset', 'Vertical drawing offset while grounded.', { step: 1, unit: 'px' })}
                      </div>

                      <div className="space-y-3 border-t border-stone-200/80 pt-3 dark:border-stone-800">
                        <SubSectionTitle title="Edge Jump" code="clusters.bit.roam.edge_jump" />
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                          {bitRoamNum('edge_jump_angle_deg', 'Edge Jump Angle', 'clusters.bit.roam.edge_jump.angle_deg', 'Launch angle when leaping off a ledge.', { step: 1, unit: 'deg' })}
                          {bitRoamNum('edge_jump_speed', 'Edge Jump Speed', 'clusters.bit.roam.edge_jump.speed', 'Nominal edge-jump speed in px/frame.', { min: 0, max: 10, step: 0.06, unit: 'px/f' })}
                          {bitRoamNum('edge_jump_sound', 'Edge Jump Sound', 'clusters.bit.roam.edge_jump.sound', 'Native sound ID played at ledge jumps (0 = silent).')}
                        </div>
                      </div>

                      <div className="space-y-3 border-t border-stone-200/80 pt-3 dark:border-stone-800">
                        <SubSectionTitle title="Hop / Jump" code="clusters.bit.roam.jump" />
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                          {bitRoamNum('jump_angle_deg', 'Jump Angle', 'clusters.bit.roam.jump.angle_deg', 'Launch angle for regular hops.', { step: 1, unit: 'deg' })}
                          {bitRoamNum('jump_speed', 'Jump Speed', 'clusters.bit.roam.jump.speed', 'Nominal jump speed in px/frame.', { min: 0, max: 10, step: 0.06, unit: 'px/f' })}
                          {bitRoamNum('jump_sound', 'Jump Sound', 'clusters.bit.roam.jump.sound', 'Native sound ID played on hop (0 = silent).')}
                        </div>
                      </div>

                      <div className="space-y-3 border-t border-stone-200/80 pt-3 dark:border-stone-800">
                        <SubSectionTitle title="Gas / Fart" code="clusters.bit.roam.gas" />
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                          {bitRoamNum('gas_start_delay_ms', 'Gas Start Delay', 'clusters.bit.roam.gas.start_delay_ms', 'Delay before emitting poison gas (0 leaves gas disabled).', { min: 0, step: 100, unit: 'ms' })}
                          {bitRoamNum('gas_poison_power', 'Poison Strength', 'clusters.bit.roam.gas.poison_power', 'Poison strength applied by emitted clouds.', { min: 0 })}
                          <StockSpriteInput
                            id="bit-roam-gas-sprite"
                            label="Gas Pose Sprite"
                            code="clusters.bit.roam.gas.animal_sprite"
                            numeric
                            placeholder="0"
                            value={project.body.clustlet.roam?.gas_animal_sprite ?? 0}
                            onChange={(v) =>
                              updateClustlet({
                                roam: {
                                  ...(project.body.clustlet.roam as RoamActionConfig),
                                  gas_animal_sprite: v === '' ? 0 : Number(v),
                                },
                              })
                            }
                            desc="Stock sprite pose shown while emitting gas (used by Skunk cluster bits)."
                          />
                        </div>
                      </div>

                      <div className="space-y-2 border-t border-stone-200/80 pt-3 dark:border-stone-800">
                        <SubSectionTitle title="Walking Collision Targets" code="clusters.bit.roam.hits" />
                        {bitRoamMaskGrid('hits')}
                      </div>

                      <div className="space-y-2 border-t border-stone-200/80 pt-3 dark:border-stone-800">
                        <SubSectionTitle title="Steered Flight Collision Targets" code="clusters.bit.roam.flight_hits" />
                        {bitRoamMaskGrid('flight_hits')}
                      </div>
                    </div>
                  )}

                  {bitAction === 'dig' && (
                    <div className="space-y-3 rounded-xl bg-stone-50/70 p-4 dark:bg-stone-950/40">
                      <SubSectionTitle title="Bit Digging Settings" code="clusters.bit.dig" />
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
                        {bitDigNum('sound', 'Dig Sound', 'clusters.bit.dig.sound', 'Native digging sound ID.')}
                        {bitDigNum('dive_sprite', 'Dive Sprite', 'clusters.bit.dig.dive_sprite', 'Stock sprite ID shown while diving into terrain.')}
                        {bitDigNum('sprite_1', 'Digging Frame 1', 'clusters.bit.dig.sprite_1', 'Native digging sprite frame 1.')}
                        {bitDigNum('sprite_2', 'Digging Frame 2', 'clusters.bit.dig.sprite_2', 'Native digging sprite frame 2.')}
                        {bitDigNum('sprite_3', 'Digging Frame 3', 'clusters.bit.dig.sprite_3', 'Native digging sprite frame 3.')}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {project.burst === 'fire' && (
            <div className="space-y-3 rounded-xl bg-stone-50/70 p-4 dark:bg-stone-950/40">
              <SubSectionTitle title="Spreading Fire Settings" code="missile.fire" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div>
                  <TooltipLabel
                    label="Spread Delay"
                    code="missile.fire.spread_delay_ms"
                    desc="Milliseconds before a flame spawns the next spreading generation."
                  />
                  <UnitNumberInput
                    value={project.fireConfig.spread_delay_ms}
                    onChange={(e) =>
                      onChange({ fireConfig: { ...project.fireConfig, spread_delay_ms: Number(e.target.value) } })
                    }
                    unit="ms"
                  />
                </div>

                <div>
                  <TooltipLabel
                    label="Burn Duration"
                    code="missile.fire.burn_time_ms"
                    desc="Nominal settled burn time before flames go out."
                  />
                  <UnitNumberInput
                    value={project.fireConfig.burn_time_ms}
                    onChange={(e) =>
                      onChange({ fireConfig: { ...project.fireConfig, burn_time_ms: Number(e.target.value) } })
                    }
                    unit="ms"
                  />
                </div>

                <div>
                  <TooltipLabel
                    label="Spread Generations"
                    code="missile.fire.spread_generations"
                    desc="How many times flames can branch outward (0 keeps initial flames only)."
                  />
                  <NumberInput
                    min={0}
                    max={25}
                    value={project.fireConfig.spread_generations}
                    onChange={(e) =>
                      onChange({ fireConfig: { ...project.fireConfig, spread_generations: Number(e.target.value) } })
                    }
                    className={inputClass}
                  />
                </div>

                <div>
                  <TooltipLabel
                    label="Fuel Burn Mode"
                    code="missile.fire.decay_mode"
                    desc="Controls whether flame lifetime drains while resting on terrain or only when damaging targets."
                  />
                  <select
                    value={project.fireConfig.decay_mode}
                    onChange={(e) =>
                      onChange({ fireConfig: { ...project.fireConfig, decay_mode: e.target.value as any } })
                    }
                    className={selectClass}
                  >
                    <option value="resting">Resting (Burns down on terrain)</option>
                    <option value="on_hit">On Hit (Drains on damage)</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PANEL 4: Sprites, Trail & Native Audio */}
      {normalizedTab === 'sprite' && (
        <div className="p-4 sm:p-5 space-y-5">
          <SectionHeader
            title="Sprites, Trail &amp; Native Audio"
            code="missile.sprite / trail / sounds"
            icon={<Sliders className="h-4 w-4 text-forge-500" aria-hidden="true" />}
            desc="Built-in stock sprite IDs, particle smoke trails, impact debris, and native sound IDs. Custom PNG missile flight sheets live in Hold & Sprites."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left column: Stock sprite & strike body sheet */}
            <div className="space-y-4">
              <div className="space-y-3 rounded-xl bg-stone-50/70 p-4 dark:bg-stone-950/40">
                <SubSectionTitle
                  title="Stock Missile Sprite"
                  code="missile.sprite (Record 0x14)"
                  desc="Built-in WA projectile art. Choose Hidden when using custom sheets in Hold & Sprites."
                />
                <div className="space-y-3">
                  <div>
                    <TooltipLabel
                      label="Stock Sprite Preset"
                      code="missile.sprite"
                      desc="Choose built-in WA weapon art, or Hidden when drawing custom Sprite Builder frames."
                    />
                    <select
                      value={
                        project.recordOverrides['missile.sprite'] !== undefined
                          ? String(project.recordOverrides['missile.sprite'])
                          : project.missileSprite?.hideStock
                            ? '0'
                            : project.missileSprite?.stockSprite || 'bazooka'
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
                      className={selectClass}
                    >
                      {STOCK_MISSILE_SPRITES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <TooltipLabel
                        label="Raw Sprite Name or ID"
                        code="missile.sprite"
                        desc="Optional numeric sprite ID or internal name override. Leave blank to use the preset above."
                      />
                      <input
                        type="text"
                        placeholder="e.g. 0 or bazooka"
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
                        className={inputClass}
                      />
                    </div>
                    {animField('missile.animation', 'Flight Animation', 0)}
                  </div>
                </div>
              </div>

              {isStrike && (
                <div className="space-y-3 rounded-xl bg-stone-50/70 p-4 dark:bg-stone-950/40">
                  <SubSectionTitle
                    title="Strike Munition Art"
                    code="sprite (body 0x74)"
                    desc="Air strikes fire created munitions without a primary launcher missile, so custom bomb art goes here."
                  />
                  <PackSpriteUpload
                    project={project}
                    onChange={onChange}
                    slot="strike_sprite"
                    label="Munition Sheet"
                    code="sprite"
                    hint="Installed on the air strike munition body. 32 direction frames match WA's airmisl order."
                    rotate={{
                      onRotate: () => updateOverride('missile.animation', 2),
                    }}
                  />
                </div>
              )}
            </div>

            {/* Right column: Particle Trail */}
            <div className="space-y-3.5 rounded-xl bg-stone-50/70 p-4 dark:bg-stone-950/40">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SubSectionTitle
                  title="Particle Trail &amp; Debris"
                  code="missile.trail"
                  desc="Stock smoke, sparks, underwater bubbles, and impact particles."
                />
                <label className="flex cursor-pointer items-center gap-1.5">
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
                              'missile.trail.sprite': 'smklt25',
                            }
                          : {}),
                      });
                    }}
                    className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
                  />
                  <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                    Enable Trail
                  </span>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-0.5 text-[10px] font-semibold uppercase text-stone-400">
                  Presets:
                </span>
                <button
                  type="button"
                  onClick={() =>
                    updateOverrides({
                      'missile.trail.enabled': true,
                      'missile.trail.sprite': 'smklt25',
                      'missile.trail.power': 25,
                      'missile.trail.speed': 250,
                    })
                  }
                  className="rounded-md border border-sky-200 bg-sky-50/75 px-2 py-1 text-[11px] font-semibold text-sky-800 transition-colors hover:bg-sky-100 dark:border-sky-800/60 dark:bg-sky-950/30 dark:text-sky-200 dark:hover:bg-sky-900/40 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Smoke
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateOverrides({
                      'missile.trail.enabled': true,
                      'missile.trail.sprite': 'firehit',
                      'missile.trail.power': 40,
                      'missile.trail.speed': 180,
                    })
                  }
                  className="rounded-md border border-amber-200 bg-amber-50/75 px-2 py-1 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-900/40 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Sparks
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateOverrides({
                      'missile.trail.enabled': true,
                      'missile.trail.sprite': 'smkdrk20',
                      'missile.trail.power': 50,
                      'missile.trail.speed': 320,
                    })
                  }
                  className="rounded-md border border-sky-200 bg-sky-50/75 px-2 py-1 text-[11px] font-semibold text-sky-800 transition-colors hover:bg-sky-100 dark:border-sky-800/60 dark:bg-sky-950/30 dark:text-sky-200 dark:hover:bg-sky-900/40 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Heavy Smoke
                </button>
                <button
                  type="button"
                  onClick={() => updateOverride('missile.trail.enabled', false)}
                  className="rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] font-medium text-forge-600 transition-colors hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-forge-400 dark:hover:bg-stone-700 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Clear
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <TooltipLabel label="Trail Density" code="missile.trail.power" desc="Emission density of trail particles." />
                  <NumberInput
                    min={1}
                    max={100}
                    value={project.recordOverrides['missile.trail.power'] ?? 25}
                    onChange={(e) => updateOverride('missile.trail.power', Number(e.target.value))}
                    disabled={!project.recordOverrides['missile.trail.enabled']}
                    className={inputClass}
                  />
                </div>

                <div>
                  <TooltipLabel label="Ejection Speed" code="missile.trail.speed" desc="Initial ejection speed of trail particles." />
                  <NumberInput
                    min={0}
                    max={1000}
                    step={10}
                    value={project.recordOverrides['missile.trail.speed'] ?? 250}
                    onChange={(e) => updateOverride('missile.trail.speed', Number(e.target.value))}
                    disabled={!project.recordOverrides['missile.trail.enabled']}
                    className={inputClass}
                  />
                </div>

                <StockSpriteInput
                  id="trail-sprite"
                  label="Trail Particle Sprite"
                  code="missile.trail.sprite"
                  value={project.recordOverrides['missile.trail.sprite'] ?? 'smklt25'}
                  onChange={(v) => updateOverride('missile.trail.sprite', v)}
                  options={TRAIL_SPRITES}
                  disabled={!project.recordOverrides['missile.trail.enabled']}
                  desc="Stock sprite name or ID; replaced if a custom trail sheet is uploaded. 0 disables the trail."
                />

                <div>
                  <TooltipLabel
                    label="Underwater Bubbles / sec"
                    code="missile.trail.bubbles_per_second"
                    desc="Bubble emission rate when travelling underwater (0 disables bubbles)."
                  />
                  <NumberInput
                    min={0}
                    max={20}
                    step={0.25}
                    value={project.recordOverrides['missile.trail.bubbles_per_second'] ?? 0}
                    onChange={(e) =>
                      updateOverride('missile.trail.bubbles_per_second', Number(e.target.value))
                    }
                    disabled={!project.recordOverrides['missile.trail.enabled']}
                    className={inputClass}
                  />
                </div>
              </div>

              <PackSpriteUpload
                project={project}
                onChange={onChange}
                slot="missile_trail"
                label="Custom Trail Sheet"
                code="missile.trail.sprite"
                hint="Replaces the stock trail sprite for this weapon; density and speed above still apply."
                onUpload={() => {
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

              <CheckboxCard
                checked={!!project.recordOverrides['missile.impact_particles']}
                onChange={(v) => updateOverride('missile.impact_particles', v)}
                label="Holy Impact Particles"
                code="missile.impact_particles"
                desc="Adds a lingering sparkle particle burst on impact and detonation (Holy Hand Grenade style)."
              />
            </div>
          </div>

          {/* Native Sound & Dive Indices */}
          <div className="space-y-3 border-t border-stone-200/80 pt-4 dark:border-stone-800">
            <SubSectionTitle
              title="Native Sound &amp; Dive Indices"
              code="flight_sound, launch_sound, bounce.sound, dig.dive_sprite"
              desc="Built-in WA sound IDs for launch, flight loops, bounces, and terrain dive sprite."
              right={<Volume2 className="h-4 w-4 text-forge-500" aria-hidden="true" />}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div>
                <TooltipLabel
                  label="In-Flight Loop Sound"
                  code="missile.flight_sound"
                  desc="Continuous sound ID looped during flight (e.g. 95 for rocket hum, 0 = silent)."
                />
                <input
                  type="number"
                  min={0}
                  placeholder="e.g. 95 (0 = silent)"
                  value={project.recordOverrides['missile.flight_sound'] ?? ''}
                  onChange={(e) => {
                    const val = e.target.value.trim();
                    updateOverride('missile.flight_sound', val === '' ? undefined : Number(val));
                  }}
                  className={inputClass}
                />
              </div>

              <div>
                <TooltipLabel
                  label="Launch Sound"
                  code="missile.launch_sound"
                  desc="Sound ID played once when the projectile fires (0 = none)."
                />
                <input
                  type="number"
                  min={0}
                  placeholder="e.g. 42 (0 = none)"
                  value={project.recordOverrides['missile.launch_sound'] ?? ''}
                  onChange={(e) => {
                    const val = e.target.value.trim();
                    updateOverride('missile.launch_sound', val === '' ? undefined : Number(val));
                  }}
                  className={inputClass}
                />
              </div>

              <div>
                <TooltipLabel
                  label="Bounce Sound"
                  code="missile.bounce.sound"
                  desc="Sound ID played when bouncing off terrain."
                />
                <input
                  type="number"
                  min={0}
                  placeholder="e.g. 110"
                  value={project.recordOverrides['missile.bounce.sound'] ?? ''}
                  onChange={(e) => {
                    const val = e.target.value.trim();
                    updateOverride('missile.bounce.sound', val === '' ? undefined : Number(val));
                  }}
                  className={inputClass}
                />
              </div>

              <div>
                <TooltipLabel
                  label="Dive Sprite ID"
                  code="missile.dig.dive_sprite"
                  desc="Stock sprite ID shown while diving or drilling into landscape."
                />
                <NumberInput
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
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PANEL 6: Firearm Specs / Flame Inspector */}
      {normalizedTab === 'gun' && (
        <div className="p-4 sm:p-5 space-y-5">
          <SectionHeader
            title={project.fireType === 'spray' ? 'Flame / Spray Inspector' : 'Firearm Specs'}
            code="gun"
            icon={
              project.fireType === 'spray' ? (
                <Flame className="h-4 w-4 text-forge-500" aria-hidden="true" />
              ) : (
                <Crosshair className="h-4 w-4 text-forge-500" aria-hidden="true" />
              )
            }
            desc="Instant-hit raycast firearm settings: damage, shots fired, spread cones, multi-pellet bursts, and hit targets."
          />

          {project.fireType === 'spray' && (
            <p className="rounded-lg bg-amber-50/70 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              <b>Spray inspection mode:</b> Native spray records share the raw{' '}
              <code className="font-mono">0x3c–0x64</code> hitscan slab, so imported{' '}
              <code className="font-mono">.wep</code> flame values decode here for inspection. WormForge
              omits <code className="font-mono">gun</code> on Lua export for spray weapons until
              dedicated spray fields exist.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div>
              <TooltipLabel
                label="Damage per Projectile"
                code="gun.damage"
                desc="Damage dealt per raycast hit (offset 0x5c)."
                htmlFor="gun-damage"
              />
              <UnitNumberInput
                id="gun-damage"
                min={0}
                max={500}
                value={body.damage}
                onChange={(e) => updateBody({ damage: Number(e.target.value) })}
                title={buildTooltip('Damage dealt per raycast hit.', 'gun.damage')}
                unit="dmg"
              />
            </div>
            {firingSubtypeField('gun')}
            {numField('gun.bullets', 'Bullets per Trigger', 1, 'Number of sequential shots fired per trigger pull.', { min: 0, max: 50 })}
            {numField('gun.spread_deg', 'Aim Spread Cone', 0, 'Total angular spread cone centered on the aim line.', { min: 0, max: 45, unit: 'deg' })}
            {numField('gun.shot_interval_ms', 'Shot Interval', 0, 'Delay in milliseconds between consecutive shots.', { min: 0, step: 20, unit: 'ms' })}
            {numField('gun.burst_size', 'Pellets per Shot', 0, 'Number of pellets fired at once per shot (e.g. Shotgun).', { min: 0, max: 50 })}
            {numField('gun.burst_spread_deg', 'Pellet Spread Cone', 0, 'Angular spread cone within a single multi-pellet shot.', { min: 0, max: 90, unit: 'deg' })}
            {numField('gun.impact_effect', 'Impact Effect ID', 0, 'Native visual effect spawned where bullets hit.')}
            {numField('gun.explosion.bias', 'Impact Blast Bias', 0, 'Vertical elevation bias at bullet impact points.')}
            {numField('gun.explosion.push_pct', 'Impact Knockback', 100, 'Knockback percentage applied per bullet hit.', { min: 0, max: 400, unit: '%' })}
            {numField('gun.explosion.variation', 'Impact Damage Spread', 0, 'Random variation applied to bullet impact damage.')}
          </div>

          <div className="space-y-2 border-t border-stone-200/80 pt-4 dark:border-stone-800">
            <SubSectionTitle
              title="Bullet Hit Targets"
              code="gun.hits"
              desc="Entities and terrain that raycast bullets collide with."
            />
            {maskGrid('gun.hits', (project.recordOverrides['gun.hits'] || {}) as CollisionMask)}
          </div>
        </div>
      )}

      {/* PANEL 7: Tool & Setup (Mine / Teleport / Arrow / Special) */}
      {normalizedTab === 'gun_mine' && (
        <div className="p-4 sm:p-5 space-y-5">
          {project.fireType === 'drop' && !body.fuse && (
            <>
              <SectionHeader
                title="Proximity Mine Setup"
                code="mine"
                icon={<Wrench className="h-4 w-4 text-forge-500" aria-hidden="true" />}
                desc="Detection radius, arming timer, trigger fuse, blast power, and sensor targets for dropped proximity mines."
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div>
                  <TooltipLabel label="Detection Radius" code="mine.proximity" desc="Trigger radius in pixels around the armed mine." />
                  <UnitNumberInput
                    min={0}
                    max={150}
                    value={body.proximity ?? 25}
                    onChange={(e) => updateBody({ proximity: Number(e.target.value) })}
                    unit="px"
                  />
                </div>
                <div>
                  <TooltipLabel label="Arming Delay" code="mine.arm" desc="Safety delay after placement before the mine arms." />
                  <UnitNumberInput
                    min={0}
                    step={250}
                    value={body.arm_delay_ms ?? 3000}
                    onChange={(e) => updateBody({ arm_delay_ms: Number(e.target.value) })}
                    unit="ms"
                  />
                </div>
                <div>
                  <TooltipLabel label="Trigger Fuse" code="mine.fuse" desc="Countdown beep duration after tripping before detonation." />
                  <UnitNumberInput
                    min={0}
                    step={250}
                    value={body.trigger_delay_ms ?? 2000}
                    onChange={(e) => updateBody({ trigger_delay_ms: Number(e.target.value) })}
                    unit="ms"
                  />
                </div>
                <div>
                  <TooltipLabel label="Blast Power" code="mine.explosion.power" desc="Maximum damage and terrain crater radius." />
                  <UnitNumberInput
                    min={0}
                    max={500}
                    value={body.damage ?? 50}
                    onChange={(e) => updateBody({ damage: Number(e.target.value) })}
                    unit="dmg"
                  />
                </div>
                {numField('mine.explosion.push_pct', 'Mine Knockback', 100, 'Knockback percentage of the mine blast.', { min: 0, max: 400, unit: '%' })}
                {numField('mine.explosion.bias', 'Mine Blast Bias', 0, 'Vertical elevation bias for the mine explosion.')}
                {firingSubtypeField('mine')}
              </div>

              <div className="space-y-2 border-t border-stone-200/80 pt-4 dark:border-stone-800">
                <SubSectionTitle
                  title="Sensor Triggers On"
                  code="mine.detects"
                  desc="Entities that trip the mine's proximity sensor."
                />
                {maskGrid('mine.detects', (project.recordOverrides['mine.detects'] || {}) as CollisionMask)}
              </div>
            </>
          )}

          {project.fireType === 'cursor' && project.teleport && (
            <>
              <SectionHeader
                title="Cursor Teleport Setup"
                code="on_select = { cursor = true }"
                icon={<Navigation className="h-4 w-4 text-forge-500" aria-hidden="true" />}
                desc="Cursor-targeted placement tool without falling strike munitions."
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                {firingSubtypeField('teleport')}
                <div className="rounded-xl bg-stone-50 px-3.5 py-2.5 text-xs text-stone-600 dark:bg-stone-950/40 dark:text-stone-300">
                  Exports <code className="font-mono text-forge-600 dark:text-forge-400">on_select = {'{ cursor = true }'}</code> so clicking a point on the map triggers selection directly instead of launching aircraft bombs.
                </div>
              </div>
            </>
          )}

          {project.fireType === 'arrow' && (
            <>
              <SectionHeader
                title="Bow &amp; Arrow Specs"
                code="arrow"
                icon={<Wrench className="h-4 w-4 text-forge-500" aria-hidden="true" />}
                desc="Direct-hit arrow damage (Longbow family)."
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {numField('arrow.damage', 'Arrow Damage', 0, 'Damage dealt per direct arrow hit.', { min: 0, max: 200, unit: 'dmg' })}
                {firingSubtypeField('arrow')}
              </div>
            </>
          )}

          {project.fireType === 'special' && (
            <>
              <SectionHeader
                title="Special &amp; Utility Tool"
                code="fires.subtype / special"
                icon={<Wrench className="h-4 w-4 text-forge-500" aria-hidden="true" />}
                desc="Selects the native special tool or utility behaviour and its parameters."
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                <div>
                  <TooltipLabel
                    label="Special Behaviour"
                    code="fires.subtype"
                    desc="Selects which native special tool or utility behaviour runs."
                    htmlFor="special-subtype"
                  />
                  <select
                    id="special-subtype"
                    value={String(project.specialSubtype ?? 1)}
                    onChange={(e) => onChange({ specialSubtype: Number(e.target.value) })}
                    className={selectClass}
                  >
                    {SPECIAL_SUBTYPES.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </div>

                {project.specialSubtype === 1 && (
                  <>
                    {numField('fire_punch.damage', 'Punch Damage', 0, 'Hit damage dealt by Fire Punch.', { min: 0, max: 200, unit: 'dmg' })}
                    {numField('fire_punch.knockback', 'Punch Knockback', 0, 'Knockback velocity in px/frame (0.1 steps).', { min: 0, max: 50, step: 0.1, unit: 'px/f' })}
                  </>
                )}

                {project.specialSubtype === 2 && (
                  <>
                    {numField('baseball_bat.damage', 'Bat Damage', 0, 'Hit damage dealt by Baseball Bat.', { min: 0, max: 200, unit: 'dmg' })}
                    {numField('baseball_bat.knockback_scale', 'Bat Knockback Scale', 1, 'Multiplier on the native launch vector (0.1 steps).', { min: 0, max: 10, step: 0.1, unit: 'x' })}
                  </>
                )}

                {project.specialSubtype === 8 &&
                  numField('drill.duration_ms', 'Drill Duration', 0, 'How long the Pneumatic Drill runs in milliseconds.', { min: 0, max: 20000, step: 100, unit: 'ms' })}

                {project.specialSubtype === 12 &&
                  numField('parachute.wind_pct', 'Parachute Wind Sensitivity', 100, 'Wind response percentage (100% is normal, 0% ignores wind).', { min: 0, max: 400, unit: '%' })}

                {project.specialSubtype === 23 &&
                  numField('jet_pack.fuel', 'Jet Pack Fuel', 0, 'Native fuel amount from 0 to 255 (0 = unlimited).', { min: 0, max: 255 })}

                {project.specialSubtype === 19 && (
                  <div>
                    <TooltipLabel
                      label="Utility Effect"
                      code="utility.effect"
                      desc="Team effect toggled when used. Choose Custom Scripted when Lua implements the effect."
                      htmlFor="utility-effect"
                    />
                    <select
                      id="utility-effect"
                      value={String(project.recordOverrides['utility.effect'] ?? 'low_gravity')}
                      onChange={(e) => updateOverride('utility.effect', e.target.value)}
                      className={selectClass}
                    >
                      {UTILITY_EFFECTS.map((effect) => (
                        <option key={effect.value} value={effect.value}>
                          {effect.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* PANEL 8: Lua Script */}
      {normalizedTab === 'callbacks' && (
        <div className="p-4 sm:p-5 space-y-4">
          <SectionHeader
            title="Custom Lua Script"
            code="on_explode, simulation hooks"
            desc="Run custom Lua logic during game events inside wa.weapons.replace{ ... } (e.g. cutting craters or spawning extra missiles)."
            right={
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-stone-100 px-3 py-1.5 dark:border-stone-700 dark:bg-stone-800">
                <input
                  type="checkbox"
                  checked={project.enableCustomLua || false}
                  onChange={(e) => onChange({ enableCustomLua: e.target.checked })}
                  className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
                />
                <span className="text-xs font-bold text-stone-900 dark:text-stone-100">
                  Enable Custom Lua
                </span>
              </label>
            }
          />

          {!project.enableCustomLua ? (
            <div className="space-y-1.5 rounded-xl border border-dashed border-stone-300 bg-stone-50 p-5 text-center dark:border-stone-700 dark:bg-stone-950/30">
              <Code2 className="mx-auto h-6 w-6 text-stone-400" aria-hidden="true" />
              <div className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                Custom Lua Callbacks Disabled
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
                <span>
                  Injected inside <code className="font-mono text-forge-600 dark:text-forge-400">wa.weapons.replace&#123; ... &#125;</code>
                </span>
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
                    className="font-mono text-[11px] font-medium text-forge-600 hover:underline dark:text-forge-400 cursor-pointer"
                  >
                    Template: Moon Grenade
                  </button>
                  <span aria-hidden="true">·</span>
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
                    className="font-mono text-[11px] font-medium text-forge-600 hover:underline dark:text-forge-400 cursor-pointer"
                  >
                    Template: Chilli Bomb
                  </button>
                </div>
              </div>

              <textarea
                rows={12}
                value={project.customLuaSnippet || ''}
                onChange={(e) => onChange({ customLuaSnippet: e.target.value })}
                className="w-full resize-y select-text rounded-xl border border-stone-300 bg-stone-950 p-4 font-mono text-xs leading-relaxed text-forge-400 focus:ring-1 focus:ring-forge-500 dark:border-stone-700"
                placeholder="on_explode = function(ev) ... end,"
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
};
