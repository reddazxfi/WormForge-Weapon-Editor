import React, { useMemo, useRef, useState } from 'react';
import { WeaponProject, FireType } from '../types/weapon';
import { STOCK_BY_ID, STOCK_WEAPONS, StockWeaponInfo } from '../data/stockWeapons';
import { WFWS_PREFIX, weaponIdSuffix, withWfwsPrefix } from '../utils/weaponId';
import { TooltipLabel, UnitNumberInput, buildTooltip } from './RecordEditor';
import { NumberInput } from './NumberInput';
import {
  Image as ImageIcon,
  Trash2,
  SlidersHorizontal,
  ChevronDown,
  Plane,
  Navigation,
} from 'lucide-react';

interface WeaponSettingsProps {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
}

function sanitizeWepFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

const FIRE_TYPE_OPTIONS: { id: FireType; label: string; defaultDonor: string; desc: string }[] = [
  {
    id: 'power',
    label: 'Projectile (Rocket / Grenade / Animal)',
    defaultDonor: 'bazooka',
    desc: 'Launched or thrown ballistic projectile with physics, actions, and payloads.',
  },
  {
    id: 'hitscan',
    label: 'Firearm (Hitscan Bullet Spread)',
    defaultDonor: 'uzi',
    desc: 'Instant raycast firearm with bullets, spread cones, and multi-pellet bursts.',
  },
  {
    id: 'drop',
    label: 'Dropped (Mine / Timed Dynamite)',
    defaultDonor: 'mine',
    desc: 'Placed at the worm’s feet as a proximity sensor mine or timed explosive.',
  },
  {
    id: 'cursor',
    label: 'Cursor (Air Strike / Teleport)',
    defaultDonor: 'air_strike',
    desc: 'Target a map coordinate for an aircraft bomb run or cursor teleport.',
  },
  {
    id: 'arrow',
    label: 'Bow & Arrow',
    defaultDonor: 'longbow',
    desc: 'Direct-hit pinning arrow projectile.',
  },
  {
    id: 'spray',
    label: 'Flame / Spray Stream',
    defaultDonor: 'flame_thrower',
    desc: 'Continuous short-range stream (shares the 0x3c–0x64 gun slab for inspection).',
  },
  {
    id: 'special',
    label: 'Special / Utility Tool',
    defaultDonor: 'fire_punch',
    desc: 'Melee strikes, drills, traversal tools, and turn utilities.',
  },
];

const FAMILY_GROUPS: { label: string; families: StockWeaponInfo['family'][] }[] = [
  { label: 'Missiles, Bombs & Animals', families: ['missile'] },
  { label: 'Firearms', families: ['gun'] },
  { label: 'Mines', families: ['mine'] },
  { label: 'Air Strikes', families: ['strike'] },
  { label: 'Arrows & Spray', families: ['arrow', 'spray'] },
  { label: 'Specials & Utilities', families: ['special'] },
];

