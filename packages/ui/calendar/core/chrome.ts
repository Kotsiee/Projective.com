/**
 * @projective/ui/calendar — the pinned viewport chrome's PHYSICS: the overlay scrollbar's lever.
 *
 * The bar this drives is not a proportional scrollbar and could not be one. Both of the calendar's
 * timed axes are effectively infinite — a ~4-year elapsed-minute axis in Day, a ~19-year stacked-block
 * axis in Week — so `viewport / content` is a thumb a few hundredths of a pixel long: a hair nobody can
 * grab, on a track that could never be dragged end to end anyway. Position mapping is the wrong model
 * for this surface, not merely an awkward one.
 *
 * So the handle is a LEVER. Pressing it morphs the pill into a joystick ball at the point of the press,
 * and that point is the lever's NEUTRAL origin: nothing scrolls while the ball sits there. The ball then
 * follows the pointer along the WHOLE track, clamped so it never leaves it, and its distance from the
 * origin — normalised against how far the track runs on that side — is a directional throttle that
 * rises linearly to full speed at the track's end. Because it is a rate rather than a position, a ball
 * held at either end keeps scrolling for as long as it is held, so the gesture never runs out of track
 * — which is the whole point on an axis that never ends. Releasing slides the ball home into the pill.
 *
 * WHAT THE READER GIVES UP, stated rather than hidden: a lever cannot jump to an absolute depth the way
 * a proportional thumb can. That trade is already paid for on this surface — the depth gauge was never
 * proportional, so dragging it "half way" never meant anything — and absolute navigation lives where it
 * is exact instead: the mini-map, the header's date controls, and the return-to-present pill.
 *
 * Everything here is pure arithmetic — no DOM, no canvas, no Preact, no clock — because the two bars
 * that consume it (`hooks/useOverlayScrollbar.ts` over a natively-scrolling container, and the Week
 * canvas's own inline drag gesture, which has no element to hang a hook on) must answer "how fast" and
 * "how long is the handle" identically. Two implementations of one feel is two bars that behave
 * differently on the same content.
 *
 * MOTION RULE. `morph` is a RESOLVED number in 0..1 — never a CSS transition, and never an
 * interpolation this module performs. rAF, CSS transitions and CSS keyframes are all frozen in a hidden
 * or background tab, and a handle stranded half way between a pill and a ball is a control the reader
 * cannot read. The CALLER owns the spring (`packages/ui/core/motion.ts`, which carries the mandatory
 * synchronous jump-to-final path) and hands the value in already resolved — the same contract
 * `BuildSceneEventsOptions.hoverExpandPx` follows for the card hover expansion.
 */

// #region Gauge bounds
/**
 * Shortest the handle is ever drawn (px) along the scroll axis.
 *
 * Not on its own the WCAG 2.2 SC 2.5.8 target floor — that floor is 24x24 and the handle is drawn about
 * ten pixels wide — so the cross-axis half is met by `core/scene-build.ts`'s `scrollbarHitRect`, which
 * widens what is HIT without widening what is drawn.
 *
 * `core/scene-build.ts` declares this same number as `GAUGE_MIN`, which predates this module; the two
 * MUST stay equal or the DOM bar and its canvas twin floor at different lengths on the same content.
 * Collapsing that declaration into a re-export from here is the one-line cleanup this module enables.
 */
export const GAUGE_MIN = 24;
/**
 * Longest the handle may be drawn, as a fraction of its track.
 *
 * Half a track reads unmistakably as "there is a lot of room here" while still leaving half the track
 * as visible travel; a ratio of 1 would fill the track and leave the handle nowhere to move, which on a
 * lever is worse than useless — the handle's offset is the only thing still reporting real depth while
 * the throttle is open.
 */
export const GAUGE_MAX_RATIO = 0.5;
// #endregion

// #region Lever constants
/**
 * Deflection (px) that produces no scroll at all — the ±4px deadband around the lever's origin.
 *
 * A press is never perfectly still — a finger rolls, a mouse jitters on the button-down, a stylus lands
 * with a few pixels of travel — and on a rate-based control any nonzero deflection scrolls FOREVER, not
 * merely once. Without a dead zone the reader could press the handle, hold still, and watch the
 * calendar drift away underneath them. Four pixels is the same order as the slop a click already
 * tolerates, so a press meaning "grab this" cannot be read as "and go".
 *
 * Shared by the scrollbar lever ({@link leverDeflection}) and the free-pointer ramp
 * ({@link joystickVelocity}). It must stay BELOW 5, because `core/scene-build.ts`'s `edgeHoldVelocity`
 * delegates to the latter and its existing test asserts that a five-pixel deflection moves something.
 * {@link joystickVelocity} carries a test pinning exactly that, so a future widening fails in this
 * module rather than in that one.
 */
