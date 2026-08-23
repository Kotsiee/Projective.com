/// <reference lib="dom" />
/**
 * @projective/ui — the package's one spring/lerp integrator: frame-rate independent, analytic, and
 * with a mandatory jump-to-final path so a hidden tab or a reduced-motion preference never strands a
 * value mid-flight.
 *
 * WHY IT EXISTS. DESIGN_SYSTEM.md §B.5 defines motion in unitless `mass`/`stiffness`/`damping` terms
 * and says those constants are "consumed by JS-driven animations in islands" — but nothing consumed
 * them, because `styles/index.css` ships only two cubic-bezier easing curves and a CSS custom
 * property cannot be read by an integrator. So every island that wanted a spring either invented one
 * or settled for a transition. This is where that stops being true.
 *
 * WHY ANALYTIC, NOT EULER. This package cannot promise a steady frame rate: a backgrounded tab
 * resumes with an arbitrary gap, a `ResizeObserver` burst can starve a frame, and a slow device
 * simply arrives late. A numerically integrated spring visibly diverges across any of those — it
 * overshoots on a long frame and undershoots on a short one, so the same gesture lands somewhere
 * different depending on machine load. The closed form composes exactly instead: a hundred 1 ms
 * steps and one 100 ms step reach the same place, which is what {@link springStep}'s test asserts.
 *
 * WHY THERE IS ALWAYS A SYNCHRONOUS PATH. Motion in this product may only ever decorate `transform`
 * and `opacity`; anything a spring drives that a reader would call a FACT has to be correct on the
 * very first paint, with no frame having run. {@link createSpring} therefore writes its target
 * synchronously whenever {@link prefersJumpToFinal} says so or `requestAnimationFrame` is simply
 * absent, and no caller is ever allowed to depend on a frame arriving.
 *
 * It is package-INTERNAL — not an entry in `packages/ui/deno.json`'s `exports` — exactly like
 * `core/cx.ts` and `core/style.ts`, and is reached by deep path from a sibling sub-path.
 */
import type { Signal } from "@preact/signals";
import { signal } from "@preact/signals";

// #region Configuration
/**
 * A spring, in the unitless `mass`/`stiffness`/`damping` form DESIGN_SYSTEM.md §B.5 specifies.
 *
 * These are the ONLY numbers that describe motion in this package; a duration is derived, never
 * authored. `stiffness` and `damping` are per-SECOND quantities, so the undamped angular frequency
 * is `sqrt(stiffness / mass)` in rad/s and a velocity is in value-units per second.
 */
export interface SpringConfig {
	mass: number;
	stiffness: number;
	damping: number;
}

/**
 * The damping ratio, `zeta = c / (2 * sqrt(k * m))`.
 *
 * `>= 1` is critically or over-damped and settles without overshoot; below 1 the motion RINGS.
 * DESIGN_SYSTEM.md:493-494 and root CLAUDE.md §3 gate #4 both require `>= 1`, so this function is
 * the mechanical form of a merge gate rather than a convenience — {@link assertOverDamped} is what
 * a consumer calls to hold itself to it.
 *
 * A spring with no mass or no stiffness has no restoring force and therefore cannot oscillate, so it
 * reports `Infinity` rather than `NaN`: the answer to "would this bounce" is honestly "no".
 */
export function dampingRatio(cfg: SpringConfig): number {
	const critical = 2 * Math.sqrt(cfg.stiffness * cfg.mass);
	if (!Number.isFinite(critical) || critical <= 0) return Number.POSITIVE_INFINITY;
	return cfg.damping / critical;
}

/**
 * Throw when `cfg` would bounce.
 *
 * Called from the unit tests of every module that declares a spring, so an under-damped constant
 * cannot reach a review unnoticed. The message carries the computed ratio AND the damping that would
 * fix it, because the useful next step after "this bounces" is the number that stops it.
 */
export function assertOverDamped(cfg: SpringConfig, name: string): void {
	const zeta = dampingRatio(cfg);
	if (zeta >= 1) return;
	const critical = 2 * Math.sqrt(cfg.stiffness * cfg.mass);
	throw new Error(
		`${name} is under-damped: damping ratio ${zeta.toFixed(6)} (< 1) overshoots its target and ` +
			`rings. DESIGN_SYSTEM.md §B.5 and root CLAUDE.md §3 gate #4 require a critically or ` +
			`over-damped spring. Raise damping to ${critical.toFixed(6)} for zeta = 1, or pass ` +
			`requireOverDamped: false behind a logged root CLAUDE.md §8 decision.`,
	);
}

