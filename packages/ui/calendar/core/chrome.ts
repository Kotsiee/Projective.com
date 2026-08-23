/**
 * @projective/ui/calendar — the pinned viewport chrome's PHYSICS: the overlay scrollbar's lever.
 *
 * The bar this drives is not a proportional scrollbar and could not be one. Both of the calendar's
 * timed axes are effectively infinite — a ~4-year elapsed-minute axis in Day, a ~19-year stacked-block
 * axis in Week — so `viewport / content` is a thumb a few hundredths of a pixel long: a hair nobody can
 * grab, on a track that could never be dragged end to end anyway. Position mapping is the wrong model
 * for this surface, not merely an awkward one.
 *
 * So the handle is a LEVER. Pressing it morphs the pill into a joystick ball anchored at the point of
 * the press; dragging away from that origin is a directional throttle whose SPEED scales with how far
 * the pointer has travelled; and because the deflection is measured from the GRAB rather than from the
 * track's ends, the gesture never runs out of track — which is the whole point on an axis that never
 * ends. Releasing returns the pill.
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
 * Deflection (px) that produces no scroll at all.
 *
 * A press is never perfectly still — a finger rolls, a mouse jitters on the button-down, a stylus lands
 * with a few pixels of travel — and on a rate-based control any nonzero deflection scrolls FOREVER, not
 * merely once. Without a dead zone the reader could press the handle, hold still, and watch the
 * calendar drift away underneath them. Four pixels is the same order as the slop a click already
 * tolerates, so a press meaning "grab this" cannot be read as "and go".
 *
 * It must stay BELOW 5, because `core/scene-build.ts`'s `edgeHoldVelocity` delegates here and its
 * existing test asserts that a five-pixel deflection moves something. {@link joystickVelocity} carries
 * a test pinning exactly that, so a future widening fails in this module rather than in that one.
 */
export const LEVER_DEAD_ZONE_PX = 4;
/**
 * Deflection (px) at which the throttle is fully open.
 *
 * Past this the curve stops climbing: the reader has visibly committed to continuous scrolling, and
 * every further pixel of travel would only make an already-fast scroll harder to stop. It also bounds
 * the gesture's ergonomics — the lever's whole useful range fits inside a comfortable forearm movement
 * rather than requiring the reader to drag off the screen.
 */
export const LEVER_MAX_PX = 120;
/**
 * Scroll speed at full deflection, in px per 60 Hz frame (about 1,680 px/s).
 *
 * Denominated per FRAME rather than per second because that is the contract `edgeHoldVelocity` already
 * published and the Week canvas's inline gesture already consumes. {@link leverScrollDelta} is where it
 * is converted against a real elapsed time, so a 120 Hz display scrolls at the same rate rather than
 * twice as fast.
 */
export const LEVER_MAX_V = 28;
/** One 60 Hz frame (ms) — the denominator {@link LEVER_MAX_V} is quoted against. */
export const LEVER_FRAME_MS = 1000 / 60;
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
/**
 * How far (px) the ball is drawn from the handle's centre at full deflection.
 *
 * A physical joystick's stick has a short, fixed throw while its throttle keeps ramping, and the same
 * split is what makes the control readable here: the ball has to stay visibly attached to the handle it
 * grew out of, so it saturates long before the deflection does. This is DECORATION — the one quantity
 * in this module the reader does not have to trust — but it is still resolved rather than transitioned,
 * because a frozen animation clock must not leave the stick pointing the wrong way.
 */
export const LEVER_MAX_THROW_PX = 14;
// #endregion

