import { HelpCircle, ListOrdered } from 'lucide-react';
import type { CustomSoundsConfig, FireSequenceConfig, WeaponProject } from '../types/weapon';
import { DEFAULT_CUSTOM_SOUNDS, SOUND_PRIORITIES } from '../data/soundPresets';
import { DEFAULT_FIRE_SEQUENCE, supportsFireSequence } from '../data/fireSequence';
import { SoundUpload } from './EffectsCards';
import { NumberInput } from './NumberInput';

interface Props {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
}

const cardClass =
  'p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-850/40 space-y-4';
const inputClass =
  'w-full text-xs font-mono px-2 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white disabled:opacity-50';

/** A labelled control whose explanation lives in the hover tooltip only. */
const Field: React.FC<{
  id: string;
  label: string;
  hint: string;
  children: React.ReactNode;
  className?: string;
}> = ({ id, label, hint, children, className }) => (
  <div className={`space-y-1 ${className ?? ''}`}>
    <div className="flex items-center gap-1">
      <label htmlFor={id} className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">
        {label}
      </label>
      <span
        className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-help"
        title={hint}
        aria-label={hint}
        role="img"
      >
        <HelpCircle className="w-3 h-3" />
      </span>
    </div>
    {children}
  </div>
);

const Toggle: React.FC<{
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ id, label, hint, checked, onChange }) => (
  <label htmlFor={id} className="flex items-center gap-2 cursor-pointer select-none">
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="rounded text-forge-600 focus:ring-forge-500 w-3.5 h-3.5"
    />
    <span className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">{label}</span>
    <span
      className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-help"
      title={hint}
      aria-label={hint}
      role="img"
    >
      <HelpCircle className="w-3 h-3" />
    </span>
  </label>
);

/**
 * `wf-lib/fire_seq` (`px.fire_seq`): one `on_fire` fires a burst. The first shot
 * leaves immediately; a hidden timer actor fires the rest `delay` frames apart
 * and holds WA's shot counters, so the worm stays in its firing pose until the
 * last one. Every key the module documents is here; the explanations live in the
 * hover tooltips so the card stays compact.
 */
