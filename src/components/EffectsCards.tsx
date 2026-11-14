import { useRef, useState } from 'react';
import type {
  CustomSoundAsset,
  CustomSoundsConfig,
  ExplosionEffectConfig,
  ExplosionPreset,
  RibbonTrailConfig,
  WeaponProject,
} from '../types/weapon';
import { DEFAULT_EXPLOSION_EFFECT, EXPLOSION_PRESETS } from '../data/explosionPresets';
import { DEFAULT_CUSTOM_SOUNDS, INTERVAL_PRESETS, SOUND_PRIORITIES } from '../data/soundPresets';
import { ExplosionPreview } from './ExplosionPreview';
import { NumberInput } from './NumberInput';
import { RibbonTrailPreview } from './RibbonTrailPreview';
import {
  SectionHeader,
  SubSectionTitle,
  TooltipLabel,
  UnitNumberInput,
  buildTooltip,
} from './RecordEditor';
import { AlertTriangle, Sparkles, Volume2, Zap } from 'lucide-react';

const RIBBON_DEFAULT: RibbonTrailConfig = {
  enabled: false,
  max: 12,
  every: 2,
  vanish: 2,
  coreWidth: 8,
  glowWidth: 13,
  color: '#ffffff',
  target: 'main',
};

/** A missile family has rounds for `wa.on.missile_frame` to sample. */
export function supportsRibbonTrail(project: WeaponProject): boolean {
  return project.fireType === 'power' || (project.fireType === 'drop' && !!project.body.fuse);
}

/**
 * WA blasts a thrown/launched missile and a placed mine. A strike's bombs are
 * created from the strike's own record copy, not a weapon slot, so the claim's
 * `on_explode` never runs for them.
 */
export function supportsExplosionEffect(project: WeaponProject): boolean {
  return project.fireType === 'power' || project.fireType === 'drop';
}

/** A missile or mine: WA blasts it, so `on_explode` runs. */
export function supportsExplosionSound(project: WeaponProject): boolean {
  return supportsExplosionEffect(project);
}

/** Only a round WA flies has `wa.on.missile_frame` samples to tick against. */
export function supportsIntervalSound(project: WeaponProject): boolean {
  return project.fireType === 'power' || (project.fireType === 'drop' && !!project.body.fuse);
}

interface CardProps {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
}

const inputClass =
  'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-white';
const selectClass =
  'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-white';

function updateRibbon(
  project: WeaponProject,
  onChange: CardProps['onChange'],
  patch: Partial<RibbonTrailConfig>
) {
  onChange({ ribbonTrail: { ...(project.ribbonTrail ?? RIBBON_DEFAULT), ...patch } });
}

