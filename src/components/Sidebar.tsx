import React from 'react';
import {
  Download,
  Upload,
  Moon,
  Sun,
  FileCode2,
  Layers,
  Sparkles,
  ChevronRight,
} from 'lucide-react';
import { WeaponProject } from '../types/weapon';
import { RECORD_TABS, RecordTabId } from '../data/recordTabs';
import { assetUrl } from '../utils/assetUrl';

type WorkspaceTab = 'editor' | 'hold' | 'code';

interface SidebarProps {
  project: WeaponProject;
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
  activeSubTab: RecordTabId;
  setActiveSubTab: (tab: RecordTabId) => void;
  onImportWep: () => void;
  onExportZip: () => void;
  isDark: boolean;
  setIsDark: (dark: boolean) => void;
  onCopyId: () => void;
}

const WORKSPACE: { id: WorkspaceTab; label: string; hint: string; icon: React.ElementType; key: string }[] = [
  { id: 'editor', label: 'Weapon Record', hint: 'Identity, flight, payload', icon: Layers, key: '1' },
  { id: 'hold', label: 'Hold & Sprite Builder', hint: 'Worm grip and flight art', icon: Sparkles, key: '2' },
  { id: 'code', label: 'Bundle Code', hint: 'Lua, mod.toml, profile', icon: FileCode2, key: '3' },
];

const chip =
  'inline-flex items-center gap-1 rounded-md border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/60 px-1.5 py-0.5 text-[10px] text-stone-500 dark:text-stone-400';