export const FireSequenceCard: React.FC<Props> = ({ project, onChange }) => {
  const seq: FireSequenceConfig = project.fireSequence ?? DEFAULT_FIRE_SEQUENCE;
  const sounds: CustomSoundsConfig = project.customSounds ?? DEFAULT_CUSTOM_SOUNDS;
  const update = (patch: Partial<FireSequenceConfig>) =>
    onChange({ fireSequence: { ...seq, ...patch } });
  const updateSounds = (patch: Partial<CustomSoundsConfig>) =>
    onChange({ customSounds: { ...sounds, ...patch } });

  const supported = supportsFireSequence(project);
  const customOnFire =
    !!project.enableCustomLua && /(?:^|\n)[ \t]*on_fire\s*=/.test(project.customLuaSnippet || '');
  const num = (
    id: string,
    label: string,
    hint: string,
    key: keyof FireSequenceConfig,
    opts: { min?: number; max?: number; step?: number } = {},
  ) => (
    <Field id={id} label={label} hint={hint}>
      <NumberInput
        id={id}
        min={opts.min}
        max={opts.max}
        step={opts.step ?? 1}
        value={seq[key] as number}
        onChange={(e) => update({ [key]: Number(e.target.value) } as Partial<FireSequenceConfig>)}
        className={inputClass}
      />
    </Field>
  );

  return (
    <div className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 dark:border-stone-700/80 pb-2.5">
        <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-2">
          <ListOrdered className="w-4 h-4 text-forge-500" />
          Sequential Fire (`wf-lib/fire_seq`)
        </span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-stone-400">px.fire_seq</span>
          <label htmlFor="seq-enabled" className="flex items-center gap-1.5 cursor-pointer">
            <input
              id="seq-enabled"
              type="checkbox"
              checked={seq.enabled}
              disabled={!supported}
              onChange={(e) => update({ enabled: e.target.checked })}
              className="rounded text-forge-600 focus:ring-forge-500 w-3.5 h-3.5"
            />
            <span className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">
              Enable
            </span>
          </label>
        </div>
      </div>

      {!supported ? (
        <p className="text-[11px] text-stone-500 dark:text-stone-400">
          An air strike&apos;s munitions are created by the strike entity, so its slot never fires
          and a burst could not start.
        </p>
      ) : customOnFire ? (
        <p className="text-[11px] text-amber-700 dark:text-amber-300">
          Your custom Lua already defines `on_fire`, which owns the trigger. Remove it (or turn the
          custom snippet off) to let this card emit the burst.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <Field
              id="seq-mode"
              label="Rounds"
              hint="Real WA missiles (fire_seq_mis, the record's own projectile) or Lua actors (fire_sequential_actor, a spawned sheet with its own brain)."
            >
              <select
                id="seq-mode"
                value={seq.mode}
                onChange={(e) => update({ mode: e.target.value as FireSequenceConfig['mode'] })}
                className={inputClass}
              >
                <option value="missiles">WA missiles</option>
                <option value="actors">Lua actors</option>
              </select>
            </Field>
            {num('seq-count', 'Shots', 'Total shots per trigger pull, the first one included. 1 leaves WA to fire it alone.', 'count', { min: 1, max: 200 })}
            {num('seq-delay', 'Delay (frames)', 'Frames between shots at 50 Hz. 4 is PX’s Megashark cadence; 1 is a stream.', 'delay', { min: 1, max: 100 })}
            {num('seq-speed', 'Speed (px/frame)', 'Launch speed along the worm’s aim. The record’s own speed is ignored for a launched missile.', 'speed', { min: 0, max: 100, step: 0.5 })}
            {num('seq-standoff', 'Standoff (px)', 'Pushes each spawn point along its own velocity so a shot does not start inside the firing worm.', 'standoff', { min: 0, max: 200 })}
            {num('seq-spread-x', 'Spread X', 'Random horizontal velocity jitter, ± per shot (drawn with wa.random, so any decimal works).', 'spreadX', { min: 0, max: 20, step: 0.1 })}
            {num('seq-spread-y', 'Spread Y', 'Random vertical velocity jitter, ± per shot.', 'spreadY', { min: 0, max: 20, step: 0.1 })}
            {num('seq-offset-x', 'Offset X (px)', 'Spawn offset from the worm, in pixels, before the standoff.', 'offsetX', { min: -100, max: 100 })}
            {num('seq-offset-y', 'Offset Y (px)', 'Spawn offset from the worm; -3 is roughly the muzzle height.', 'offsetY', { min: -100, max: 100 })}
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
            <Toggle
              id="seq-live-aim"
              label="Live aim"
              hint="Read the worm’s aim again for every shot (functions of (i, w)), so the player can keep adjusting during the burst. Off locks the aim to the trigger pull."
              checked={seq.liveAim}
              onChange={(v) => update({ liveAim: v })}
            />
            <Toggle
              id="seq-cancel"
              label="Stop when the weapon changes"
              hint="cancel_weapon = ctx.id: the burst ends if the worm drops this weapon. Actors have no default, so it is always emitted there."
              checked={seq.cancelOnWeaponChange}
              onChange={(v) => update({ cancelOnWeaponChange: v })}
            />
          </div>

          <p className="text-[11px] text-stone-500 dark:text-stone-400">
            The worm&apos;s fire animation and sound come from the weapon&apos;s{' '}
            <span className="font-mono">fires.subtype</span> (Flight &amp; Physics), not from
            this card. 4 is the Minigun (shells + firing loop), 5 the Shotgun&apos;s pump; a
            burst keeps whatever the record uses.
          </p>

          {seq.mode === 'actors' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <Field
                id="seq-actor-sprite"
                label="Actor sheet"
                hint="Bundle-relative PNG/GIF the spawned actor draws. Its brain (movement, damage, lifetime) is custom Lua: fire_seq only decides where and when it spawns."
              >
                <input
                  id="seq-actor-sprite"
                  type="text"
                  value={seq.actorSprite}
                  placeholder="sprites/<mod>/bullet.png"
                  onChange={(e) => update({ actorSprite: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-4">
                <Toggle
                  id="seq-actor-gravity"
                  label="Gravity"
                  hint="The spawned actor falls under WA’s gravity."
                  checked={seq.actorGravity}
                  onChange={(v) => update({ actorGravity: v })}
                />
                <Toggle
                  id="seq-actor-collide"
                  label="Collide"
                  hint="The actor collides with the land instead of passing through it."
                  checked={seq.actorCollide}
                  onChange={(v) => update({ actorCollide: v })}
                />
                <Toggle
                  id="seq-actor-persist"
                  label="Persist"
                  hint="Survives a nearby blast, so only its own brain ends it."
                  checked={seq.actorPersist}
                  onChange={(v) => update({ actorPersist: v })}
                />
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-stone-700 dark:text-stone-300 uppercase tracking-wide">
                Shot sound (`on_shot`)
              </span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sounds.shotEnabled}
                  onChange={(e) => updateSounds({ shotEnabled: e.target.checked })}
                  className="rounded text-forge-600 focus:ring-forge-500 w-3.5 h-3.5"
                />
                <span className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">
                  Enable
                </span>
              </label>
            </div>
            {sounds.shotEnabled && (
              <>
                <SoundUpload
                  id="sound-shot"
                  asset={sounds.shot}
                  onPick={(asset) => updateSounds({ shot: asset, shotEnabled: true })}
                  onRemove={() => updateSounds({ shot: undefined, shotEnabled: false })}
                />
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <Field
                    id="sound-shot-every"
                    label="Every N shots"
                    hint="Play the WAV on every Nth shot; 1 is every shot, 3 gives a three-round burst one report."
                  >
                    <NumberInput
                      id="sound-shot-every"
                      min={1}
                      max={50}
                      value={sounds.shotEvery}
                      onChange={(e) => updateSounds({ shotEvery: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </Field>
                  <Field
                    id="sound-shot-priority"
                    label="Priority"
                    hint="Higher priorities replace lower ones in a full voice pool."
                  >
                    <select
                      id="sound-shot-priority"
                      value={sounds.shotPriority}
                      onChange={(e) => updateSounds({ shotPriority: Number(e.target.value) })}
                      className={inputClass}
                    >
                      {SOUND_PRIORITIES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};