export function RibbonTrailCard({ project, onChange }: CardProps) {
  if (!supportsRibbonTrail(project)) return null;
  const ribbon = project.ribbonTrail ?? RIBBON_DEFAULT;
  const update = (patch: Partial<RibbonTrailConfig>) => updateRibbon(project, onChange, patch);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Ribbon Trail"
        code="wf-lib/effects/trail (effects.sdk)"
        icon={<Zap className="h-4 w-4 text-sky-500" aria-hidden="true" />}
        desc="Samples the flying projectile and draws an additive tapered beam + glow ribbon trail. Automatically adds effects.sdk to mod dependencies."
        right={
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-sky-200 bg-sky-50/80 px-3 py-1.5 dark:border-sky-800/70 dark:bg-sky-950/30">
            <input
              type="checkbox"
              checked={ribbon.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
              className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
            />
            <span className="text-xs font-semibold text-sky-900 dark:text-sky-200">
              Enable Trail
            </span>
          </label>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        {/* Controls Column */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
              Presets:
            </span>
            {[
              {
                name: 'PX Bullet',
                tone: 'border-sky-300/80 bg-sky-50/80 text-sky-800 hover:bg-sky-100 dark:border-sky-700/60 dark:bg-sky-950/30 dark:text-sky-200',
                patch: { max: 12, every: 2, vanish: 2, coreWidth: 8, glowWidth: 13, color: '#ffffff' },
              },
              {
                name: 'Thin Streak',
                tone: 'border-stone-200 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200',
                patch: { max: 8, every: 1, vanish: 2, coreWidth: 3, glowWidth: 6, color: '#ffffff' },
              },
              {
                name: 'Plasma Blue',
                tone: 'border-sky-300/80 bg-sky-50/80 text-sky-800 hover:bg-sky-100 dark:border-sky-700/60 dark:bg-sky-950/30 dark:text-sky-200',
                patch: { max: 14, every: 1, vanish: 2, coreWidth: 6, glowWidth: 15, color: '#4cb5ff' },
              },
              {
                name: 'Solar Amber',
                tone: 'border-amber-300/80 bg-amber-50/80 text-amber-800 hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200',
                patch: { max: 12, every: 1, vanish: 1, coreWidth: 5, glowWidth: 12, color: '#ff9436' },
              },
            ].map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => update(preset.patch)}
                className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${preset.tone}`}
              >
                {preset.name}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
            <div>
              <TooltipLabel
                label="Trail Colour"
                code="r, g, b"
                desc="RGB tint applied multiplicatively to the beam and glow sheets."
                htmlFor="ribbon-color"
              />
              <div className="flex items-center gap-1.5">
                <input
                  id="ribbon-color"
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(ribbon.color) ? ribbon.color : '#ffffff'}
                  onChange={(e) => update({ color: e.target.value })}
                  className="h-8 w-9 shrink-0 cursor-pointer rounded-lg border border-stone-200 bg-white p-0.5 dark:border-stone-700 dark:bg-stone-900"
                />
                <input
                  aria-label="Ribbon colour hex"
                  type="text"
                  value={ribbon.color}
                  onChange={(e) => update({ color: e.target.value })}
                  spellCheck={false}
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <TooltipLabel
                label="Core Width"
                code="core_w"
                desc="Sharp inner beam width in pixels."
                htmlFor="ribbon-core"
              />
              <UnitNumberInput
                id="ribbon-core"
                min={0}
                max={40}
                step={0.5}
                value={ribbon.coreWidth}
                onChange={(e) => update({ coreWidth: Number(e.target.value) })}
                unit="px"
              />
            </div>

            <div>
              <TooltipLabel
                label="Glow Width"
                code="glow_w"
                desc="Outer halo width in pixels using beam_glow.png. Set to 0 for core only."
                htmlFor="ribbon-glow"
              />
              <UnitNumberInput
                id="ribbon-glow"
                min={0}
                max={40}
                step={0.5}
                value={ribbon.glowWidth}
                onChange={(e) => update({ glowWidth: Number(e.target.value) })}
                unit="px"
              />
            </div>

            <div>
              <TooltipLabel
                label="Trail Length"
                code="max"
                desc="Maximum number of sampled points held in the ribbon buffer."
                htmlFor="ribbon-max"
              />
              <UnitNumberInput
                id="ribbon-max"
                min={2}
                max={64}
                value={ribbon.max}
                onChange={(e) => update({ max: Number(e.target.value) })}
                unit="pts"
              />
            </div>

            <div>
              <TooltipLabel
                label="Sample Interval"
                code="every"
                desc="Game frames between position samples (50 Hz; 1 = every frame)."
                htmlFor="ribbon-every"
              />
              <UnitNumberInput
                id="ribbon-every"
                min={1}
                max={10}
                value={ribbon.every}
                onChange={(e) => update({ every: Number(e.target.value) })}
                unit="f"
              />
            </div>

            <div>
              <TooltipLabel
                label="Tail Fade Rate"
                code="vanish"
                desc="Frames between shedding trailing points once flight ends."
                htmlFor="ribbon-vanish"
              />
              <UnitNumberInput
                id="ribbon-vanish"
                min={1}
                max={10}
                value={ribbon.vanish}
                onChange={(e) => update({ vanish: Number(e.target.value) })}
                unit="f"
              />
            </div>
          </div>

          <div>
            <TooltipLabel
              label="Attach To"
              code="wa.on.missile_frame"
              desc="Main Projectile skips cluster bits (which spawn while the parent ribbon is fading). Every Round attaches trails to all cluster bits too."
            />
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-stone-200 bg-stone-100 p-1 dark:border-stone-800 dark:bg-stone-950/60">
              {(
                [
                  { id: 'main', label: 'Main Projectile' },
                  { id: 'all', label: 'Every Round & Cluster Bits' },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => update({ target: option.id })}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    ribbon.target === option.id
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Live Action Canvas Column */}
        <RibbonTrailPreview config={ribbon} />
      </div>
    </div>
  );
}

interface BurstNumFieldProps {
  id: string;
  label: string;
  code: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}

function BurstNumField({
  id,
  label,
  code,
  hint,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: BurstNumFieldProps) {
  return (
    <div>
      <TooltipLabel label={label} code={code} desc={hint} htmlFor={id} />
      <UnitNumberInput
        id={id}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        title={buildTooltip(hint, code)}
        unit={unit}
      />
    </div>
  );
}

export function ExplosionEffectCard({ project, onChange }: CardProps) {
  if (!supportsExplosionEffect(project)) return null;
  const fx: ExplosionEffectConfig = project.explosionEffect ?? DEFAULT_EXPLOSION_EFFECT;
  const update = (patch: Partial<ExplosionEffectConfig>) => {
    onChange({ explosionEffect: { ...fx, ...patch } });
  };
  const customOnExplode =
    !!project.enableCustomLua && /^\s*on_explode\s*=/m.test(project.customLuaSnippet || '');
  const soundMode = typeof fx.sound === 'number' ? 'id' : fx.sound;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Explosion Burst"
        code="wf-lib/effects/px_effects (effects.sdk)"
        icon={<Sparkles className="h-4 w-4 text-amber-500" aria-hidden="true" />}
        desc="Shockwave ring and squashed lens rendered from on_explode using beam, beam_glow, and optional smoke sheets."
        right={
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-1.5 dark:border-amber-800/70 dark:bg-amber-950/30">
            <input
              type="checkbox"
              checked={fx.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
              className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
            />
            <span className="text-xs font-semibold text-amber-900 dark:text-amber-200">
              Enable Burst
            </span>
          </label>
        }
      />

      {customOnExplode && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50/70 p-3 text-[11px] text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            Custom Lua defines <code className="font-mono">on_explode</code> on the Record page.
            The custom snippet wins on export unless disabled.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <div className="space-y-4">
          {/* Blast Integration Mode */}
          <div>
            <TooltipLabel
              label="Blast Mode"
              code="custom_explosion / on_explode"
              desc="Layer Over Game Blast keeps the native WA crater/damage. Replace Game Blast zeros record damage and deals damage, knockback, crater, and sound through custom_explosion."
            />
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-stone-200 bg-stone-100 p-1 dark:border-stone-800 dark:bg-stone-950/60">
              {(
                [
                  { id: 'effect', label: 'Layer Over Game Blast' },
                  { id: 'blast', label: 'Replace Game Blast' },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => update({ mode: option.id })}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    fx.mode === option.id
                      ? option.id === 'blast'
                        ? 'bg-forge-600 text-white shadow-xs'
                        : 'bg-sky-600 text-white shadow-xs'
                      : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
              Presets:
            </span>
            {(Object.keys(EXPLOSION_PRESETS) as ExplosionPreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                title={EXPLOSION_PRESETS[preset].hint}
                onClick={() => update({ ...EXPLOSION_PRESETS[preset].patch, preset })}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  fx.preset === preset
                    ? preset === 'ember'
                      ? 'border-amber-600 bg-amber-600 text-white'
                      : 'border-sky-600 bg-sky-600 text-white'
                    : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'
                }`}
              >
                {EXPLOSION_PRESETS[preset].label}
              </button>
            ))}
          </div>

          {/* Core Burst Geometry & Timing */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <TooltipLabel
                label="Ring Colour"
                code="r, g, b"
                desc="RGB tint for the shockwave ring, lens flare, and optional smoke."
                htmlFor="explosion-color"
              />
              <div className="flex items-center gap-1.5">
                <input
                  id="explosion-color"
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(fx.color) ? fx.color : '#6496dc'}
                  onChange={(e) => update({ color: e.target.value, preset: 'custom' })}
                  className="h-8 w-9 shrink-0 cursor-pointer rounded-lg border border-stone-200 bg-white p-0.5 dark:border-stone-700 dark:bg-stone-900"
                />
                <input
                  aria-label="Explosion colour hex"
                  type="text"
                  value={fx.color}
                  onChange={(e) => update({ color: e.target.value, preset: 'custom' })}
                  spellCheck={false}
                  className={inputClass}
                />
              </div>
            </div>

            <BurstNumField
              id="explosion-radius"
              label="Base Radius"
              code="radius"
              hint="Initial ring radius in game pixels before growth. PX custom blast formula is (damage + 2) × 2."
              value={fx.radius}
              min={1}
              max={400}
              step={1}
              unit="px"
              onChange={(radius) => update({ radius, preset: 'custom' })}
            />
            <BurstNumField
              id="explosion-thickness"
              label="Glow Thickness"
              code="thickness"
              hint="Width of the outer halo glow pass in pixels."
              value={fx.thickness}
              min={0.5}
              max={80}
              step={0.5}
              unit="px"
              onChange={(thickness) => update({ thickness, preset: 'custom' })}
            />
            <BurstNumField
              id="explosion-core"
              label="Core Sharpness"
              code="core"
              hint="Inner bright core line width in pixels (0 derives 0.9× from thickness; 2.5px floor)."
              value={fx.core ?? 0}
              min={0}
              max={80}
              step={0.5}
              unit="px"
              onChange={(core) => update({ core, preset: 'custom' })}
            />
            <BurstNumField
              id="explosion-noise"
              label="Jagged Noise"
              code="noise"
              hint="Vertex jitter intensity around the ring (0 = smooth circle)."
              value={fx.noise}
              min={0}
              max={4}
              step={0.05}
              onChange={(noise) => update({ noise, preset: 'custom' })}
            />
            <BurstNumField
              id="explosion-duration"
              label="Fade Duration"
              code="duration"
              hint="Target fade curve denominator in frames."
              value={fx.duration}
              min={1}
              max={120}
              step={1}
              unit="f"
              onChange={(duration) => update({ duration, preset: 'custom' })}
            />
            <BurstNumField
              id="explosion-fade"
              label="Fade Step"
              code="fade"
              hint="Envelope step consumed each game frame."
              value={fx.fade}
              min={-2}
              max={2}
              step={0.05}
              onChange={(fade) => update({ fade, preset: 'custom' })}
            />
            <BurstNumField
              id="explosion-grow"
              label="Growth Scale"
              code="grow"
              hint="Outward expansion multiplier across the fade duration."
              value={fx.grow}
              min={0}
              max={10}
              step={0.1}
              unit="×"
              onChange={(grow) => update({ grow, preset: 'custom' })}
            />
            <BurstNumField
              id="explosion-live"
              label="Effect Lifetime"
              code="live"
              hint="Total frames the shockwave exists at 50 Hz."
              value={fx.live}
              min={1}
              max={120}
              step={1}
              unit="f"
              onChange={(live) => update({ live, preset: 'custom' })}
            />
            <BurstNumField
              id="explosion-segments"
              label="Polygon Sides"
              code="segments"
              hint="Number of ring polygon edges (0 auto-computes radius × 1.2)."
              value={fx.segments}
              min={0}
              max={255}
              step={1}
              onChange={(segments) => update({ segments, preset: 'custom' })}
            />
            <BurstNumField
              id="explosion-ellipse-x"
              label="Lens Width Scale"
              code="ellipse[1]"
              hint="Horizontal multiplier on the squashed inner lens flare."
              value={fx.ellipseX}
              min={0.1}
              max={4}
              step={0.05}
              unit="×"
              onChange={(ellipseX) => update({ ellipseX, preset: 'custom' })}
            />
            <BurstNumField
              id="explosion-ellipse-y"
              label="Lens Height Scale"
              code="ellipse[2]"
              hint="Vertical multiplier on the inner lens flare (1 / 1 is a circle)."
              value={fx.ellipseY}
              min={0.1}
              max={4}
              step={0.05}
              unit="×"
              onChange={(ellipseY) => update({ ellipseY, preset: 'custom' })}
            />
          </div>

          {/* Flags */}
          <div className="flex flex-wrap gap-4 pt-1">
            <label
              title={buildTooltip('Spawns tinted smoke puffs underneath the shockwave ring.', 'fx.SMOKE')}
              className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300"
            >
              <input
                type="checkbox"
                checked={fx.smoke}
                onChange={(e) => update({ smoke: e.target.checked, preset: 'custom' })}
                className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
              />
              <span>Add Smoke Cloud</span>
            </label>
            <label
              title={buildTooltip('Re-noises and reverses fade envelope at frame 16 (electric mine flash).', 'rebuffer')}
              className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300"
            >
              <input
                type="checkbox"
                checked={fx.rebuffer}
                onChange={(e) => update({ rebuffer: e.target.checked, preset: 'custom' })}
                className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
              />
              <span>Frame-16 Second Pulse</span>
            </label>
          </div>

          {/* Custom Damage / Crater overrides when Replace Game Blast is selected */}
          {fx.mode === 'blast' && (
            <div className="space-y-3 border-t border-stone-200/80 pt-3.5 dark:border-stone-800">
              <SubSectionTitle
                title="Custom Explosion Hit Values"
                code="custom_explosion"
                desc="Applied directly when Replace Game Blast mode is active."
              />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <BurstNumField
                  id="explosion-damage"
                  label="Blast Damage"
                  code="damage"
                  hint="Maximum damage dealt by custom_explosion."
                  value={fx.damage}
                  min={0}
                  max={200}
                  step={1}
                  unit="dmg"
                  onChange={(damage) => update({ damage })}
                />
                <BurstNumField
                  id="explosion-push"
                  label="Knockback"
                  code="push"
                  hint="Push force percentage applied to nearby worms."
                  value={fx.push}
                  min={0}
                  max={400}
                  step={1}
                  unit="%"
                  onChange={(push) => update({ push })}
                />
                <BurstNumField
                  id="explosion-hole"
                  label="Crater Radius"
                  code="hole"
                  hint="Terrain crater cut radius in pixels (0 leaves terrain intact)."
                  value={fx.hole}
                  min={0}
                  max={200}
                  step={1}
                  unit="px"
                  onChange={(hole) => update({ hole })}
                />
                <div className="space-y-1">
                  <TooltipLabel
                    label="Blast Sound"
                    code="sound"
                    desc="Native sound played by custom_explosion unless overridden by a custom WAV."
                    htmlFor="explosion-sound"
                  />
                  <select
                    id="explosion-sound"
                    value={soundMode}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === 'default' || value === 'none') update({ sound: value });
                      else update({ sound: typeof fx.sound === 'number' ? fx.sound : 69 });
                    }}
                    className={selectClass}
                  >
                    <option value="default">PX Random 69–71</option>
                    <option value="none">Silent</option>
                    <option value="id">Sound ID…</option>
                  </select>
                  {soundMode === 'id' && (
                    <NumberInput
                      aria-label="Explosion sound id"
                      min={0}
                      value={typeof fx.sound === 'number' ? fx.sound : 69}
                      onChange={(e) => update({ sound: Number(e.target.value) })}
                      className={inputClass}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Live 50 Hz Preview */}
        <ExplosionPreview config={fx} />
      </div>
    </div>
  );
}

