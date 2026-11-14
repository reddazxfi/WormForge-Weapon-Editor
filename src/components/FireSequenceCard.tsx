import type { CustomSoundsConfig, FireSequenceConfig, WeaponProject } from '../types/weapon';
import { DEFAULT_CUSTOM_SOUNDS, SOUND_PRIORITIES } from '../data/soundPresets';
import { DEFAULT_FIRE_SEQUENCE, supportsFireSequence } from '../data/fireSequence';
import { SoundUpload } from './EffectsCards';
import {
  SectionHeader,
  SubSectionTitle,
  TooltipLabel,
  UnitNumberInput,
} from './RecordEditor';
import { NumberInput } from './NumberInput';
import { ListOrdered } from 'lucide-react';

interface Props {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
}

const inputClass =
  'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-white';
const selectClass =
  'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-white';

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

  const seqNum = (
    id: string,
    label: string,
    code: string,
    hint: string,
    key: keyof FireSequenceConfig,
    opts: { min?: number; max?: number; step?: number; unit?: string } = {}
  ) => (
    <div>
      <TooltipLabel label={label} code={code} desc={hint} htmlFor={id} />
      <UnitNumberInput
        id={id}
        min={opts.min}
        max={opts.max}
        step={opts.step ?? 1}
        value={seq[key] as number}
        onChange={(e) => update({ [key]: Number(e.target.value) } as Partial<FireSequenceConfig>)}
        unit={opts.unit}
      />
    </div>
  );

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Sequential Fire"
        code="wf-lib/fire_seq (px.fire_seq)"
        icon={<ListOrdered className="h-4 w-4 text-forge-500" aria-hidden="true" />}
        desc="Fires a rapid timed burst from one trigger pull while holding the worm's firing animation until the final shot. Requires px.fire_seq."
        right={
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-forge-200 bg-forge-50/80 px-3 py-1.5 dark:border-forge-800/70 dark:bg-forge-950/30">
            <input
              id="seq-enabled"
              type="checkbox"
              checked={seq.enabled}
              disabled={!supported}
              onChange={(e) => update({ enabled: e.target.checked })}
              className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
            />
            <span className="text-xs font-semibold text-forge-900 dark:text-forge-200">
              Enable Burst
            </span>
          </label>
        }
      />

      {!supported ? (
        <p className="rounded-xl bg-stone-50 px-3.5 py-2.5 text-xs text-stone-500 dark:bg-stone-950/40 dark:text-stone-400">
          Air strikes drop bombs from the aircraft rather than firing from a worm slot, so sequential fire cannot trigger.
        </p>
      ) : customOnFire ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50/70 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
          Your custom Lua defines <code className="font-mono">on_fire</code>, which already owns the trigger. Remove it to emit this sequential burst.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div>
              <TooltipLabel
                label="Round Type"
                code="fire_seq_mis / fire_sequential_actor"
                desc="WA Projectiles spawns native projectiles using this weapon's record. Custom Lua Actors spawns script-driven sprites with their own custom Lua behaviour."
                htmlFor="seq-mode"
              />
              <select
                id="seq-mode"
                value={seq.mode}
                onChange={(e) => update({ mode: e.target.value as FireSequenceConfig['mode'] })}
                className={selectClass}
              >
                <option value="missiles">WA Projectiles</option>
                <option value="actors">Custom Lua Actors</option>
              </select>
            </div>

            {seqNum('seq-count', 'Total Shots', 'count', 'Number of shots fired per trigger pull (1 leaves normal single shot).', 'count', { min: 1, max: 200 })}
            {seqNum('seq-delay', 'Shot Interval', 'delay', 'Frames between shots at 50 Hz (4 = Megashark cadence, 1 = continuous stream).', 'delay', { min: 1, max: 100, unit: 'f' })}
            {seqNum('seq-speed', 'Launch Velocity', 'speed', 'Launch speed along the worm aim vector in pixels/frame.', 'speed', { min: 0, max: 100, step: 0.5, unit: 'px/f' })}
            {seqNum('seq-standoff', 'Muzzle Standoff', 'standoff', 'Forward spawn push in pixels so rounds do not clip the firing worm.', 'standoff', { min: 0, max: 200, unit: 'px' })}
            {seqNum('seq-spread-x', 'Horizontal Spread', 'spread.x', 'Random horizontal velocity jitter (+/-) per shot.', 'spreadX', { min: 0, max: 20, step: 0.1, unit: 'px/f' })}
            {seqNum('seq-spread-y', 'Vertical Spread', 'spread.y', 'Random vertical velocity jitter (+/-) per shot.', 'spreadY', { min: 0, max: 20, step: 0.1, unit: 'px/f' })}
            {seqNum('seq-offset-x', 'Muzzle Offset X', 'x', 'Horizontal origin offset from worm center before standoff.', 'offsetX', { min: -100, max: 100, unit: 'px' })}
            {seqNum('seq-offset-y', 'Muzzle Offset Y', 'y', 'Vertical origin offset from worm center (-3 is roughly weapon height).', 'offsetY', { min: -100, max: 100, unit: 'px' })}
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300">
              <input
                id="seq-live-aim"
                type="checkbox"
                checked={seq.liveAim}
                onChange={(e) => update({ liveAim: e.target.checked })}
                className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
              />
              <span title="Reads the worm aim angle on every shot so you can sweep your aim mid-burst.">
                Track Live Aim
              </span>
            </label>

            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300">
              <input
                id="seq-cancel"
                type="checkbox"
                checked={seq.cancelOnWeaponChange}
                onChange={(e) => update({ cancelOnWeaponChange: e.target.checked })}
                className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
              />
              <span title="Stops the remaining burst immediately if the worm swaps weapons or takes knockback.">
                Stop if Weapon Switched
              </span>
            </label>
          </div>

          {seq.mode === 'actors' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl bg-stone-50/70 p-3.5 dark:bg-stone-950/40">
              <div>
                <TooltipLabel
                  label="Actor Sprite Path"
                  code="actor.sprite"
                  desc="Bundle-relative path (e.g. sprites/<mod>/bullet.png) for Lua-driven actors."
                  htmlFor="seq-actor-sprite"
                />
                <input
                  id="seq-actor-sprite"
                  type="text"
                  value={seq.actorSprite}
                  placeholder="sprites/<mod>/bullet.png"
                  onChange={(e) => update({ actorSprite: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="flex flex-wrap items-end gap-5 pb-1">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300">
                  <input
                    id="seq-actor-gravity"
                    type="checkbox"
                    checked={seq.actorGravity}
                    onChange={(e) => update({ actorGravity: e.target.checked })}
                    className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
                  />
                  <span>Gravity</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300">
                  <input
                    id="seq-actor-collide"
                    type="checkbox"
                    checked={seq.actorCollide}
                    onChange={(e) => update({ actorCollide: e.target.checked })}
                    className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
                  />
                  <span>Collide Terrain</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300">
                  <input
                    id="seq-actor-persist"
                    type="checkbox"
                    checked={seq.actorPersist}
                    onChange={(e) => update({ actorPersist: e.target.checked })}
                    className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
                  />
                  <span>Persist Past Blasts</span>
                </label>
              </div>
            </div>
          )}

          {/* Per-Shot WAV Audio */}
          <div className="space-y-3 border-t border-stone-200/80 pt-4 dark:border-stone-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SubSectionTitle
                title="Per-Shot Audio"
                code="on_shot"
                desc="Optional custom WAV triggered on every shot or every N shots in the sequence."
              />
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={sounds.shotEnabled}
                  onChange={(e) => updateSounds({ shotEnabled: e.target.checked })}
                  className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
                />
                <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                  Enable
                </span>
              </label>
            </div>

            {sounds.shotEnabled && (
              <div className="space-y-3 rounded-xl bg-stone-50/70 p-3.5 dark:bg-stone-950/40">
                <SoundUpload
                  id="sound-shot"
                  asset={sounds.shot}
                  onPick={(asset) => updateSounds({ shot: asset, shotEnabled: true })}
                  onRemove={() => updateSounds({ shot: undefined, shotEnabled: false })}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <TooltipLabel
                      label="Play Every N Shots"
                      code="shotEvery"
                      desc="Play the WAV on every Nth shot (1 = every shot; 3 plays once per 3-round burst)."
                      htmlFor="sound-shot-every"
                    />
                    <NumberInput
                      id="sound-shot-every"
                      min={1}
                      max={50}
                      value={sounds.shotEvery}
                      onChange={(e) => updateSounds({ shotEvery: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <TooltipLabel
                      label="Voice Priority"
                      code="priority"
                      desc="Higher priorities override lower-priority sounds when voices are busy."
                      htmlFor="sound-shot-priority"
                    />
                    <select
                      id="sound-shot-priority"
                      value={sounds.shotPriority}
                      onChange={(e) => updateSounds({ shotPriority: Number(e.target.value) })}
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
      )}
    </div>
  );
};