const ProjectCard: React.FC<{ project: WeaponProject; onCopyId: () => void }> = ({ project, onCopyId }) => (
  <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-900/60 p-3">
    <div className="flex items-start gap-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800">
        {project.customIconPreview ? (
          <img
            src={project.customIconPreview}
            alt=""
            width={36}
            height={36}
            className="h-full w-full object-contain"
            style={{ imageRendering: 'pixelated' }}
          />
        ) : (
          <span className="font-heading text-[11px] font-bold uppercase text-stone-500 dark:text-stone-300">
            {project.slot.slice(0, 2)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100" title={project.name}>
          {project.name}
        </div>
        <button
          type="button"
          onClick={onCopyId}
          className="mt-0.5 max-w-full truncate rounded font-mono text-[10px] text-forge-700 hover:underline dark:text-forge-300"
          title="Copy component ID"
        >
          {project.id}
        </button>
      </div>
    </div>

    <div className="mt-2.5 grid grid-cols-2 gap-1">
      <span className={`${chip} min-w-0`} title={`Base: ${project.based_on}`}>
        <span className="shrink-0 text-stone-400">Base</span>
        <b className="truncate font-medium text-stone-700 dark:text-stone-200">
          {project.useWepFile && project.wepFile ? '.wep' : project.based_on}
        </b>
      </span>
      <span className={`${chip} min-w-0`} title={`Slot: ${project.slot}`}>
        <span className="shrink-0 text-stone-400">Slot</span>
        <b className="truncate font-medium text-stone-700 dark:text-stone-200">{project.slot}</b>
      </span>
      <span className={`${chip} min-w-0`} title={`Action: ${project.action || 'none'}`}>
        <span className="shrink-0 text-stone-400">Action</span>
        <b className="truncate font-medium capitalize text-stone-700 dark:text-stone-200">{project.action || 'none'}</b>
      </span>
      <span className={`${chip} min-w-0`} title={`Burst: ${project.burst || 'plain'}`}>
        <span className="shrink-0 text-stone-400">Burst</span>
        <b className="truncate font-medium capitalize text-stone-700 dark:text-stone-200">{project.burst || 'plain'}</b>
      </span>
    </div>

    {project.hold?.enabled && (
      <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-forge-50 px-1.5 py-0.5 text-[10px] font-medium text-forge-700 dark:bg-forge-950/50 dark:text-forge-300">
        <span className="h-1 w-1 rounded-full bg-forge-500" />
        Hold art enabled
      </div>
    )}
  </div>
);

export const Sidebar: React.FC<SidebarProps> = ({
  project,
  activeTab,
  setActiveTab,
  activeSubTab,
  setActiveSubTab,
  onImportWep,
  onExportZip,
  isDark,
  setIsDark,
  onCopyId,
}) => {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 flex-col border-r border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900 lg:flex">
      <div className="border-b border-stone-100 px-5 pb-4 pt-5 dark:border-stone-800">
        <img
          src={assetUrl('assets/wormforge-logo.png')}
          alt="WormForge"
          width={327}
          height={57}
          className="h-9 w-auto"
        />
        <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400 dark:text-stone-500">
          Weapon Studio
        </div>
      </div>

      <div className="px-3 pt-3">
        <ProjectCard project={project} onCopyId={onCopyId} />
      </div>

      <nav className="mt-4 flex-1 overflow-y-auto px-3 pb-4" aria-label="Workspace">
        <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400 dark:text-stone-500">
          Workspace
        </div>
        <div className="space-y-1">
          {WORKSPACE.map(({ id, label, hint, icon: Icon, key }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                aria-current={active ? 'page' : undefined}
                className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  active
                    ? 'bg-forge-50 text-forge-800 dark:bg-forge-950/40 dark:text-forge-200'
                    : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/60 dark:hover:text-stone-100'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${active ? 'text-forge-600 dark:text-forge-400' : 'text-stone-400 group-hover:text-stone-600 dark:group-hover:text-stone-300'}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">{label}</span>
                  <span className="block truncate text-[10px] font-normal text-stone-400 dark:text-stone-500">{hint}</span>
                </span>
                <kbd
                  className={`rounded border px-1 py-0.5 font-mono text-[9px] ${
                    active
                      ? 'border-forge-200 bg-white/70 text-forge-600 dark:border-forge-800 dark:bg-forge-950/40 dark:text-forge-300'
                      : 'border-stone-200 bg-stone-50 text-stone-400 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-500'
                  }`}
                >
                  {key}
                </kbd>
              </button>
            );
          })}
        </div>

        {activeTab === 'editor' && (
          <>
            <div className="mt-5 px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400 dark:text-stone-500">
              Record Sections
            </div>
            <div className="space-y-0.5 border-l border-stone-200 pl-1 dark:border-stone-800">
              {RECORD_TABS.map(({ id, label, icon: Icon }) => {
                const active = activeSubTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveSubTab(id)}
                    aria-current={active ? 'page' : undefined}
                    className={`relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors ${
                      active
                        ? 'bg-stone-100 font-semibold text-stone-900 dark:bg-stone-800/70 dark:text-stone-100'
                        : 'text-stone-500 hover:bg-stone-50 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800/40 dark:hover:text-stone-200'
                    }`}
                  >
                    {active && (
                      <span className="absolute -left-[5px] top-1.5 h-4 w-[3px] rounded-full bg-forge-500" aria-hidden="true" />
                    )}
                    <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {id === 'action' && (
                      <span className="rounded bg-stone-200 px-1 font-mono text-[9px] uppercase text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                        {project.action || 'none'}
                      </span>
                    )}
                    {id === 'burst' && (
                      <span className="rounded bg-stone-200 px-1 font-mono text-[9px] uppercase text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                        {project.burst || 'plain'}
                      </span>
                    )}
                    {id === 'callbacks' && project.enableCustomLua && (
                      <span className="h-1.5 w-1.5 rounded-full bg-forge-500" aria-label="Custom Lua enabled" />
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </nav>

      <div className="border-t border-stone-200 p-3 dark:border-stone-800">
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={onImportWep}
            className="flex w-full items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-700 transition-colors hover:border-stone-400 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="flex-1 text-left">Import .wep</span>
            <ChevronRight className="h-3 w-3 opacity-40" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onExportZip}
            className="flex w-full items-center gap-2 rounded-lg bg-forge-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-forge-700 dark:bg-forge-500 dark:hover:bg-forge-400"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="flex-1 text-left">Export Mod (.zip)</span>
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px] text-stone-400 dark:text-stone-500">Worms Armageddon 3.8+</span>
          <button
            type="button"
            onClick={() => setIsDark(!isDark)}
            className="rounded-md border border-stone-200 p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {isDark ? <Sun className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" /> : <Moon className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
        </div>
      </div>
    </aside>
  );
};

interface MobileBarProps {
  project: WeaponProject;
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
  activeSubTab: RecordTabId;
  setActiveSubTab: (tab: RecordTabId) => void;
  onImportWep: () => void;
  onExportZip: () => void;
  isDark: boolean;
  setIsDark: (dark: boolean) => void;
}

export const MobileBar: React.FC<MobileBarProps> = ({
  project,
  activeTab,
  setActiveTab,
  activeSubTab,
  setActiveSubTab,
  onImportWep,
  onExportZip,
  isDark,
  setIsDark,
}) => (
  <div className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur dark:border-stone-800 dark:bg-stone-900/95 lg:hidden">
    <div className="flex items-center gap-2.5 px-4 py-2.5">
      <img src={assetUrl('assets/wormforge-logo.png')} alt="WormForge" width={327} height={57} className="h-5 w-auto shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-stone-900 dark:text-stone-100">{project.name}</div>
        <div className="truncate font-mono text-[10px] text-stone-400">{project.id}</div>
      </div>
      <button
        type="button"
        onClick={onImportWep}
        className="rounded-md border border-stone-300 p-1.5 text-stone-600 dark:border-stone-700 dark:text-stone-300"
        aria-label="Import .wep"
        title="Import .wep"
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onExportZip}
        className="rounded-md bg-forge-600 p-1.5 text-white dark:bg-forge-500"
        aria-label="Export mod zip"
        title="Export mod zip"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => setIsDark(!isDark)}
        className="rounded-md border border-stone-300 p-1.5 text-stone-600 dark:border-stone-700 dark:text-stone-300"
        aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
    <div className="grid grid-cols-3 gap-1 px-3 pb-2">
      {WORKSPACE.map(({ id, icon: Icon }) => {
        const short = id === 'editor' ? 'Record' : id === 'hold' ? 'Hold & Sprite' : 'Bundle';
        return (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`flex items-center justify-center gap-1.5 rounded-md px-1.5 py-1.5 text-[11px] font-medium ${
              activeTab === id
                ? 'bg-forge-50 text-forge-800 dark:bg-forge-950/40 dark:text-forge-200'
                : 'text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800/60'
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="truncate">{short}</span>
          </button>
        );
      })}
    </div>
    {activeTab === 'editor' && (
      <div className="border-t border-stone-100 px-3 py-2 dark:border-stone-800">
        <label htmlFor="mobile-record-section" className="sr-only">
          Record section
        </label>
        <select
          id="mobile-record-section"
          value={activeSubTab}
          onChange={(e) => setActiveSubTab(e.target.value as RecordTabId)}
          className="w-full rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
        >
          {RECORD_TABS.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
    )}
  </div>
);
