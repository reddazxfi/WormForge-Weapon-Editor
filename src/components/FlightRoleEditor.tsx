import React, { useId, useRef } from 'react';
import {
  CheckCircle2,
  Image as ImageIcon,
  Layers,
  ShieldOff,
  Trash2,
  Upload,
} from 'lucide-react';
import type { FlightRoleArt, MissileAnimType } from '../types/weapon';

const ANIM_OPTIONS: { id: MissileAnimType; label: string }[] = [
  { id: 'track', label: 'Track trajectory' },
  { id: 'rotation', label: 'Speed rotation' },
  { id: 'slow', label: 'Slow spin' },
  { id: 'medium', label: 'Medium spin' },
  { id: 'fast', label: 'Fast spin' },
  { id: 'none', label: 'Fixed upright' },
];

interface FlightRoleEditorProps {
  role: FlightRoleArt;
  onChange: (patch: Partial<FlightRoleArt>) => void;
  title: string;
  description: string;
  /** Bundle path the sheet is written to, e.g. `sprites/<mod>/bit_flight.png`. */
  path: string;
  /** The `sig` ids the state matches (behaviour states only). */
  sig?: number[];
  /** Text for the third mode; differs between bits and behaviour states. */
  inheritLabel?: string;
  /** Everything is ignored until the primary flight builder is on. */
  disabled?: boolean;
  warning?: string;
}

/**
 * One WFWS builder role: native (WA draws it), builder (our sheet) or inherit
 * (the identity art already in force). Used for cluster bits and the
 * per-behaviour states; the primary round keeps the larger editor above it.
 */