export const LEVER_DEAD_ZONE_PX = 4;
/**
 * Scrollbar lever speed at FULL deflection, in calendar PERIODS per second — two days per second on the
 * Day timeline, two weeks per second on the Week grid. Half deflection is half this; the ramp is linear.
 * (Doubled from 1 after the first live run: one period per second read as sluggish.)
 *
 * Denominated in periods rather than pixels because a pixel rate is a different amount of TIME at every
 * zoom: 1,680 px/s is an afternoon per second zoomed in and a fortnight per second zoomed out. A period
 * rate is the same journey through the calendar at every zoom, which is what the reader is steering.
 * {@link leverSpeed} converts it against the bar's own period height.
 */
export const LEVER_MAX_SCROLL_SPEED = 2;
/**
 * Full-deflection speed (px/s) for a bar that has not been told its period — 28 px per 60 Hz frame, the
 * rate the lever ran at before it was denominated in periods, so such a consumer keeps the feel it had.
 */
export const LEVER_FALLBACK_PX_PER_S = 1680;
/**
 * Largest elapsed time (ms) integrated in one lever tick.
 *
 * A hidden tab stops delivering frames and resumes with an arbitrary gap; integrating a still-open
 * throttle across a four-second gap in one step would teleport the reader four seconds of scrolling
 * into the future the instant they came back to the tab. The same 48 ms cap `createSpring` and both
 * viewport hooks apply to their own integrators, restated here so every rAF loop in this engine answers
 * a long gap the same way.
 */
export const LEVER_DT_CAP_MS = 48;
// #endregion

// #region Free-pointer joystick constants
/**
 * Deflection (px) at which the FREE-POINTER ramp ({@link joystickVelocity}) is fully open.
 *
 * Only the gestures with no track to normalise against use it — the Gantt's middle-click fly mode and
 * `edgeHoldVelocity`. The scrollbar lever normalises against its own track instead
 * ({@link leverDeflection}), so its full speed sits at the track's end rather than at a fixed distance.
 */
export const LEVER_MAX_PX = 120;
/**
 * Free-pointer speed at full deflection, in px per 60 Hz frame (about 1,680 px/s).
 *
 * Denominated per FRAME because that is the contract `edgeHoldVelocity` already published and the Gantt
 * fly mode consumes; each caller converts it against a real elapsed time via {@link LEVER_FRAME_MS}.
 */
export const LEVER_MAX_V = 28;
/** One 60 Hz frame (ms) — the denominator {@link LEVER_MAX_V} is quoted against. */
export const LEVER_FRAME_MS = 1000 / 60;
// #endregion

// #region Free-pointer throttle
/**
 * Signed scroll speed (px per 60 Hz frame) for a pointer deflected `displacementPx` from an origin, on a
 * gesture with no track to bound it — the Gantt's fly mode and `edgeHoldVelocity`. The scrollbar lever
 * does NOT use this: it has a track, so it normalises against it ({@link leverDeflection}).
 *
 * Zero inside {@link LEVER_DEAD_ZONE_PX}, monotone increasing outside it, saturating at
 * {@link LEVER_MAX_V} beyond {@link LEVER_MAX_PX}, and exactly symmetric about zero — pushing up and
 * pushing down by the same distance must scroll at the same speed, or the control feels warped.
 *
 * QUADRATIC, not linear, and that is the whole character of the gesture. A linear ramp makes the first
 * few pixels past the dead zone already feel like a committed fast-scroll, which punishes the small
 * accidental deflection every real drag produces; squaring the normalised deflection keeps the
 * near-origin response gentle and reserves the ceiling for a reader who has visibly pushed the lever.
 * "Velocity scales proportionally with displacement from origin", read as a curve rather than a
 * straight line.
 *
 * The ramp is measured from the EDGE of the dead zone rather than from the origin, so speed rises
 * continuously from zero as the lever leaves it. Measured from the origin instead, the throttle would
 * jump to a finite speed the instant the dead zone was crossed, which reads as the control catching
 * rather than engaging.
 */
export function joystickVelocity(displacementPx: number): number {
	if (!Number.isFinite(displacementPx)) return 0;
	const magnitude = Math.abs(displacementPx);
	if (magnitude <= LEVER_DEAD_ZONE_PX) return 0;
	const span = LEVER_MAX_PX - LEVER_DEAD_ZONE_PX;
	// A degenerate configuration (a dead zone at or past saturation) leaves no ramp to speak of; the
	// honest answer there is the ceiling, not a division by zero.
	const t = span > 0 ? Math.min(1, (magnitude - LEVER_DEAD_ZONE_PX) / span) : 1;
	const speed = t * t * LEVER_MAX_V;
	return displacementPx < 0 ? -speed : speed;
}

// #endregion

