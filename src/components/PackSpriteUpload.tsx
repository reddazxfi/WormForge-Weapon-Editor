import React, { useRef, useState } from 'react';
import { HelpCircle, Image as ImageIcon, Loader2, RotateCw, Trash2, Upload } from 'lucide-react';
import { PackArtAsset, PackArtSlot, WeaponProject } from '../types/weapon';
import { packArtPath } from '../utils/luaGenerator';
import { buildRotationSheet } from '../utils/rotateSheet';

interface PackSpriteUploadProps {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
  slot: PackArtSlot;
  /** Human-readable card title. */
  label: string;
  /** The record field this sheet ends up in, shown in hover tooltip. */
  code?: string;
  hint: string;
  /** Extra record edits applied when art is uploaded (e.g. turn the trail on). */
  onUpload?: () => void;
  /**
   * Offer "rotate the single frame into a direction sheet". Only for slots WA
   * draws itself as a native missile body: the sprite builder has its own
   * ANIM_TYPE and does not need baked frames.
   */
  rotate?: {
    /** Record edits that pair with a rotation sheet (the native anim type). */
    onRotate: (frames: number) => void;
  };
  /** Shown when another feature makes this slot's art redundant. */
  warning?: string;
}

const DEFAULT_ASSET: PackArtAsset = { frames: 1, fps: 15, play: 'loop' };

/**
 * Upload for the record sprite fields the engine also accepts a pack image in
 * (`sprite`, `missile.trail.sprite`, `clusters.bit.trail.sprite`,
 * `cluster.sprite`, `cluster.homing_sprite`). The PNG/GIF is written into the
 * exported bundle at `sprites/<mod folder>/...`; see `packArtPath` in
 * `luaGenerator.ts`.
 */
