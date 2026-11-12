import React, { useState, useEffect } from 'react';
import { WeaponProject } from './types/weapon';
import { Sidebar, MobileBar } from './components/Sidebar';
import { WeaponSettings } from './components/WeaponSettings';
import { RecordEditor } from './components/RecordEditor';
import { HoldPreview } from './components/HoldPreview';
import { EffectsWorkspace } from './components/EffectsWorkspace';
import { WepImportModal } from './components/WepImportModal';
import { ModBrowserModal } from './components/ModBrowserModal';
import { LuaPreviewModal } from './components/LuaPreviewModal';
import { BundleDependencies } from './components/BundleDependencies';
import { exportModZip, downloadBlob } from './utils/modExporter';
import { sanitizeModFolder } from './utils/luaGenerator';
import { DEFAULT_EXPLOSION_EFFECT } from './data/explosionPresets';
import { DEFAULT_CUSTOM_SOUNDS } from './data/soundPresets';
import { DEFAULT_ROLE_ART } from './data/spriteBuilder';
import type { RecordTabId } from './data/recordTabs';
import { CheckCircle2 } from 'lucide-react';

const INITIAL_PROJECT: WeaponProject = {
  id: 'wfws.moon_grenade',
  name: 'Moon Grenade',
  description: "WA's Grenade with about a third of gravity and small burst, which digs three craters in the ground.",
  version: '0.1.0',
  author: 'WormForge Author',
  slot: 'grenade',
  based_on: 'grenade',
  fireType: 'power',
  specialSubtype: 1,
  teleport: false,
  panel_icon: 'grenade',
  defaults: {
    ammo: 3,
    delay: 0,
    crateChance: 15,
    crateType: 'weapon',
    afterUse: 'retreat',
  },
  body: {
    sprite: 'grenade',
    damage: 20,
    gravity_pct: 35,
    wind_pct: 100,
    bounce_pct: 15,
    fuse: true,
    fuse_time_ms: 3000,
    countdown_ms: 3000,
    homing: 'off',
    // WA's own homing records use arm 0-1500 ms and time 2000-5000; 0/0 is what
    // a project used to carry by accident (the fields displayed 1000/8000
    // regardless), and a zero duration means no guidance at all.
    homing_arm_ms: 1000,
    homing_time_ms: 8000,
    cluster: true,
    custom_cluster: false,
    custom_site: 'explode',
    proximity: 25,
    arm_delay_ms: 3000,
    trigger_delay_ms: 2000,
    detect_mask: 0,
    clustlet: {
      sprite: 'clustlet',
      sprite_count: 1,
      count: 3,
      angle: 0,
      spread: 60,
      power: 20,
      power_variation: 0,
      damage: 15,
      trail: 'smklt25',
      contact: 'bounce',
      bounce_explode: true,
      bounce_power: 15,
      bounces: 0,
      fuse: 2500,
      proximity: 0,
      homing: 'off',
      homing_arm_ms: 1000,
      homing_time_ms: 8000,
      gravity_pct: 40,
      wind_pct: 100,
      bounciness: 25,
    },
  },
  action: 'bounce',
  burst: 'nothing',
  missileSprite: {
    enabled: false,
    mode: 'stock',
    stockSprite: 'grenade',
    sheet: '',
    anim: 'rotation',
    frames: 1,
    fps: 15,
    animSpeed: 1.0,
    spinRate: 1.0,
    scale: 1.0,
    mirror: true,
    z: 5.0,
    animate: false,
    spin: true,
    hideStock: true,
  },
  bitFlight: { ...DEFAULT_ROLE_ART },
  behaviorArt: {},
  roamConfig: {
    walk_speed: 2,
    step_height: 4,
    terrain_offset: -10,
    edge_jump_angle_deg: 0,
    edge_jump_speed: 0,
    edge_jump_sound: 0,
    jump_angle_deg: 25,
    jump_speed: 6,
    jump_sound: 50,
    gas_start_delay_ms: 0,
    gas_poison_power: 0,
    gas_animal_sprite: 0,
    flight_1: 0,
    flight_2: 0,
    hits: { land: true, worms: true, mines: true, crates: true, water: true },
    flight_hits: { land: true, worms: true, mines: true, crates: true, water: true },
  },
  roamSheets: { flight1: {}, flight2: {} },
  digConfig: {
    sound: 90,
    dive_sprite: 0,
    sprite_1: 0,
    sprite_2: 0,
    sprite_3: 0,
  },
  fireConfig: {
    spread_delay_ms: 30,
    burn_time_ms: 1500,
    spread_generations: 10,
    decay_mode: 'resting',
  },
  ribbonTrail: {
    enabled: false,
    max: 12,
    every: 2,
    vanish: 2,
    coreWidth: 8,
    glowWidth: 13,
    color: '#ffffff',
    target: 'main',
  },
  explosionEffect: { ...DEFAULT_EXPLOSION_EFFECT },
  customSounds: { ...DEFAULT_CUSTOM_SOUNDS },
  extraDependencies: [],
  hold: {
    enabled: true,
    sheet: '',
    handType: 'mid',
    handRadius: 10,
    // PX holds are authored right-facing: at level aim a negative radius puts
    // the weapon on the forward side. Positive radii are the rear-hand side.
    weapRadius: 6,
    weapRotation: 0,
    scale: 1,
    handScale: 1,
    frames: 1,
    fps: 15,
    animate: false,
    drawHand: true,
    keepWhileFiring: false,
    thrown: true,
    putAway: false,
    handRad: 10,
    handRadLower: 0,
    handRadUpper: 0,
  },
  packArt: {},
  customSprites: {},
  recordOverrides: {
    'missile.explosion.push_pct': 80,
    'missile.explode_on_space': false,
  },
  enableCustomLua: false,
  useWepFile: false,
  customLuaSnippet: `on_explode = function(ev)
  -- Excavate three craters in the ground below burst
  for i = 0, 2 do
    local angle = math.rad(20 + 60 * i + wa.random(0, 20))
    local distance = wa.random(60, 85)
    wa.land.cut{
      x = ev.x + distance * wa.math.cos(angle),
      y = ev.y + distance * wa.math.sin(angle),
      shape = "circle",
      radius = wa.random(12, 18),
    }
  end
  wa.log("craters cut below burst")
end,`,
};

