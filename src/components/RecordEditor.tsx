import React, { useEffect } from 'react';
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
  Bomb,
  Sparkles,
  Image as ImageIcon,
  Code2,
  Crosshair,
  Plane,
  Wrench,
  Check,
  Volume2,
  Sliders,
  HelpCircle,
} from 'lucide-react';
import { bitActionOf, type RecordTabId } from '../data/recordTabs';
import { bitBuilderMode } from '../data/spriteBuilder';
import { FIRE_SUBTYPES, fireSubtypeLabel } from '../data/fireSubtypes';
import { PackSpriteUpload } from './PackSpriteUpload';
import { recordField } from '../utils/recordField';

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

/** `fires.subtype` values with a native behaviour the record can configure. */
const SPECIAL_SUBTYPES: { value: number; label: string }[] = [
  { value: 1, label: '1 — Fire Punch' },
  { value: 2, label: '2 — Baseball Bat' },
  { value: 8, label: '8 — Pneumatic Drill' },
  { value: 12, label: '12 — Parachute' },
  { value: 19, label: '19 — Turn Utility' },
  { value: 23, label: '23 — Jet Pack' },
  { value: 0, label: '0 — Other / Inherited' },
];

/** `utility.effect` values, paired with readable labels. */
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

interface RecordEditorProps {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
  activeSubTab: RecordTabId;
}

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

const BURST_BIT_TABS: RecordTabId[] = [
  'burst_bit',
  'burst_bit_collision',
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
    <div className="flex items-center justify-between gap-1 mb-1">
      <label
        htmlFor={htmlFor}
        className="text-xs font-semibold text-stone-700 dark:text-stone-300 truncate cursor-pointer"
        title={tip}
      >
        {label}
      </label>
      {tip && (
        <span
          tabIndex={0}
          role="tooltip"
          className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-help shrink-0 transition-colors"
          title={tip}
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </span>
      )}
    </div>
  );
};

export const UnitNumberInput: React.FC<
  React.InputHTMLAttributes<HTMLInputElement> & { unit?: string }
> = ({ unit, className = '', ...props }) => {
  if (!unit) {
    return (
      <input
        type="number"
        {...props}
        className={`w-full text-xs font-mono px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white disabled:opacity-50 ${className}`}
      />
    );
  }
  return (
    <div className="flex items-stretch w-full rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 overflow-hidden focus-within:ring-2 focus-within:ring-forge-500 focus-within:border-forge-500">
      <input
        type="number"
        {...props}
        className={`flex-1 min-w-0 text-xs font-mono px-3 py-1.5 bg-transparent text-stone-900 dark:text-white focus:outline-hidden disabled:opacity-50 ${className}`}
      />
      <span className="px-2.5 flex items-center text-[11px] font-mono text-stone-500 dark:text-stone-400 bg-stone-50 dark:bg-stone-800/70 border-l border-stone-200 dark:border-stone-700 select-none shrink-0 pointer-events-none">
        {unit}
      </span>
    </div>
  );
};

const SectionHeader: React.FC<{
  title: string;
  desc?: string;
  code?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  right?: React.ReactNode;
}> = ({ title, desc, code, icon, badge, right }) => {
  const tip = buildTooltip(desc, code);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0" title={tip}>
        <h3 className="font-heading text-sm font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-2">
          {icon}
          <span>{title}</span>
        </h3>
        {badge}
        {tip && (
          <span
            tabIndex={0}
            role="tooltip"
            title={tip}
            className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-help shrink-0 transition-colors"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
      {right}
    </div>
  );
};

const SubSectionTitle: React.FC<{
  title: string;
  desc?: string;
  code?: string;
  tone?: string;
  right?: React.ReactNode;
}> = ({ title, desc, code, tone = 'text-stone-900 dark:text-stone-100', right }) => {
  const tip = buildTooltip(desc, code);
  return (
    <div className="flex items-center justify-between gap-2">
      <div className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide ${tone}`} title={tip}>
        <span>{title}</span>
        {tip && (
          <span
            tabIndex={0}
            role="tooltip"
            title={tip}
            className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-help shrink-0 transition-colors font-normal normal-case"
          >
            <HelpCircle className="w-3.5 h-3.5" />
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
  bgClass?: string;
}> = ({ checked, onChange: onToggle, label, code, desc, bgClass = 'bg-stone-50 dark:bg-stone-800/40' }) => {
  const tip = buildTooltip(desc, code);
  return (
    <label
      title={tip}
      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-800 ${bgClass} cursor-pointer hover:border-stone-300 dark:hover:border-stone-700 transition-colors`}
    >
      <span className="flex items-center gap-2.5 min-w-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4 shrink-0"
        />
        <span className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
          {label}
        </span>
      </span>
      {tip && (
        <span
          title={tip}
          className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-help shrink-0 transition-colors"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </span>
      )}
    </label>
  );
};

