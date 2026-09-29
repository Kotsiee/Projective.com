/**
 * The pure physics behind a drag-to-scroll track's release fling: how fast the pointer was moving
 * when it let go, where that speed would carry the track, which resting position to aim for, and
 * where the track is at each instant of the glide towards it.
 *
 * Kept free of the DOM so every rule here is unit-testable; `drag-scroll.ts` is the only caller and
 * owns the measuring and the frame loop.
 *
 * ## The curve
 *
 * The glide is an exponential approach, `x(t) = target − (target − from)·e^(−t/τ)`. Its initial
 * speed is `(target − from)/τ`, and because the target is chosen near `from + v·τ`, that is the
 * release speed the reader imparted — the track leaves the hand at the speed it was thrown and
 * decelerates continuously from there. It is over-damped by construction (it never passes the
 * target), which is the no-bounce rule of DESIGN_SYSTEM §B.5, and it is expressed in elapsed time
 * rather than per frame, so a 144Hz display and a 60Hz one glide the same distance in the same time.
 * A harder flick projects further, so it covers more ground AND takes longer to settle.
 */

// #region Tuning
/** The glide's time constant (ms). ~325ms is the long-standing kinetic-scroll figure. */
export const MOMENTUM_TAU_MS = 325;
/** Only pointer samples this recent (ms) inform the release velocity. */
export const VELOCITY_WINDOW_MS = 100;
/** A pointer that has not moved for this long (ms) before release was held still, not thrown. */
export const RELEASE_IDLE_MS = 60;
/** Release speeds are capped (px/ms) so one noisy sample cannot hurl the track to its end. */
export const MAX_VELOCITY = 6;
/** Below this release speed (px/ms) the drag simply settles where it was let go. */
export const MIN_FLING_VELOCITY = 0.15;
/** The glide is finished once it is this close (px) to its target — `scrollLeft` is integral, so less is invisible. */
export const SETTLE_EPSILON_PX = 1;
// #endregion

/** One pointer position, stamped with the event's `timeStamp`. */
export interface PointerSample {
	t: number;
	x: number;
}

/** Keep only the samples inside the velocity window ending at `now`. */
export function recentSamples(samples: readonly PointerSample[], now: number): PointerSample[] {
	return samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS);
}

/**
 * The POINTER's velocity at release, in px/ms (positive = moving right).
 *
 * The slope across the whole recent window rather than the last pair of events: a single pair is
 * one or two pixels over a few milliseconds and swings wildly between frames. A pointer whose last
 * movement is older than {@link RELEASE_IDLE_MS} was held still before letting go, and a held pointer
 * has no velocity however fast it moved earlier — flinging it would be acting on a stale gesture.
 */
export function releaseVelocity(samples: readonly PointerSample[], now: number): number {
	const window = recentSamples(samples, now);
	if (window.length < 2) return 0;
	const first = window[0];
	const last = window[window.length - 1];
	if (now - last.t > RELEASE_IDLE_MS) return 0;
	const dt = last.t - first.t;
	if (dt <= 0) return 0;
	const v = (last.x - first.x) / dt;
	return Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, v));
}

/** Where a glide from `position` at `velocity` (scroll px/ms) would come to rest unconstrained. */
export function projectRest(position: number, velocity: number): number {
	return Math.abs(velocity) < MIN_FLING_VELOCITY ? position : position + velocity * MOMENTUM_TAU_MS;
}

/** The inputs {@link chooseRestTarget} decides from. */
export interface RestInput {
	/** The track's scroll position at release. */
	position: number;
	/** The track's scroll velocity at release (px/ms, in scroll coordinates). */
	velocity: number;
	/** The resting positions the track may snap to; empty when the track does not snap. */
	points: readonly number[];
	/** The scroll range — `[−max, 0]` for a right-to-left track, `[0, max]` otherwise. */
	min: number;
	max: number;
}

/**
 * The position the glide aims for.
 *
 * A track that does not snap rests wherever the throw carries it, clamped into the scroll range, so
 * the glide eases into a boundary instead of striking it. A snapping track rests on the snap position
 * nearest the projection — the same positions the browser's own snapping computes, so re-enabling
 * `scroll-snap-type` once the glide ends finds the track already at rest and moves nothing.
 *
 * A fling never settles BEHIND the reader's throw: when the nearest point lies against the direction
 * of travel, the nearest point in the direction of travel wins, falling back to the nearest overall
 * only when nothing lies ahead.
 */
export function chooseRestTarget({ position, velocity, points, min, max }: RestInput): number {
	const clamp = (n: number) => Math.min(max, Math.max(min, n));
	const projected = clamp(projectRest(position, velocity));
	if (points.length === 0) return projected;

	const candidates = [...points.map(clamp), min, max];
	const flinging = Math.abs(velocity) >= MIN_FLING_VELOCITY;
	const ahead = flinging
		? candidates.filter((p) => (velocity > 0 ? p >= position - 1 : p <= position + 1))
		: [];
	const pool = ahead.length > 0 ? ahead : candidates;

	let best = pool[0];
	for (const p of pool) if (Math.abs(p - projected) < Math.abs(best - projected)) best = p;
	return best;
}

/** The glide's position `elapsed` ms after leaving `from` for `target`. */
export function glidePosition(
	from: number,
	target: number,
	elapsed: number,
	tau = MOMENTUM_TAU_MS,
): number {
	if (elapsed <= 0) return from;
	return target - (target - from) * Math.exp(-elapsed / tau);
}

/** How long (ms) a glide across `distance` px takes to come within {@link SETTLE_EPSILON_PX}. */
export function glideDurationMs(distance: number, tau = MOMENTUM_TAU_MS): number {
	const d = Math.abs(distance);
	return d <= SETTLE_EPSILON_PX ? 0 : tau * Math.log(d / SETTLE_EPSILON_PX);
}