export const FlightRoleEditor: React.FC<FlightRoleEditorProps> = ({
  role,
  onChange,
  title,
  description,
  path,
  sig,
  inheritLabel = 'Inherit',
  disabled = false,
  warning,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uid = useId();

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (role.sheetPreview) URL.revokeObjectURL(role.sheetPreview);
    onChange({
      sheetFile: file,
      sheetPreview: URL.createObjectURL(file),
      mode: 'builder',
    });
  };

  const removeSheet = () => {
    if (role.sheetPreview) URL.revokeObjectURL(role.sheetPreview);
    onChange({ sheetFile: undefined, sheetPreview: undefined, mode: 'native' });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const modes: { id: FlightRoleArt['mode']; label: string; hint: string }[] = [
    { id: 'native', label: 'Native', hint: "WA's own sprite" },
    { id: 'builder', label: 'Builder', hint: 'Our sheet' },
    { id: 'inherit', label: inheritLabel, hint: 'Same art as the parent' },
  ];

  return (
    <div
      className={`p-4 rounded-xl border space-y-3 transition-colors ${
        disabled
          ? 'border-stone-200 dark:border-stone-800 bg-stone-100/60 dark:bg-stone-900/40 opacity-60'
          : 'border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-forge-600 dark:text-forge-400 shrink-0" />
            <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
              {title}
            </span>
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">{description}</p>
        </div>
        {sig && sig.length > 0 && (
          <span
            className="font-mono text-[10px] px-2 py-0.5 rounded bg-forge-50 dark:bg-forge-950/60 text-forge-700 dark:text-forge-300 border border-forge-200 dark:border-forge-900/60 shrink-0"
            title="The record sprite id(s) this state matches (m.sprite signal)."
          >
            sig {sig.join(', ')}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {modes.map((mode) => {
          const active = role.mode === mode.id;
          const disabledMode = disabled;
          return (
            <button
              key={mode.id}
              type="button"
              disabled={disabledMode}
              onClick={() => onChange({ mode: mode.id })}
              className={`p-2 rounded-lg border text-left transition-all ${
                active
                  ? 'border-forge-500 bg-forge-50/40 dark:bg-forge-950/30 ring-1 ring-forge-500'
                  : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 hover:border-stone-300 dark:hover:border-stone-600'
              } ${disabledMode ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <div className="flex items-center justify-between gap-1">
                <span
                  className={`text-[11px] font-bold ${
                    active
                      ? 'text-forge-700 dark:text-forge-300'
                      : 'text-stone-800 dark:text-stone-200'
                  }`}
                >
                  {mode.label}
                </span>
                {active && <CheckCircle2 className="w-3 h-3 text-forge-600 dark:text-forge-400" />}
              </div>
              <div className="text-[10px] text-stone-500 leading-tight">{mode.hint}</div>
            </button>
          );
        })}
      </div>

      {role.mode === 'builder' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              id={`${uid}-file`}
              type="file"
              accept="image/png,image/gif"
              onChange={handleUpload}
              className="hidden"
              disabled={disabled}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 text-xs font-semibold bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-700 shadow-2xs transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5 text-forge-600 dark:text-forge-400" />
              <span>{role.sheetFile ? 'Change sheet' : 'Upload sheet'}</span>
            </button>
            {role.sheetFile && (
              <button
                type="button"
                disabled={disabled}
                onClick={removeSheet}
                className="text-[11px] text-rose-500 hover:text-rose-600 font-medium flex items-center gap-1 disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
                <span>Remove</span>
              </button>
            )}
            <div className="flex items-center gap-2 min-w-0 text-[11px] text-stone-500 dark:text-stone-400">
              <div className="w-8 h-8 rounded border border-stone-300 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 flex items-center justify-center overflow-hidden shrink-0">
                {role.sheetPreview ? (
                  <img src={role.sheetPreview} alt="" className="w-7 h-7 object-contain image-rendering-pixelated" />
                ) : (
                  <ImageIcon className="w-3.5 h-3.5 text-stone-400" aria-hidden="true" />
                )}
              </div>
              <span className="font-mono text-forge-600 dark:text-forge-400 truncate" title={path}>
                {path}
              </span>
              {!role.sheetFile && <span className="text-stone-400">(default art)</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label
                htmlFor={`${uid}-anim`}
                className="text-[11px] font-medium text-stone-600 dark:text-stone-400"
              >
                Animation
              </label>
              <select
                id={`${uid}-anim`}
                value={role.anim}
                disabled={disabled}
                onChange={(e) => onChange({ anim: e.target.value as MissileAnimType })}
                className="w-full text-xs px-2 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white disabled:opacity-50"
              >
                {ANIM_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {(
              [
                { key: 'frames' as const, label: 'Frames', min: 1, max: 64, step: 1 },
                { key: 'fps' as const, label: 'FPS', min: 1, max: 50, step: 1 },
                { key: 'animSpeed' as const, label: 'Anim speed', min: 0.1, max: 10, step: 0.1 },
                { key: 'spinRate' as const, label: 'Spin rate', min: 0.1, max: 5, step: 0.1 },
                { key: 'scale' as const, label: 'Scale', min: 0.2, max: 3, step: 0.1 },
                { key: 'z' as const, label: 'Depth (z)', min: 0, max: 20, step: 0.5 },
              ] as const
            ).map((field) => (
              <div key={field.key} className="space-y-1">
                <label
                  htmlFor={`${uid}-${field.key}`}
                  className="text-[11px] font-medium text-stone-600 dark:text-stone-400"
                >
                  {field.label}
                </label>
                <input
                  id={`${uid}-${field.key}`}
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={role[field.key]}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange({
                      [field.key]: Math.min(
                        field.max,
                        Math.max(field.min, Number(e.target.value) || field.min)
                      ),
                    })
                  }
                  className="w-full text-xs font-mono px-2 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white disabled:opacity-50"
                />
              </div>
            ))}
            <label className="flex items-start gap-2 p-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 cursor-pointer">
              <input
                type="checkbox"
                checked={role.mirror !== false}
                disabled={disabled}
                onChange={(e) => onChange({ mirror: e.target.checked })}
                className="rounded text-forge-600 focus:ring-forge-500 mt-0.5"
              />
              <div>
                <div className="text-[11px] font-semibold text-stone-800 dark:text-stone-200">
                  Mirror when moving left
                </div>
                <div className="text-[10px] text-stone-500">Flips on <code className="font-mono">vx &lt; 0</code>.</div>
              </div>
            </label>
          </div>
        </>
      )}

      {role.mode === 'inherit' && (
        <p className="text-[11px] text-stone-500 dark:text-stone-400 flex items-center gap-1.5">
          <ShieldOff className="w-3.5 h-3.5" />
          No extra keys emitted; this role keeps the identity art.
        </p>
      )}

      {warning && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg px-2.5 py-1.5">
          {warning}
        </p>
      )}
    </div>
  );
};
