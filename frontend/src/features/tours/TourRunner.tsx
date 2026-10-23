/**
 * Shared engine for the hand-rolled guided tours (legacy components/Common/*Tour.js).
 * Every legacy tour duplicated: step state, target measuring, a lock while the step's side
 * effect runs, the red pulsing highlight and the dark-cyan tooltip. That lives here once.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './tours.css';

export interface TourStep {
  title: string;
  text: string;
  /** Element to outline. */
  target: () => Element | null;
  /** Side effect when the step is entered; returns the lock duration in ms (default 800). */
  action?: () => number | void | Promise<number | void>;
  /** Circular highlight (location control). */
  circle?: boolean;
  /** Element (open modal / sidebar) the tooltip must not cover. */
  avoid?: () => Element | null;
  /** Custom tooltip top (viewport px), e.g. below drawn shapes. */
  placeTop?: () => number | null;
}

export interface TourRunnerProps {
  steps: TourStep[];
  onEnd: () => void;
  /** 'enter': run step action whenever a step is entered (incl. the first);
   *  'navigate': only after Next/Back (legacy BaseLayer/MouzaMurabba/Location tours). */
  actionMode?: 'enter' | 'navigate';
  /** Cleanup before onEnd (close modals, remove demo layers). */
  onStop?: () => void;
  /** Desktop: place the tooltip to the right of the target instead of below. */
  sideOnDesktop?: boolean;
}

type Rect = { top: number; left: number; width: number; height: number; bottom: number; right: number };
const rectOf = (el: Element | null): Rect | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
};

