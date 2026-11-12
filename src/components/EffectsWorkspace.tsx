import { Blocks, Sparkles } from 'lucide-react';
import type { WeaponProject } from '../types/weapon';
import {
  CustomSoundsCard,
  ExplosionEffectCard,
  RibbonTrailCard,
  supportsExplosionEffect,
  supportsExplosionSound,
  supportsIntervalSound,
  supportsRibbonTrail,
} from './EffectsCards';
import { FireSequenceCard } from './FireSequenceCard';

interface Props {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
}

/**
 * The advanced-library workspace: everything that is a claim hook or a library
 * bundle rather than a native record field. The ribbon trail and the explosion
 * burst come from `effects.sdk`, the burst from `px.fire_seq`; a future library
 * gets a card here instead of a record section.
 */
export const EffectsWorkspace: React.FC<Props> = ({ project, onChange }) => {
  // The effects cards need a round WA flies or blasts. A strike's bombs are
  // built from the strike's own record copy, so no claim hook can reach them.
  const effectsAvailable =
    supportsRibbonTrail(project) ||
    supportsExplosionEffect(project) ||
    supportsExplosionSound(project) ||
    supportsIntervalSound(project);

  return (
    <div className="space-y-6">
      <div className="p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white/60 dark:bg-stone-900/40">
        <h2 className="font-heading text-sm font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-forge-500" />
          Effects &amp; Libraries
        </h2>
        <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 max-w-3xl">
          Claim hooks and library bundles rather than native record fields: the Project X ribbon
          trail and explosion burst (`effects.sdk`), uploaded WAVs played with `wa.sound.play`, and
          sequential fire (`px.fire_seq`). Their colour, shape, sound and timing are free, and each
          one adds its own `mod.toml` dependency.
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
            Guns, arrows, sprays, specials and air strikes do not fire a missile this claim owns, so
            the ribbon trail, the explosion burst and the sound hooks cannot run. Air-strike bombs
            are built by the strike entity from its own record copy, which the engine never maps to
            a weapon slot.
          </p>
        </div>
      )}

      <FireSequenceCard project={project} onChange={onChange} />

      <div className="p-5 rounded-xl border border-dashed border-stone-300 dark:border-stone-700 bg-stone-50/60 dark:bg-stone-800/20 space-y-1.5">
        <div className="text-[11px] font-bold text-stone-700 dark:text-stone-300 uppercase tracking-wide flex items-center gap-2">
          <Blocks className="w-3.5 h-3.5 text-stone-400" />
          More libraries
        </div>
        <p className="text-[11px] text-stone-500 dark:text-stone-400 max-w-3xl">
          A library that needs its own claim hook or bundle gets a card on this page. Anything not
          modelled here can still be used from the custom Lua snippet on the record page; add its
          bundle id under Bundle Code → Dependencies so `mod.toml` resolves it.
        </p>
      </div>
    </div>
  );
};
