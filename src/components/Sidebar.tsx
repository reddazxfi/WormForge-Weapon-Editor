import React from 'react';
import {
  Download,
  Upload,
  Moon,
  Sun,
  FileCode2,
  Layers,
  Sparkles,
  Wand2,
  FolderSearch,
  ChevronRight,
} from 'lucide-react';
import { WeaponProject } from '../types/weapon';
import { hasProjectileBody, type RecordTabId } from '../data/recordTabs';
import { assetUrl } from '../utils/assetUrl';

type WorkspaceTab = 'editor' | 'hold' | 'effects' | 'code';

interface SidebarProps {
  project: WeaponProject;
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
  activeSubTab?: RecordTabId;
  setActiveSubTab?: (tab: RecordTabId) => void;
  onImportWep: () => void;
  onBrowseMods: () => void;
  onExportZip: () => void;
  isDark: boolean;
  setIsDark: (dark: boolean) => void;
  onCopyId: () => void;
}

const WORKSPACE: { id: WorkspaceTab; label: string; hint: string; icon: React.ElementType; key: string }[] = [
  { id: 'editor', label: 'Weapon Record', hint: 'Identity, physics & payload', icon: Layers, key: '1' },
  { id: 'hold', label: 'Hold & Sprites', hint: 'Worm grip & flight animation', icon: Sparkles, key: '2' },
  { id: 'effects', label: 'Effects & Audio', hint: 'Ribbon trail, blast & WAVs', icon: Wand2, key: '3' },
  { id: 'code', label: 'Bundle & Export', hint: 'Lua, mod.toml & profile', icon: FileCode2, key: '4' },
];

const ARCHETYPE_BADGE: Record<string, string> = {
  power: 'Projectile',
  hitscan: 'Firearm',
  drop: 'Dropped',
  cursor: 'Cursor',
  arrow: 'Arrow',
  spray: 'Flame',
  special: 'Special',
};