/** `{ mass: 1, stiffness: 480, damping: 44 }` — zeta 1.00416. Menus, toggles, view switches. */
export const SPRING_SNAPPY: SpringConfig = { mass: 1, stiffness: 480, damping: 44 };
/** `{ mass: 1, stiffness: 320, damping: 38 }` — zeta 1.06213. The default: drawers, sheets, zoom. */
export const SPRING_STANDARD: SpringConfig = { mass: 1, stiffness: 320, damping: 38 };
/** `{ mass: 1, stiffness: 180, damping: 32 }` — zeta 1.19257. Large surfaces, layout reflow. */
export const SPRING_GENTLE: SpringConfig = { mass: 1, stiffness: 180, damping: 32 };

/**
 * `{ mass: 1, stiffness: 300, damping: 18 }` — zeta 0.51962. **The one spring in this product that
 * BOUNCES**, and the only place an under-damped constant is declared.
 *
 * DESIGN_SYSTEM.md §B.5 and root CLAUDE.md §3 gate #4 require zeta >= 1, and {@link assertOverDamped}
 * is the mechanical form of that gate. This constant is the documented exception the product owner
 * asked for by name, logged as a root CLAUDE.md §8 decision rather than slipped past the gate, and it
 * is declared HERE — beside the three that obey the rule — so that "where can a bounce enter this
 * product" has exactly one answer a reader can grep for. Two modules each writing
 * `{ stiffness: 300, damping: 18 }` inline would be two answers, and the second one would drift.
 *
 * Using it requires `createSpring(v, { config: SPRING_EXPRESSIVE_EXIT, requireOverDamped: false })`
 * — the flag is deliberately not folded into the constant, so every call site still states out loud
 * that it is opting out of the gate.
 *
 * SCOPE. It is for an EXIT, on decoration. The motion it was asked for is a card's hover expansion
 * collapsing as the pointer leaves — a flourish on top of geometry that is already correct, skipped
 * entirely under `prefers-reduced-motion` or in a hidden tab by {@link prefersJumpToFinal}. Nothing a
 * reader must trust may ring, because an overshoot on a value that encodes a FACT is a frame in which
 * the interface is stating something false.
 */
export const SPRING_EXPRESSIVE_EXIT: SpringConfig = { mass: 1, stiffness: 300, damping: 18 };
// #endregion

// #region Degradation gate
/**
 * True when motion must arrive at its final state with ZERO frames elapsed.
 *
 * Two independent triggers, checked in this order and for different reasons:
 * 1. `document.hidden` — rAF, CSS transitions and CSS `@keyframes` are all frozen in a hidden or
 *    background tab, so a value that needed a frame would never arrive at all.
 * 2. `prefers-reduced-motion: reduce` — the §B.5 jump-to-final rule. A media query cannot reach a
 *    JS integrator, so it is honoured here or not at all.
 *
 * Optional-chained `matchMedia?.` so a non-DOM environment falls through to `false`, and the caller
 * then still has a synchronous path because {@link createSpring} degrades when
 * `requestAnimationFrame` is absent.
 *
 * It is the spring twin of `calendar/hooks/useCalendarViewport.ts`'s `scrollBehaviorFor`, which
 * gates programmatic SCROLL on the same two conditions in the same order — deliberately, so the two
 * halves of "does this move" can never answer differently.
 */
export function prefersJumpToFinal(): boolean {
	if (typeof document !== "undefined" && document.hidden) return true;
	return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}
// #endregion

// #region Interpolation
/** Linear interpolation. `t` is clamped to `0..1`, so an overshooting caller cannot fabricate one. */
export function lerp(a: number, b: number, t: number): number {
	const k = t < 0 ? 0 : t > 1 ? 1 : t;
	return a + (b - a) * k;
}

/**
 * Frame-rate-independent exponential approach: the value covers HALF the remaining distance every
 * `halfLifeMs`, whatever `dtMs` happens to be. Use this where a spring is more machinery than the
 * motion deserves (a hover tint, a fade); use {@link createSpring} where the motion has a character.
 *
 * Independence is the whole point and it is structural: `0.5^(a/h) * 0.5^(b/h) === 0.5^((a+b)/h)`,
 * so two short steps and one long one land on the same number. The naive `from + (to - from) * 0.1`
 * every frame does not, which is why a hover fade written that way is twice as fast on a 120 Hz
 * display as on a 60 Hz one.
 */
export function damp(from: number, to: number, halfLifeMs: number, dtMs: number): number {
	if (!(halfLifeMs > 0)) return to;
	if (!(dtMs > 0)) return from;
	return to + (from - to) * Math.pow(0.5, dtMs / halfLifeMs);
}
// #endregion

