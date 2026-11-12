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
import { AlertTriangle, HelpCircle, Sparkles, Volume2, Zap } from 'lucide-react';

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

const cardClass =
  'p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-850/40 space-y-4';
const inputClass =
  'w-full text-xs font-mono px-2 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white';
const labelClass = 'text-xs font-semibold text-stone-700 dark:text-stone-300';

function updateRibbon(project: WeaponProject, onChange: CardProps['onChange'], patch: Partial<RibbonTrailConfig>) {
  onChange({ ribbonTrail: { ...(project.ribbonTrail ?? RIBBON_DEFAULT), ...patch } });
}

/** The effects-SDK ribbon trail, moved here from the Indices & Trail tab. */
export function RibbonTrailCard({ project, onChange }: CardProps) {
  if (!supportsRibbonTrail(project)) return null;
  const ribbon = project.ribbonTrail ?? RIBBON_DEFAULT;
  const update = (patch: Partial<RibbonTrailConfig>) => updateRibbon(project, onChange, patch);

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-700/80 pb-2.5">
        <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-2">
          <Zap className="w-4 h-4 text-forge-500" />
          Ribbon Trail (`wf-lib/effects/trail`)
        </span>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={ribbon.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
            className="rounded text-forge-600 focus:ring-forge-500 w-3.5 h-3.5"
          />
          <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">Enable</span>
        </label>
      </div>

      <p className="text-[11px] text-stone-500 dark:text-stone-400">
        Lua samples the round every {ribbon.every} game frame(s) and the engine draws a tapering
        ribbon through those points, so the colour and widths are yours — the stock particle trail
        on Indices &amp; Trail is a record field with a stock sprite. Adds the `effects.sdk` library
        to the bundle.
      </p>

      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-[10px] text-stone-400 font-medium mr-1 uppercase">Presets:</span>
        {[
          {
            name: 'PX bullet',
            patch: { max: 12, every: 2, vanish: 2, coreWidth: 8, glowWidth: 13, color: '#ffffff' },
          },
          {
            name: 'Thin line',
            patch: { max: 8, every: 1, vanish: 2, coreWidth: 3, glowWidth: 6, color: '#ffffff' },
          },
          {
            name: 'Green streak',
            patch: { max: 12, every: 1, vanish: 1, coreWidth: 5, glowWidth: 9, color: '#7cff5a' },
          },
        ].map((preset) => (
          <button
            key={preset.name}
            type="button"
            onClick={() => update(preset.patch)}
            className="px-2 py-1 text-[11px] rounded bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 font-medium transition-colors cursor-pointer"
          >
            {preset.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="space-y-1">
          <label htmlFor="ribbon-color" className={labelClass}>
            Colour (`r`, `g`, `b`)
          </label>
          <div className="flex items-center gap-2">
            <input
              id="ribbon-color"
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(ribbon.color) ? ribbon.color : '#ffffff'}
              onChange={(e) => update({ color: e.target.value })}
              className="h-8 w-10 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 cursor-pointer"
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

        <div className="space-y-1">
          <label htmlFor="ribbon-core" className={labelClass}>
            Core width (`core_w`)
          </label>
          <div className="relative">
            <input
              id="ribbon-core"
              type="number"
              min={0}
              max={40}
              step={0.5}
              value={ribbon.coreWidth}
              onChange={(e) => update({ coreWidth: Number(e.target.value) })}
              className={inputClass}
            />
            <span className="absolute right-2 top-1.5 text-[10px] text-stone-400">px</span>
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="ribbon-glow" className={labelClass}>
            Glow width (`glow_w`)
          </label>
          <div className="relative">
            <input
              id="ribbon-glow"
              type="number"
              min={0}
              max={40}
              step={0.5}
              value={ribbon.glowWidth}
              onChange={(e) => update({ glowWidth: Number(e.target.value) })}
              className={inputClass}
            />
            <span className="absolute right-2 top-1.5 text-[10px] text-stone-400">px</span>
          </div>
          <p className="text-[10px] text-stone-400">0 draws the core only.</p>
        </div>

        <div className="space-y-1">
          <label htmlFor="ribbon-max" className={labelClass}>
            Length (`max`)
          </label>
          <input
            id="ribbon-max"
            type="number"
            min={2}
            max={64}
            value={ribbon.max}
            onChange={(e) => update({ max: Number(e.target.value) })}
            className={inputClass}
          />
          <p className="text-[10px] text-stone-400">Points kept.</p>
        </div>

        <div className="space-y-1">
          <label htmlFor="ribbon-every" className={labelClass}>
            Sample every (`every`)
          </label>
          <input
            id="ribbon-every"
            type="number"
            min={1}
            max={10}
            value={ribbon.every}
            onChange={(e) => update({ every: Number(e.target.value) })}
            className={inputClass}
          />
          <p className="text-[10px] text-stone-400">Game frames per point.</p>
        </div>

        <div className="space-y-1">
          <label htmlFor="ribbon-vanish" className={labelClass}>
            Fade (`vanish`)
          </label>
          <input
            id="ribbon-vanish"
            type="number"
            min={1}
            max={10}
            value={ribbon.vanish}
            onChange={(e) => update({ vanish: Number(e.target.value) })}
            className={inputClass}
          />
          <p className="text-[10px] text-stone-400">Frames between shed points.</p>
        </div>

        <div className="space-y-1 col-span-2">
          <span className={labelClass}>Attach to</span>
          <div className="grid grid-cols-2 gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-lg border border-stone-200 dark:border-stone-700 text-xs">
            {(
              [
                { id: 'main', label: 'Main round' },
                { id: 'all', label: 'Every round + bits' },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => update({ target: option.id })}
                className={`py-1.5 font-medium rounded-md transition-colors ${
                  ribbon.target === option.id
                    ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs font-bold'
                    : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-stone-400">
            Main round skips cluster bits (they are born where the parent's ribbon is still fading).
            Every round trails a full burst.
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <div
          aria-hidden="true"
          className="h-1.5 w-full rounded-full"
          style={{
            background: `linear-gradient(90deg, transparent, ${ribbon.color})`,
            boxShadow: ribbon.glowWidth > 0 ? `0 0 6px ${ribbon.color}88` : undefined,
          }}
        />
        <p className="text-[10px] text-stone-400">
          Ribbon fades toward the tail; widths and colour are emitted as `TRAIL` in the generated
          Lua.
        </p>
      </div>
    </div>
  );
}

interface NumberFieldProps {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

function NumberField({ id, label, hint, value, min, max, step, onChange }: NumberFieldProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        <label htmlFor={id} className={`${labelClass} truncate`} title={hint}>
          {label}
        </label>
        {hint && (
          <span className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-help shrink-0" title={hint}>
            <HelpCircle className="w-3 h-3" />
          </span>
        )}
      </div>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={inputClass}
      />
    </div>
  );
}

/**
 * The effects SDK's `px_effects` burst — the electric mine's explosion. In
 * `effect` mode the claim keeps WA's blast and only draws on top of it; in
 * `blast` mode the record's own blast is zeroed and `custom_explosion` supplies
 * damage, push, crater and sound before drawing the same burst.
 */
export function ExplosionEffectCard({ project, onChange }: CardProps) {
  if (!supportsExplosionEffect(project)) return null;
  const fx: ExplosionEffectConfig = project.explosionEffect ?? DEFAULT_EXPLOSION_EFFECT;
  const update = (patch: Partial<ExplosionEffectConfig>) => {
    onChange({ explosionEffect: { ...fx, ...patch } });
  };
  const customOnExplode =
    !!project.enableCustomLua &&
    /^\s*on_explode\s*=/m.test(project.customLuaSnippet || '');
  const soundMode = typeof fx.sound === 'number' ? 'id' : fx.sound;

  return (
    <div className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 dark:border-stone-700/80 pb-2.5">
        <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-forge-500" />
          Explosion Burst (`wf-lib/effects/px_effects`)
        </span>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={fx.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
            className="rounded text-forge-600 focus:ring-forge-500 w-3.5 h-3.5"
          />
          <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">Enable</span>
        </label>
      </div>

      <p className="text-[11px] text-stone-500 dark:text-stone-400">
        Project X's explosion ring and squashed lens, drawn from a claim `on_explode` hook. Adds
        `effects.sdk` and registers the SDK's beam, glow (and optional cloud) sheets on this weapon.
        A mine is a `drop` record without a fuse; both families use the same hook.
      </p>

      {customOnExplode && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-300 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/30 text-[11px] text-amber-900 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>
            A custom Lua <code className="font-mono">on_explode</code> is enabled on the Lua
            Callbacks tab. Two `on_explode` keys would not compile, so the custom hook wins and this
            burst is not emitted. Disable one of the two.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="space-y-1">
            <span className={labelClass}>Blast</span>
            <div className="grid grid-cols-2 gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-lg border border-stone-200 dark:border-stone-700 text-xs">
              {(
                [
                  { id: 'effect', label: 'Add to WA blast' },
                  { id: 'blast', label: 'Replace WA blast' },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => update({ mode: option.id })}
                  className={`py-1.5 font-medium rounded-md transition-colors ${
                    fx.mode === option.id
                      ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs font-bold'
                      : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-stone-400">
              {fx.mode === 'blast'
                ? 'The record blast is silenced (power 0) and the SDK supplies the damage, push, crater and sound.'
                : 'WA still blasts normally; the burst is drawn on top at the same point.'}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[10px] text-stone-400 font-medium mr-1 uppercase">Presets:</span>
            {(Object.keys(EXPLOSION_PRESETS) as ExplosionPreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                title={EXPLOSION_PRESETS[preset].hint}
                onClick={() => update({ ...EXPLOSION_PRESETS[preset].patch, preset })}
                className={`px-2 py-1 text-[11px] rounded border font-medium transition-colors ${
                  fx.preset === preset
                    ? 'bg-forge-600 text-white border-forge-600'
                    : 'bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300'
                }`}
              >
                {EXPLOSION_PRESETS[preset].label}
              </button>
            ))}
            <span className="text-[10px] text-stone-400">
              {fx.preset === 'custom'
                ? 'Custom numbers'
                : EXPLOSION_PRESETS[fx.preset as ExplosionPreset]?.hint}
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label htmlFor="explosion-color" className={labelClass}>
                Colour (`r`, `g`, `b`)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="explosion-color"
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(fx.color) ? fx.color : '#6496dc'}
                  onChange={(e) => update({ color: e.target.value, preset: 'custom' })}
                  className="h-8 w-10 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 cursor-pointer"
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
            <NumberField
              id="explosion-radius"
              label="Radius (`radius`)"
              hint="Game pixels before growth."
              value={fx.radius}
              min={1}
              max={200}
              step={1}
              onChange={(radius) => update({ radius, preset: 'custom' })}
            />
            <NumberField
              id="explosion-thickness"
              label="Thickness (`thickness`)"
              hint="Beam width of the ring."
              value={fx.thickness}
              min={0.5}
              max={80}
              step={0.5}
              onChange={(thickness) => update({ thickness, preset: 'custom' })}
            />
            <NumberField
              id="explosion-noise"
              label="Noise (`noise`)"
              hint="0 is a clean circle."
              value={fx.noise}
              min={0}
              max={4}
              step={0.05}
              onChange={(noise) => update({ noise, preset: 'custom' })}
            />
            <NumberField
              id="explosion-duration"
              label="Duration (`duration`)"
              hint="Frames to fade out."
              value={fx.duration}
              min={1}
              max={120}
              step={1}
              onChange={(duration) => update({ duration, preset: 'custom' })}
            />
            <NumberField
              id="explosion-fade"
              label="Fade step (`fade`)"
              hint="Envelope lost per frame."
              value={fx.fade}
              min={-2}
              max={2}
              step={0.05}
              onChange={(fade) => update({ fade, preset: 'custom' })}
            />
            <NumberField
              id="explosion-grow"
              label="Grow (`grow`)"
              hint="Radius gain over the fade."
              value={fx.grow}
              min={0}
              max={10}
              step={0.1}
              onChange={(grow) => update({ grow, preset: 'custom' })}
            />
            <NumberField
              id="explosion-live"
              label="Live (`live`)"
              hint="Frames the effect exists."
              value={fx.live}
              min={1}
              max={120}
              step={1}
              onChange={(live) => update({ live, preset: 'custom' })}
            />
            <NumberField
              id="explosion-segments"
              label="Segments (`segments`)"
              hint="0 = radius × 1.2."
              value={fx.segments}
              min={0}
              max={255}
              step={1}
              onChange={(segments) => update({ segments, preset: 'custom' })}
            />
            <NumberField
              id="explosion-ellipse-x"
              label="Ellipse X (`ellipse[1]`)"
              hint="Lens width multiplier."
              value={fx.ellipseX}
              min={0.1}
              max={4}
              step={0.05}
              onChange={(ellipseX) => update({ ellipseX, preset: 'custom' })}
            />
            <NumberField
              id="explosion-ellipse-y"
              label="Ellipse Y (`ellipse[2]`)"
              hint="1 / 1 keeps it a circle."
              value={fx.ellipseY}
              min={0.1}
              max={4}
              step={0.05}
              onChange={(ellipseY) => update({ ellipseY, preset: 'custom' })}
            />
          </div>

          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-stone-700 dark:text-stone-300">
              <input
                type="checkbox"
                checked={fx.smoke}
                onChange={(e) => update({ smoke: e.target.checked, preset: 'custom' })}
                className="rounded text-forge-600 focus:ring-forge-500 w-3.5 h-3.5"
              />
              Smoke puff (`fx.SMOKE`)
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-stone-700 dark:text-stone-300">
              <input
                type="checkbox"
                checked={fx.rebuffer}
                onChange={(e) => update({ rebuffer: e.target.checked, preset: 'custom' })}
                className="rounded text-forge-600 focus:ring-forge-500 w-3.5 h-3.5"
              />
              Re-buffer at frame 16
            </label>
          </div>

          {fx.mode === 'blast' && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
              <NumberField
                id="explosion-damage"
                label="Damage (`damage`)"
                hint="Blast damage."
                value={fx.damage}
                min={0}
                max={200}
                step={1}
                onChange={(damage) => update({ damage })}
              />
              <NumberField
                id="explosion-push"
                label="Push (`push`)"
                hint="Knockback percent."
                value={fx.push}
                min={0}
                max={400}
                step={1}
                onChange={(push) => update({ push })}
              />
              <NumberField
                id="explosion-hole"
                label="Crater (`hole`)"
                hint="0 leaves the terrain."
                value={fx.hole}
                min={0}
                max={200}
                step={1}
                onChange={(hole) => update({ hole })}
              />
              <div className="space-y-1">
                <label htmlFor="explosion-sound" className={labelClass}>
                  Sound (`sound`)
                </label>
                <select
                  id="explosion-sound"
                  value={soundMode}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === 'default' || value === 'none') update({ sound: value });
                    else update({ sound: typeof fx.sound === 'number' ? fx.sound : 69 });
                  }}
                  className={inputClass}
                >
                  <option value="default">PX random 69–71</option>
                  <option value="none">Silent</option>
                  <option value="id">Sound id…</option>
                </select>
                {soundMode === 'id' && (
                  <input
                    aria-label="Explosion sound id"
                    type="number"
                    min={0}
                    value={typeof fx.sound === 'number' ? fx.sound : 69}
                    onChange={(e) => update({ sound: Number(e.target.value) })}
                    className={inputClass}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <ExplosionPreview config={fx} />
          <p className="text-[10px] text-stone-400">
            The ring grows by `grow`, fades over `duration` and (when re-buffered) re-noises and
            recolours at frame 16. The squashed lens uses the `ellipse` pair, exactly as PX's
            electric explosion does.
          </p>
        </div>
      </div>
    </div>
  );
}

/** WormForge's custom sample bank takes up to 32 MiB per WAV. */
const MAX_WAV_BYTES = 32 * 1024 * 1024;

interface SoundUploadProps {
  id: string;
  asset?: CustomSoundAsset;
  disabled?: boolean;
  onPick: (asset: CustomSoundAsset) => void;
  onRemove: () => void;
}

/** One WAV slot: a validated upload, its name/size and an `<audio>` preview. */
export function SoundUpload({ id, asset, disabled, onPick, onRemove }: SoundUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!/\.wav$/i.test(file.name)) {
      setError('Use a .wav file — WormForge loads PCM WAVs only (convert MP3 first).');
      return;
    }
    if (file.size > MAX_WAV_BYTES) {
      setError(`That WAV is ${(file.size / 1024 / 1024).toFixed(1)} MiB; the engine caps one file at 32 MiB.`);
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
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Volume2 className="w-3.5 h-3.5" />
          {asset?.file ? 'Replace WAV' : 'Upload WAV'}
        </button>
        {asset?.file && (
          <>
            <span className="font-mono text-[10px] text-stone-500 dark:text-stone-400 truncate max-w-[220px]">
              {asset.fileName}
              {asset.size ? ` · ${(asset.size / 1024).toFixed(0)} KiB` : ''}
            </span>
            <button
              type="button"
              onClick={remove}
              className="text-[10px] font-semibold text-rose-600 dark:text-rose-400 hover:underline"
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
      {error && <p className="text-[10px] text-rose-600 dark:text-rose-400">{error}</p>}
      {!asset?.file && !error && (
        <p className="text-[10px] text-stone-400">
          Mono/stereo 8/16-bit PCM WAV. Written to `sounds/&lt;mod folder&gt;/` in the ZIP.
        </p>
      )}
    </div>
  );
}

/**
 * Pack WAVs played with `wa.sound.play`. WA's record sound fields are native
 * sample ids, so the only way to use an imported WAV is to declare it in the
 * claim's `sounds` list and play it by path.
 *
 * - On explosion: `on_explode` (the same hook as the burst), on the firing worm.
 * - Interval: ticked from `wa.on.missile_frame`. Lua has no handle to a flying
 *   missile's emitter, so the firing worm (whose turn it is) plays it; the voice
 *   is therefore positioned at the worm, not the round.
 */
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
    <div className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 dark:border-stone-700/80 pb-2.5">
        <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-forge-500" />
          Custom Sounds (`sounds`, `wa.sound.play`)
        </span>
        <span className="font-mono text-[10px] text-stone-400">WAV · custom bank</span>
      </div>

      <p className="text-[11px] text-stone-500 dark:text-stone-400">
        The record&apos;s sound fields are WA&apos;s own sample ids, so an imported WAV cannot go
        there. The exporter writes it under `sounds/&lt;mod folder&gt;/` and the claim declares it in
        `sounds`; Lua plays it by path, without using one of WA&apos;s 49 spare sample slots.
        Identical files share one voice and higher priorities cut lower ones.
      </p>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="p-4 rounded-lg border border-stone-200 dark:border-stone-700 bg-white/60 dark:bg-stone-900/40 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-stone-800 dark:text-stone-200">
              On explosion (`on_explode`)
            </span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={sounds.explosionEnabled}
                disabled={!canExplode}
                onChange={(e) => update({ explosionEnabled: e.target.checked })}
                className="rounded text-forge-600 focus:ring-forge-500 w-3.5 h-3.5"
              />
              <span className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">
                Enable
              </span>
            </label>
          </div>

          {!canExplode ? (
            <p className="text-[11px] text-stone-400">
              This family has no native blast, so `on_explode` never runs.
            </p>
          ) : (
            <>
              <SoundUpload
                id="sound-explosion"
                asset={sounds.explosion}
                disabled={false}
                onPick={(asset) => update({ explosion: asset, explosionEnabled: true })}
                onRemove={() => update({ explosion: undefined, explosionEnabled: false })}
              />
              <div className="space-y-1">
                <label htmlFor="sound-explosion-priority" className={labelClass}>
                  Priority
                </label>
                <select
                  id="sound-explosion-priority"
                  value={sounds.explosionPriority}
                  onChange={(e) => update({ explosionPriority: Number(e.target.value) })}
                  className={inputClass}
                >
                  {SOUND_PRIORITIES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-stone-400">
                  Played on the firing worm (`ev.worm`), before WA&apos;s own blast. In{' '}
                  <strong>Replace WA blast</strong> mode above it also silences the SDK&apos;s random
                  blast sound.
                </p>
              </div>

              {customOnExplode && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-100/60 dark:bg-stone-800/40 text-[11px] text-stone-700 dark:text-stone-300">
                  <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-forge-500" />
                  <p>
                    Your custom Lua `on_explode` hook is automatically merged with this explosion sound
                    and any visual burst into a single unified callback.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 rounded-lg border border-stone-200 dark:border-stone-700 bg-white/60 dark:bg-stone-900/40 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-stone-800 dark:text-stone-200">
              On an interval (`wa.on.missile_frame`)
            </span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={sounds.intervalEnabled}
                disabled={!canInterval}
                onChange={(e) => update({ intervalEnabled: e.target.checked })}
                className="rounded text-forge-600 focus:ring-forge-500 w-3.5 h-3.5"
              />
              <span className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">
                Enable
              </span>
            </label>
          </div>

          {!canInterval ? (
            <p className="text-[11px] text-stone-400">
              Only a fired or thrown round (a missile family) gives `wa.on.missile_frame` samples. A
              placed mine has no flight frames.
            </p>
          ) : (
            <>
              <SoundUpload
                id="sound-interval"
                asset={sounds.interval}
                disabled={false}
                onPick={(asset) => update({ interval: asset, intervalEnabled: true })}
                onRemove={() => update({ interval: undefined, intervalEnabled: false })}
              />
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-[10px] text-stone-400 font-medium mr-1 uppercase">Presets:</span>
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
                    className="px-2 py-1 text-[11px] rounded bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 font-medium"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  id="sound-interval-ms"
                  label="Every (ms)"
                  hint={`${Math.max(1, Math.round(sounds.intervalMs / 20))} game frames at 50 Hz.`}
                  value={sounds.intervalMs}
                  min={20}
                  max={5000}
                  step={10}
                  onChange={(intervalMs) => update({ intervalMs })}
                />
                <NumberField
                  id="sound-interval-delay"
                  label="Delay (ms)"
                  hint="Before the first play."
                  value={sounds.intervalDelayMs}
                  min={0}
                  max={10000}
                  step={20}
                  onChange={(intervalDelayMs) => update({ intervalDelayMs })}
                />
                <NumberField
                  id="sound-interval-limit"
                  label="Plays"
                  hint="0 keeps it going for the whole flight."
                  value={sounds.intervalLimit}
                  min={0}
                  max={50}
                  step={1}
                  onChange={(intervalLimit) => update({ intervalLimit })}
                />
                <div className="space-y-1">
                  <label htmlFor="sound-interval-priority" className={labelClass}>
                    Priority
                  </label>
                  <select
                    id="sound-interval-priority"
                    value={sounds.intervalPriority}
                    onChange={(e) => update({ intervalPriority: Number(e.target.value) })}
                    className={inputClass}
                  >
                    {SOUND_PRIORITIES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex items-start gap-2 p-2.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-100/60 dark:bg-stone-800/40 text-[10px] text-stone-500 dark:text-stone-400">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <p>
                  WA gives Lua no handle to a flying missile&apos;s emitter, so the voice plays on the
                  worm whose turn it is (else any living worm) and is positioned there, not at the
                  round. Cluster bits tick their own interval from `m.id`.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