export const PackSpriteUpload: React.FC<PackSpriteUploadProps> = ({
  project,
  onChange,
  slot,
  label,
  code,
  hint,
  onUpload,
  rotate,
  warning,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const asset = project.packArt?.[slot];
  const isGif = !!asset?.fileName?.toLowerCase().endsWith('.gif');
  const path = packArtPath(project, slot);
  const headerTooltip = [hint, code ? `Field: ${code}` : undefined].filter(Boolean).join('\n') || undefined;
  const frameId = `pack-art-${slot}-frames`;
  const fpsId = `pack-art-${slot}-fps`;
  const rotateId = `pack-art-${slot}-rotate`;
  const [rotateFrames, setRotateFrames] = useState(asset?.rotationFrames || 32);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);

  const updateAsset = (patch: Partial<PackArtAsset>) => {
    const next = { ...(asset || DEFAULT_ASSET), ...patch };
    onChange({ packArt: { ...(project.packArt || {}), [slot]: next } });
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (asset?.previewUrl) URL.revokeObjectURL(asset.previewUrl);
    // A GIF carries its own frame timing, so it cannot be sliced by `frames`.
    updateAsset({
      file,
      fileName: file.name,
      previewUrl: URL.createObjectURL(file),
      // Kept for the rotation sheet, which is built from the single frame.
      sourceFile: file,
      sourceName: file.name,
      rotationFrames: undefined,
      frames: 1,
    });
    setRotateError(null);
    onUpload?.();
  };

  const makeRotationSheet = async () => {
    const source = asset?.sourceFile || asset?.file;
    if (!source || !rotate) return;
    setRotating(true);
    setRotateError(null);
    try {
      const sheet = await buildRotationSheet(source, rotateFrames);
      if (asset?.previewUrl) URL.revokeObjectURL(asset.previewUrl);
      updateAsset({
        file: sheet.file,
        fileName: sheet.file.name,
        previewUrl: sheet.previewUrl,
        frames: sheet.frames,
        rotationFrames: sheet.frames,
      });
      // `animation = 2` on the record: the frame follows the flight direction.
      rotate.onRotate(sheet.frames);
    } catch (err: any) {
      setRotateError(err?.message || String(err));
    } finally {
      setRotating(false);
    }
  };

  const restoreOriginal = () => {
    const source = asset?.sourceFile;
    if (!source) return;
    if (asset?.previewUrl) URL.revokeObjectURL(asset.previewUrl);
    updateAsset({
      file: source,
      fileName: asset?.sourceName || source.name,
      previewUrl: URL.createObjectURL(source),
      frames: 1,
      rotationFrames: undefined,
    });
    setRotateError(null);
  };

  const removeArt = () => {
    if (asset?.previewUrl) URL.revokeObjectURL(asset.previewUrl);
    const next = { ...(project.packArt || {}) };
    delete next[slot];
    onChange({ packArt: next });
    setRotateError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="p-2.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="text-xs font-semibold text-stone-800 dark:text-stone-200 truncate" title={headerTooltip}>
            {label}
          </div>
          {headerTooltip && (
            <span
              className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-help shrink-0 transition-colors"
              title={headerTooltip}
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </span>
          )}
        </div>
        {asset && (
          <button
            type="button"
            onClick={removeArt}
            className="flex items-center gap-1 text-[11px] text-rose-500 hover:text-rose-600 font-medium shrink-0"
            title="Remove this pack image and go back to the stock sprite"
          >
            <Trash2 className="w-3 h-3" />
            <span>Use stock</span>
          </button>
        )}
      </div>

      {warning && (
        <p className="text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-md px-2 py-1.5">
          {warning}
        </p>
      )}

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded border border-stone-300 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 flex items-center justify-center overflow-hidden shrink-0">
          {asset?.previewUrl ? (
            <img
              src={asset.previewUrl}
              alt=""
              className={`w-8 h-8 image-rendering-pixelated ${
                asset.frames > 1 ? 'object-cover object-top' : 'object-contain'
              }`}
            />
          ) : (
            <ImageIcon className="w-4 h-4 text-stone-400" aria-hidden="true" />
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/gif"
          onChange={handleUpload}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="px-3 py-1.5 text-xs font-medium bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 border border-stone-300 dark:border-stone-700 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5 text-forge-600 dark:text-forge-400" />
          <span>{asset ? 'Change PNG' : 'Upload PNG'}</span>
        </button>

        <div className="text-[11px] text-stone-500 dark:text-stone-400 min-w-0">
          {asset?.fileName && path ? (
            <>
              <span className="font-mono text-forge-600 dark:text-forge-400 font-medium">
                {path}
              </span>
              {asset.file && (
                <span className="text-stone-400"> ({(asset.file.size / 1024).toFixed(1)} KB)</span>
              )}
            </>
            ) : (
            <span>Upload a PNG or GIF to replace stock art.</span>
          )}
        </div>
      </div>

      {asset && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-1">
              <label
                htmlFor={frameId}
                className="text-[11px] font-medium text-stone-700 dark:text-stone-300 cursor-pointer"
                title={
                  isGif
                    ? 'GIF files use their built-in frame timing.'
                    : 'Number of vertical frames in the PNG sheet (1 = still image).'
                }
              >
                Frames
              </label>
              <span
                className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-help shrink-0"
                title={
                  isGif
                    ? 'GIF files use their built-in frame timing.'
                    : 'Number of vertical frames in the PNG sheet (1 = still image).'
                }
              >
                <HelpCircle className="w-3 h-3" />
              </span>
            </div>
            <input
              id={frameId}
              type="number"
              min={1}
              max={64}
              value={asset.frames}
              disabled={isGif}
              onChange={(e) => updateAsset({ frames: Math.max(1, Number(e.target.value) || 1) })}
              className="w-full text-xs font-mono px-2 py-1 rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white disabled:opacity-50"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-1">
              <label
                htmlFor={fpsId}
                className="text-[11px] font-medium text-stone-700 dark:text-stone-300 cursor-pointer"
                title="Playback rate written to mod.toml."
              >
                FPS
              </label>
              <span
                className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-help shrink-0"
                title="Playback rate written to mod.toml."
              >
                <HelpCircle className="w-3 h-3" />
              </span>
            </div>
            <input
              id={fpsId}
              type="number"
              min={1}
              max={50}
              value={asset.fps}
              onChange={(e) =>
                updateAsset({ fps: Math.min(50, Math.max(1, Number(e.target.value) || 15)) })
              }
              className="w-full text-xs font-mono px-2 py-1 rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
            />
          </div>
        </div>
      )}

      {rotate && asset && !isGif && (
        <div className="pt-2 border-t border-stone-200 dark:border-stone-700/70 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <label
                htmlFor={rotateId}
                className="text-[11px] font-medium text-stone-700 dark:text-stone-300 cursor-pointer"
                title={`Bakes a 360° directional strip of ${rotateFrames} frames (frame 0 pointing up, rotating clockwise) and sets animation mode to follow flight direction.`}
              >
                Rotation sheet
              </label>
              <span
                className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-help shrink-0"
                title={`Bakes a 360° directional strip of ${rotateFrames} frames (frame 0 pointing up, rotating clockwise) and sets animation mode to follow flight direction.`}
              >
                <HelpCircle className="w-3 h-3" />
              </span>
            </div>
            <select
              id={rotateId}
              value={rotateFrames}
              onChange={(e) => setRotateFrames(Number(e.target.value))}
              className="text-[11px] px-2 py-1 rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
            >
              <option value={16}>16 frames</option>
              <option value={32}>32 frames</option>
              <option value={64}>64 frames</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={makeRotationSheet}
              disabled={rotating}
              title={`Bake ${rotateFrames} directional frames from this image`}
              className="px-3 py-1 text-xs font-medium bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 border border-stone-300 dark:border-stone-700 rounded-md transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {rotating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RotateCw className="w-3.5 h-3.5 text-forge-600 dark:text-forge-400" />
              )}
              <span>{asset.rotationFrames ? 'Rebuild sheet' : 'Rotate into sheet'}</span>
            </button>
            {asset.rotationFrames && (
              <button
                type="button"
                onClick={restoreOriginal}
                className="text-[11px] text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200 font-medium underline"
              >
                Use original frame
              </button>
            )}
          </div>

          {rotateError && <p className="text-[10px] text-rose-500">{rotateError}</p>}
        </div>
      )}
    </div>
  );
};
