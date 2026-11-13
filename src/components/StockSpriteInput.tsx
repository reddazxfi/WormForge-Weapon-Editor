import React from 'react';
import { HelpCircle } from 'lucide-react';
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
  code?: string;
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
}> = ({ id, label, code, desc, value, onChange, options, numeric, placeholder, disabled }) => {
  const raw = value === undefined || value === null ? '' : String(value);
  const decoded = decodeRecordId(Number(raw));
  const resolved = resolveStockSprite(raw === '' ? undefined : raw);
  const list = options ?? STOCK_SPRITE_OPTIONS;
  const tooltip = [desc, code ? `Field: ${code}` : undefined].filter(Boolean).join('\n') || undefined;

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
        <label
          htmlFor={id}
          className="text-xs font-semibold text-stone-700 dark:text-stone-300 truncate cursor-pointer"
          title={tooltip}
        >
          {label}
        </label>
        {tooltip && (
          <span
            className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-help shrink-0 transition-colors"
            title={tooltip}
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
      <input
        id={id}
        type="text"
        list={`${id}-sprites`}
        value={raw}
        placeholder={placeholder}
        disabled={disabled}
        title={tooltip}
        onChange={(e) => handle(e.target.value)}
        className="w-full text-xs font-mono px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white disabled:opacity-50"
      />
      <datalist id={`${id}-sprites`}>
        {list.map((sprite) => (
          <option key={sprite.name} value={sprite.name}>
            {sprite.label}
          </option>
        ))}
      </datalist>
      {decoded.flagged && (
        <p className="text-[10px] text-amber-700 dark:text-amber-300">
          0x{Number(raw).toString(16).toUpperCase()} is 0x10000 + {decoded.id} (id {decoded.id}).
        </p>
      )}
      {raw !== '' && resolved === null ? (
        <p className="text-[10px] text-rose-600 dark:text-rose-400">
          Not a WA stock sprite: pick a name from the list or a valid id.
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