/** WormForge's custom sample bank caps one PCM WAV at 32 MiB. */
const MAX_WAV_BYTES = 32 * 1024 * 1024;

interface SoundUploadProps {
  id: string;
  asset?: CustomSoundAsset;
  disabled?: boolean;
  onPick: (asset: CustomSoundAsset) => void;
  onRemove: () => void;
}

/** One WAV slot: validated PCM WAV upload, filename readout, and audio player. */
export function SoundUpload({ id, asset, disabled, onPick, onRemove }: SoundUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!/\.wav$/i.test(file.name)) {
      setError('Use a .wav file — WormForge loads PCM WAVs only.');
      return;
    }
    if (file.size > MAX_WAV_BYTES) {
      setError(`WAV is ${(file.size / 1024 / 1024).toFixed(1)} MiB; max 32 MiB per file.`);
      return;
    }
    setError(null);
    if (asset?.previewUrl) URL.revokeObjectURL(asset.previewUrl);
    onPick({
      file,
      fileName: file.name,
      size: file.size,
      previewUrl: URL.createObjectURL(file),
    });
  };

  const remove = () => {
    setError(null);
    if (asset?.previewUrl) URL.revokeObjectURL(asset.previewUrl);
    onRemove();
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept=".wav,audio/wav,audio/x-wav"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = '';
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          title="Mono or stereo 8/16-bit PCM WAV exported under sounds/<mod_folder>/."
          className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300/80 bg-sky-50/75 px-2.5 py-1.5 text-[11px] font-semibold text-sky-900 transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-sky-700/60 dark:bg-sky-950/30 dark:text-sky-200 dark:hover:bg-sky-900/40 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Volume2 className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          <span>{asset?.file ? 'Replace WAV' : 'Upload WAV'}</span>
        </button>
        {asset?.file && (
          <>
            <span className="max-w-[200px] truncate font-mono text-[10px] text-stone-500 dark:text-stone-400">
              {asset.fileName}
              {asset.size ? ` · ${(asset.size / 1024).toFixed(0)} KiB` : ''}
            </span>
            <button
              type="button"
              onClick={remove}
              className="text-[11px] font-semibold text-forge-600 hover:underline dark:text-forge-400 cursor-pointer"
            >
              Remove
            </button>
          </>
        )}
      </div>
      {asset?.previewUrl && (
        <audio
          controls
          preload="none"
          src={asset.previewUrl}
          aria-label={`Preview ${asset.fileName || 'uploaded sound'}`}
          className="h-8 w-full max-w-sm"
        />
      )}
      {error && <p className="text-[11px] text-forge-600 dark:text-forge-400">{error}</p>}
    </div>
  );
}

