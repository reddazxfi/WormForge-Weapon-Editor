import { useEffect, useRef, useState } from 'react';

/**
 * Tap-to-read tooltips.
 *
 * The editor explains most fields through an element's `title` attribute: fine
 * on a desktop (hover shows the native tooltip) and useless on a touch screen,
 * where nothing ever hovers. This mounts one listener for the whole app and
 * turns a tap on any `title` into a small bubble with the same text, so the
 * explanations are reachable on a phone without a per-field component.
 *
 * - The `title` is moved to `data-tip-tap` while the bubble is open, so the
 *   native tooltip cannot pop up on top of it.
 * - A tap on a `<label>` is swallowed (`preventDefault`), because forwarding it
 *   to the input would open the on-screen keyboard behind the bubble.
 * - Real controls (`button`, `input`, `select`, `textarea`, `a`) keep their
 *   own click; their `title` is not a tooltip the user is trying to read.
 */
const CONTROLS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A', 'OPTION']);

interface Tip {
  text: string;
  /** Viewport coordinates of the tapped element. */
  left: number;
  top: number;
  bottom: number;
  width: number;
}

export const TooltipTap: React.FC = () => {
  const [tip, setTip] = useState<Tip | null>(null);
  const holder = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const close = () => {
      const element = holder.current;
      if (element) {
        const text = element.getAttribute('data-tip-tap');
        if (text !== null) {
          element.setAttribute('title', text);
          element.removeAttribute('data-tip-tap');
        }
      }
      holder.current = null;
      setTip(null);
    };

    const onPointerDown = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const element = target?.closest?.('[title], [data-tip-tap]') as HTMLElement | null;
      if (!element) {
        close();
        return;
      }
      if (holder.current === element) {
        close();
        return;
      }
      close();
      if (CONTROLS.has(element.tagName)) return;
      const text = element.getAttribute('title') ?? element.getAttribute('data-tip-tap') ?? '';
      if (!text.trim()) return;
      // A label's own click would focus its input; the tip is what was tapped.
      if (element.tagName === 'LABEL') event.preventDefault();
      element.setAttribute('data-tip-tap', text);
      element.removeAttribute('title');
      const box = element.getBoundingClientRect();
      holder.current = element;
      setTip({ text, left: box.left, top: box.top, bottom: box.bottom, width: box.width });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, []);

  if (!tip) return null;

  const MARGIN = 8;
  const MAX_WIDTH = Math.min(340, window.innerWidth - MARGIN * 2);
  // Below the element when there is room, otherwise above it.
  const below = tip.bottom + 12 + 96 < window.innerHeight;
  const left = Math.min(
    Math.max(MARGIN, tip.left + tip.width / 2 - MAX_WIDTH / 2),
    window.innerWidth - MAX_WIDTH - MARGIN,
  );
  return (
    <div
      role="tooltip"
      onClick={close}
      style={{
        position: 'fixed',
        left,
        top: below ? tip.bottom + 8 : undefined,
        bottom: below ? undefined : window.innerHeight - tip.top + 8,
        maxWidth: MAX_WIDTH,
        zIndex: 80,
      }}
      className="pointer-events-auto rounded-lg border border-stone-700 bg-stone-900/97 px-2.5 py-2 text-[11px] leading-snug text-stone-100 shadow-xl dark:border-stone-600 dark:bg-stone-800"
    >
      {tip.text}
    </div>
  );
};