export const q = (...selectors: string[]): Element | null => {
  for (const s of selectors) {
    const el = s.startsWith('#') && !/[ .[]/.test(s) ? document.getElementById(s.slice(1)) : document.querySelector(s);
    if (el) return el;
  }
  return null;
};

/** Legacy targets `.modern-modal-compact .modal-content`; the Radix modal also exposes role=dialog. */
export const modalEl = (...extra: string[]) =>
  q(...extra, '.modern-modal-compact .modal-content', '.modern-modal-compact', '[role="dialog"]');

const POPUP_H = 200;

export default function TourRunner({ steps, onEnd, actionMode = 'enter', onStop, sideOnDesktop }: TourRunnerProps) {
  const [step, setStep] = useState(0);
  const [coords, setCoords] = useState<Rect | null>(null);
  const [avoid, setAvoid] = useState<Rect | null>(null);
  const [customTop, setCustomTop] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [tipH, setTipH] = useState(POPUP_H);
  const [, force] = useState(0);
  const lockTimer = useRef<number | undefined>(undefined);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const total = steps.length;

  const measure = useCallback(() => {
    const s = stepsRef.current[step];
    if (!s) return;
    const r = rectOf(s.target());
    if (r) setCoords(r);
    setAvoid(s.avoid ? rectOf(s.avoid()) : null);
    setCustomTop(s.placeTop ? s.placeTop() : null);
  }, [step]);

  const runAction = useCallback(async (idx: number) => {
    const s = stepsRef.current[idx];
    setLoading(true);
    let lock = 800;
    try {
      const r = await s?.action?.();
      if (typeof r === 'number') lock = r;
    } catch {
      /* ignore demo failures */
    }
    window.clearTimeout(lockTimer.current);
    lockTimer.current = window.setTimeout(() => setLoading(false), lock);
  }, []);

  // Measure on step change, keep following the target (modals animate, sidebar slides, map flies)
  useEffect(() => {
    measure();
    const iv = window.setInterval(measure, 250);
    const onRs = () => {
      measure();
      force((n) => n + 1);
    };
    window.addEventListener('resize', onRs);
    window.addEventListener('scroll', onRs, true);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener('resize', onRs);
      window.removeEventListener('scroll', onRs, true);
    };
  }, [measure]);

  const entered = useRef(-1);
  useEffect(() => {
    if (actionMode !== 'enter' || entered.current === step) return;
    entered.current = step;
    runAction(step);
  }, [step, actionMode, runAction]);

  useEffect(() => () => window.clearTimeout(lockTimer.current), []);

  const stop = () => {
    window.clearTimeout(lockTimer.current);
    setLoading(false);
    onStop?.();
    onEnd();
  };
  const goTo = (n: number) => {
    setStep(n);
    if (actionMode === 'navigate') runAction(n);
  };
  const next = () => {
    if (loading) return;
    if (step < total - 1) goTo(step + 1);
    else stop();
  };
  const back = () => {
    if (loading || step === 0) return;
    goTo(step - 1);
  };

  // Real tooltip height (texts differ in length) so placement never runs off-screen.
   
  useLayoutEffect(() => {
    const h = tipRef.current?.offsetHeight;
    if (h && Math.abs(h - tipH) > 2) setTipH(h);
  });

  if (!coords) return null;
  const s = steps[step];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const isMobile = vw <= 768;
  const popupW = Math.min(290, vw - 24);
  const size = Math.max(coords.width, coords.height, 36);
  const tBottom = s.circle ? coords.top + coords.height / 2 + size / 2 + 6 : coords.bottom;

  let top: number;
  let left: number;
  if (customTop != null) {
    top = customTop;
    left = Math.max(12, (vw - popupW) / 2);
  } else if (isMobile) {
    left = Math.max(12, (vw - popupW) / 2);
    if (avoid) {
      // Phone windows are bottom sheets: put the tour above them when there is room, else at the top.
      top = avoid.top - tipH - 8 >= 50 ? avoid.top - tipH - 8 : avoid.bottom + tipH + 8 <= vh ? avoid.bottom + 8 : 50;
    } else top = coords.top > vh / 2 ? Math.max(12, coords.top - tipH - 12) : Math.min(vh - tipH - 10, tBottom + 12);
  } else if (avoid) {
    if (avoid.right + popupW + 20 <= vw) {
      left = avoid.right + 16;
      top = Math.max(16, Math.min(avoid.top, vh - 250));
    } else if (avoid.left - popupW - 20 >= 0) {
      left = avoid.left - popupW - 16;
      top = Math.max(16, Math.min(avoid.top, vh - 250));
    } else {
      left = Math.max(12, Math.min(avoid.left, vw - popupW - 12));
      top = avoid.bottom + 220 <= vh ? avoid.bottom + 12 : Math.max(12, avoid.top - 220);
    }
  } else if (sideOnDesktop && coords.right + popupW + 20 <= vw) {
    left = coords.right + 16;
    top = Math.max(16, Math.min(coords.top, vh - 240));
  } else {
    left = Math.max(12, Math.min(coords.left, vw - popupW - 12));
    top = Math.min(tBottom + 12, vh - 220);
  }
  top = Math.max(10, Math.min(top, vh - tipH - 10));
  left = Math.max(12, Math.min(left, vw - popupW - 12));

  const hl = s.circle
    ? { top: coords.top + coords.height / 2 - size / 2 - 6, left: coords.left + coords.width / 2 - size / 2 - 6, width: size + 12, height: size + 12, borderRadius: '50%' }
    : { top: coords.top - 4, left: coords.left - 4, width: coords.width + 8, height: coords.height + 8 };

  // Portal to <body>: the map page's fixed layout creates a stacking context that would
  // otherwise keep the tour below any open modal, whatever its z-index.
  return createPortal(
    <>
      <div className="tour-highlight" style={hl} />
      <div ref={tipRef} className="tour-tooltip" style={{ top, left }} role="dialog" aria-label={s.title}>
        <h6>{s.title}</h6>
        <p>{s.text}</p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.7rem] text-[#9ca3af]">
            Step {step + 1} of {total}
          </span>
          <div className="flex gap-1.5">
            <button type="button" className="tour-btn tour-stop" onClick={stop}>
              Stop
            </button>
            {step > 0 && (
              <button type="button" className="tour-btn tour-back" onClick={back} disabled={loading}>
                Back
              </button>
            )}
            <button type="button" className="tour-btn tour-next" onClick={next} disabled={loading}>
              {loading ? 'Loading…' : step === total - 1 ? 'Finish' : 'Next'
}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