export const WeaponSettings: React.FC<WeaponSettingsProps> = ({ project, onChange }) => {
  const iconInputRef = useRef<HTMLInputElement>(null);
  const [showHandling, setShowHandling] = useState(false);
  // The id box keeps the typed text (spaces and capitals included) while it is
  // being edited, and shows the slugged id again on blur.
  const [idDraft, setIdDraft] = useState<string | null>(null);

  const selectedSlot = STOCK_BY_ID.get(project.slot);
  const selectedDonor = STOCK_BY_ID.get(project.based_on);
  const activeFireOption = FIRE_TYPE_OPTIONS.find((f) => f.id === project.fireType);

  const groupedDonors = useMemo(
    () =>
      FAMILY_GROUPS.map((group) => ({
        label: group.label,
        items: STOCK_WEAPONS.filter((w) => group.families.includes(w.family)),
      })),
    []
  );

  const handleIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onChange({
        customIconFile: file,
        customIconPreview: reader.result as string,
        panel_icon: 'custom',
      });
    };
    reader.readAsDataURL(file);
  };

  const removeCustomIcon = () => {
    onChange({
      customIconFile: undefined,
      customIconPreview: undefined,
      panel_icon: project.slot,
    });
  };

  const fieldInput =
    'w-full px-2.5 py-1.5 text-xs bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-forge-500';
  const selectInput =
    'w-full px-2.5 py-1.5 text-xs bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-50 disabled:cursor-not-allowed';

  const handlingShots = project.recordOverrides['handling.shots'] ?? 1;
  const handlingRetreat = project.recordOverrides['handling.retreat'] ?? 3000;
  const handlingEndsTurn = project.recordOverrides['handling.ends_turn'] ?? true;
  const handlingCaves = project.recordOverrides['handling.available_in_caves'] ?? true;
  const handlingRemember = project.recordOverrides['handling.remember_selection'] ?? true;

  const setOverride = (path: string, value: unknown) => {
    onChange({
      recordOverrides: {
        ...project.recordOverrides,
        [path]: value,
      },
    });
  };

  return (
    <section
      aria-label="Weapon Loadout"
      className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900"
    >
      {/* Top Armory Header Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200/80 bg-stone-50/80 px-4 py-2.5 dark:border-stone-800 dark:bg-stone-950/60">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          <h2 className="font-heading text-xs font-bold uppercase tracking-wider text-stone-900 dark:text-stone-100">
            Weapon Loadout
          </h2>
          <span className="text-stone-300 dark:text-stone-700" aria-hidden="true">
            ·
          </span>
          <span className="text-[11px] text-stone-500 dark:text-stone-400 tabular-nums">
            Slot {selectedSlot?.row || 'F1'} · Col {selectedSlot?.column || 1}
          </span>
          {project.wepFile && (
            <>
              <span className="text-stone-300 dark:text-stone-700" aria-hidden="true">
                ·
              </span>
              <span className="font-mono text-[11px] text-forge-600 dark:text-forge-400 truncate max-w-[200px]">
                {project.wepFileName || project.wepFile.name}
              </span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowHandling((open) => !open)}
          aria-expanded={showHandling}
          title={buildTooltip(
            'Shots per use, retreat timer, cave availability, and turn-ending overrides.',
            'handling'
          )}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            showHandling
              ? 'border-sky-500 bg-sky-600 text-white shadow-xs dark:border-sky-400 dark:bg-sky-500'
              : 'border-sky-300/80 bg-sky-50/75 text-sky-800 hover:border-sky-400 hover:bg-sky-100/80 dark:border-sky-700/60 dark:bg-sky-950/30 dark:text-sky-200 dark:hover:bg-sky-900/40'
          }`}
        >
          <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
          <span>Turn Handling</span>
          <ChevronDown
            className={`h-3 w-3 transition-transform ${showHandling ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>

      <div className="p-4 space-y-3.5">
        {/* Row 1: Armory Icon Slot + Identity */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3.5">
          {/* 32x32 Panel Icon */}
          <div className="flex items-end gap-2.5 shrink-0">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-300 bg-stone-100 dark:border-stone-700 dark:bg-stone-950"
              title={
                project.customIconFile
                  ? 'Custom 32x32 panel icon (exports to icon.png)'
                  : `Stock icon: ${project.panel_icon}`
              }
            >
              {project.customIconPreview ? (
                <img
                  src={project.customIconPreview}
                  alt="Custom weapon icon"
                  className="h-8 w-8 object-contain"
                  style={{ imageRendering: 'pixelated' }}
                />
              ) : (
                <span className="font-mono text-[10px] font-semibold uppercase text-stone-400">
                  {project.panel_icon?.slice(0, 4) || 'ico'}
                </span>
              )}
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-stone-600 dark:text-stone-400">
                Panel Icon
              </div>
              <div className="flex items-center gap-1">
                <input
                  ref={iconInputRef}
                  type="file"
                  accept="image/png,.png"
                  onChange={handleIconUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => iconInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-md border border-sky-300/80 bg-sky-50/75 px-2 py-1 text-[11px] font-semibold text-sky-800 hover:bg-sky-100 dark:border-sky-700/60 dark:bg-sky-950/30 dark:text-sky-200 dark:hover:bg-sky-900/40 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ImageIcon className="h-3 w-3 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                  <span>{project.customIconFile ? 'Replace' : 'Upload PNG'}</span>
                </button>
                {project.customIconFile && (
                  <button
                    type="button"
                    onClick={removeCustomIcon}
                    className="rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-forge-600 dark:hover:bg-stone-800 dark:hover:text-forge-400 cursor-pointer"
                    title="Revert to stock slot icon"
                    aria-label="Revert to stock slot icon"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Identity Fields */}
          <div className="grid flex-1 grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <TooltipLabel
                label="Display Name"
                desc="Weapon name shown in the inventory panel and game HUD."
                htmlFor="ws-display-name"
              />
              <input
                id="ws-display-name"
                type="text"
                value={project.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder="e.g. Moon Grenade"
                maxLength={40}
                className={fieldInput}
              />
            </div>

            <div>
              <TooltipLabel
                label="Unique Weapon ID"
                code="id"
                desc="Unique bundle component ID. The wfws. namespace keeps created weapons distinct from other mods."
                htmlFor="ws-component-id"
              />
              <div className="flex items-stretch overflow-hidden rounded-lg border border-stone-200 bg-white focus-within:border-forge-500 focus-within:ring-2 focus-within:ring-forge-500 dark:border-stone-700 dark:bg-stone-900">
                <span
                  className="flex select-none items-center border-r border-stone-200 bg-stone-50 px-2 font-mono text-xs text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400"
                  aria-hidden="true"
                >
                  {WFWS_PREFIX}
                </span>
                <input
                  id="ws-component-id"
                  type="text"
                  value={idDraft ?? weaponIdSuffix(project.id)}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setIdDraft(raw);
                    // Clearing the box keeps the last id: `wfws.` alone is not an
                    // id, and the old fallback quietly wrote `wfws.weapon`.
                    if (!raw.replace(/[^a-zA-Z0-9_-]/g, '')) return;
                    onChange({ id: withWfwsPrefix(raw) });
                  }}
                  onBlur={() => setIdDraft(null)}
                  placeholder="moon_grenade"
                  maxLength={64 - WFWS_PREFIX.length}
                  className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 font-mono text-xs text-stone-900 focus:outline-hidden dark:text-white"
                />
              </div>
            </div>

            <div>
              <TooltipLabel
                label="Author"
                desc="Creator or team name written into mod.toml."
                htmlFor="ws-author"
              />
              <input
                id="ws-author"
                type="text"
                value={project.author}
                onChange={(e) => onChange({ author: e.target.value })}
                placeholder="Your name"
                maxLength={40}
                className={fieldInput}
              />
            </div>
          </div>
        </div>

        {/* Description (1 clean line) */}
        <div>
          <input
            id="ws-description"
            aria-label="Weapon description"
            type="text"
            value={project.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Short description shown in the mod loader..."
            maxLength={160}
            className={fieldInput}
          />
        </div>

        {/* Row 2: Compact 3-Dropdown Firing Core */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          {/* Fire Archetype Dropdown */}
          <div>
            <TooltipLabel
              label="Weapon Type"
              code="fires.type / method"
              desc={
                activeFireOption?.desc ??
                'Controls which parameter group and weapon mechanics this record uses.'
              }
              htmlFor="ws-fire-type"
            />
            <select
              id="ws-fire-type"
              value={project.fireType}
              onChange={(e) => {
                const nextType = e.target.value as FireType;
                const opt = FIRE_TYPE_OPTIONS.find((f) => f.id === nextType);
                const defaultDonor = opt?.defaultDonor ?? 'bazooka';
                onChange({
                  fireType: nextType,
                  teleport: false,
                  slot: defaultDonor,
                  based_on: defaultDonor,
                  panel_icon: project.customIconFile ? project.panel_icon : defaultDonor,
                });
              }}
              className={selectInput}
            >
              {FIRE_TYPE_OPTIONS.map((ft) => (
                <option key={ft.id} value={ft.id}>
                  {ft.label}
                </option>
              ))}
            </select>
          </div>

          {/* Based On Donor Dropdown */}
          <div>
            <TooltipLabel
              label="Base Template"
              code="copy_from"
              desc={
                project.useWepFile
                  ? 'Disabled while an imported .wep supplies the base record.'
                  : `Inherits physics, native behaviour, and sounds from ${selectedDonor?.name || project.based_on}. Switching keeps your edited fields.`
              }
              htmlFor="ws-based-on"
            />
            <select
              id="ws-based-on"
              value={project.based_on}
              onChange={(e) => onChange({ based_on: e.target.value })}
              disabled={!!project.useWepFile}
              className={selectInput}
            >
              {groupedDonors.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.items.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.id})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Inventory Slot Dropdown */}
          <div>
            <TooltipLabel
              label="Inventory Slot"
              code="slot"
              desc="Stock weapon slot replaced in the game's weapon panel (does not copy physics)."
              htmlFor="ws-slot"
            />
            <select
              id="ws-slot"
              value={project.slot}
              onChange={(e) => {
                const newSlot = e.target.value;
                onChange({
                  slot: newSlot,
                  panel_icon: project.customIconFile ? project.panel_icon : newSlot,
                });
              }}
              className={selectInput}
            >
              {STOCK_WEAPONS.map((w) => (
                <option key={w.id} value={w.id}>
                  [{w.row}] {w.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Cursor sub-mode switcher (Air Strike vs Teleport) */}
        {project.fireType === 'cursor' && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-800 dark:bg-stone-950/60">
            <span className="text-xs font-medium text-stone-600 dark:text-stone-300">
              Cursor Mode
            </span>
            <div className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white p-0.5 dark:border-stone-700 dark:bg-stone-900">
              <button
                type="button"
                onClick={() => onChange({ teleport: false })}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  !project.teleport
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'
                }`}
              >
                <Plane className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Air Strike Plane</span>
              </button>
              <button
                type="button"
                onClick={() => onChange({ teleport: true })}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  project.teleport
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'
                }`}
              >
                <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Cursor Teleport</span>
              </button>
            </div>
          </div>
        )}

        {/* Imported .wep Override Strip */}
        {project.wepFile && (
          <label className="flex items-center gap-2.5 rounded-lg border border-forge-200 bg-forge-50/50 px-3 py-2 cursor-pointer dark:border-forge-900/60 dark:bg-forge-950/20">
            <input
              type="checkbox"
              checked={!!project.useWepFile}
              onChange={(e) => {
                const checked = e.target.checked;
                if (checked && !project.wepBaseline) {
                  onChange({
                    useWepFile: true,
                    wepBaseline: {
                      body: { ...project.body, clustlet: { ...project.body.clustlet } },
                      action: project.action,
                      burst: project.burst,
                      recordOverrides: { ...project.recordOverrides },
                      missileSprite: { ...project.missileSprite },
                      roamConfig: { ...project.roamConfig },
                      digConfig: { ...project.digConfig },
                      fireConfig: { ...project.fireConfig },
                      specialSubtype: project.specialSubtype,
                    },
                  });
                } else {
                  onChange({ useWepFile: checked });
                }
              }}
              className="rounded text-forge-600 focus:ring-forge-500"
            />
            <span className="text-xs text-stone-700 dark:text-stone-300">
              Use imported{' '}
              <code className="font-mono font-semibold text-forge-700 dark:text-forge-300">
                weps/{sanitizeWepFileName(project.wepFileName || project.wepFile.name)}
              </code>{' '}
              as base record (unchanged fields stay in the .wep)
            </span>
          </label>
        )}

        {/* Row 3: Match Rules Bar */}
        <div className="border-t border-stone-200/80 pt-3 dark:border-stone-800">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <TooltipLabel
                label="Start Ammo"
                code="defaults.ammo"
                desc="Starting round ammunition (-1 = infinite)."
              />
              <NumberInput
                value={project.defaults.ammo}
                onChange={(e) =>
                  onChange({
                    defaults: { ...project.defaults, ammo: parseInt(e.target.value, 10) || 0 },
                  })
                }
                className={`${fieldInput} font-mono tabular-nums`}
              />
            </div>

            <div>
              <TooltipLabel
                label="Turn Delay"
                code="defaults.delay"
                desc="Turns elapsed before this weapon unlocks."
              />
              <NumberInput
                min={0}
                value={project.defaults.delay}
                onChange={(e) =>
                  onChange({
                    defaults: {
                      ...project.defaults,
                      delay: Math.max(0, parseInt(e.target.value, 10) || 0),
                    },
                  })
                }
                className={`${fieldInput} font-mono tabular-nums`}
              />
            </div>

            <div>
              <TooltipLabel
                label="Crate Chance"
                code="defaults.crate.chance_pct"
                desc="Chance this weapon appears in a weapon crate (0–100%)."
              />
              <UnitNumberInput
                min={0}
                max={100}
                value={project.defaults.crateChance}
                onChange={(e) =>
                  onChange({
                    defaults: {
                      ...project.defaults,
                      crateChance: Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0)),
                    },
                  })
                }
                unit="%"
              />
            </div>

            <div>
              <TooltipLabel
                label="Crate Pool"
                code="defaults.crate.type"
                desc="Which crate category can drop this weapon."
              />
              <select
                value={project.defaults.crateType}
                onChange={(e) =>
                  onChange({
                    defaults: { ...project.defaults, crateType: e.target.value as any },
                  })
                }
                className={selectInput}
              >
                <option value="weapon">Weapon Crate</option>
                <option value="utility">Utility Crate</option>
                <option value="super">Super Weapon</option>
              </select>
            </div>

            <div>
              <TooltipLabel
                label="After Firing"
                code="defaults.after_use"
                desc="Turn action taken after firing completes."
              />
              <select
                value={project.defaults.afterUse}
                onChange={(e) =>
                  onChange({
                    defaults: { ...project.defaults, afterUse: e.target.value as any },
                  })
                }
                className={selectInput}
              >
                <option value="">Inherit Base</option>
                <option value="end">End Turn</option>
                <option value="retreat">Retreat Timer</option>
                <option value="continue">Continue Turn</option>
              </select>
            </div>
          </div>
        </div>

        {/* Row 4: Collapsible Native Turn Handling Drawer */}
        {showHandling && (
          <div className="border-t border-stone-200/80 pt-3 dark:border-stone-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-stone-600 dark:text-stone-400">
                Native Turn Handling Overrides
              </span>
              <span className="text-[11px] text-stone-400">
                Written into <code className="font-mono">handling</code> when changed
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
              <div>
                <TooltipLabel
                  label="Shots per Turn"
                  code="handling.shots"
                  desc="How many times the weapon fires before ending use (e.g. Shotgun = 2)."
                />
                <NumberInput
                  min={1}
                  max={50}
                  value={handlingShots}
                  onChange={(e) => setOverride('handling.shots', Number(e.target.value))}
                  className={`${fieldInput} font-mono tabular-nums`}
                />
              </div>

              <div>
                <TooltipLabel
                  label="Retreat Time"
                  code="handling.retreat"
                  desc="Retreat countdown in milliseconds after firing."
                />
                <UnitNumberInput
                  min={0}
                  step={500}
                  value={handlingRetreat}
                  onChange={(e) => setOverride('handling.retreat', Number(e.target.value))}
                  unit="ms"
                />
              </div>

              <label
                title={buildTooltip('Whether using the weapon ends weapon use for this turn.', 'handling.ends_turn')}
                className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/70 px-3 py-1.5 text-xs font-medium text-stone-700 cursor-pointer dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-200"
              >
                <input
                  type="checkbox"
                  checked={!!handlingEndsTurn}
                  onChange={(e) => setOverride('handling.ends_turn', e.target.checked)}
                  className="rounded text-forge-600 focus:ring-forge-500"
                />
                <span className="truncate">Ends Turn</span>
              </label>

              <label
                title={buildTooltip('Allow selecting this weapon on cavern maps and cavern crates.', 'handling.available_in_caves')}
                className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/70 px-3 py-1.5 text-xs font-medium text-stone-700 cursor-pointer dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-200"
              >
                <input
                  type="checkbox"
                  checked={!!handlingCaves}
                  onChange={(e) => setOverride('handling.available_in_caves', e.target.checked)}
                  className="rounded text-forge-600 focus:ring-forge-500"
                />
                <span className="truncate">Usable in Caves</span>
              </label>

              <label
                title={buildTooltip('Re-select this weapon automatically on your next turn.', 'handling.remember_selection')}
                className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/70 px-3 py-1.5 text-xs font-medium text-stone-700 cursor-pointer dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-200"
              >
                <input
                  type="checkbox"
                  checked={!!handlingRemember}
                  onChange={(e) => setOverride('handling.remember_selection', e.target.checked)}
                  className="rounded text-forge-600 focus:ring-forge-500"
                />
                <span className="truncate">Keep Selected</span>
              </label>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
