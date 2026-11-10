import React, { useState, useRef } from 'react';
import { parseWepBinary, WepParseResult } from '../utils/wepParser';
import { sanitizeWepFileName } from '../utils/luaGenerator';
import { WeaponProject } from '../types/weapon';
import { Upload, FileCode2, Check, AlertCircle, X, Sparkles, ArrowRight } from 'lucide-react';

interface WepImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (parsedState: Partial<WeaponProject>) => void;
}

export const WepImportModal: React.FC<WepImportModalProps> = ({ isOpen, onClose, onApply }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parseResult, setParseResult] = useState<WepParseResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  // Default to the file itself: it preserves every native field. Unchecking
  // falls back to the decoded donor + named overrides below.
  const [useWepFile, setUseWepFile] = useState(true);

  if (!isOpen) return null;

  const handleFile = async (file: File) => {
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const result = parseWepBinary(buffer, file.name);
      setParseResult({ ...result, wepFile: file, wepFileName: file.name });
      setUseWepFile(result.success);
    } catch (err: any) {
      setParseResult({
        success: false,
        name: '',
        fireType: 'power',
        inferredDonor: 'bazooka',
        rawOffsets: {},
        projectState: {},
        summary: [],
        error: `Failed to read file: ${err.message || String(err)}`,
      });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // Sample presets mimicking Project X .wep records
  const loadPreset = (presetName: string) => {
    let preset: Partial<WeaponProject> = {};
    if (presetName === 'chilli_bomb') {
      preset = {
        id: 'px.chilli_bomb',
        name: 'Chilli Bomb',
        description: 'Project X classic: Super Banana base bursting into five incendiary children.',
        slot: 'super_banana',
        based_on: 'super_banana',
        fireType: 'power',
        action: 'bounce',
        burst: 'clusters',
        enableCustomLua: true,
        missileSprite: {
          enabled: true,
          mode: 'custom',
          stockSprite: 'banana',
          sheet: 'sprites/chilli_bomb/chilli_bomb.png',
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
        defaults: { ammo: 2, delay: 0, crateChance: 10, crateType: 'super', afterUse: 'retreat' },
        body: {
          sprite: 'banana',
          damage: 50,
          gravity_pct: 100,
          wind_pct: 100,
          bounce_pct: 80,
          fuse: true,
          fuse_time_ms: 5000,
          countdown_ms: 5000,
          homing: 'off',
          homing_arm_ms: 0,
          homing_time_ms: 0,
          cluster: true,
          custom_cluster: false,
          custom_site: 'explode',
          proximity: 0,
          arm_delay_ms: 0,
          trigger_delay_ms: 0,
          detect_mask: 0,
          clustlet: {
            sprite: 'clustlet',
            sprite_count: 1,
            count: 5,
            angle: 0,
            spread: 45,
            power: 30,
            power_variation: 0,
            damage: 30,
            trail: 'smklt25',
            contact: 'bounce',
            bounce_explode: true,
            bounce_power: 30,
            bounces: 0,
            fuse: 8000,
            proximity: 0,
            homing: 'off',
            homing_arm_ms: 1000,
            homing_time_ms: 8000,
            gravity_pct: 100,
            wind_pct: 100,
            bounciness: 60,
          },
        },
        recordOverrides: {
          'missile.explode_on_space': true,
          'handling.retreat': 3000,
          'missile.explosion.push_pct': 75,
        },
      };
    } else if (presetName === 'girder_launcher') {
      preset = {
        id: 'px.girder_launcher',
        name: 'Girder Launcher',
        description: 'Specialists weapon: launches girders that stamp permanent terrain.',
        slot: 'bazooka',
        based_on: 'bazooka',
        fireType: 'power',
        action: 'bounce',
        burst: 'nothing',
        enableCustomLua: true,
        missileSprite: {
          enabled: true,
          mode: 'custom',
          stockSprite: 'bazooka',
          sheet: 'sprites/girder_launcher/mgirderspb.png',
          anim: 'fast',
          frames: 8,
          fps: 15,
          animSpeed: 3.0,
          spinRate: 1.0,
          scale: 1.0,
          mirror: false,
          z: 5.0,
          animate: true,
          spin: true,
          hideStock: true,
        },
        defaults: { ammo: 3, delay: 0, crateChance: 15, crateType: 'weapon', afterUse: 'continue' },
        body: {
          sprite: 'bazooka',
          damage: 0,
          gravity_pct: 0,
          wind_pct: 0,
          bounce_pct: 80,
          fuse: true,
          fuse_time_ms: 4200,
          countdown_ms: 4200,
          homing: 'off',
          homing_arm_ms: 0,
          homing_time_ms: 0,
          cluster: false,
          custom_cluster: false,
          custom_site: 'explode',
          proximity: 0,
          arm_delay_ms: 0,
          trigger_delay_ms: 0,
          detect_mask: 0,
          clustlet: {
            sprite: 'clustlet',
            sprite_count: 1,
            count: 1,
            angle: 0,
            spread: 0,
            power: 0,
            power_variation: 0,
            damage: 0,
            trail: '',
            contact: 'impact',
            bounce_explode: false,
            bounce_power: 0,
            bounces: 0,
            fuse: 0,
            proximity: 0,
            homing: 'off',
            homing_arm_ms: 1000,
            homing_time_ms: 8000,
            gravity_pct: 100,
            wind_pct: 100,
            bounciness: 0,
          },
        },
        recordOverrides: {
          'handling.shots': 4,
          'handling.ends_turn': false,
          'fires.launch_power_pct': 45,
          'missile.explosion.power': 0,
          'missile.explosion.push_pct': 0,
        },
      };
    } else if (presetName === 'moon_grenade') {
      preset = {
        id: 'guide.moon_grenade',
        name: 'Moon Grenade',
        description: "WormForge tutorial weapon: Grenade with low gravity and 3 crater excavation.",
        slot: 'grenade',
        based_on: 'grenade',
        fireType: 'power',
        action: 'bounce',
        burst: 'nothing',
        enableCustomLua: true,
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
          spin: false,
          hideStock: false,
        },
        defaults: { ammo: 3, delay: 0, crateChance: 20, crateType: 'weapon', afterUse: 'retreat' },
        body: {
          sprite: 'grenade',
          damage: 20,
          gravity_pct: 35,
          wind_pct: 100,
          bounce_pct: 0,
          fuse: true,
          fuse_time_ms: 3000,
          countdown_ms: 3000,
          homing: 'off',
          homing_arm_ms: 0,
          homing_time_ms: 0,
          cluster: false,
          custom_cluster: false,
          custom_site: 'explode',
          proximity: 0,
          arm_delay_ms: 0,
          trigger_delay_ms: 0,
          detect_mask: 0,
          clustlet: {
            sprite: 'clustlet',
            sprite_count: 1,
            count: 0,
            angle: 0,
            spread: 0,
            power: 0,
            power_variation: 0,
            damage: 0,
            trail: '',
            contact: 'impact',
            bounce_explode: false,
            bounce_power: 0,
            bounces: 0,
            fuse: 0,
            proximity: 0,
            homing: 'off',
            homing_arm_ms: 1000,
            homing_time_ms: 8000,
            gravity_pct: 100,
            wind_pct: 100,
            bounciness: 0,
          },
        },
        customLuaSnippet: `on_explode = function(ev)
  -- One crater down-right, one straight down, one down-left
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
    }

    setUseWepFile(false);
    onApply({
      ...preset,
      useWepFile: false,
      wepFile: undefined,
      wepFileName: undefined,
      wepBaseline: undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden transition-colors">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100 dark:border-stone-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-forge-50 dark:bg-forge-950/40 text-forge-600 dark:text-forge-400 rounded-lg">
              <FileCode2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-heading font-bold text-base text-stone-900 dark:text-stone-100">
                Import Project X (.wep) Binary
              </h3>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Reads the native 0x1D0 record slab and translates it into WormForge Lua.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-5">
          {/* Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-forge-500 bg-forge-50/50 dark:bg-forge-950/20'
                : 'border-stone-300 dark:border-stone-700 hover:border-forge-500 hover:bg-stone-50/50 dark:hover:bg-stone-800/40'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".wep"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              className="hidden"
            />
            <div className="w-12 h-12 rounded-full bg-forge-100 dark:bg-forge-900/40 text-forge-600 dark:text-forge-400 mx-auto flex items-center justify-center mb-3">
              <Upload className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-stone-800 dark:text-stone-200">
              Drag & drop a <span className="font-mono text-forge-600 dark:text-forge-400">.wep</span> file here, or click to browse
            </p>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
              Supports native Project X weapon records (from PX library or WormForge mods)
            </p>
          </div>

          {/* Quick Presets */}
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Or load a known PX / tutorial preset:</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => loadPreset('chilli_bomb')}
                className="p-2.5 text-xs text-left rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/40 hover:border-forge-500 transition-colors"
              >
                <div className="font-bold text-stone-800 dark:text-stone-200">Chilli Bomb</div>
                <div className="text-[10px] text-stone-400">Super Banana + 5 fire bits</div>
              </button>
              <button
                type="button"
                onClick={() => loadPreset('girder_launcher')}
                className="p-2.5 text-xs text-left rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/40 hover:border-forge-500 transition-colors"
              >
                <div className="font-bold text-stone-800 dark:text-stone-200">Girder Launcher</div>
                <div className="text-[10px] text-stone-400">4 shot terrain stamper</div>
              </button>
              <button
                type="button"
                onClick={() => loadPreset('moon_grenade')}
                className="p-2.5 text-xs text-left rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/40 hover:border-forge-500 transition-colors"
              >
                <div className="font-bold text-stone-800 dark:text-stone-200">Moon Grenade</div>
                <div className="text-[10px] text-stone-400">Starting guide tutorial</div>
              </button>
            </div>
          </div>

          {/* Parse Result Summary */}
          {parseResult && (
            <div className={`p-4 rounded-xl border text-xs ${
              parseResult.success
                ? 'bg-forge-50/60 dark:bg-forge-950/20 border-forge-300 dark:border-forge-800/60'
                : 'bg-rose-50 dark:bg-rose-950/20 border-rose-300 dark:border-rose-800/60'
            }`}>
              {parseResult.success ? (
                <div>
                  <div className="flex items-center gap-2 font-heading font-bold text-forge-900 dark:text-forge-200 mb-2">
                    <Check className="w-4 h-4 text-forge-600 dark:text-forge-400" />
                    <span>Successfully Decoded: {parseResult.name}</span>
                  </div>
                  <ul className="space-y-1 text-forge-800 dark:text-forge-300 font-mono text-[11px] list-disc list-inside">
                    {parseResult.summary.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="flex items-start gap-2 text-rose-800 dark:text-rose-300">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Decoding Error:</span>
                    <p className="mt-0.5">{parseResult.error}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {parseResult?.success && parseResult.wepFile && (
            <label className="flex items-start gap-3 p-3.5 rounded-xl border border-forge-300 dark:border-forge-800/60 bg-forge-50/40 dark:bg-forge-950/20 cursor-pointer">
              <input
                type="checkbox"
                checked={useWepFile}
                onChange={(e) => setUseWepFile(e.target.checked)}
                className="mt-0.5 rounded text-forge-600 focus:ring-forge-500"
              />
              <div className="space-y-1">
                <div className="text-xs font-bold text-forge-900 dark:text-forge-200">
                  Use .wep weapon file
                </div>
                <p className="text-[11px] leading-relaxed text-forge-800/80 dark:text-forge-300/80">
                  Emits{' '}
                  <code className="font-mono">
                    wep = "weps/{sanitizeWepFileName(parseResult.wepFileName || fileName)}"
                  </code>{' '}
                  and copies the original file into the bundle. Record fields you change in the
                  editor are applied as named overrides on top of it. Uncheck to rebuild the record
                  from the decoded values instead.
                </p>
              </div>
            </label>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-stone-50 dark:bg-stone-800/40 border-t border-stone-100 dark:border-stone-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!parseResult || !parseResult.success}
            onClick={() => {
              if (!parseResult?.success) return;
              const patch: Partial<WeaponProject> = { ...parseResult.projectState };
              if (parseResult.wepFile) {
                patch.useWepFile = useWepFile;
                patch.wepFile = parseResult.wepFile;
                patch.wepFileName = parseResult.wepFileName;
              } else {
                patch.useWepFile = false;
                patch.wepFile = undefined;
                patch.wepFileName = undefined;
              }
              patch.wepBaseline = undefined;
              onApply(patch);
              onClose();
            }}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-forge-600 hover:bg-forge-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition-all cursor-pointer"
          >
            <span>{useWepFile && parseResult?.wepFile ? 'Apply .wep Record' : 'Apply Decoded Record'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
