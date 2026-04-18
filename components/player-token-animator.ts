import type { Feature } from 'ol';
import { Point } from 'ol/geom';

export interface Waypoint { x: number; y: number; }

interface AnimationState {
  rafId: number;
  cancelled: boolean;
}

function segmentLength(a: Waypoint, b: Waypoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function polylineLength(points: Waypoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += segmentLength(points[i - 1], points[i]);
  return total;
}

function pointAtFraction(points: Waypoint[], frac: number): Waypoint {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { ...points[0] };
  const f = Math.max(0, Math.min(1, frac));
  const total = polylineLength(points);
  if (total === 0) return { ...points[0] };
  const target = total * f;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = segmentLength(points[i - 1], points[i]);
    if (acc + seg >= target) {
      const t = seg === 0 ? 0 : (target - acc) / seg;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
    acc += seg;
  }
  return { ...points[points.length - 1] };
}

/**
 * Track in-flight animations keyed by an arbitrary identifier (playerId).
 * A new animation for the same key cancels the previous one.
 */
export class TokenAnimator {
  private states = new Map<string, AnimationState>();

  /**
   * Animate a feature's Point geometry along `waypoints` over `durationMs`.
   * If prefers-reduced-motion is set, jumps to the final point immediately.
   * Returns a promise that resolves when animation completes OR is cancelled.
   */
  animate(key: string, feature: Feature, waypoints: Waypoint[], durationMs: number): Promise<void> {
    this.cancel(key);

    if (waypoints.length === 0) return Promise.resolve();

    const prefersReduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (prefersReduced || durationMs <= 0) {
      const last = waypoints[waypoints.length - 1];
      feature.setGeometry(new Point([last.x, last.y]));
      return Promise.resolve();
    }

    const state: AnimationState = { rafId: 0, cancelled: false };
    this.states.set(key, state);

    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = (now: number) => {
        if (state.cancelled) return resolve();
        const frac = Math.min(1, (now - t0) / durationMs);
        const pt = pointAtFraction(waypoints, frac);
        feature.setGeometry(new Point([pt.x, pt.y]));
        if (frac >= 1) {
          this.states.delete(key);
          return resolve();
        }
        state.rafId = requestAnimationFrame(tick);
      };
      state.rafId = requestAnimationFrame(tick);
    });
  }

  cancel(key: string): void {
    const s = this.states.get(key);
    if (!s) return;
    s.cancelled = true;
    cancelAnimationFrame(s.rafId);
    this.states.delete(key);
  }

  cancelAll(): void {
    for (const key of Array.from(this.states.keys())) this.cancel(key);
  }
}