export const RecordEditor: React.FC<RecordEditorProps> = ({
  project,
  onChange,
  activeSubTab,
}) => {
  const body = project.body;
  const clustlet = body.clustlet;
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

  const updateOverrides = (patch: Record<string, any>) => {
    const updated = { ...project.recordOverrides };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '' || value === null) delete updated[key];
      else updated[key] = value;
    }
    onChange({ recordOverrides: updated });
  };

  const isBurstTab = activeSubTab === 'burst' || BURST_BIT_TABS.includes(activeSubTab);

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

  const toggleMaskTarget = (path: string, key: CollisionTargetKey, current: CollisionMask) => {
    updateOverride(path, toggleMaskValue(current, key));
  };

  const inputClass =
    'w-full text-xs font-mono px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white disabled:opacity-50';
  const selectClass =
    'w-full text-xs px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white disabled:opacity-50';

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
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {COLLISION_TARGETS.map((flag) => {
        const isChecked = isSelected(flag.id);
        const tip = buildTooltip(flag.desc, flag.id);
        return (
          <label
            key={flag.id}
            title={tip}
            className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border cursor-pointer transition-colors ${
              isChecked
                ? 'border-forge-500/50 bg-forge-50/25 dark:bg-forge-950/25 text-stone-900 dark:text-stone-100 font-semibold'
                : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-800/40 text-stone-600 dark:text-stone-400 hover:border-stone-300 dark:hover:border-stone-700'
            }`}
          >
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => onToggle(flag.id)}
              className="rounded text-forge-600 focus:ring-forge-500 shrink-0"
            />
            <span className="text-xs truncate flex-1">{flag.label}</span>
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

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-sm transition-colors dark:border-stone-800 dark:bg-stone-900">
      {/* Tab 1: Flight & Physics */}
      {activeSubTab === 'missile' && (
        <div className="p-5 space-y-5">
          <SectionHeader
            title="Flight & Physics"
            code="missile"
            desc="Core ballistic physics, fuse timers, blast damage, knockback, and launch settings."
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <TooltipLabel
                label="Firing Animation"
                code="fires.subtype"
                desc="Selects the stock worm firing animation and sound (e.g. Minigun firing loop or Shotgun pump). Does not change projectile physics or custom held art."
                htmlFor="fire-subtype"
              />
              <select
                id="fire-subtype"
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
                  value={recordField(project, 'fires.launch_power_pct', 0)}
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
                value={recordField(project, 'missile.explosion.push_pct', 100)}
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
                onChange={(e) => updateBody({ fuse_time_ms: Number(e.target.value), fuse: Number(e.target.value) > 0 })}
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
                value={recordField(project, 'missile.speed_pct', 100)}
                onChange={(e) => updateOverride('missile.speed_pct', Number(e.target.value))}
                title={buildTooltip('Initial projectile speed percentage.', 'missile.speed_pct')}
                unit="%"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
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
      )}

      {/* Tab 2: Missile Action */}
      {activeSubTab === 'action' && (
        <div className="p-5 space-y-5">
          <SectionHeader
            title="Missile Action"
            code="missile.action"
            desc="Controls how the projectile moves during flight. Only one action can be active at a time."
            badge={
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold border border-amber-500/20">
                Choose One
              </span>
            }
          />

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 p-1.5 bg-stone-100 dark:bg-stone-800/80 rounded-xl border border-stone-200 dark:border-stone-700">
            {(
              [
                { id: 'none', label: 'Direct Flight', code: 'none', desc: 'Standard ballistic arc; explodes on impact or fuse (Bazooka style).' },
                { id: 'bounce', label: 'Bounce', code: 'bounce', desc: 'Bounces off terrain and targets (Grenade, Banana Bomb).' },
                { id: 'homing', label: 'Homing', code: 'homing', desc: 'Steers toward or locks onto the target cursor mid-flight.' },
                { id: 'roam', label: 'Roam', code: 'roam', desc: 'Walks, jumps, or flies along terrain (Sheep, Skunk).' },
                { id: 'dig', label: 'Dig', code: 'dig', desc: 'Burrows through solid land instead of stopping at the surface (Mole Bomb).' },
              ] as const
            ).map((act) => {
              const isSelected = (project.action || 'none') === act.id;
              return (
                <button
                  key={act.id}
                  type="button"
                  onClick={() => onChange({ action: act.id })}
                  title={buildTooltip(act.desc, act.code)}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-left transition-all ${
                    isSelected
                      ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs font-bold border border-forge-500/40'
                      : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white hover:bg-stone-200/50 dark:hover:bg-stone-700/50'
                  }`}
                >
                  <span className="text-xs font-bold uppercase tracking-wide">{act.label}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-forge-500 shrink-0" />}
                </button>
              );
            })}
          </div>

          {project.action === 'bounce' && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4 animate-in fade-in">
              <SubSectionTitle title="Bounce Settings" code="missile.bounce" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <TooltipLabel
                      label="Bounciness"
                      code="missile.bounce.bounciness"
                      desc="Extra elasticity above a standard Grenade (0 = Grenade, 60 = Banana Bomb, 80 = Super Banana)."
                    />
                    <span className="font-mono text-forge-600 dark:text-forge-400 font-bold mb-1">{body.bounce_pct}</span>
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
                    <TooltipLabel
                      label="Speed Kept on Bounce"
                      code="missile.bounce.terrain_keep_speed_pct"
                      desc="Percentage of velocity preserved when bouncing off terrain."
                    />
                    <span className="font-mono text-forge-600 dark:text-forge-400 font-bold mb-1">
                      {recordField(project, 'missile.bounce.terrain_keep_speed_pct', 75)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    value={recordField(project, 'missile.bounce.terrain_keep_speed_pct', 75)}
                    onChange={(e) => updateOverride('missile.bounce.terrain_keep_speed_pct', Number(e.target.value))}
                    className="w-full accent-forge-500 cursor-pointer"
                  />
                </div>

                <div>
                  <TooltipLabel
                    label="Max Bounces"
                    code="missile.bounce.max_bounces"
                    desc="Detonate after this many bounces. 0 keeps the normal fuse timer."
                  />
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={recordField(project, 'missile.bounce.max_bounces', 0)}
                    onChange={(e) => updateOverride('missile.bounce.max_bounces', Number(e.target.value))}
                    className={inputClass}
                  />
                </div>

                {numField('missile.bounce.sound', 'Bounce Sound', 0, 'Native sound ID played on bounce (0 = silent).')}
                {numField('missile.bounce.contact_sides', 'Counted Impact Sides', 0, 'Native side mask controlling which hit directions count toward Max Bounces or contact blasts.')}
                {numField('missile.bounce.extra_reverse_chance_pct', 'Extra Rebound Chance', 0, 'Chance for an extra horizontal direction flip before normal collision handling.', { min: 0, max: 100, unit: '%' })}
              </div>

              <CheckboxCard
                checked={(recordField(project, 'missile.bounce.explosion.power', 0)) > 0}
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
                bgClass="bg-white dark:bg-stone-900"
              />

              {(recordField(project, 'missile.bounce.explosion.power', 0)) > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pl-2 border-l-2 border-forge-500/30">
                  {numField('missile.bounce.explosion.power', 'Contact Blast Power', 20, 'Damage and crater radius per bounce.', { min: 0, max: 500 })}
                  {numField('missile.bounce.explosion.push_pct', 'Contact Knockback', 100, 'Knockback percentage per bounce.', { min: 0, max: 400, unit: '%' })}
                  {numField('missile.bounce.explosion.bias', 'Contact Blast Bias', 0, 'Vertical elevation bias for bounce blasts.')}
                  {numField('missile.bounce.explosion.variation', 'Contact Damage Spread', 0, 'Random variation applied to bounce blasts.')}
                </div>
              )}
            </div>
          )}

          {project.action === 'homing' && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4 animate-in fade-in">
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
                    <option value="lock">Lock-On (Direct tracking to target)</option>
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
            </div>
          )}

          {project.action === 'roam' && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4 animate-in fade-in">
              <SubSectionTitle title="Roaming Animal Settings" code="missile.roam" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {roamNum('walk_speed', 'Walk Speed', 'walk_speed', 'Grounded walk speed in pixels/frame (PX 100 = 2.0 px/f).', { min: 0, max: 10, step: 0.02, unit: 'px/f' })}
                {roamNum('step_height', 'Climb Step Height', 'step_height', 'Maximum vertical terrain step climbed while walking (can be negative).', { step: 1, unit: 'px' })}
                {roamNum('terrain_offset', 'Ground Sprite Offset', 'terrain_offset', 'Vertical drawing offset in pixels while walking on terrain.', { step: 1, unit: 'px' })}
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-3">
                <SubSectionTitle title="Edge Jump" code="roam.edge_jump" tone="text-stone-700 dark:text-stone-300" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {roamNum('edge_jump_angle_deg', 'Edge Jump Angle', 'roam.edge_jump.angle_deg', 'Launch angle when leaping off a ledge (negative values can detonate).', { step: 1, unit: 'deg' })}
                  {roamNum('edge_jump_speed', 'Edge Jump Speed', 'roam.edge_jump.speed', 'Nominal edge-jump speed in px/frame (~1/6 variation).', { min: 0, max: 10, step: 0.06, unit: 'px/f' })}
                  {roamNum('edge_jump_sound', 'Edge Jump Sound', 'roam.edge_jump.sound', 'Native sound ID played at ledge jumps (0 = silent).')}
                </div>
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-3">
                <SubSectionTitle title="Hop / Jump" code="roam.jump" tone="text-stone-700 dark:text-stone-300" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {roamNum('jump_angle_deg', 'Jump Angle', 'roam.jump.angle_deg', 'Launch angle for regular hops (negative values can detonate).', { step: 1, unit: 'deg' })}
                  {roamNum('jump_speed', 'Jump Speed', 'roam.jump.speed', 'Nominal jump speed in px/frame (~1/6 variation).', { min: 0, max: 10, step: 0.06, unit: 'px/f' })}
                  {roamNum('jump_sound', 'Jump Sound', 'roam.jump.sound', 'Native sound ID played on hop (0 = silent).')}
                </div>
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-3">
                <SubSectionTitle title="Gas / Fart" code="roam.gas" tone="text-stone-700 dark:text-stone-300" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-3">
                <SubSectionTitle title="Sheep Flight Sprites" code="sheep" tone="text-stone-700 dark:text-stone-300" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-2">
                <SubSectionTitle title="Walking Collision Targets" code="roam.hits" tone="text-stone-700 dark:text-stone-300" />
                {roamMaskGrid('hits', project.roamConfig.hits)}
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-2">
                <SubSectionTitle title="Steered Flight Collision Targets" code="roam.flight_hits" tone="text-stone-700 dark:text-stone-300" />
                {roamMaskGrid('flight_hits', project.roamConfig.flight_hits)}
              </div>
            </div>
          )}

          {project.action === 'dig' && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4 animate-in fade-in">
              <SubSectionTitle title="Digging Settings" code="missile.dig" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <TooltipLabel label="Dig Sound" code="missile.dig.sound" desc="Native sound ID played while burrowing underground." />
                  <input
                    type="number"
                    value={project.digConfig.sound}
                    onChange={(e) =>
                      onChange({ digConfig: { ...project.digConfig, sound: Number(e.target.value) } })
                    }
                    className={inputClass}
                  />
                </div>

                <div>
                  <TooltipLabel label="Dive Sprite" code="missile.dig.dive_sprite" desc="Stock sprite ID shown while diving into terrain." />
                  <input
                    type="number"
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
                      className={inputClass}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {(!project.action || project.action === 'none') && (
            <div className="px-3.5 py-2.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 text-xs text-stone-500">
              Unguided ballistic arc — detonates on impact or fuse expiration.
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Explodes Into (formerly Burst Payload) and its sub-sections */}
      {isBurstTab && (
        <div className="p-5 space-y-5">
          <div id="burst-payload" className="scroll-mt-6 space-y-4">
            <SectionHeader
              title="Explodes Into"
              code="missile.burst"
              desc="What spawns when the main projectile detonates: a single blast, cluster submunitions, or spreading fire."
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-1.5 bg-stone-100 dark:bg-stone-800/80 rounded-xl border border-stone-200 dark:border-stone-700">
              {(
                [
                  { id: 'nothing', label: 'Plain Blast', code: '"nothing"', desc: 'Single explosion with no extra submunitions.' },
                  { id: 'clusters', label: 'Cluster Bits', code: '"clusters"', desc: 'Splits into multiple smaller projectiles on detonation.' },
                  { id: 'fire', label: 'Spreading Fire', code: '"fire"', desc: 'Drops napalm flames that ignite and spread across terrain.' },
                ] as const
              ).map((b) => {
                const isSelected = (project.burst || 'nothing') === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onChange({ burst: b.id })}
                    title={buildTooltip(b.desc, b.code)}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-left transition-all ${
                      isSelected
                        ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs font-bold border border-forge-500/40'
                        : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white hover:bg-stone-200/50 dark:hover:bg-stone-700/50'
                    }`}
                  >
                    <span className="text-xs font-bold uppercase tracking-wide">{b.label}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-forge-500 shrink-0" />}
                  </button>
                );
              })}
            </div>

            {project.burst === 'clusters' && (
              <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4 animate-in fade-in">
                <SubSectionTitle title="Cluster Ejection" code="clusters" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <TooltipLabel label="Cluster Count" code="clusters.count" desc="Number of child projectiles spawned on detonation." />
                    <input
                      type="number"
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
                    <TooltipLabel label="Bit Blast Power" code="clusters.bit.explosion.power" desc="Damage and crater radius of each cluster bit." />
                    <input
                      type="number"
                      min={5}
                      max={150}
                      value={clustlet.damage}
                      onChange={(e) => updateClustlet({ damage: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <TooltipLabel label="Bit Gravity" code="clusters.bit.gravity_pct" desc="Gravity multiplier applied to cluster bits." />
                    <input
                      type="number"
                      min={0}
                      max={200}
                      value={clustlet.gravity_pct}
                      onChange={(e) => updateClustlet({ gravity_pct: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </div>

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

                  <div>
                    <TooltipLabel label="Emission Angle" code="clusters.angle" desc="Native center ejection angle; keep base value unless tuning scatter bias." />
                    <UnitNumberInput
                      value={clustlet.angle}
                      onChange={(e) => updateClustlet({ angle: Number(e.target.value) })}
                      unit="native"
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
                    <TooltipLabel
                      label="Sprite ID Stride"
                      code="clusters.bit.sprite_count"
                      desc="Consecutive stock sprite IDs cycled across bits. Use 1 with an uploaded pack sheet."
                    />
                    <input
                      type="number"
                      min={0}
                      value={clustlet.sprite_count}
                      onChange={(e) => updateClustlet({ sprite_count: Number(e.target.value) })}
                      className={inputClass}
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
              <SubSectionTitle
                title="Cluster Bit Physics & Art"
                code="clusters.bit"
                desc="Each cluster bit acts as a full missile body. Bounce, homing, roam, and dig share native slots so only the chosen action is written."
              />

              <div className="space-y-4">
                <div>
                  <TooltipLabel
                    label="Bit Action"
                    code="clusters.bit.action"
                    desc="Flight behaviour of each spawned cluster bit."
                  />
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
                        {act === 'none' ? 'Impact' : act}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                  {bitNum('speed_pct', 'Bit Speed', 'clusters.bit.speed_pct', 100, 'Initial launch speed percentage.', { min: 0, max: 300, unit: '%' })}
                  {bitNum('wind_pct', 'Bit Wind Sensitivity', 'clusters.bit.wind_pct', 100, 'Wind response percentage.', { min: 0, max: 300, unit: '%' })}
                  {bitNum('gravity_pct', 'Bit Gravity', 'clusters.bit.gravity_pct', 100, 'Gravity multiplier percentage.', { min: 0, max: 300, unit: '%' })}
                  {bitNum('damage', 'Bit Blast Power', 'clusters.bit.explosion.power', 30, 'Child explosion damage and crater radius.', { min: 0, max: 500 })}
                  {bitNum('explosion_bias', 'Bit Blast Bias', 'clusters.bit.explosion.bias', 0, 'Vertical elevation bias of child blasts.')}
                  {bitNum('explosion_push_pct', 'Bit Knockback', 'clusters.bit.explosion.push_pct', 100, 'Knockback percentage of child blasts.', { min: 0, max: 400, unit: '%' })}
                  {bitNum('explosion_variation', 'Bit Damage Spread', 'clusters.bit.explosion.variation', 0, 'Random variation applied to child damage.')}
                  {bitNum('countdown_ms', 'Bit Countdown', 'clusters.bit.countdown', 0, 'Separate native countdown timer.', { min: 0, step: 500, unit: 'ms' })}
                  {bitNum('fuse', 'Bit Fuse Timer', 'clusters.bit.fuse', 5000, 'Milliseconds before detonation (0 = impact).', { min: 0, step: 500, unit: 'ms' })}
                  {bitNum('flight_sound', 'Bit Flight Sound', 'clusters.bit.flight_sound', 0, 'Native sound ID looped in flight.')}
                </div>

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

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {bitNum('trail_power', 'Bit Trail Density', 'clusters.bit.trail.power', 0, 'Particle trail emission density.')}
                  {bitNum('trail_speed', 'Bit Trail Speed', 'clusters.bit.trail.speed', 0, 'Particle ejection rate.')}
                  {bitNum('trail_bubbles', 'Bit Bubbles / sec', 'clusters.bit.trail.bubbles_per_second', 0, 'Underwater bubble emission rate.')}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <CheckboxCard
                    checked={!!clustlet.explode_on_space}
                    onChange={(v) => updateClustlet({ explode_on_space: v })}
                    label="Detonate Bits on Space"
                    code="clusters.bit.explode_on_space"
                    desc="Allows detonating airborne cluster bits by pressing Space."
                    bgClass="bg-white dark:bg-stone-900"
                  />
                  <CheckboxCard
                    checked={!!clustlet.explosion_sound_enabled}
                    onChange={(v) => updateClustlet({ explosion_sound_enabled: v })}
                    label="Pre-Blast Warning Sound"
                    code="clusters.bit.explosion_sound"
                    desc="Plays a native sound shortly before a cluster bit's timed explosion."
                    bgClass="bg-white dark:bg-stone-900"
                  />
                </div>

                {clustlet.explosion_sound_enabled && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-2 border-l-2 border-forge-500/30">
                    {bitNum('explosion_sound', 'Warning Sound ID', 'clusters.bit.explosion_sound.sound', 0, 'Native sound ID played before detonation.')}
                    {bitNum('explosion_sound_before', 'Lead Time', 'clusters.bit.explosion_sound.before', 0, 'Milliseconds before detonation to play the sound.', { min: 0, step: 100, unit: 'ms' })}
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
              <SubSectionTitle
                title="Bit Detonates On Contact"
                code="clusters.bit.ends_on_contact"
                desc="Targets whose contact immediately ends the bit and triggers its blast."
              />
              {bitMaskGrid('ends_on_contact', clustlet.ends_on_contact)}
            </div>
          )}

          {project.burst === 'clusters' && bitAction === 'bounce' && (
            <div
              id="burst-bit-bounce"
              className="scroll-mt-6 p-4 rounded-xl border border-forge-500/30 bg-forge-50/10 dark:bg-forge-950/10 space-y-4"
            >
              <SubSectionTitle
                title="Bit Bounce Settings"
                code="clusters.bit.bounce"
                tone="text-forge-700 dark:text-forge-300"
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {bitNum('bounciness', 'Bit Bounciness', 'clusters.bit.bounce.bounciness', 0, '0 matches standard grenade bounciness.', { min: 0, max: 100 })}
                {bitNum('bounce_terrain_keep_speed_pct', 'Speed Kept on Bounce', 'clusters.bit.bounce.terrain_keep_speed_pct', 75, 'Velocity preserved when bouncing off terrain.', { min: 0, max: 100, unit: '%' })}
                {bitNum('bounce_sound', 'Bounce Sound', 'clusters.bit.bounce.sound', 0, 'Native sound ID played on bounce (0 = silent).')}
                {bitNum('bounce_contact_sides', 'Counted Impact Sides', 'clusters.bit.bounce.contact_sides', 0, 'Native side mask for bounce limit and contact blasts.')}
                {bitNum('bounce_extra_reverse_chance_pct', 'Extra Rebound Chance', 'clusters.bit.bounce.extra_reverse_chance_pct', 0, 'Chance for an extra horizontal direction flip.', { min: 0, max: 100, unit: '%' })}
                {bitNum('bounces', 'Max Bounces', 'clusters.bit.bounce.max_bounces', 0, 'Detonate on Nth bounce (0 keeps normal fuse timing).', { min: 0, max: 20 })}
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
                bgClass="bg-white dark:bg-stone-900"
              />

              {clustlet.bounce_explode && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pl-2 border-l-2 border-forge-500/30">
                  {bitNum('bounce_power', 'Contact Blast Power', 'clusters.bit.bounce.explosion.power', 0, 'Damage and crater radius per bounce.', { min: 0, max: 500 })}
                  {bitNum('bounce_explosion_push_pct', 'Contact Knockback', 'clusters.bit.bounce.explosion.push_pct', 100, 'Knockback percentage per bounce.', { min: 0, max: 400, unit: '%' })}
                  {bitNum('bounce_explosion_bias', 'Contact Blast Bias', 'clusters.bit.bounce.explosion.bias', 0, 'Vertical elevation bias per bounce.')}
                  {bitNum('bounce_explosion_variation', 'Contact Damage Spread', 'clusters.bit.bounce.explosion.variation', 0, 'Random damage variation per bounce.')}
                </div>
              )}

              <div className="space-y-2">
                <SubSectionTitle
                  title="Bit Bounces Off"
                  code="clusters.bit.bounce.hits"
                  tone="text-stone-700 dark:text-stone-300"
                  desc="Extra targets the bit physically bounces off instead of exploding."
                />
                {bitMaskGrid('bounce_hits', clustlet.bounce_hits)}
              </div>
            </div>
          )}

          {project.burst === 'clusters' && bitAction === 'homing' && (
            <div
              id="burst-bit-homing"
              className="scroll-mt-6 p-4 rounded-xl border border-sky-500/30 bg-sky-50/10 dark:bg-sky-950/10 space-y-4"
            >
              <SubSectionTitle
                title="Bit Homing Settings"
                code="clusters.bit.homing"
                tone="text-sky-700 dark:text-sky-300"
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                {bitNum('homing_sprite', 'Homing Sprite ID', 'clusters.bit.homing.sprite', 0, 'Native stock sprite ID shown while homing.')}
                {bitAnimField('homing_animation', 'Homing Animation Mode', 'clusters.bit.homing.animation', 0)}
                {bitNum('homing_arm_ms', 'Arming Delay', 'clusters.bit.homing.arm', 1000, 'Milliseconds before homing steering begins.', { min: 0, step: 250, unit: 'ms' })}
                {bitNum('homing_time_ms', 'Guidance Duration', 'clusters.bit.homing.time', 8000, 'How long homing steering lasts.', { min: 0, step: 500, unit: 'ms' })}
                {bitNum('homing_trail_sprite', 'Homing Trail ID', 'clusters.bit.homing.trail.sprite', 0, 'Native stock trail sprite ID while homing.')}
                {bitNum('homing_trail_power', 'Homing Trail Density', 'clusters.bit.homing.trail.power', 0, 'Particle trail density while homing.')}
                {bitNum('homing_trail_speed', 'Homing Trail Speed', 'clusters.bit.homing.trail.speed', 0, 'Particle ejection speed while homing.')}
                {bitNum('homing_trail_bubbles', 'Homing Bubbles / sec', 'clusters.bit.homing.trail.bubbles_per_second', 0, 'Underwater bubble rate while homing.')}
              </div>
              {isStrike ? (
                <p
                  className="text-[11px] text-stone-400"
                  title="Air strikes apply cluster render timers without the strike offset shift, so strike bits inherit the main munition sheet."
                >
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

          {project.burst === 'clusters' && bitAction === 'roam' && (
            <div
              id="burst-bit-roam"
              className="scroll-mt-6 p-4 rounded-xl border border-amber-500/30 bg-amber-50/10 dark:bg-amber-950/10 space-y-4"
            >
              <SubSectionTitle
                title="Bit Roaming Settings"
                code="clusters.bit.roam"
                tone="text-amber-700 dark:text-amber-300"
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {bitRoamNum('walk_speed', 'Walk Speed', 'clusters.bit.roam.walk_speed', 'Grounded walk speed in pixels/frame (PX 100 = 2.0 px/f).', { min: 0, max: 10, step: 0.02, unit: 'px/f' })}
                {bitRoamNum('step_height', 'Climb Step Height', 'clusters.bit.roam.step_height', 'Maximum vertical terrain step climbed while walking.', { step: 1, unit: 'px' })}
                {bitRoamNum('terrain_offset', 'Ground Sprite Offset', 'clusters.bit.roam.terrain_offset', 'Vertical drawing offset while grounded.', { step: 1, unit: 'px' })}
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-3">
                <SubSectionTitle title="Edge Jump" code="clusters.bit.roam.edge_jump" tone="text-stone-700 dark:text-stone-300" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {bitRoamNum('edge_jump_angle_deg', 'Edge Jump Angle', 'clusters.bit.roam.edge_jump.angle_deg', 'Launch angle when leaping off a ledge.', { step: 1, unit: 'deg' })}
                  {bitRoamNum('edge_jump_speed', 'Edge Jump Speed', 'clusters.bit.roam.edge_jump.speed', 'Nominal edge-jump speed in px/frame.', { min: 0, max: 10, step: 0.06, unit: 'px/f' })}
                  {bitRoamNum('edge_jump_sound', 'Edge Jump Sound', 'clusters.bit.roam.edge_jump.sound', 'Native sound ID played at ledge jumps (0 = silent).')}
                </div>
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-3">
                <SubSectionTitle title="Hop / Jump" code="clusters.bit.roam.jump" tone="text-stone-700 dark:text-stone-300" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {bitRoamNum('jump_angle_deg', 'Jump Angle', 'clusters.bit.roam.jump.angle_deg', 'Launch angle for regular hops.', { step: 1, unit: 'deg' })}
                  {bitRoamNum('jump_speed', 'Jump Speed', 'clusters.bit.roam.jump.speed', 'Nominal jump speed in px/frame.', { min: 0, max: 10, step: 0.06, unit: 'px/f' })}
                  {bitRoamNum('jump_sound', 'Jump Sound', 'clusters.bit.roam.jump.sound', 'Native sound ID played on hop (0 = silent).')}
                </div>
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-3">
                <SubSectionTitle title="Gas / Fart" code="clusters.bit.roam.gas" tone="text-stone-700 dark:text-stone-300" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-2">
                <SubSectionTitle title="Walking Collision Targets" code="clusters.bit.roam.hits" tone="text-stone-700 dark:text-stone-300" />
                {bitRoamMaskGrid('hits')}
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-2">
                <SubSectionTitle title="Steered Flight Collision Targets" code="clusters.bit.roam.flight_hits" tone="text-stone-700 dark:text-stone-300" />
                {bitRoamMaskGrid('flight_hits')}
              </div>
            </div>
          )}

          {project.burst === 'clusters' && bitAction === 'dig' && (
            <div
              id="burst-bit-dig"
              className="scroll-mt-6 p-4 rounded-xl border border-orange-500/30 bg-orange-50/10 dark:bg-orange-950/10 space-y-4"
            >
              <SubSectionTitle
                title="Bit Digging Settings"
                code="clusters.bit.dig"
                tone="text-orange-700 dark:text-orange-300"
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {bitDigNum('sound', 'Dig Sound', 'clusters.bit.dig.sound', 'Native digging sound ID.')}
                {bitDigNum('dive_sprite', 'Dive Sprite', 'clusters.bit.dig.dive_sprite', 'Stock sprite ID shown while diving into terrain.')}
                {bitDigNum('sprite_1', 'Digging Frame 1', 'clusters.bit.dig.sprite_1', 'Native digging sprite frame 1.')}
                {bitDigNum('sprite_2', 'Digging Frame 2', 'clusters.bit.dig.sprite_2', 'Native digging sprite frame 2.')}
                {bitDigNum('sprite_3', 'Digging Frame 3', 'clusters.bit.dig.sprite_3', 'Native digging sprite frame 3.')}
              </div>
            </div>
          )}

          {project.burst === 'fire' && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-4 animate-in fade-in">
              <SubSectionTitle title="Spreading Fire Settings" code="missile.fire" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                  <input
                    type="number"
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
                    <option value="on_hit">On Hit (Drains on contact damage)</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Sprites, Trail & Audio */}
      {activeSubTab === 'sprite' && (
        <div className="p-5 space-y-5 animate-in fade-in">
          <SectionHeader
            title="Sprites, Trail & Audio"
            code="missile.sprite / trail / sounds"
            icon={<Sliders className="w-4 h-4 text-cyan-500" />}
            desc="Built-in stock sprite IDs, particle smoke trails, impact debris, and native sound IDs. Use Hold & Sprite Builder to upload custom PNG missile flight sheets."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-850/40 space-y-3.5">
              <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-700/80 pb-2">
                <SubSectionTitle
                  title="Stock Missile Sprite"
                  code="missile.sprite (Record 0x14)"
                  desc="Selects built-in WA projectile art. Choose Hidden when using custom sheets in Hold & Sprite Builder so the stock sprite does not draw underneath."
                />
                <Bomb className="w-4 h-4 text-rose-500 shrink-0" />
              </div>

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
                    className={selectClass}
                  >
                    {STOCK_MISSILE_SPRITES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <TooltipLabel
                    label="Raw Sprite Name or ID"
                    code="missile.sprite"
                    desc="Optional numeric sprite ID or internal name override. Leave blank to use the dropdown above."
                  />
                  <input
                    type="text"
                    placeholder="e.g. 0, bazooka, or sprite ID"
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

                {animField('missile.animation', 'Flight Animation Mode', 0)}
              </div>
            </div>

            {isStrike && (
              <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-850/40 space-y-3">
                <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-700/80 pb-2">
                  <SubSectionTitle
                    title="Strike Munition Art"
                    code="sprite (body 0x74)"
                    desc="Air strikes fire created munitions without a primary launcher missile, so custom bomb art is supplied here and carried into homing/cluster sprites."
                  />
                  <ImageIcon className="w-4 h-4 text-forge-500 shrink-0" />
                </div>
                <PackSpriteUpload
                  project={project}
                  onChange={onChange}
                  slot="strike_sprite"
                  label="Munition Sheet"
                  code="sprite"
                  hint="Installed on the air strike munition body. Single frame stays static; 32 direction frames match WA's airmisl order."
                  rotate={{
                    onRotate: () => updateOverride('missile.animation', 2),
                  }}
                />
              </div>
            )}

            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-850/40 space-y-3.5">
              <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-700/80 pb-2">
                <SubSectionTitle
                  title="Particle Trail & Debris"
                  code="missile.trail"
                  desc="Stock smoke, sparks, underwater bubbles, and impact particles."
                />
                <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
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
                    className="rounded text-forge-600 focus:ring-forge-500 w-3.5 h-3.5"
                  />
                  <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                    Enable Trail
                  </span>
                </label>
              </div>

              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-[10px] text-stone-400 font-medium mr-1 uppercase">Presets:</span>
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
                  className="px-2 py-1 text-[11px] rounded bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 font-medium transition-colors cursor-pointer"
                >
                  Smoke Trail
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
                  className="px-2 py-1 text-[11px] rounded bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 font-medium transition-colors cursor-pointer"
                >
                  Spark Emitter
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
                  className="px-2 py-1 text-[11px] rounded bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 font-medium transition-colors cursor-pointer"
                >
                  Heavy Smoke
                </button>
                <button
                  type="button"
                  onClick={() => updateOverride('missile.trail.enabled', false)}
                  className="px-2 py-1 text-[11px] rounded bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700 text-rose-500 font-medium transition-colors cursor-pointer"
                >
                  Clear
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <TooltipLabel label="Trail Density" code="missile.trail.power" desc="Emission density of trail particles." />
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={recordField(project, 'missile.trail.power', 25)}
                    onChange={(e) => updateOverride('missile.trail.power', Number(e.target.value))}
                    disabled={!project.recordOverrides['missile.trail.enabled']}
                    className={inputClass}
                  />
                </div>

                <div>
                  <TooltipLabel label="Ejection Speed" code="missile.trail.speed" desc="Initial ejection speed of trail particles." />
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    step={10}
                    value={recordField(project, 'missile.trail.speed', 250)}
                    onChange={(e) => updateOverride('missile.trail.speed', Number(e.target.value))}
                    disabled={!project.recordOverrides['missile.trail.enabled']}
                    className={inputClass}
                  />
                </div>

                <StockSpriteInput
                  id="trail-sprite"
                  label="Trail Particle Sprite"
                  code="missile.trail.sprite"
                  value={recordField(project, 'missile.trail.sprite', 'smklt25')}
                  onChange={(v) => updateOverride('missile.trail.sprite', v)}
                  options={TRAIL_SPRITES}
                  disabled={!project.recordOverrides['missile.trail.enabled']}
                  desc="Stock sprite name or ID; replaced if a custom trail sheet is uploaded. 0 disables the trail."
                />

                <div>
                  <TooltipLabel label="Underwater Bubbles / sec" code="missile.trail.bubbles_per_second" desc="Bubble emission rate when travelling underwater (0 disables bubbles)." />
                  <input
                    type="number"
                    min={0}
                    max={20}
                    step={0.25}
                    value={recordField(project, 'missile.trail.bubbles_per_second', 0)}
                    onChange={(e) => updateOverride('missile.trail.bubbles_per_second', Number(e.target.value))}
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
                bgClass="bg-white dark:bg-stone-900"
              />
            </div>

            <div className="md:col-span-2 p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-850/40 space-y-3.5">
              <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-700/80 pb-2">
                <SubSectionTitle
                  title="Native Sound & Dive Indices"
                  code="flight_sound, launch_sound, bounce.sound, dig.dive_sprite"
                  desc="Built-in WA sound IDs for launch, flight loops, bounces, and terrain dive sprite."
                />
                <Volume2 className="w-4 h-4 text-forge-500 shrink-0" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <TooltipLabel label="In-Flight Loop Sound" code="missile.flight_sound" desc="Continuous sound ID looped during flight (e.g. 95 for rocket hum, 0 = silent)." />
                  <input
                    type="number"
                    min={0}
                    placeholder="e.g. 95 (0 = silent)"
                    value={recordField(project, 'missile.flight_sound', '')}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      updateOverride('missile.flight_sound', val === '' ? undefined : Number(val));
                    }}
                    className={inputClass}
                  />
                </div>

                <div>
                  <TooltipLabel label="Launch Sound" code="missile.launch_sound" desc="Sound ID played once when the projectile fires (0 = none)." />
                  <input
                    type="number"
                    min={0}
                    placeholder="e.g. 42 (0 = none)"
                    value={recordField(project, 'missile.launch_sound', '')}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      updateOverride('missile.launch_sound', val === '' ? undefined : Number(val));
                    }}
                    className={inputClass}
                  />
                </div>

                <div>
                  <TooltipLabel label="Bounce Sound" code="missile.bounce.sound" desc="Sound ID played when bouncing off terrain." />
                  <input
                    type="number"
                    min={0}
                    placeholder="e.g. 110"
                    value={recordField(project, 'missile.bounce.sound', '')}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      updateOverride('missile.bounce.sound', val === '' ? undefined : Number(val));
                    }}
                    className={inputClass}
                  />
                </div>

                <div>
                  <TooltipLabel label="Dive Sprite ID" code="missile.dig.dive_sprite" desc="Stock sprite ID shown while diving or drilling into landscape." />
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
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: Advanced */}
      {activeSubTab === 'advanced' && (
        <div className="p-5 space-y-5">
          <SectionHeader
            title="Advanced Native Fields"
            desc="Less common missile fields carried by .wep records. Unchanged values remain inherited from the base weapon or imported .wep."
          />

          <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-3">
            <SubSectionTitle title="Blast Shaping & Random Motion" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {numField('missile.explosion.bias', 'Blast Bias', 0, 'Vertical elevation bias of the main explosion.')}
              {numField('missile.explosion.variation', 'Damage Randomness', 0, 'Random variation applied to explosion damage.')}
              {numField('missile.random_motion', 'Random Flight Wobble', 0, 'Native random-motion parameter (depends on base weapon).')}
              {numField('missile.collision_shape', 'Collision Outline', 0, 'Numeric physical clearance preset; keep inherited unless tested.')}
            </div>
          </div>

          <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-3">
            <SubSectionTitle title="Pre-Explosion Warning Sound" code="missile.explosion_sound" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              <CheckboxCard
                checked={!!project.recordOverrides['missile.explosion_sound.enabled']}
                onChange={(v) => updateOverride('missile.explosion_sound.enabled', v)}
                label="Play Warning Sound"
                code="missile.explosion_sound.enabled"
                desc="Plays a sound shortly before a timed explosion goes off."
                bgClass="bg-white dark:bg-stone-900"
              />
              {numField('missile.explosion_sound.sound', 'Sound ID', 0, 'Native sound ID (0 = none).')}
              {numField('missile.explosion_sound.before', 'Lead Time', 0, 'Milliseconds before detonation to play the sound.', { step: 50, unit: 'ms' })}
            </div>
          </div>

          {project.action === 'bounce' && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-3">
              <SubSectionTitle title="Bounce Extras" code="missile.bounce" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {numField('missile.bounce.contact_sides', 'Counted Impact Sides', 0, 'Native side mask controlling bounce-limit hits and contact explosions.')}
                {numField('missile.bounce.extra_reverse_chance_pct', 'Extra Rebound Chance', 0, 'Chance for an extra horizontal reversal before normal collision.', { min: 0, max: 100, unit: '%' })}
                {numField('missile.bounce.sound', 'Bounce Sound', 0, 'Native sound ID played on bounce (0 = none).')}
                {numField('missile.bounce.explosion.bias', 'Contact Blast Bias', 0, 'Vertical bias for bounce contact explosions.')}
                {numField('missile.bounce.explosion.push_pct', 'Contact Knockback', 100, 'Knockback percentage for bounce explosions.', { min: 0, max: 400, unit: '%' })}
                {numField('missile.bounce.explosion.power', 'Contact Blast Power', 0, 'Contact-explosion power; 0 disables it.')}
                {numField('missile.bounce.explosion.variation', 'Contact Damage Spread', 0, 'Random variation applied to contact blasts.')}
              </div>
            </div>
          )}

          {project.action === 'homing' && (
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-3">
              <SubSectionTitle title="Homing Art & Trail" code="missile.homing" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <StockSpriteInput
                  id="homing-sprite"
                  label="Homing Sprite"
                  code="missile.homing.sprite"
                  value={recordField(project, 'missile.homing.sprite', '')}
                  onChange={(v) => updateOverride('missile.homing.sprite', v)}
                  desc="Stock sprite shown while homing. When the WFWS builder is active, it draws its own homing sheet instead."
                />
                {animField('missile.homing.animation', 'Homing Animation Mode', 0)}
                <StockSpriteInput
                  id="homing-trail-sprite"
                  label="Homing Trail Sprite"
                  code="missile.homing.trail.sprite"
                  value={recordField(project, 'missile.homing.trail.sprite', '')}
                  onChange={(v) => updateOverride('missile.homing.trail.sprite', v)}
                  options={TRAIL_SPRITES}
                  desc="Stock trail sprite emitted while homing (0 or blank disables it)."
                />
                {numField('missile.homing.trail.power', 'Homing Trail Density', 0, 'Particle density while homing.')}
                {numField('missile.homing.trail.speed', 'Homing Trail Speed', 0, 'Particle ejection speed while homing.')}
                {numField('missile.homing.trail.bubbles_per_second', 'Homing Bubbles / sec', 0, 'Underwater bubble rate while homing (0.25 steps).', { min: 0, max: 20, step: 0.25 })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 6: Collision Targets */}
      {activeSubTab === 'collisions' && (
        <div className="p-5 space-y-6">
          <div className="space-y-2.5">
            <SectionHeader
              title="Detonates On Contact"
              code="missile.ends_on_contact"
              desc="Targets whose contact immediately ends flight and triggers the payload."
            />
            {maskGrid('missile.ends_on_contact', endsOnContactMask)}
          </div>

          <div className="space-y-2.5 pt-4 border-t border-stone-200/60 dark:border-stone-800/60">
            <SectionHeader
              title="Bounces Off"
              code="missile.bounce.hits"
              desc="Extra targets the projectile physically bounces off instead of exploding. Only emitted when Missile Action is Bounce."
              badge={
                project.action !== 'bounce' ? (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    Inactive ({project.action || 'none'})
                  </span>
                ) : undefined
              }
            />
            {maskGrid('missile.bounce.hits', bounceHitsMask)}
          </div>
        </div>
      )}

      {/* Tab 7: Hitscan Gun (when fireType === 'hitscan' or 'spray' for flame inspection) */}
      {activeSubTab === 'gun' && (
        <div className="p-5 space-y-5">
          <SectionHeader
            title={project.fireType === 'spray' ? 'Hitscan Gun (Spray / Flame Inspection)' : 'Hitscan Gun'}
            code="gun"
            icon={<Crosshair className="w-4 h-4 text-forge-500" />}
            desc="Instant-hit raycast firearm settings: damage, shots fired, spread cones, multi-pellet bursts, and impact parameters."
          />

          {project.fireType !== 'hitscan' && project.fireType !== 'spray' ? (
            <div className="px-4 py-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/30 text-xs text-stone-500">
              Hitscan settings are only available when <b>Fire Archetype</b> is set to <b>Hitscan Gun</b> or <b>Spray / Flame</b>.
            </div>
          ) : (
            <div className="space-y-4">
              {project.fireType === 'spray' && (
                <div className="px-3.5 py-2.5 rounded-lg border border-amber-300/70 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-950/20 text-[11px] text-amber-800 dark:text-amber-300">
                  <b>Spray / Flame inspection mode:</b> Native spray records share the raw <code className="font-mono">0x3c–0x64</code> hitscan gun slab, so imported <code className="font-mono">.wep</code> flame values decode into these fields for inspection. Dedicated <code className="font-mono">spray</code> Lua fields are not yet exposed by WormForge, so Lua export omits <code className="font-mono">gun</code> for spray weapons.
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-2">
                <SubSectionTitle
                  title="Bullet Hit Targets"
                  code="gun.hits"
                  tone="text-stone-700 dark:text-stone-300"
                  desc="Entities and terrain that raycast bullets collide with."
                />
                {maskGrid('gun.hits', (project.recordOverrides['gun.hits'] || {}) as CollisionMask)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 8: Air Strike (only when cursor && !teleport) */}
      {activeSubTab === 'strike' && (
        <div className="p-5 space-y-5">
          <SectionHeader
            title="Air Strike"
            code="strike"
            icon={<Plane className="w-4 h-4 text-forge-500" />}
            desc="Aircraft pass and drop pattern settings. Physics, fuse, and explosions of the dropped bombs live in Flight & Physics / Explodes Into."
          />

          {!isStrike ? (
            <div className="px-4 py-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/30 text-xs text-stone-500">
              Air Strike settings are only available when <b>Fire Archetype</b> is set to <b>Cursor Strike</b>.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {numField('strike.count', 'Munitions Dropped', 5, 'Number of bombs or mines released across the flyover.', { min: 0, max: 50 })}
              {numField('strike.plane', 'Plane Sprite ID', 86, 'Stock sprite ID or name of the aircraft (default 86).')}
              {numField('strike.spacing', 'Drop Spacing', 0, 'Distance between consecutive dropped munitions.')}
              {numField('strike.munition_speed', 'Drop Forward Speed', 0, 'Horizontal speed multiplier inherited from the aircraft.', { step: 0.01 })}
              {numField('strike.plane_sound', 'Plane Sound ID', 0, 'Native sound ID played for the flyover aircraft.')}
              <div>
                <TooltipLabel
                  label="Munition Type"
                  code="strike.munition"
                  desc="Whether the aircraft drops proximity Mines or falling Missiles."
                />
                <select
                  value={String(recordField(project, 'strike.munition', 2))}
                  onChange={(e) => updateOverride('strike.munition', Number(e.target.value))}
                  className={selectClass}
                >
                  <option value="0">Mines</option>
                  <option value="2">Missiles</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 9: Mine & Specials (only when drop, arrow, or special) */}
      {activeSubTab === 'gun_mine' && (
        <div className="p-5 space-y-5">
          {project.fireType === 'drop' && (
            <>
              <SectionHeader
                title="Proximity Mine"
                code="mine"
                icon={<Wrench className="w-4 h-4 text-forge-500" />}
                desc="Detection radius, arming timer, trigger fuse, and sensor targets for dropped proximity mines."
              />

              {body.fuse && (
                <div className="px-3 py-2 rounded-lg border border-amber-300/70 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-950/20 text-[11px] text-amber-800 dark:text-amber-300">
                  Fuse Timer is nonzero — this dropped weapon exports as timed Dynamite rather than a Proximity Mine. Set Fuse Timer to 0 in Flight &amp; Physics to use Mine settings.
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <TooltipLabel label="Detection Radius" code="mine.proximity" desc="Trigger radius in pixels around the armed mine." />
                  <input
                    type="number"
                    min={0}
                    max={150}
                    value={body.proximity ?? 25}
                    onChange={(e) => updateBody({ proximity: Number(e.target.value) })}
                    className={inputClass}
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
                {numField('mine.explosion.bias', 'Mine Blast Bias', 0, 'Vertical elevation bias for the mine explosion.')}
                {numField('mine.explosion.push_pct', 'Mine Knockback', 100, 'Knockback percentage of the mine blast.', { min: 0, max: 400, unit: '%' })}
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-2">
                <SubSectionTitle
                  title="Sensor Triggers On"
                  code="mine.detects"
                  tone="text-stone-700 dark:text-stone-300"
                  desc="Entities that trip the mine's proximity sensor."
                />
                {maskGrid('mine.detects', (project.recordOverrides['mine.detects'] || {}) as CollisionMask)}
              </div>
            </>
          )}

          {project.fireType === 'arrow' && (
            <>
              <SectionHeader
                title="Arrow Settings"
                code="arrow"
                icon={<Wrench className="w-4 h-4 text-forge-500" />}
                desc="Direct-hit arrow damage (Longbow family)."
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {numField('arrow.damage', 'Arrow Damage', 0, 'Damage dealt per direct arrow hit.', { min: 0, max: 200 })}
              </div>
            </>
          )}

          {project.fireType === 'special' && (
            <>
              <SectionHeader
                title="Special & Utility Settings"
                code="fires.subtype / special"
                icon={<Wrench className="w-4 h-4 text-forge-500" />}
                desc="Selects the native special tool or utility behaviour and its parameters."
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <TooltipLabel
                    label="Special Behaviour"
                    code="fires.subtype"
                    desc="Selects which native special behaviour this weapon runs (synced with Firing Animation in Flight & Physics)."
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
                    {numField('fire_punch.damage', 'Punch Damage', 0, 'Hit damage dealt by Fire Punch.', { min: 0, max: 200 })}
                    {numField('fire_punch.knockback', 'Punch Knockback', 0, 'Knockback velocity in px/frame (0.1 steps).', { min: 0, max: 50, step: 0.1 })}
                  </>
                )}

                {project.specialSubtype === 2 && (
                  <>
                    {numField('baseball_bat.damage', 'Bat Damage', 0, 'Hit damage dealt by Baseball Bat.', { min: 0, max: 200 })}
                    {numField('baseball_bat.knockback_scale', 'Bat Knockback Scale', 1, 'Multiplier on the native launch vector (0.1 steps).', { min: 0, max: 10, step: 0.1 })}
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
                      value={String(recordField(project, 'utility.effect', 'low_gravity'))}
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

          {project.fireType !== 'drop' && project.fireType !== 'arrow' && project.fireType !== 'special' && (
            <div className="px-4 py-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/30 text-xs text-stone-500">
              Mine, Arrow, and Special settings are not used for this Fire Archetype.
            </div>
          )}
        </div>
      )}

      {/* Tab 10: Custom Lua Callbacks */}
      {activeSubTab === 'callbacks' && (
        <div className="p-5 space-y-4">
          <SectionHeader
            title="Lua Callbacks"
            code="on_explode, simulation hooks"
            desc="Run custom Lua logic during game events inside wa.weapons.replace{ ... } (e.g. cutting craters or spawning extra missiles)."
            right={
              <label className="flex items-center gap-2 cursor-pointer bg-stone-100 dark:bg-stone-800 px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700">
                <input
                  type="checkbox"
                  checked={project.enableCustomLua || false}
                  onChange={(e) => onChange({ enableCustomLua: e.target.checked })}
                  className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4 cursor-pointer"
                />
                <span className="text-xs font-bold text-stone-900 dark:text-stone-100">
                  Enable Custom Lua
                </span>
              </label>
            }
          />

          {!project.enableCustomLua ? (
            <div className="p-5 rounded-xl border border-dashed border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/20 text-center space-y-1.5">
              <Code2 className="w-7 h-7 text-stone-400 mx-auto" />
              <div className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                Custom Lua Callbacks Disabled
              </div>
            </div>
          ) : (
            <div className="space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between text-xs text-stone-500">
                <span>Injected inside <code className="font-mono text-forge-600">wa.weapons.replace&#123; ... &#125;</code>:</span>
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
                    Template: Moon Grenade
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
                    Template: Chilli Bomb
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
    </div>
  );
};