// #region Integration
/** One integration step's result. */
export interface SpringStep {
	value: number;
	velocity: number;
	/** Within `epsilon` of the target with negligible velocity — the caller may stop the loop. */
	settled: boolean;
}

/** Default settle threshold, in the value's own units. */
const DEFAULT_EPSILON = 0.01;

/**
 * Below this `|zeta - 1|` the critically-damped limit is used instead of the under/over branches.
 *
 * Not a tolerance for sloppiness: both branches divide by a frequency that goes to zero AT `zeta 1`,
 * so evaluating them near the limit is catastrophic cancellation. `SPRING_SNAPPY` sits at 1.00416
 * and is comfortably outside it; a caller who authors exactly critical damping gets the closed form
 * that is actually correct there.
 */
const CRITICAL_EPS = 1e-6;

/**
 * Advance a damped harmonic oscillator by `dtMs`, ANALYTICALLY.
 *
 * The closed form is used for all three regimes (under-, critically- and over-damped) rather than a
 * Euler or semi-implicit step, because this engine cannot promise a steady frame rate: a background
 * tab resumes with an arbitrary gap, and a numerically integrated spring diverges visibly across
 * one. `dtMs` is the caller's responsibility to cap (see {@link CreateSpringOptions.maxDtMs}).
 *
 * The under- and over-damped branches are the SAME expression with circular and hyperbolic
 * functions swapped (`cos`/`sin` against `cosh`/`sinh`, `omega_d` against `s`), because
 * `omega_d = i * s` is the only difference between them — writing it once is what keeps the two from
 * drifting apart under a later edit.
 *
 * "Negligible velocity" is stated in the value's own units rather than as a second threshold: the
 * spring is settled when the NEXT 60 Hz frame would move it less than `epsilon`. A velocity
 * threshold picked independently of `epsilon` would let a fast spring report settled while still
 * visibly travelling, or a slow one loop forever a hair from its target.
 *
 * `settled` does NOT snap the value — this function is pure arithmetic and composing two steps must
 * equal one long step exactly. {@link createSpring} is where the final exact write to `target`
 * happens, because that is where "the motion is over" is a fact rather than a prediction.
 *
 * Pure and total: no clock, no frame, no signal. This is what the unit tests assert, because the
 * live rAF loop cannot be observed in this repo's preview harness.
 */
export function springStep(
	cfg: SpringConfig,
	value: number,
	velocity: number,
	target: number,
	dtMs: number,
	epsilon: number = DEFAULT_EPSILON,
): SpringStep {
	const eps = epsilon > 0 ? epsilon : DEFAULT_EPSILON;
	const rest = (v: number, vel: number): SpringStep => ({
		value: v,
		velocity: vel,
		settled: Math.abs(target - v) <= eps && Math.abs(vel) / 60 <= eps,
	});

	if (!Number.isFinite(dtMs) || dtMs <= 0) return rest(value, velocity);
	if (!Number.isFinite(value) || !Number.isFinite(velocity) || !Number.isFinite(target)) {
		return { value: target, velocity: 0, settled: true };
	}

	const mass = cfg.mass > 0 ? cfg.mass : 1;
	const omega0 = Math.sqrt(cfg.stiffness / mass);
	// No restoring force at all: the "spring" is a brake, so the honest answer is that it stops where
	// it is rather than that it snaps somewhere it was never pulled toward.
	if (!Number.isFinite(omega0) || omega0 <= 0) return rest(value, velocity);

	const zeta = dampingRatio(cfg);
	const t = dtMs / 1000;
	const sigma = zeta * omega0;
	const decay = Math.exp(-sigma * t);
	// Displacement FROM the target, which is what the oscillator equation is written in.
	const d0 = value - target;
	const v0 = velocity;

	let d: number;
	let v: number;
	if (Math.abs(zeta - 1) < CRITICAL_EPS) {
		// The limit both branches approach: `sin(w t)/w` and `sinh(s t)/s` alike tend to `t`.
		d = decay * (d0 + (v0 + omega0 * d0) * t);
		v = decay * (v0 - omega0 * t * (v0 + omega0 * d0));
	} else if (zeta < 1) {
		const wd = omega0 * Math.sqrt(1 - zeta * zeta);
		const cos = Math.cos(wd * t);
		const sin = Math.sin(wd * t);
		d = decay * (d0 * cos + ((v0 + sigma * d0) / wd) * sin);
		v = decay * (v0 * cos - ((omega0 * omega0 * d0 + sigma * v0) / wd) * sin);
	} else {
		const s = omega0 * Math.sqrt(zeta * zeta - 1);
		const cosh = Math.cosh(s * t);
		const sinh = Math.sinh(s * t);
		d = decay * (d0 * cosh + ((v0 + sigma * d0) / s) * sinh);
		v = decay * (v0 * cosh - ((omega0 * omega0 * d0 + sigma * v0) / s) * sinh);
	}

	// A heavily over-damped spring integrated across a very long gap multiplies a vanishing `decay`
	// by a diverging `cosh`; the product is finite in exact arithmetic but can round to a non-finite
	// double. Landing on the target is the correct limit of that expression, and it is also the only
	// answer that cannot paint a NaN.
	if (!Number.isFinite(d) || !Number.isFinite(v)) {
		return { value: target, velocity: 0, settled: true };
	}
	return rest(target + d, v);
}
// #endregion