// #region Throttle
/**
 * Signed scroll speed (px per 60 Hz frame) for a lever deflected `displacementPx` from its grab origin.
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

/**
 * How far (px, signed) to scroll for one animation frame of `dtMs` at a deflection of
 * `displacementPx` — the whole of what a lever tick has to compute.
 *
 * It exists so the rAF loop is a single call rather than arithmetic no test can reach: the frame-rate
 * normalisation and the {@link LEVER_DT_CAP_MS} guard are both facts about the gesture, and facts about
 * the gesture belong where they can be pinned.
 *
 * A non-positive or non-finite `dtMs` scrolls nothing. That is not defensive noise — it is the first
 * callback of every rAF run, which has no previous timestamp to measure from, and a loop that treated
 * it as an elapsed time would open the throttle with a garbage delta on its opening frame.
 */
export function leverScrollDelta(displacementPx: number, dtMs: number): number {
	if (!Number.isFinite(dtMs) || dtMs <= 0) return 0;
	const dt = Math.min(dtMs, LEVER_DT_CAP_MS);
	return joystickVelocity(displacementPx) * (dt / LEVER_FRAME_MS);
}
// #endregion

// #region Lever state
/**
 * The live lever: where it was grabbed, how far it has been pushed, and how far through the pill to
 * ball morph it currently is.
 *
 * Structurally the same shape as `core/grid-paint.ts`'s `SceneScrollbar.lever`, deliberately — the
 * scene carries this verbatim, so the canvas painter and the DOM bar draw one gesture.
 */
export interface LeverState {
	/** Client-space y (px) the press landed on. The ball is anchored here for the drag's lifetime. */
	grabY: number;
	/** Signed travel (px) from {@link grabY}: positive when the pointer is BELOW where it grabbed. */
	displacement: number;
	/** 0..1 through the pill to ball morph — a resolved number, never a transition. */
	morph: number;
}

/**
 * Assemble the lever's live state for a pointer at `pointerY` that grabbed at `grabY`.
 *
 * The sign convention is the one the reader's hand expects and the one the scroll container already
 * uses: pushing DOWN (a larger client y) is positive and scrolls forward through time. Nothing here
 * inverts it, so a caller wanting a natural-scrolling axis inverts once at its own boundary rather than
 * this function guessing which of the two it is.
 *
 * `morph` is clamped rather than trusted: it arrives from the caller's spring, and a spring integrated
 * across a long frame can momentarily report a value slightly outside its target range. The clamp costs
 * nothing and means no consumer has to defend against a scale factor of 1.02.
 *
 * It returns a state unconditionally — "no drag is in flight" is expressed by the CALLER storing
 * `null`, because a function that sometimes returns null invites a caller to ask IT whether a drag
 * exists, and the caller is the only thing that knows.
 */
export function leverBall(grabY: number, pointerY: number, morph: number): LeverState {
	const m = Number.isFinite(morph) ? Math.min(1, Math.max(0, morph)) : 0;
	const travel = Number.isFinite(pointerY) && Number.isFinite(grabY) ? pointerY - grabY : 0;
	return { grabY, displacement: travel, morph: m };
}

/**
 * Where the ball is DRAWN (px, signed) relative to the handle's centre, for a given deflection.
 *
 * Linear in the normalised deflection, unlike {@link joystickVelocity}, and the difference is not an
 * inconsistency: a velocity is a rate the reader infers, so it may be curved to feel right, whereas the
 * stick's offset IS a position, and a position moving non-linearly with the pointer reads as the
 * control lagging behind the hand. It saturates at `maxThrowPx` so the ball never detaches from the
 * handle it grew out of.
 *
 * No dead zone here, on purpose: the stick should visibly answer the very first pixel of travel even
 * while the throttle is still shut, which is exactly what tells the reader the lever is live and where
 * its origin is.
 */
export function leverThrowPx(
	displacementPx: number,
	maxThrowPx: number = LEVER_MAX_THROW_PX,
): number {
	if (!Number.isFinite(displacementPx) || !Number.isFinite(maxThrowPx)) return 0;
	if (LEVER_MAX_PX <= 0) return 0;
	const t = Math.min(1, Math.abs(displacementPx) / LEVER_MAX_PX);
	const offset = t * maxThrowPx;
	return displacementPx < 0 ? -offset : offset;
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