export default function App() {
  const [project, setProject] = useState<WeaponProject>(INITIAL_PROJECT);
  const [activeTab, setActiveTab] = useState<'editor' | 'hold' | 'effects' | 'code'>('editor');
  const [activeSubTab, setActiveSubTab] = useState<RecordTabId>('missile');
  const [isWepModalOpen, setIsWepModalOpen] = useState(false);
  const [isModBrowserOpen, setIsModBrowserOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Light is the default: it reads like the game's own 1998 UI and keeps the
  // pixel-art previews on a neutral, uncoloured backdrop.
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('wf_theme_v2');
      if (stored) return stored === 'dark';
    }
    return false;
  });

  useEffect(() => {
    const root = document.documentElement;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (isDark) {
      root.classList.add('dark');
      localStorage.setItem('wf_theme_v2', 'dark');
      themeColor?.setAttribute('content', '#0c0a09');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('wf_theme_v2', 'light');
      themeColor?.setAttribute('content', '#f5f5f4');
    }
  }, [isDark]);

  // Keyboard navigation hotkeys (1: Record, 2: Hold, 3: Effects, 4: Code)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === '1') setActiveTab('editor');
      else if (e.key === '2') setActiveTab('hold');
      else if (e.key === '3') setActiveTab('effects');
      else if (e.key === '4') setActiveTab('code');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const updateProject = (patch: Partial<WeaponProject>) => {
    setProject((prev) => ({ ...prev, ...patch }));
  };

  const handleApplyWepImport = (parsed: Partial<WeaponProject>) => {
    setProject((prev) => {
      const body: WeaponProject['body'] = {
        ...prev.body,
        ...(parsed.body || {}),
        clustlet: {
          ...prev.body.clustlet,
          ...(parsed.body?.clustlet || {}),
        },
      };
      const defaults: WeaponProject['defaults'] = {
        ...prev.defaults,
        ...(parsed.defaults || {}),
      };
      // Importing a different weapon must not keep the previous weapon's
      // record edits or callbacks. Those stale fields were a large part of why
      // importing a .wep could "break" the weapon: old overrides were merged
      // on top of the new record. Presets supply their own overrides.
      const recordOverrides = { ...(parsed.recordOverrides || {}) };
      const action = parsed.action ?? prev.action;
      const burst = parsed.burst ?? prev.burst;
      const missileSprite = parsed.missileSprite ?? prev.missileSprite;
      const roamConfig = parsed.roamConfig ?? prev.roamConfig;
      const digConfig = parsed.digConfig ?? prev.digConfig;
      const fireConfig = parsed.fireConfig ?? prev.fireConfig;
      const specialSubtype = parsed.specialSubtype ?? prev.specialSubtype;
      const useWepFile = !!parsed.useWepFile && !!parsed.wepFile;

      return {
        ...prev,
        ...parsed,
        body,
        defaults,
        recordOverrides,
        action,
        burst,
        missileSprite,
        roamConfig,
        digConfig,
        fireConfig,
        specialSubtype,
        enableCustomLua: parsed.enableCustomLua ?? false,
        customLuaSnippet: parsed.customLuaSnippet ?? '',
        useWepFile,
        // Keep the file even when the user applies the decoded record, so the
        // settings toggle can switch back to `wep` without re-importing.
        wepFile: parsed.wepFile,
        wepFileName: parsed.wepFileName,
        // The decoded model at import time. Fields that still match it are
        // inherited from the .wep; only edits become named overrides. A bundle
        // import supplies its own baseline (the decoded `.wep` *before* the
        // module's declared tables), so those edits are what gets written.
        wepBaseline: parsed.wepBaseline ?? (useWepFile
          ? {
              body: { ...body, clustlet: { ...body.clustlet } },
              action,
              burst,
              recordOverrides: { ...recordOverrides },
              missileSprite: { ...missileSprite },
              roamConfig: { ...roamConfig },
              digConfig: { ...digConfig },
              fireConfig: { ...fireConfig },
              specialSubtype,
            }
          : undefined),
      };
    });
    showToast(
      parsed.useWepFile && parsed.wepFile
        ? `Imported ${parsed.wepFileName || parsed.wepFile.name}; the bundle will use that .wep record.`
        : `Imported ${parsed.name || 'weapon'} record into project.`
    );
  };

  const handleExportZip = async () => {
    setIsExporting(true);
    try {
      const blob = await exportModZip(project);
      const modFolder = sanitizeModFolder(project.id);
      downloadBlob(blob, `${modFolder}.zip`);
      showToast(`Exported ${modFolder}.zip with mod.toml & profile.`);
    } catch (err: any) {
      alert(`Export failed: ${err.message || String(err)}`);
    } finally {
      setIsExporting(false);
    }
  };

  const copyId = () => {
    navigator.clipboard.writeText(project.id);
    showToast(`Copied ${project.id} to clipboard.`);
  };

  const pageMeta = {
    editor: {
      eyebrow: 'Weapon Record',
      title: 'Shape the weapon',
      description: 'Type, donor slot, flight physics, payload and collision behaviour.',
    },
    hold: {
      eyebrow: 'Hold & Sprite Builder',
      title: 'Aim and flight art',
      description: 'Check the worm hold at every aim angle and the 50 Hz missile animation.',
    },
    effects: {
      eyebrow: 'Effects & Libraries',
      title: 'Advanced libraries',
      description: 'Ribbon trail, explosion burst, custom sounds and sequential fire.',
    },
    code: {
      eyebrow: 'Bundle Code',
      title: 'Review the bundle',
      description: 'Generated Lua, mod.toml and profile, ready to drop into WormForge/Mods.',
    },
  }[activeTab];

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-forge-600 focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      <Sidebar
        project={project}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        activeSubTab={activeSubTab}
        setActiveSubTab={setActiveSubTab}
        onImportWep={() => setIsWepModalOpen(true)}
        onBrowseMods={() => setIsModBrowserOpen(true)}
        onExportZip={handleExportZip}
        isDark={isDark}
        setIsDark={setIsDark}
        onCopyId={copyId}
      />

      <div className="flex min-h-screen flex-col lg:pl-72">
        <MobileBar
          project={project}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          activeSubTab={activeSubTab}
          setActiveSubTab={setActiveSubTab}
          onImportWep={() => setIsWepModalOpen(true)}
          onBrowseMods={() => setIsModBrowserOpen(true)}
          onExportZip={handleExportZip}
          isDark={isDark}
          setIsDark={setIsDark}
        />

        <main
          id="main"
          className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-forge-600 dark:text-forge-400">
                {pageMeta.eyebrow}
              </div>
              <h1 className="mt-1 font-heading text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
                {pageMeta.title}
              </h1>
              <p className="mt-1 max-w-2xl text-xs text-stone-500 dark:text-stone-400">
                {pageMeta.description}
              </p>
            </div>
          </header>

          {activeTab === 'editor' && (
            <div className="space-y-6">
              <WeaponSettings project={project} onChange={updateProject} />
              <RecordEditor project={project} onChange={updateProject} activeSubTab={activeSubTab} />
            </div>
          )}

          {activeTab === 'hold' && (
            <div className="space-y-6">
              <HoldPreview project={project} onChange={updateProject} />
            </div>
          )}

          {activeTab === 'effects' && (
            <EffectsWorkspace project={project} onChange={updateProject} />
          )}

          {activeTab === 'code' && (
            <div className="space-y-6">
              <BundleDependencies project={project} onChange={updateProject} />
              <div className="h-[750px]">
                <LuaPreviewModal project={project} inline />
              </div>
            </div>
          )}
        </main>

        <footer className="border-t border-stone-200/80 bg-white/60 py-4 dark:border-stone-800 dark:bg-stone-900/40">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 text-[11px] text-stone-500 sm:px-6 lg:px-8 dark:text-stone-400">
            <span>WormForge Weapon Studio</span>
            <span className="font-mono">
              WormForge/Mods/{sanitizeModFolder(project.id)}/
            </span>
          </div>
        </footer>
      </div>

      {isModBrowserOpen && (
        <ModBrowserModal
          onClose={() => setIsModBrowserOpen(false)}
          showToast={showToast}
          onImport={handleApplyWepImport}
        />
      )}

      <WepImportModal
        isOpen={isWepModalOpen}
        onClose={() => setIsWepModalOpen(false)}
        onApply={handleApplyWepImport}
      />

      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200 dark:bg-stone-100 dark:text-stone-900"
        >
          <CheckCircle2 className="h-4 w-4 text-forge-400 dark:text-forge-600" aria-hidden="true" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