// #region Live spring
/** A live, signal-backed spring. Created per instance; never a module singleton. */
export interface Spring {
	/** The current value. Read this in a render body; it is a signal, so reading it subscribes. */
	readonly value: Signal<number>;
	/** True when the spring is at rest at its target. */
	readonly settled: Signal<boolean>;
	/** The target the spring is travelling toward. Always exact, never interpolated. */
	readonly target: Signal<number>;
	/**
	 * Animate toward `next`.
	 *
	 * If {@link CreateSpringOptions.jumpToFinal} returns true, or `requestAnimationFrame` is absent,
	 * this writes `value` to `next` SYNCHRONOUSLY and starts no loop — so no caller ever depends on a
	 * frame arriving.
	 *
	 * `config` overrides the spring's character for THIS journey only, and exists because a motion's
	 * character is a property of the journey rather than of the object: a card that expands on hover
	 * should arrive without overshoot and may be asked to leave with a flourish, and those are two
	 * different springs driving one value. It is checked against
	 * {@link CreateSpringOptions.requireOverDamped} exactly as the constructor's is, so an
	 * under-damped override cannot enter through the side door a strict spring closed at the front.
	 */
	set(next: number, config?: SpringConfig): void;
	/** Cancel any loop and place the spring at `next` with zero velocity. */
	jump(next: number): void;
	/** Cancel the loop, leaving `value` where it is and `target` unchanged. */
	stop(): void;
	/** Cancel the loop and release the frame handle. MUST be called from the owner's unmount. */
	dispose(): void;
}

export interface CreateSpringOptions {
	/** Defaults to {@link SPRING_STANDARD}. Rejected at construction if `dampingRatio(cfg) < 1`. */
	config?: SpringConfig;
	/** Settle threshold in the value's own units. Default `0.01`. */
	epsilon?: number;
	/**
	 * Largest `dt` (ms) integrated in one tick. Default `48`.
	 *
	 * A hidden-tab rAF gap must not be integrated across in a single jump — the same cap the two
	 * viewport hooks already apply to their pan flings, restated here so every spring in the product
	 * answers the same way.
	 */
	maxDtMs?: number;
	/** Override the degradation gate. Defaults to {@link prefersJumpToFinal}. */
	jumpToFinal?: () => boolean;
	/**
	 * Refuse an under-damped `config` at construction. Default `true`.
	 *
	 * Set `false` ONLY behind a logged root CLAUDE.md §8 decision — today that is Decision #75, and
	 * {@link SPRING_EXPRESSIVE_EXIT} is the one constant it sanctions. Passing `false` is the single,
	 * greppable place a bounce could enter the product.
	 */
	requireOverDamped?: boolean;
}

/** Default `dt` cap (ms) — see {@link CreateSpringOptions.maxDtMs}. */
const DEFAULT_MAX_DT_MS = 48;

/**
 * How long (ms) a running spring will wait for a frame before deciding none is coming.
 *
 * THE GAP THIS CLOSES. {@link prefersJumpToFinal} degrades on a HIDDEN document and
 * {@link createSpring} degrades on an ABSENT `requestAnimationFrame` — but a third state exists and
 * was reachable: rAF is present, `document.hidden` is `false`, `visibilityState` is `"visible"`, and
 * frames simply never arrive. It was measured in this repo's own preview pane (zero callbacks in
 * 16.7 seconds) and it is not an artefact of a test harness: a fully occluded window and some
 * remote-desktop and virtualised displays behave the same way. In that state a spring started a loop
 * and its value never moved again, so anything driven by one — a zoom the reader asked for, a panel's
 * scale — was stuck at its starting value with no error and nothing to see.
 *
 * `setTimeout` still fires where `requestAnimationFrame` does not, which is what makes a timer the
 * right watchdog and the same reason DESIGN_SYSTEM.md §B.10.5 requires one behind every rAF flip.
 * Re-armed on every tick, so a loop that starts and then STALLS resolves too, not only one that never
 * starts.
 *
 * 250ms is fifteen frames at 60Hz. It is deliberately not tight: a slow first frame under load is
 * normal and must not be mistaken for a frameless environment, while a quarter of a second of nothing
 * is long past the point where any animation was still being watched.
 */
