import React, { useRef } from 'react';
import { WeaponProject, FireType } from '../types/weapon';
import { STOCK_WEAPONS, STOCK_BY_ID } from '../data/stockWeapons';
import { sanitizeWepFileName } from '../utils/luaGenerator';
import { Image as ImageIcon, Trash2, Info, Sparkles } from 'lucide-react';

interface WeaponSettingsProps {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
}

export const WeaponSettings: React.FC<WeaponSettingsProps> = ({ project, onChange }) => {
  const iconInputRef = useRef<HTMLInputElement>(null);

  const handleIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.includes('png') && !file.name.toLowerCase().endsWith('.png')) {
      alert('Icon must be a PNG image file.');
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      onChange({
        customIconFile: file,
        customIconPreview: previewUrl,
        panel_icon: `sprites/${project.id.split('.').pop() || 'weapon'}/icon.png`,
      });
    };
    img.src = previewUrl;
  };

  const removeCustomIcon = () => {
    if (project.customIconPreview) {
      URL.revokeObjectURL(project.customIconPreview);
    }
    onChange({
      customIconFile: undefined,
      customIconPreview: undefined,
      panel_icon: project.slot,
    });
    if (iconInputRef.current) iconInputRef.current.value = '';
  };

  const selectedSlot = STOCK_BY_ID.get(project.slot);
  const selectedDonor = STOCK_BY_ID.get(project.based_on);

  const fireTypes: { id: FireType; label: string; desc: string }[] = [
    { id: 'power', label: 'Power Launch', desc: 'Ballistic rockets, grenades & missiles' },
    { id: 'hitscan', label: 'Hitscan Gun', desc: 'Instant raycast bullet spreads' },
    { id: 'drop', label: 'Drop / Place', desc: 'Proximity mines & timed dynamite' },
    { id: 'cursor', label: 'Cursor Strike', desc: 'Air strikes, plane drops & teleport' },
    { id: 'arrow', label: 'Arrow', desc: 'Piercing pin projectiles' },
    { id: 'spray', label: 'Spray / Flame', desc: 'Continuous stream emission' },
    { id: 'special', label: 'Special / Utility', desc: 'Melee, drills, jet packs & tools' },
  ];

  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 shadow-xs transition-colors">
      <div className="flex items-center justify-between pb-4 mb-5 border-b border-stone-100 dark:border-stone-800">
        <div>
          <h2 className="font-heading text-base font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
            Weapon config & Panel Placement
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
            Define weapon, donor template, and stock replacement slot.
          </p>
        </div>
        <div className="hidden items-center gap-1.5 rounded border border-forge-200/60 bg-forge-50 px-2.5 py-1 font-mono text-[11px] text-forge-700 sm:flex dark:border-forge-800/60 dark:bg-forge-950/40 dark:text-forge-300">
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
          <span>WormForge format</span>
        </div>
      </div>

      {/* Fire Archetype Selector */}
      <div className="mb-6">
        <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 dark:text-stone-400 mb-2">
          Fire Archetype
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {fireTypes.map((ft) => (
            <button
              key={ft.id}
              type="button"
              onClick={() => {
                let defaultDonor = 'bazooka';
                if (ft.id === 'hitscan') defaultDonor = 'uzi';
                else if (ft.id === 'drop') defaultDonor = 'mine';
                else if (ft.id === 'cursor') defaultDonor = 'air_strike';
                else if (ft.id === 'arrow') defaultDonor = 'longbow';
                else if (ft.id === 'spray') defaultDonor = 'flame_thrower';
                else if (ft.id === 'special') defaultDonor = 'fire_punch';

                onChange({
                  fireType: ft.id,
                  slot: defaultDonor,
                  based_on: defaultDonor,
                  panel_icon: project.customIconFile ? project.panel_icon : defaultDonor,
                });
              }}
              className={`text-left p-2.5 rounded-lg border text-xs transition-all ${
                project.fireType === ft.id
                  ? 'border-forge-500 bg-forge-50/60 dark:bg-forge-950/30 text-forge-950 dark:text-forge-100 shadow-xs font-semibold'
                  : 'border-stone-200 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-700 text-stone-700 dark:text-stone-300 bg-stone-50/50 dark:bg-stone-800/40'
              }`}
            >
              <div className="font-heading font-bold text-xs">{ft.label}</div>
              <div className="text-[10px] text-stone-500 dark:text-stone-400 mt-0.5 line-clamp-1">{ft.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Name */}
        <div>
          <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
            Display Name
          </label>
          <input
            type="text"
            value={project.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. Moon Grenade"
            maxLength={40}
            className="w-full px-3 py-2 text-sm bg-stone-50 dark:bg-stone-800/60 border border-stone-300 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-forge-500"
          />
          <p className="text-[11px] text-stone-400 mt-1">Player-facing name shown in panel & game.</p>
        </div>

        {/* Component ID */}
        <div>
          <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
            Component Unique ID
          </label>
          <input
            type="text"
            value={project.id}
            onChange={(e) => onChange({ id: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') })}
            placeholder="guide.moon_grenade"
            maxLength={64}
            className="w-full px-3 py-2 text-sm font-mono bg-stone-50 dark:bg-stone-800/60 border border-stone-300 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-forge-500"
          />
          <p className="text-[11px] text-stone-400 mt-1">Rule 1: A weapon is an ID, never a slot number.</p>
        </div>

        {/* Author */}
        <div>
          <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
            Author / Credits
          </label>
          <input
            type="text"
            value={project.author}
            onChange={(e) => onChange({ author: e.target.value })}
            placeholder="Your name or team"
            maxLength={40}
            className="w-full px-3 py-2 text-sm bg-stone-50 dark:bg-stone-800/60 border border-stone-300 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-forge-500"
          />
        </div>

        {/* Description */}
        <div className="md:col-span-2 lg:col-span-3">
          <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
            Description
          </label>
          <input
            type="text"
            value={project.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="A short sentence for the loader describing behavior..."
            maxLength={160}
            className="w-full px-3 py-2 text-sm bg-stone-50 dark:bg-stone-800/60 border border-stone-300 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-forge-500"
          />
        </div>

        {/* Panel Replacement Slot */}
        <div>
          <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
            Panel Placement Slot
          </label>
          <select
            value={project.slot}
            onChange={(e) => {
              const newSlot = e.target.value;
              onChange({
                slot: newSlot,
                panel_icon: project.customIconFile ? project.panel_icon : newSlot,
              });
            }}
            className="w-full px-3 py-2 text-sm bg-stone-50 dark:bg-stone-800/60 border border-stone-300 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-forge-500"
          >
            {STOCK_WEAPONS.map((w) => (
              <option key={w.id} value={w.id}>
                [{w.row}] {w.name} ({w.id})
              </option>
            ))}
          </select>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-1">
            Default position: {selectedSlot?.row || 'F1'}, Col {selectedSlot?.column || 1}
          </p>
        </div>

        {/* Based On Donor */}
        <div>
          <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
            Based On (`copy_from`)
          </label>
          <select
            value={project.based_on}
            onChange={(e) => onChange({ based_on: e.target.value })}
            disabled={!!project.useWepFile}
            className="w-full px-3 py-2 text-sm bg-stone-50 dark:bg-stone-800/60 border border-stone-300 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {STOCK_WEAPONS.map((w) => (
              <option key={w.id} value={w.id}>
                stock.{w.id} — {w.name}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-1">
            {project.useWepFile
              ? 'Disabled while the .wep supplies the firing record.'
              : `Inherits physics, native handler & sounds from ${selectedDonor?.name || project.based_on}.`}
          </p>
        </div>

        {/* Imported .wep */}
        {project.wepFile && (
          <div className="md:col-span-2 lg:col-span-3">
            <label className="flex items-start gap-3 p-3 rounded-lg border border-forge-300 dark:border-forge-800/60 bg-forge-50/40 dark:bg-forge-950/20 cursor-pointer">
              <input
                type="checkbox"
                checked={!!project.useWepFile}
                onChange={(e) => {
                  const checked = e.target.checked;
                  if (checked && !project.wepBaseline) {
                    // Enabling the file later: treat the current model as the
                    // baseline, so the .wep wins until the user edits a field.
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
                className="mt-0.5 rounded text-forge-600 focus:ring-forge-500"
              />
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-forge-900 dark:text-forge-200">
                  Use .wep weapon file
                </div>
                <p className="text-[11px] leading-relaxed text-forge-800/80 dark:text-forge-300/80">
                  Emits{' '}
                  <code className="font-mono">
                    wep = "weps/{sanitizeWepFileName(project.wepFileName || project.wepFile.name)}"
                  </code>{' '}
                  and copies the file into the bundle. The .wep is the record; fields you change in
                  the Record tab are written as named overrides on top. Uncheck to use the decoded
                  donor instead.
                </p>
              </div>
            </label>
          </div>
        )}

        {/* Panel Icon */}
        <div>
          <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
            Panel Icon Art (32x32)
          </label>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded border border-stone-300 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 flex items-center justify-center overflow-hidden shrink-0">
              {project.customIconPreview ? (
                <img
                  src={project.customIconPreview}
                  alt="Custom icon"
                  className="w-8 h-8 object-contain image-rendering-pixelated"
                />
              ) : (
                <div className="text-[10px] font-mono text-stone-400 text-center uppercase">
                  {project.panel_icon?.slice(0, 4) || 'ico'}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
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
                className="px-3 py-1.5 text-xs font-medium bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 border border-stone-300 dark:border-stone-700 rounded-md transition-colors flex items-center gap-1.5"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>Upload PNG</span>
              </button>

              {project.customIconFile && (
                <button
                  type="button"
                  onClick={removeCustomIcon}
                  className="p-1.5 text-red-500 hover:text-red-700 dark:hover:text-red-400 rounded-md"
                  title="Remove custom icon and use stock"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <p className="text-[11px] text-stone-400 mt-1">
            {project.customIconFile ? 'Custom icon imported (will export to icon.png)' : `Stock icon: ${project.panel_icon}`}
          </p>
        </div>
      </div>

      {/* Defaults Section */}
      <div className="mt-6 pt-5 border-t border-stone-100 dark:border-stone-800">
        <div className="flex items-center gap-2 mb-3">
          <Info className="w-4 h-4 text-forge-600 dark:text-forge-400" />
          <h3 className="font-heading font-bold text-xs uppercase tracking-wider text-stone-700 dark:text-stone-300">
            Weapon Defaults (`defaults = {'{ ... }'}`)
          </h3>
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
          Default round settings written to the component. Profile settings in WormForge lay over these.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-400 mb-1">
              Start Ammo (-1 = ∞)
            </label>
            <input
              type="number"
              value={project.defaults.ammo}
              onChange={(e) =>
                onChange({
                  defaults: { ...project.defaults, ammo: parseInt(e.target.value, 10) || 0 },
                })
              }
              className="w-full px-2.5 py-1.5 text-xs bg-stone-50 dark:bg-stone-800/60 border border-stone-300 dark:border-stone-700 rounded-md text-stone-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-400 mb-1">
              Turn Delay
            </label>
            <input
              type="number"
              min={0}
              value={project.defaults.delay}
              onChange={(e) =>
                onChange({
                  defaults: { ...project.defaults, delay: Math.max(0, parseInt(e.target.value, 10) || 0) },
                })
              }
              className="w-full px-2.5 py-1.5 text-xs bg-stone-50 dark:bg-stone-800/60 border border-stone-300 dark:border-stone-700 rounded-md text-stone-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-400 mb-1">
              Crate Drop Chance (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={project.defaults.crateChance}
              onChange={(e) =>
                onChange({
                  defaults: { ...project.defaults, crateChance: Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0)) },
                })
              }
              className="w-full px-2.5 py-1.5 text-xs bg-stone-50 dark:bg-stone-800/60 border border-stone-300 dark:border-stone-700 rounded-md text-stone-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-400 mb-1">
              Crate Type
            </label>
            <select
              value={project.defaults.crateType}
              onChange={(e) =>
                onChange({
                  defaults: { ...project.defaults, crateType: e.target.value as any },
                })
              }
              className="w-full px-2.5 py-1.5 text-xs bg-stone-50 dark:bg-stone-800/60 border border-stone-300 dark:border-stone-700 rounded-md text-stone-900 dark:text-white"
            >
              <option value="weapon">Weapon</option>
              <option value="utility">Utility</option>
              <option value="super">Super Weapon</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-400 mb-1">
              After Use Action
            </label>
            <select
              value={project.defaults.afterUse}
              onChange={(e) =>
                onChange({
                  defaults: { ...project.defaults, afterUse: e.target.value as any },
                })
              }
              className="w-full px-2.5 py-1.5 text-xs bg-stone-50 dark:bg-stone-800/60 border border-stone-300 dark:border-stone-700 rounded-md text-stone-900 dark:text-white"
            >
              <option value="">Inherit Base</option>
              <option value="end">End Turn</option>
              <option value="retreat">Retreat Timer</option>
              <option value="continue">Continue Turn</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