// #region Lever travel
/**
 * The span the ball's CENTRE may travel (px), in whatever one coordinate space the caller measured its
 * track in — client space for the DOM bar, canvas space for the Week canvas.
 */
export interface LeverTravel {
	/** Highest the ball's centre may sit: half a ball below the track's top. */
	min: number;
	/** Lowest the ball's centre may sit: half a ball above the track's bottom. */
	max: number;
}

/**
 * The ball's travel along a track running from `start` to `end`, for a ball `ballPx` across.
 *
 * The ball's whole box stays on the track — its top never above `start`, its bottom never below `end`
 * — so its centre stops half a ball short of either end. A track shorter than the ball has no travel to
 * offer and pins the centre to the track's midpoint rather than inverting the bounds.
 */
export function leverTravel(start: number, end: number, ballPx: number): LeverTravel {
	if (!Number.isFinite(start) || !Number.isFinite(end)) return { min: 0, max: 0 };
	const radius = Number.isFinite(ballPx) ? Math.max(0, ballPx) / 2 : 0;
	const min = Math.min(start, end) + radius;
	const max = Math.max(start, end) - radius;
	if (max >= min) return { min, max };
	const mid = (start + end) / 2;
	return { min: mid, max: mid };
}

/** Clamp `y` into a travel. */
function clampTravel(y: number, travel: LeverTravel): number {
	return Math.min(travel.max, Math.max(travel.min, y));
}
// #endregion

// #region Lever throttle
/**
 * The lever's normalised deflection `d` ∈ [−1, 1] for a pointer at `pointerY` that grabbed at `grabY`:
 *
 *     d = (Y − Y₀) / (Y_end − Y₀)
 *
 * where `Y` is the ball's clamped centre, `Y₀` the clamped grab — the NEUTRAL origin — and `Y_end` the
 * end of the travel on the side the ball has moved toward. So `d` is −1 with the ball at the top of the
 * track, +1 at the bottom, ±0.5 half way between the origin and that end, and 0 at the origin itself.
 *
 * WHY THE GRAB AND NOT THE TRACK'S CENTRE. The press lands on the handle, and the handle sits wherever
 * the depth gauge put it. Anchored at the track's centre, every press away from the middle would open
 * the throttle the instant it landed; anchored at the grab, a press is always a lever at rest.
 *
 * Each side is normalised against its OWN reach, so both ends of the track are full speed wherever the
 * press landed. A press near one end therefore makes that side steeper — a shorter run to the same
 * ceiling — which is the honest answer: the alternative is a side whose full speed cannot be reached.
 *
 * Inside {@link LEVER_DEAD_ZONE_PX} the answer is exactly 0. Outside it, `d` is the plain ratio rather
 * than one re-measured from the dead zone's edge, so `d = 0.5` is exactly half way to the end. That
 * leaves a step of `LEVER_DEAD_ZONE_PX / reach` at the dead zone's edge — about 1% of full speed on a
 * 300px reach — too small to read as the control catching.
 *
 * Positive is DOWN (a larger y) and scrolls forward through time, the convention the scroll container
 * already uses; nothing here inverts it.
 */
export function leverDeflection(grabY: number, pointerY: number, travel: LeverTravel): number {
	if (!Number.isFinite(grabY) || !Number.isFinite(pointerY)) return 0;
	const origin = clampTravel(grabY, travel);
	const travelled = clampTravel(pointerY, travel) - origin;
	if (Math.abs(travelled) <= LEVER_DEAD_ZONE_PX) return 0;
	const reach = travelled > 0 ? travel.max - origin : origin - travel.min;
	if (!(reach > 0)) return 0;
	return Math.min(1, Math.max(-1, travelled / reach));
}

/**
 * The lever's full-deflection speed (px/s) for a bar whose PERIOD — a day on the Day timeline, a week
 * on the Week grid — is `periodPx` tall at the live zoom: {@link LEVER_MAX_SCROLL_SPEED} periods per
 * second. A bar with no known period falls back to {@link LEVER_FALLBACK_PX_PER_S}.
 */
export function leverSpeed(periodPx?: number): number {
	if (periodPx === undefined || !Number.isFinite(periodPx) || periodPx <= 0) {
		return LEVER_FALLBACK_PX_PER_S;
	}
	return LEVER_MAX_SCROLL_SPEED * periodPx;
}

/**
 * How far (px, signed) to scroll for one animation frame of `dtMs` at deflection `d`, on a bar whose
 * full-deflection speed is `pxPerSecond` — velocity × elapsed time, the whole of what a lever tick has
 * to compute.
 *
 * Driven by the REAL elapsed time, so the same deflection travels the same distance per second on a
 * 60 Hz, 120 Hz or 144 Hz display. It exists so the rAF loop is a single call rather than arithmetic no
 * test can reach: the frame-rate normalisation and the {@link LEVER_DT_CAP_MS} guard are both facts
 * about the gesture, and facts about the gesture belong where they can be pinned.
 *
 * A non-positive or non-finite `dtMs` scrolls nothing. That is not defensive noise — it is the first
 * callback of every rAF run, which has no previous timestamp to measure from, and a loop that treated
 * it as an elapsed time would open the throttle with a garbage delta on its opening frame.
 */