const FRAME_WATCHDOG_MS = 250;

/** Create a spring at `initial`, already settled. */
export function createSpring(initial: number, opts: CreateSpringOptions = {}): Spring {
	const strict = opts.requireOverDamped !== false;
	const base = opts.config ?? SPRING_STANDARD;
	if (strict) assertOverDamped(base, "createSpring config");
	/** The spring driving the CURRENT journey — `base`, or a per-`set` override. */
	let config = base;

	const epsilon = opts.epsilon !== undefined && opts.epsilon > 0 ? opts.epsilon : DEFAULT_EPSILON;
	const maxDtMs = opts.maxDtMs !== undefined && opts.maxDtMs > 0 ? opts.maxDtMs : DEFAULT_MAX_DT_MS;
	const shouldJump = opts.jumpToFinal ?? prefersJumpToFinal;

	const value = signal(initial);
	const target = signal(initial);
	const settled = signal(true);

	let velocity = 0;
	let frame: number | null = null;
	/** The watchdog waiting on the frame `frame` was scheduled for. */
	let watchdog: ReturnType<typeof setTimeout> | null = null;
	/** rAF's own timestamp origin, or `-1` before the first tick of a run has established it. */
	let last = -1;

	const cancel = (): void => {
		if (watchdog !== null) {
			clearTimeout(watchdog);
			watchdog = null;
		}
		if (frame === null) return;
		globalThis.cancelAnimationFrame?.(frame);
		frame = null;
		last = -1;
	};

	const finish = (): void => {
		cancel();
		value.value = target.value;
		velocity = 0;
		settled.value = true;
	};

	/** Schedule the next frame, and a timer that finishes the spring if that frame never arrives. */
	const schedule = (): void => {
		frame = globalThis.requestAnimationFrame(tick);
		if (watchdog !== null) clearTimeout(watchdog);
		watchdog = setTimeout(() => {
			watchdog = null;
			// Not "the animation is taking too long" — "this environment is not painting". Landing on the
			// target is the only honest end state: the value the caller asked for is the value they get,
			// with no frames spent getting there.
			finish();
		}, FRAME_WATCHDOG_MS);
	};

	const tick = (now: number): void => {
		frame = null;
		if (watchdog !== null) {
			clearTimeout(watchdog);
			watchdog = null;
		}
		// The first callback of a run only ESTABLISHES the clock. Seeding `last` from `Date.now()` or
		// `performance.now()` at scheduling time would mix timestamp origins with rAF's, and a spring
		// that integrates a bogus first `dt` snaps visibly on its opening frame.
		if (last < 0) {
			last = now;
			schedule();
			return;
		}
		const dt = Math.min(maxDtMs, Math.max(0, now - last));
		last = now;
		const step = springStep(config, value.value, velocity, target.value, dt, epsilon);
		velocity = step.velocity;
		if (step.settled) {
			finish();
			return;
		}
		value.value = step.value;
		schedule();
	};

	const start = (): void => {
		if (frame !== null) return;
		last = -1;
		settled.value = false;
		schedule();
	};

	return {
		value,
		settled,
		target,
		set(next: number, override?: SpringConfig): void {
			if (override) {
				if (strict) assertOverDamped(override, "Spring.set config");
				config = override;
			} else config = base;
			target.value = next;
			// Absent rAF is not an error case to be tolerated — it is the environment SSR and a hidden
			// tab actually run in, and the only correct behaviour there is to be finished already.
			if (typeof globalThis.requestAnimationFrame !== "function" || shouldJump()) {
				finish();
				return;
			}
			if (Math.abs(next - value.value) <= epsilon && Math.abs(velocity) / 60 <= epsilon) {
				finish();
				return;
			}
			start();
		},
		jump(next: number): void {
			config = base;
			cancel();
			target.value = next;
			value.value = next;
			velocity = 0;
			settled.value = true;
		},
		stop(): void {
			cancel();
			velocity = 0;
			settled.value = Math.abs(target.value - value.value) <= epsilon;
		},
		dispose(): void {
			cancel();
		},
	};
}
// #endregion
