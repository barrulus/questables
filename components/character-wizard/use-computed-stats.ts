import { useEffect, useRef } from 'react';
import { useWizard } from './wizard-context';
import { computeStats } from '../../utils/api/srd';

/**
 * Hook that watches wizard state and debounces calls to the compute-stats endpoint.
 * Dispatches SET_COMPUTED_STATS when results arrive.
 */
export function useComputedStats() {
  const { state, dispatch } = useWizard();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { speciesKey, classKey, baseAbilities, chosenSkills, chosenLanguages } = state;

  useEffect(() => {
    // Need at least abilities and a class to compute meaningful stats
    if (!classKey) {
      dispatch({ type: 'SET_COMPUTED_STATS', stats: null });
      return;
    }

    // Debounce 300ms
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();

    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const stats = await computeStats(
          {
            speciesKey: speciesKey ?? undefined,
            classKey: classKey,
            level: 1,
            baseAbilities,
            chosenSkills,
            chosenLanguages,
          },
          { signal: controller.signal },
        );

        if (!controller.signal.aborted) {
          dispatch({ type: 'SET_COMPUTED_STATS', stats });
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        // Silently ignore compute errors — preview just won't update
        console.warn('[useComputedStats] Failed to compute stats:', err);
      }
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [speciesKey, classKey, baseAbilities, chosenSkills, chosenLanguages, dispatch]);
}
