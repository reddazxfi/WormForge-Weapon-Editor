import { useState } from 'react';
import type { WeaponProject } from '../types/weapon';
import { Boxes, Plus, X } from 'lucide-react';

interface BundleDependenciesProps {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
}

/**
 * `mod.toml` libraries this bundle loads. WormForge resolves each id from
 * `WormForge/Mods/` at load, so nothing is copied into the ZIP; the panel only
 * records which bundles must be installed next to this one.
 */
export function BundleDependencies({ project, onChange }: BundleDependenciesProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const auto: { id: string; reason: string }[] = [];
  if (project.hold?.enabled) {
    auto.push({ id: 'wf.sdk', reason: 'hold art builder' });
  }
  if (project.missileSprite?.enabled && project.missileSprite.mode === 'custom') {
    auto.push({ id: 'wf.sdk', reason: 'flight sprite builder' });
  }
  const customOnExplode =
    !!project.enableCustomLua &&
    /^\s*on_explode\s*=/m.test(project.customLuaSnippet || '');
  const ribbonTrail =
    !!project.ribbonTrail?.enabled &&
    (project.fireType === 'power' || (project.fireType === 'drop' && !!project.body.fuse));
  const explosion =
    !!project.explosionEffect?.enabled &&
    !customOnExplode &&
    (project.fireType === 'power' || project.fireType === 'drop');
  if (ribbonTrail) auto.push({ id: 'effects.sdk', reason: 'ribbon trail' });
  if (explosion) auto.push({ id: 'effects.sdk', reason: 'explosion burst' });

  // One row per id, with every feature that pulled it in.
  const autoById = new Map<string, string[]>();
  for (const entry of auto) {
    autoById.set(entry.id, [...(autoById.get(entry.id) ?? []), entry.reason]);
  }

  const manual = (project.extraDependencies || []).filter(Boolean);

  const add = (raw: string) => {
    const id = raw.trim();
    if (!id) return;
    if (!/^[A-Za-z0-9_.-]+$/.test(id)) {
      setError('Use letters, digits, dots, dashes or underscores.');
      return;
    }
    if (autoById.has(id) || manual.includes(id)) {
      setError(`${id} is already in the bundle.`);
      return;
    }
    setError(null);
    setDraft('');
    onChange({ extraDependencies: [...manual, id] });
  };

  const remove = (id: string) => {
    setError(null);
    onChange({ extraDependencies: manual.filter((value) => value !== id) });
  };

  return (
    <div className="p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white/80 dark:bg-stone-900/60 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 dark:border-stone-700/80 pb-2.5">
        <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-2">
          <Boxes className="w-4 h-4 text-forge-500" />
          Bundle SDKs &amp; Dependencies
        </span>
        <span className="font-mono text-[10px] text-stone-400">mod.toml · `dependencies`</span>
      </div>

      <p className="text-[11px] text-stone-500 dark:text-stone-400">
        Libraries are resolved by id from `WormForge/Mods/` when the match loads; the export only
        declares them, it does not copy their files. The features above add their own entries
        automatically, so this list is for a bundle the custom Lua uses or one this editor does not
        model.
      </p>

      <div className="space-y-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
          Required by this bundle
        </span>
        {autoById.size === 0 ? (
          <p className="text-xs text-stone-500 dark:text-stone-400">
            None — the exported weapon stands alone.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {[...autoById].map(([id, reasons]) => (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-forge-50 dark:bg-forge-950/40 border border-forge-200 dark:border-forge-900/60 text-[11px] text-forge-900 dark:text-forge-200"
                title={`Added by: ${reasons.join(', ')}`}
              >
                <span className="font-mono font-semibold">{id}</span>
                <span className="text-forge-700/80 dark:text-forge-300/80">
                  ({reasons.join(', ')})
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
          Additional libraries
        </span>
        {manual.length === 0 ? (
          <p className="text-xs text-stone-500 dark:text-stone-400">None added by hand.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {manual.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-[11px] text-stone-800 dark:text-stone-200"
              >
                <span className="font-mono font-semibold">{id}</span>
                <button
                  type="button"
                  aria-label={`Remove dependency ${id}`}
                  onClick={() => remove(id)}
                  className="p-0.5 rounded hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-500 hover:text-stone-800 dark:hover:text-stone-100"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[180px] space-y-1">
            <label
              htmlFor="bundle-dependency"
              className="text-[10px] font-semibold text-stone-500 dark:text-stone-400"
            >
              Bundle id
            </label>
            <input
              id="bundle-dependency"
              type="text"
              value={draft}
              spellCheck={false}
              placeholder="e.g. effects.sdk"
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add(draft);
                }
              }}
              className="w-full text-xs font-mono px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
            />
          </div>
          <button
            type="button"
            onClick={() => add(draft)}
            className="inline-flex items-center gap-1 px-3 py-2 text-[11px] font-semibold rounded-lg bg-forge-600 text-white hover:bg-forge-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add dependency
          </button>
        </div>
        {error && <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-stone-400 uppercase tracking-wide">Known:</span>
          {[
            { id: 'effects.sdk', hint: 'Project X effects (trail, bursts, emitters)' },
            { id: 'wf.sdk', hint: 'WormForge SDK (holds, sprite builder)' },
          ].map((entry) => (
            <button
              key={entry.id}
              type="button"
              title={entry.hint}
              disabled={autoById.has(entry.id) || manual.includes(entry.id)}
              onClick={() => add(entry.id)}
              className="px-2 py-1 text-[11px] rounded bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed font-mono"
            >
              {entry.id}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
