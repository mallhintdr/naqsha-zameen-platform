import { useCallback, useRef } from 'react';
import L from 'leaflet';

export function useTooltipHighlight(murabbaTooltipsRef, lastHighlightedTooltipRef, highlightTimeoutRef, map = null) {
  // Store reference to previously displaced tooltip to restore its center offset
  const previousDisplacedTooltipRef = useRef(null);
  // Store currently highlighted murabba number to avoid re-triggering blinking on clicks within the same murabba
  const currentHighlightedMurabbaRef = useRef(null);

  const highlightMurabbaTooltip = useCallback((murabbaNo) => {
    if (!murabbaNo) return;

    const isSameMurabba = String(currentHighlightedMurabbaRef.current) === String(murabbaNo);
    currentHighlightedMurabbaRef.current = String(murabbaNo);

    // Clear previous highlight and timeout
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = null;
    }
    // Always remove pulsing selection class from previous element
    if (lastHighlightedTooltipRef.current) {
      lastHighlightedTooltipRef.current.classList.remove('tooltip-selected');
      lastHighlightedTooltipRef.current = null;
    }

    // Restore previous displaced tooltip back to center [0, 0]
    if (previousDisplacedTooltipRef.current) {
      try {
        const prevTooltip = previousDisplacedTooltipRef.current;
        prevTooltip.options.offset = L.point(0, 0);
        if (typeof prevTooltip.update === 'function') {
          prevTooltip.update();
        }
        const prevEl = typeof prevTooltip.getElement === 'function' ? prevTooltip.getElement() : null;
        if (prevEl) {
          prevEl.classList.remove('murabba-tooltip--selected-displaced');
        }
      } catch (e) {
        console.warn('Error resetting previous displaced tooltip:', e);
      }
      previousDisplacedTooltipRef.current = null;
    }

    const activeMap = map || (typeof window !== 'undefined' ? window._leaflet_map : null);

    const applyDisplacementAndBlink = (targetTooltip) => {
      if (!targetTooltip) return;
      const currentZoom = (activeMap && typeof activeMap.getZoom === 'function')
        ? activeMap.getZoom()
        : (targetTooltip._map ? targetTooltip._map.getZoom() : 17);
      // Offset halved (was up to 8px).
      const yOffset = currentZoom >= 16 ? -Math.min(4, Math.round(1.875 * Math.pow(1.5, currentZoom - 16))) : -1.75;
      const displacedOffset = L.point(0, yOffset);

      targetTooltip.options.offset = displacedOffset;
      if (typeof targetTooltip.update === 'function') {
        targetTooltip.update();
      }
      previousDisplacedTooltipRef.current = targetTooltip;

      const el = targetTooltip.getElement();
      if (el) {
        el.classList.add('murabba-tooltip--selected-displaced');
        lastHighlightedTooltipRef.current = el;

        // If clicking inside the same murabba, keep displacement active but skip blinking animation
        if (isSameMurabba) {
          console.log(`ℹ️ Same murabba ${murabbaNo} clicked, skipping blinking animation`);
          return true;
        }

        console.log(`✨ Triggered pulsing highlight & upper-center displacement for Murabba ${murabbaNo}`);

        const animationStartTime = Date.now();
        const runAnimationLoop = (isVisible) => {
          if (!lastHighlightedTooltipRef.current || lastHighlightedTooltipRef.current !== el) return;

          // Stop blinking after 1.5 seconds (half the earlier 3s)
          if (Date.now() - animationStartTime >= 1500) {
            el.classList.remove('tooltip-selected');
            lastHighlightedTooltipRef.current = null;
            return;
          }

          if (isVisible) {
            el.classList.add('tooltip-selected');
            highlightTimeoutRef.current = setTimeout(() => {
              runAnimationLoop(false);
            }, 600); // 50% less blinking (slower)
          } else {
            el.classList.remove('tooltip-selected');
            highlightTimeoutRef.current = setTimeout(() => {
              runAnimationLoop(true);
            }, 600);
          }
        };

        // Start animation
        runAnimationLoop(true);
      } else {
        // Element not in DOM yet (e.g. map is zooming in from low zoom, or tooltips are being attached)
        return false;
      }
      return true;
    };

    // Helper to execute displacement when map finishes animating/moving
    const executeAfterAnimation = (targetMurabbaNo) => {
      const getTargetTooltip = () => {
        let t = murabbaTooltipsRef?.current?.find(item => item._murabbaNo === String(targetMurabbaNo));
        if (!t && typeof window !== 'undefined' && window._activeMurabbaTooltipsByNo) {
          t = window._activeMurabbaTooltipsByNo.get(String(targetMurabbaNo));
        }
        return t;
      };

      const resolvedTooltip = getTargetTooltip();
      const currentMap = activeMap || resolvedTooltip?._map;

      const triggerWithRetry = (attemptsLeft = 5) => {
        const tooltipObj = getTargetTooltip();
        const success = applyDisplacementAndBlink(tooltipObj);
        if (!success && attemptsLeft > 0) {
          setTimeout(() => {
            triggerWithRetry(attemptsLeft - 1);
          }, 120);
        } else if (!success) {
          console.warn(`⚠️ Tooltip element not found for Murabba ${murabbaNo} (maybe not visible at current zoom?)`);
        }
      };

      // Check if map is currently animating or moving
      const isAnimating = currentMap && (currentMap._animatingZoom || currentMap._isPanning || currentMap._panAnim?.isRunning?.());

      if (currentMap && isAnimating) {
        currentMap.once('moveend', () => {
          setTimeout(() => triggerWithRetry(5), 50);
        });
      } else if (currentMap) {
        // If an animation might start immediately on this tick, listen for moveend
        let moveEndFired = false;
        const onMoveEndOnce = () => {
          moveEndFired = true;
          setTimeout(() => triggerWithRetry(5), 50);
        };
        currentMap.once('moveend', onMoveEndOnce);

        setTimeout(() => {
          if (!moveEndFired) {
            currentMap.off('moveend', onMoveEndOnce);
            triggerWithRetry(4);
          }
        }, 150);
      } else {
        triggerWithRetry(3);
      }
    };

    executeAfterAnimation(murabbaNo);
  }, [murabbaTooltipsRef, lastHighlightedTooltipRef, highlightTimeoutRef, map]);

  return { highlightMurabbaTooltip };
}
