import { useEffect, useMemo, useState } from 'react';
import { Blocks, ListOrdered, Sparkles, Volume2, Zap } from 'lucide-react';
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
import { supportsFireSequence } from '../data/fireSequence';

interface Props {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
}

type EffectTabId = 'trail' | 'explosion' | 'sounds' | 'sequence';

interface EffectTabDef {
  id: EffectTabId;
  label: string;
  hint: string;
  icon: typeof Zap;
  active: boolean;
  tone: 'sky' | 'amber' | 'forge';
}

export const EffectsWorkspace: React.FC<Props> = ({ project, onChange }) => {
  const [selectedTab, setSelectedTab] = useState<EffectTabId>('trail');

  const tabs = useMemo<EffectTabDef[]>(() => {
    const list: EffectTabDef[] = [];
    if (supportsRibbonTrail(project)) {
      list.push({
        id: 'trail',
        label: 'Ribbon Trail',
        hint: 'Additive beam + glow ribbon following flying projectiles',
        icon: Zap,
        active: !!project.ribbonTrail?.enabled,
        tone: 'sky',
      });
    }
    if (supportsExplosionEffect(project)) {
      list.push({
        id: 'explosion',
        label: 'Explosion Burst',
        hint: 'Custom shockwave ring, lens flare & optional smoke cloud',
        icon: Sparkles,
        active: !!project.explosionEffect?.enabled,
        tone: 'amber',
      });
    }
    if (supportsExplosionSound(project) || supportsIntervalSound(project)) {
      list.push({
        id: 'sounds',
        label: 'Custom Sounds',
        hint: 'Import PCM WAV audio for detonations and in-flight loops',
        icon: Volume2,
        active: !!(project.customSounds?.explosionEnabled || project.customSounds?.intervalEnabled),
        tone: 'sky',
      });
    }
    if (supportsFireSequence(project)) {
      list.push({
        id: 'sequence',
        label: 'Sequential Fire',
        hint: 'Rapid timed burst firing while holding worm animation',
        icon: ListOrdered,
        active: !!project.fireSequence?.enabled,
        tone: 'forge',
      });
    }
    return list;
  }, [project]);

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.id === selectedTab)) {
      setSelectedTab(tabs[0].id);
    }
  }, [tabs, selectedTab]);

  const currentTab = tabs.some((t) => t.id === selectedTab) ? selectedTab : tabs[0]?.id;

  return (
    <section
      aria-label="Effects & Libraries Workbench"
      className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900"
    >
      {tabs.length === 0 ? (
        <div className="space-y-2 p-8 text-center">
          <Sparkles className="mx-auto h-7 w-7 text-stone-400" aria-hidden="true" />
          <div className="text-sm font-semibold text-stone-800 dark:text-stone-200">
            No Library Hooks Available for Air Strikes
          </div>
          <p className="mx-auto max-w-lg text-xs text-stone-500 dark:text-stone-400">
            Air strike bombs spawn directly from the flyover aircraft rather than a worm slot, so
            ribbon trails, explosion bursts, custom WAV triggers, and sequential fire do not attach to them.
          </p>
        </div>
      ) : (
        <>
          {/* Unified Armory Effects Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200/80 bg-stone-50/80 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-950/60">
            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Effects and library modules">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isSelected = currentTab === tab.id;
                const activeClasses =
                  tab.tone === 'sky'
                    ? 'bg-sky-600 text-white shadow-xs dark:bg-sky-500'
                    : tab.tone === 'amber'
                      ? 'bg-amber-600 text-white shadow-xs dark:bg-amber-500'
                      : 'bg-forge-600 text-white shadow-xs dark:bg-forge-500';
                const iconTint =
                  tab.tone === 'sky'
                    ? 'text-sky-500'
                    : tab.tone === 'amber'
                      ? 'text-amber-500'
                      : 'text-forge-500';

                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    title={tab.hint}
                    onClick={() => setSelectedTab(tab.id)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isSelected
                        ? activeClasses
                        : 'border border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:text-white'
                    }`}
                  >
                    <Icon
                      className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-white' : iconTint}`}
                      aria-hidden="true"
                    />
                    <span>{tab.label}</span>
                    {tab.active && (
                      <span
                        className={`font-mono text-[10px] ${
                          isSelected ? 'text-white/85' : 'text-sky-600 dark:text-sky-400'
                        }`}
                      >
                        · on
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-4 sm:p-5">
            {currentTab === 'trail' && <RibbonTrailCard project={project} onChange={onChange} />}
            {currentTab === 'explosion' && <ExplosionEffectCard project={project} onChange={onChange} />}
            {currentTab === 'sounds' && <CustomSoundsCard project={project} onChange={onChange} />}
            {currentTab === 'sequence' && <FireSequenceCard project={project} onChange={onChange} />}
          </div>
        </>
      )}

      {/* Compact Dependency Reminder Footer */}
      <div className="flex flex-wrap items-center gap-2 border-t border-stone-200/80 bg-stone-50/60 px-4 py-2 text-[11px] text-stone-500 dark:border-stone-800 dark:bg-stone-950/40 dark:text-stone-400">
        <Blocks className="h-3.5 w-3.5 shrink-0 text-sky-500" aria-hidden="true" />
        <span>
          Enabling any library automatically adds its dependency to <code className="font-mono">mod.toml</code>. Add extra third-party library IDs under <strong>Bundle &amp; Export</strong>.
        </span>
      </div>
    </section>
  );
};