const ProjectCard: React.FC<{ project: WeaponProject; onCopyId: () => void }> = ({ project, onCopyId }) => {
  const showMissileMeta = hasProjectileBody(project.fireType, project.teleport, project.body?.fuse);
  const typeText =
    project.fireType === 'cursor'
      ? project.teleport
        ? 'Teleport'
        : 'Air Strike'
      : project.fireType === 'drop'
        ? project.body?.fuse
          ? 'Dynamite'
          : 'Mine'
        : ARCHETYPE_BADGE[project.fireType] ?? project.fireType;

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-900/60 p-3">
      <div className="flex items-start gap-2.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800">
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
              {project.slot.slice(0, 3)}
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
            title="Copy unique weapon ID"
          >
            {project.id}
          </button>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-stone-200/70 pt-2 text-[11px] text-stone-500 dark:border-stone-800 dark:text-stone-400">
        <span className="font-medium text-stone-700 dark:text-stone-200">{typeText}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate">
          {project.useWepFile && project.wepFile ? '.wep base' : project.based_on}
        </span>
        {showMissileMeta && (
          <>
            <span aria-hidden="true">·</span>
            <span className="capitalize">
              {project.action && project.action !== 'none' ? project.action : 'direct'}
            </span>
          </>
        )}
      </div>
    </div>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  project,
  activeTab,
  setActiveTab,
  onImportWep,
  onBrowseMods,
  onExportZip,
  isDark,
  setIsDark,
  onCopyId,
}) => (
  <aside className="fixed inset-y-0 left-0 z-40 hidden w-68 flex-col border-r border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900 lg:flex">
    <div className="border-b border-stone-100 px-5 pb-4 pt-5 dark:border-stone-800">
      <img
        src={assetUrl('assets/wormforge-logo.png')}
        alt="WormForge"
        width={327}
        height={57}
        className="h-8 w-auto"
      />
      <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400 dark:text-stone-500">
        Weapon Studio
      </div>
    </div>

    <div className="px-3 pt-3">
      <ProjectCard project={project} onCopyId={onCopyId} />
    </div>

    <nav className="mt-4 flex-1 overflow-y-auto px-3 pb-4" aria-label="Workspace">
      <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400 dark:text-stone-500">
        Studio
      </div>
      <div className="space-y-1">
        {WORKSPACE.map(({ id, label, hint, icon: Icon, key }) => {
          const active = activeTab === id;
          const iconTint =
            id === 'editor'
              ? 'text-forge-500'
              : id === 'hold'
                ? 'text-amber-500'
                : id === 'effects'
                  ? 'text-sky-500'
                  : 'text-orange-500';
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              aria-current={active ? 'page' : undefined}
              className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer ${
                active
                  ? 'bg-forge-50 text-forge-800 dark:bg-forge-950/40 dark:text-forge-200'
                  : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/60 dark:hover:text-stone-100'
              }`}
            >
              <Icon
                className={`h-4 w-4 shrink-0 ${active ? 'text-forge-600 dark:text-forge-400' : iconTint}`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">{label}</span>
                <span className="block truncate text-[10px] font-normal text-stone-400 dark:text-stone-500">{hint}</span>
              </span>
              <kbd
                className={`rounded border px-1 py-0.5 font-mono text-[9px] tabular-nums ${
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
    </nav>

    <div className="border-t border-stone-200 p-3 dark:border-stone-800">
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={onImportWep}
          className="flex w-full items-center gap-2 rounded-lg border border-amber-300/80 bg-amber-50/75 px-3 py-2 text-xs font-semibold text-amber-900 transition-colors hover:border-amber-400 hover:bg-amber-100/80 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-900/40 cursor-pointer"
        >
          <Upload className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <span className="flex-1 text-left">Import .wep</span>
          <ChevronRight className="h-3 w-3 opacity-50" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onBrowseMods}
          className="flex w-full items-center gap-2 rounded-lg border border-sky-300/80 bg-sky-50/75 px-3 py-2 text-xs font-semibold text-sky-900 transition-colors hover:border-sky-400 hover:bg-sky-100/80 dark:border-sky-700/60 dark:bg-sky-950/30 dark:text-sky-200 dark:hover:bg-sky-900/40 cursor-pointer"
        >
          <FolderSearch className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          <span className="flex-1 text-left">Read installed mods</span>
          <ChevronRight className="h-3 w-3 opacity-50" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onExportZip}
          className="flex w-full items-center gap-2 rounded-lg bg-forge-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-forge-700 dark:bg-forge-500 dark:hover:bg-forge-400 cursor-pointer"
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

interface MobileBarProps {
  project: WeaponProject;
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
  activeSubTab?: RecordTabId;
  setActiveSubTab?: (tab: RecordTabId) => void;
  onImportWep: () => void;
  onBrowseMods: () => void;
  onExportZip: () => void;
  isDark: boolean;
  setIsDark: (dark: boolean) => void;
}

export const MobileBar: React.FC<MobileBarProps> = ({
  project,
  activeTab,
  setActiveTab,
  onImportWep,
  onBrowseMods,
  onExportZip,
  isDark,
  setIsDark,
}) => (
  <div className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur dark:border-stone-800 dark:bg-stone-900/95 lg:hidden">
    <div className="flex items-center gap-2.5 px-4 py-2">
      <img src={assetUrl('assets/wormforge-logo.png')} alt="WormForge" width={327} height={57} className="h-5 w-auto shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-stone-900 dark:text-stone-100">{project.name}</div>
        <div className="truncate font-mono text-[10px] text-stone-400">{project.id}</div>
      </div>
      <button
        type="button"
        onClick={onImportWep}
        className="rounded-md border border-amber-300/80 bg-amber-50/75 p-1.5 text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-300"
        aria-label="Import .wep"
        title="Import .wep"
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onBrowseMods}
        className="rounded-md border border-sky-300/80 bg-sky-50/75 p-1.5 text-sky-700 dark:border-sky-700/60 dark:bg-sky-950/30 dark:text-sky-300"
        aria-label="Read installed mods"
        title="Read installed mods"
      >
        <FolderSearch className="h-4 w-4" aria-hidden="true" />
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
    <div className="grid grid-cols-4 gap-1 px-3 pb-2">
      {WORKSPACE.map(({ id, icon: Icon }) => {
        const short =
          id === 'editor'
            ? 'Record'
            : id === 'hold'
              ? 'Hold'
              : id === 'effects'
                ? 'Effects'
                : 'Bundle';
        return (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`flex items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[11px] font-medium ${
              activeTab === id
                ? 'bg-forge-50 text-forge-800 dark:bg-forge-950/40 dark:text-forge-200'
                : 'text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800/60'
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{short}</span>
          </button>
        );
      })}
    </div>
  </div>
);