export function CustomSoundsCard({ project, onChange }: CardProps) {
  const sounds: CustomSoundsConfig = project.customSounds ?? DEFAULT_CUSTOM_SOUNDS;
  const update = (patch: Partial<CustomSoundsConfig>) =>
    onChange({ customSounds: { ...sounds, ...patch } });
  const canExplode = supportsExplosionSound(project);
  const canInterval = supportsIntervalSound(project);
  if (!canExplode && !canInterval) return null;
  const customOnExplode =
    !!project.enableCustomLua && /^\s*on_explode\s*=/m.test(project.customLuaSnippet || '');

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Custom WAV Audio"
        code="sounds / wa.sound.play"
        icon={<Volume2 className="h-4 w-4 text-sky-500" aria-hidden="true" />}
        desc="Import custom PCM WAV files declared in the mod's sounds list and played via wa.sound.play without using native WA sample slots."
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* On Detonation */}
        <div className="space-y-3.5 rounded-xl bg-stone-50/70 p-4 dark:bg-stone-950/40">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200/80 pb-2.5 dark:border-stone-800">
            <SubSectionTitle
              title="On Detonation"
              code="on_explode"
              desc="Plays on the firing worm right before blast execution. Silences random PX blast sound when Replace Game Blast is active."
            />
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={sounds.explosionEnabled}
                disabled={!canExplode}
                onChange={(e) => update({ explosionEnabled: e.target.checked })}
                className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
              />
              <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                Enable
              </span>
            </label>
          </div>

          {!canExplode ? (
            <p className="text-xs text-stone-500">
              This weapon type has no detonation hook.
            </p>
          ) : (
            <div className="space-y-3">
              <SoundUpload
                id="sound-explosion"
                asset={sounds.explosion}
                disabled={false}
                onPick={(asset) => update({ explosion: asset, explosionEnabled: true })}
                onRemove={() => update({ explosion: undefined, explosionEnabled: false })}
              />
              <div>
                <TooltipLabel
                  label="Voice Priority"
                  code="priority"
                  desc="Higher priorities interrupt lower-priority sounds if the engine voice pool is full."
                  htmlFor="sound-explosion-priority"
                />
                <select
                  id="sound-explosion-priority"
                  value={sounds.explosionPriority}
                  onChange={(e) => update({ explosionPriority: Number(e.target.value) })}
                  className={selectClass}
                >
                  {SOUND_PRIORITIES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {customOnExplode && (
                <p className="text-[11px] text-sky-700 dark:text-sky-300">
                  Merged automatically into your custom Lua <code className="font-mono">on_explode</code> hook.
                </p>
              )}
            </div>
          )}
        </div>

        {/* In-Flight Interval Sound */}
        <div className="space-y-3.5 rounded-xl bg-stone-50/70 p-4 dark:bg-stone-950/40">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200/80 pb-2.5 dark:border-stone-800">
            <SubSectionTitle
              title="In-Flight Repeat"
              code="wa.on.missile_frame"
              desc="Plays a repeating WAV while airborne on the firing worm's voice emitter. Placed proximity mines have no flight frames."
            />
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={sounds.intervalEnabled}
                disabled={!canInterval}
                onChange={(e) => update({ intervalEnabled: e.target.checked })}
                className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
              />
              <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                Enable
              </span>
            </label>
          </div>

          {!canInterval ? (
            <p className="text-xs text-stone-500">
              Only airborne projectiles fire flight frame callbacks (switch dropped weapons to Timed Dynamite to enable).
            </p>
          ) : (
            <div className="space-y-3">
              <SoundUpload
                id="sound-interval"
                asset={sounds.interval}
                disabled={false}
                onPick={(asset) => update({ interval: asset, intervalEnabled: true })}
                onRemove={() => update({ interval: undefined, intervalEnabled: false })}
              />

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                  Presets:
                </span>
                {INTERVAL_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() =>
                      update({
                        intervalMs: preset.every,
                        intervalDelayMs: preset.delay,
                        intervalLimit: preset.limit,
                      })
                    }
                    className="rounded-md border border-amber-200 bg-amber-50/75 px-2 py-1 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-900/40 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <TooltipLabel
                    label="Repeat Interval"
                    code="every"
                    desc={`${Math.max(1, Math.round(sounds.intervalMs / 20))} game frames at 50 Hz between sound plays.`}
                    htmlFor="sound-interval-ms"
                  />
                  <UnitNumberInput
                    id="sound-interval-ms"
                    min={20}
                    max={5000}
                    step={10}
                    value={sounds.intervalMs}
                    onChange={(e) => update({ intervalMs: Number(e.target.value) })}
                    unit="ms"
                  />
                </div>
                <div>
                  <TooltipLabel
                    label="Initial Delay"
                    code="delay"
                    desc="Milliseconds after launch before the first repeat plays."
                    htmlFor="sound-interval-delay"
                  />
                  <UnitNumberInput
                    id="sound-interval-delay"
                    min={0}
                    max={10000}
                    step={20}
                    value={sounds.intervalDelayMs}
                    onChange={(e) => update({ intervalDelayMs: Number(e.target.value) })}
                    unit="ms"
                  />
                </div>
                <div>
                  <TooltipLabel
                    label="Max Plays"
                    code="limit"
                    desc="Maximum repeat count (0 plays continuously while airborne)."
                    htmlFor="sound-interval-limit"
                  />
                  <NumberInput
                    id="sound-interval-limit"
                    min={0}
                    max={50}
                    value={sounds.intervalLimit}
                    onChange={(e) => update({ intervalLimit: Number(e.target.value) })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <TooltipLabel
                    label="Voice Priority"
                    code="priority"
                    desc="Higher priorities interrupt lower-priority sounds if the engine voice pool is full."
                    htmlFor="sound-interval-priority"
                  />
                  <select
                    id="sound-interval-priority"
                    value={sounds.intervalPriority}
                    onChange={(e) => update({ intervalPriority: Number(e.target.value) })}
                    className={selectClass}
                  >
                    {SOUND_PRIORITIES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
