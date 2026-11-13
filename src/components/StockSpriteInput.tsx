import React from 'react';
import {
  STOCK_SPRITE_OPTIONS,
  decodeRecordId,
  resolveStockSprite,
  stockSpriteId,
  stockSpriteName,
} from '../data/stockSprites';

/**
 * A record sprite field's value: a WA stock name or an id, never free text.
 * The engine names the field in its install error because an unknown string is
 * read as a bundle path, so the picker resolves what was typed and says loudly
 * when it cannot.
 */
export const StockSpriteInput: React.FC<{
  id: string;
  label: string;
  desc?: string;
  /** Current value: a name, an id, or a number when `numeric`. */
  value: string | number;
  onChange: (value: string) => void;
  /** Offer the whole stock table; otherwise only `options`. */
  options?: ReadonlyArray<{ name: string; id: number; label: string }>;
  /** Emit an id (`"609"`) rather than the raw text. */
  numeric?: boolean;
  /** Shown when the field is empty, e.g. `0`. */
  placeholder?: string;
  disabled?: boolean;
}> = ({ id, label, desc, value, onChange, options, numeric, placeholder, disabled }) => {
  const raw = value === undefined || value === null ? '' : String(value);
  const decoded = decodeRecordId(Number(raw));
  const resolved = resolveStockSprite(raw === '' ? undefined : raw);
  const list = options ?? STOCK_SPRITE_OPTIONS;

  const handle = (text: string) => {
    if (!numeric) {
      onChange(text);
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      onChange('');
      return;
    }
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      onChange(String(decodeRecordId(asNumber).id));
      return;
    }
    const named = stockSpriteId(trimmed);
    onChange(named === undefined ? trimmed : String(named));
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        <label htmlFor={id} className="text-xs font-semibold text-stone-700 dark:text-stone-300 truncate" title={desc}>
          {label}
        </label>
      </div>
      <input
        id={id}
        type="text"
        list={`${id}-sprites`}
        value={raw}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => handle(e.target.value)}
        className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white disabled:opacity-50"
      />
      <datalist id={`${id}-sprites`}>
        {list.map((sprite) => (
          <option key={sprite.name} value={sprite.name}>
            {sprite.label}
          </option>
        ))}
      </datalist>
      {desc && <p className="text-[10px] text-stone-400">{desc}</p>}
      {decoded.flagged && (
        <p className="text-[10px] text-amber-700 dark:text-amber-300">
          0x{Number(raw).toString(16).toUpperCase()} is `0x10000 + id`: the file
          spells the 16.16 phase beside the id, so this is id {decoded.id}.
        </p>
      )}
      {raw !== '' && resolved === null ? (
        <p className="text-[10px] text-rose-600 dark:text-rose-400">
          Not a WA stock sprite: the engine would read &quot;{raw}&quot; as a
          bundle path and fail the install. Pick a name from the list or an id.
        </p>
      ) : (
        raw !== '' &&
        resolved !== null &&
        resolved !== 0 && (
          <p className="text-[10px] text-stone-500 dark:text-stone-400">
            →{' '}
            {typeof resolved === 'number'
              ? `${stockSpriteName(resolved) ?? 'unknown'} (#${resolved})`
              : `${resolved} (#${stockSpriteId(resolved) ?? '?'})`}
          </p>
        )
      )}
    </div>
  );
};