export function leverScrollDelta(deflection: number, pxPerSecond: number, dtMs: number): number {
	if (!Number.isFinite(dtMs) || dtMs <= 0) return 0;
	if (!Number.isFinite(deflection) || !Number.isFinite(pxPerSecond)) return 0;
	const d = Math.min(1, Math.max(-1, deflection));
	const dt = Math.min(dtMs, LEVER_DT_CAP_MS);
	return d * pxPerSecond * (dt / 1000);
}
// #endregion

// #region Lever state
/**
 * The live lever: its neutral origin, where the ball is, how hard it is pushed, and how far through the
 * pill-to-ball morph it currently is.
 *
 * Structurally the same shape as `core/grid-paint.ts`'s `SceneScrollbar.lever`, deliberately — the
 * scene carries this verbatim, so the canvas painter and the DOM bar draw one gesture.
 */
export interface LeverState {
	/** The neutral origin (px): where the press landed, clamped into the ball's travel. */
	grabY: number;
	/** The ball's centre (px): the pointer, clamped so the ball never leaves its track. */
	ballY: number;
	/** `d` ∈ [−1, 1] — see {@link leverDeflection}. */
	deflection: number;
	/** 0..1 through the pill to ball morph — a resolved number, never a transition. */
	morph: number;
}

/**
 * Assemble the lever's live state for a pointer at `pointerY` that grabbed at `grabY`, on a track the
 * ball may travel `travel` along. All three y values share one coordinate space.
 *
 * The ball follows the pointer directly — no saturation, no lag — because the ball's position IS what
 * the throttle reads, and a ball drawn anywhere else would show a speed the reader is not getting.
 *
 * `morph` is clamped rather than trusted: it arrives from the caller's spring, and a spring integrated
 * across a long frame can momentarily report a value slightly outside its target range. The clamp costs
 * nothing and means no consumer has to defend against a scale factor of 1.02.
 *
 * It returns a state unconditionally — "no drag is in flight" is expressed by the CALLER storing
 * `null`, because a function that sometimes returns null invites a caller to ask IT whether a drag
 * exists, and the caller is the only thing that knows.
 */
export function leverBall(
	grabY: number,
	pointerY: number,
	morph: number,
	travel: LeverTravel,
): LeverState {
	const m = Number.isFinite(morph) ? Math.min(1, Math.max(0, morph)) : 0;
	const origin = Number.isFinite(grabY) ? clampTravel(grabY, travel) : travel.min;
	const ballY = Number.isFinite(pointerY) ? clampTravel(pointerY, travel) : origin;
	return {
		grabY: origin,
		ballY,
		deflection: leverDeflection(grabY, pointerY, travel),
		morph: m,
	};
}
// #endregion

// #region Handle length
/**
 * The handle's drawn length (px) for a track of `trackPx` showing `visibleFraction` of the current
 * PERIOD — one day in Day, one week in Week — at the live zoom.
 *
 * THE DENOMINATOR IS THE POINT. "Handle size reflects viewport scale" is a real requirement and a
 * proportional thumb is a real impossibility here, and the two are only in conflict while the
 * denominator is the whole scrollable content. Against ~19 years of stacked blocks, `viewport / content`
 * is a hair; against the PERIOD the reader is actually reading, `viewport / period` is a number with
 * meaning — a full day in view is a long handle, an hour zoomed to fill the viewport is a short one —
 * and it moves live with the zoom continuum. It is a genuine reflection of viewport scale that does not
 * have to pretend an endless axis has a proportional thumb.
 *
 * Floored at {@link GAUGE_MIN} so the deepest zoom still leaves something to press, and capped at
 * {@link GAUGE_MAX_RATIO} of the track so a coarse zoom cannot swallow the travel the handle's OFFSET
 * still needs in order to report depth. The track itself wins over the floor on a very short track: a
 * handle longer than its own track is not a floor being honoured, it is a handle drawn outside the bar.
 */
export function handleLength(trackPx: number, visibleFraction: number): number {
	if (!Number.isFinite(trackPx) || trackPx <= 0) return 0;
	const fraction = Number.isFinite(visibleFraction) ? Math.max(0, visibleFraction) : 0;
	const capped = Math.min(trackPx * fraction, trackPx * GAUGE_MAX_RATIO);
	return Math.min(trackPx, Math.max(GAUGE_MIN, capped));
}
// #endregion
