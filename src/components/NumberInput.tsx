import React, { useState } from 'react';

/**
 * A number box that never turns "empty" into a value.
 *
 * `<input type="number">` reports `''` when it is cleared, and `Number('')` is
 * `0` (and `Number('-')` is `NaN`), so every `Number(e.target.value)` handler in
 * the record pages silently wrote a `0` into the project — and therefore into
 * the exported record — the moment a field was emptied. This keeps the typed
 * text as a draft instead: an empty box writes nothing, and leaving it restores
 * the value the project still holds. A lone `-` or `1e` is not committed until
 * it parses.
 */
type DraftProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
> & {
  value: number | string | undefined | null;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
};

/** The draft text, plus the handlers that keep it in step with the project. */
export const useNumberDraft = (
  value: number | string | undefined | null,
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void,
  onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void,
) => {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === undefined || value === null ? '' : String(value));

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value;
    if (text.trim() === '') {
      // Cleared: show the empty box, write nothing. Blur puts the value back.
      setDraft('');
      return;
    }
    if (Number.isNaN(Number(text))) {
      setDraft(text);
      return;
    }
    setDraft(text);
    onChange?.(event);
  };

  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    setDraft(null);
    onBlur?.(event);
  };

  return { shown, handleChange, handleBlur };
};

/** A number input with no styling of its own; the caller's `className` rules. */
export const NumberInput: React.FC<DraftProps> = ({
  value,
  onChange,
  onBlur,
  ...props
}) => {
  const { shown, handleChange, handleBlur } = useNumberDraft(value, onChange, onBlur);
  return (
    <input type="number" {...props} value={shown} onChange={handleChange} onBlur={handleBlur} />
  );
};

/**
 * The record pages' number box: the shared field styling plus an optional unit
 * suffix in its own cell.
 */
export const UnitNumberInput: React.FC<DraftProps & { unit?: string }> = ({
  unit,
  className = '',
  value,
  onChange,
  onBlur,
  ...props
}) => {
  const { shown, handleChange, handleBlur } = useNumberDraft(value, onChange, onBlur);
  if (!unit) {
    return (
      <input
        type="number"
        {...props}
        value={shown}
        onChange={handleChange}
        onBlur={handleBlur}
        className={`w-full text-xs font-mono px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white disabled:opacity-50 ${className}`}
      />
    );
  }
  return (
    <div className="flex items-stretch w-full rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 overflow-hidden focus-within:ring-2 focus-within:ring-forge-500 focus-within:border-forge-500">
      <input
        type="number"
        {...props}
        value={shown}
        onChange={handleChange}
        onBlur={handleBlur}
        className={`flex-1 min-w-0 text-xs font-mono px-3 py-1.5 bg-transparent text-stone-900 dark:text-white focus:outline-hidden disabled:opacity-50 ${className}`}
      />
      <span className="px-2.5 flex items-center text-[11px] font-mono text-stone-500 dark:text-stone-400 bg-stone-50 dark:bg-stone-800/70 border-l border-stone-200 dark:border-stone-700 select-none shrink-0 pointer-events-none">
        {unit}
      </span>
    </div>
  );
};
