/**
 * The spring integrator's proof.
 *
 * It is a pure-math suite by necessity, not by preference: this repo's preview harness runs with
 * `document.hidden === true`, so `requestAnimationFrame` never fires there and the live loop cannot
 * be WATCHED. Everything that decides how motion looks is therefore an exported pure function, and
 * everything asserted below is asserted about that function rather than about a frame.
 *
 * Two of these cases are merge gates rather than regression guards: the damping-ratio arithmetic is
 * what DESIGN_SYSTEM.md §B.5's "never bounces" rule is mechanically checked by, and the
 * frame-rate-independence case is what stops a spring from looking different on a 120 Hz display, a
 * throttled tab, or a machine under load.
 */
import { assert, assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import {
	assertOverDamped,
	createSpring,
	damp,
	dampingRatio,
	lerp,
	prefersJumpToFinal,
	SPRING_GENTLE,
	SPRING_SNAPPY,
	SPRING_STANDARD,
	springStep,
} from "./motion.ts";

/** The calendar's card-exit spring — the brief's literal constant. See the calendar contract §F.1. */
const BOUNCY = { mass: 1, stiffness: 300, damping: 18 };
/** The same stiffness at critical damping: the requested SPEED without the requested RING. */
const CRITICAL_AT_300 = { mass: 1, stiffness: 300, damping: 34.7 };

// #region The bounce gate
Deno.test("dampingRatio — the brief's spring is under-damped at 0.5196, a little over half critical", () => {
	assertAlmostEquals(dampingRatio(BOUNCY), 0.519615, 1e-6);
	assert(dampingRatio(BOUNCY) < 1, "zeta below 1 is the definition of a spring that rings");
});

Deno.test("dampingRatio — the same stiffness at damping 34.7 clears the gate at 1.0017", () => {
	assertAlmostEquals(dampingRatio(CRITICAL_AT_300), 1.001703, 1e-6);
});

Deno.test("dampingRatio — every documented spring token is critically or over-damped", () => {
	assertAlmostEquals(dampingRatio(SPRING_SNAPPY), 1.004159, 1e-6);
	assertAlmostEquals(dampingRatio(SPRING_STANDARD), 1.062132, 1e-6);
	assertAlmostEquals(dampingRatio(SPRING_GENTLE), 1.192570, 1e-6);
});

Deno.test("dampingRatio — a spring with no restoring force reports Infinity, never NaN", () => {
	// "Would this bounce?" has an answer for a brake, and the answer is no. NaN would propagate
	// silently through a comparison and quietly pass the gate it was supposed to fail.
	assertEquals(dampingRatio({ mass: 1, stiffness: 0, damping: 10 }), Number.POSITIVE_INFINITY);
	assertEquals(dampingRatio({ mass: 0, stiffness: 300, damping: 10 }), Number.POSITIVE_INFINITY);
});

Deno.test("assertOverDamped — throws for the brief's constant, and names the damping that fixes it", () => {
	const err = assertThrows(
		() => assertOverDamped(BOUNCY, "CARD_EXIT_SPRING"),
		Error,
		"CARD_EXIT_SPRING is under-damped",
	);
	assert(
		String(err).includes("34.641016"),
		"the message must carry the critical damping, because that is the next thing anyone needs",
	);
});

Deno.test("assertOverDamped — passes silently for all three documented tokens", () => {
	assertOverDamped(SPRING_SNAPPY, "SPRING_SNAPPY");
	assertOverDamped(SPRING_STANDARD, "SPRING_STANDARD");
	assertOverDamped(SPRING_GENTLE, "SPRING_GENTLE");
});
// #endregion

// #region Frame-rate independence
Deno.test("springStep — 100 steps of 1ms land where one step of 100ms lands", () => {
	const step = (dt: number, count: number) => {
		let v = 0;
		let vel = 0;
		for (let i = 0; i < count; i++) {
			const next = springStep(SPRING_STANDARD, v, vel, 1, dt);
			v = next.value;
			vel = next.velocity;
		}
		return { v, vel };
	};
	const fine = step(1, 100);
	const coarse = step(100, 1);
	// The closed form composes exactly; the tolerance here is floating-point accumulation over a
	// hundred multiplications, not integration error. A semi-implicit Euler step diverges by ~15% of
	// the travel across this same comparison, which is why the analytic form is not an optimisation.
	assertAlmostEquals(fine.v, coarse.v, 1e-9);
	assertAlmostEquals(fine.vel, coarse.vel, 1e-7);
});

Deno.test("springStep — independence holds for an UNDER-damped spring too, mid-ring", () => {
	// The under-damped branch is a different closed form, and the brief's constant is the one that
	// would actually ship through the escape hatch — so it gets its own proof rather than inheriting
	// the over-damped one's.
	const step = (dt: number, count: number) => {
		let v = 0;
		let vel = 0;
		for (let i = 0; i < count; i++) {
			const next = springStep(BOUNCY, v, vel, 1, dt, 1e-9);
			v = next.value;
			vel = next.velocity;
		}
		return v;
	};
	assertAlmostEquals(step(2, 100), step(200, 1), 1e-9);
});

Deno.test("springStep — the under-damped brief constant genuinely overshoots its target", () => {
	// The whole reason §F.1 exists. Its first peak is ~14.8% past the target at ~212ms; sampling near
	// there must find the value ABOVE 1, or the escape hatch is guarding nothing.
	let v = 0;
	let vel = 0;
	let peak = 0;
	for (let i = 0; i < 106; i++) {
		const next = springStep(BOUNCY, v, vel, 1, 2, 1e-9);
		v = next.value;
		vel = next.velocity;
		peak = Math.max(peak, v);
	}
	assertAlmostEquals(peak, 1.14799, 1e-4);
});

Deno.test("springStep — a critically-damped spring never passes its target", () => {
	let v = 0;
	let vel = 0;
	for (let i = 0; i < 200; i++) {
		const next = springStep({ mass: 1, stiffness: 300, damping: 34.641016 }, v, vel, 1, 4);
		v = next.value;
		vel = next.velocity;
		assert(v <= 1 + 1e-9, `overshot to ${v} — a critically-damped spring may not`);
	}
});

Deno.test("springStep — a zero or negative dt is a no-op, so a caller need not guard", () => {
	const held = springStep(SPRING_STANDARD, 0.3, 12, 1, 0);
	assertEquals(held.value, 0.3);
	assertEquals(held.velocity, 12);
	assertEquals(springStep(SPRING_STANDARD, 0.3, 12, 1, -5).value, 0.3);
});

Deno.test("springStep — settles once the next 60Hz frame would move it less than epsilon", () => {
	let v = 0;
	let vel = 0;
	let steps = 0;
	while (steps < 1000) {
		const next = springStep(SPRING_STANDARD, v, vel, 1, 16, 0.01);
		v = next.value;
		vel = next.velocity;
		steps++;
		if (next.settled) break;
	}
	assert(steps < 1000, "a settling spring must actually report settled");
	assert(Math.abs(1 - v) <= 0.01, `settled at ${v}, which is not within epsilon of the target`);
	assert(Math.abs(vel) / 60 <= 0.01, "settled while still visibly travelling");
});

Deno.test("springStep — an enormous gap resolves to the target rather than to NaN", () => {
	// A heavily over-damped spring integrated across a minute multiplies a vanishing exponential by a
	// diverging cosh. The product is finite in exact arithmetic and can still round to Infinity here;
	// landing on the target is that expression's limit AND the only answer that cannot paint a NaN.
	const far = springStep({ mass: 1, stiffness: 400, damping: 900 }, 0, 0, 1, 60_000);
	assert(Number.isFinite(far.value), "a long gap must not produce a non-finite value");
	assertAlmostEquals(far.value, 1, 1e-6);
	assert(far.settled);
});
// #endregion

// #region lerp / damp
Deno.test("lerp — t is clamped, so an overshooting caller cannot fabricate one", () => {
	assertEquals(lerp(0, 10, 0.5), 5);
	assertEquals(lerp(0, 10, -3), 0);
	assertEquals(lerp(0, 10, 4), 10);
});

Deno.test("damp — two short steps equal one long step, which is the whole claim", () => {
	const once = damp(0, 1, 120, 240);
	const twice = damp(damp(0, 1, 120, 120), 1, 120, 120);
	assertAlmostEquals(once, twice, 1e-12);
	// One half-life covers exactly half the distance — the property the name promises.
	assertAlmostEquals(damp(0, 1, 120, 120), 0.5, 1e-12);
});

Deno.test("damp — a non-positive half-life arrives immediately instead of dividing by zero", () => {
	assertEquals(damp(0, 1, 0, 16), 1);
	assertEquals(damp(0, 1, -5, 16), 1);
	assertEquals(damp(0.25, 1, 120, 0), 0.25);
});
// #endregion

// #region The no-frame-required rule
Deno.test("createSpring — set() writes its target SYNCHRONOUSLY with requestAnimationFrame deleted", () => {
	const raf = globalThis.requestAnimationFrame;
	const caf = globalThis.cancelAnimationFrame;
	// Deleted outright rather than stubbed: the assertion is that nothing in the path so much as
	// reaches for a frame. It is NOT the same case as a frame that never arrives — that one is a
	// separate state with a separate guard, and its own test below.
	// deno-lint-ignore no-explicit-any
	delete (globalThis as any).requestAnimationFrame;
	// deno-lint-ignore no-explicit-any
	delete (globalThis as any).cancelAnimationFrame;
	try {
		const spring = createSpring(0);
		spring.set(42);
		assertEquals(spring.value.value, 42, "a value that needed a frame would never arrive at all");
		assertEquals(spring.target.value, 42);
		assertEquals(spring.settled.value, true);
		spring.dispose();
	} finally {
		globalThis.requestAnimationFrame = raf;
		globalThis.cancelAnimationFrame = caf;
	}
});

Deno.test("createSpring — a frame that NEVER ARRIVES still lands the value", async () => {
	/*
	 * The third state, and the one that was reachable in production: `requestAnimationFrame` exists,
	 * `document.hidden` is false, and no callback is ever made. Measured in this repo's preview pane at
	 * zero callbacks in 16.7 seconds, and reachable outside it on a fully occluded window and on some
	 * remote and virtualised displays. Without the watchdog the spring started a loop and its value
	 * never moved again — a zoom the reader asked for simply did not happen, with no error to see.
	 *
	 * rAF is STUBBED rather than deleted here, because the whole point is that it is present: the
	 * deletion path above takes a different branch entirely and would prove nothing about this one.
	 */
	const raf = globalThis.requestAnimationFrame;
	const caf = globalThis.cancelAnimationFrame;
	let scheduled = 0;
	globalThis.requestAnimationFrame = (() => ++scheduled) as typeof globalThis.requestAnimationFrame;
	globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;
	try {
		const spring = createSpring(0);
		spring.set(100);
		assert(scheduled > 0, "a spring in a frame-capable environment must at least ASK for a frame");
		assertEquals(spring.value.value, 0, "and it must not pre-empt a frame that might still arrive");
		await new Promise((r) => setTimeout(r, 400));
		assertEquals(
			spring.value.value,
			100,
			"once no frame has arrived for long enough, the target is the only honest end state",
		);
		assertEquals(spring.settled.value, true);
		spring.dispose();
	} finally {
		globalThis.requestAnimationFrame = raf;
		globalThis.cancelAnimationFrame = caf;
	}
});

Deno.test("createSpring — an explicit jumpToFinal gate lands the value with no loop", () => {
	const spring = createSpring(0, { jumpToFinal: () => true });
	spring.set(-17.5);
	assertEquals(spring.value.value, -17.5);
	assertEquals(spring.settled.value, true);
	spring.dispose();
});

Deno.test("createSpring — refuses an under-damped config, and takes it behind the named hatch", () => {
	assertThrows(() => createSpring(0, { config: BOUNCY }), Error, "under-damped");
	const escaped = createSpring(0, { config: BOUNCY, requireOverDamped: false });
	assertEquals(escaped.value.value, 0);
	escaped.dispose();
});

Deno.test("createSpring — the escape hatch does NOT also opt out of jump-to-final", () => {
	// The two gates are independent on purpose. A surface-scoped decision to let one motion ring is
	// still not a decision to keep ringing at a reader who asked for reduced motion, or to leave a
	// value stranded in a background tab — so the bounce and the degradation are separate switches,
	// and only one of them has a hatch.
	const spring = createSpring(0, {
		config: BOUNCY,
		requireOverDamped: false,
		jumpToFinal: () => true,
	});
	spring.set(1);
	assertEquals(spring.value.value, 1, "an under-damped spring must still arrive with zero frames");
	assertEquals(spring.settled.value, true);
	spring.dispose();
});

Deno.test("createSpring — jump() and stop() both leave the spring at rest with no frame pending", () => {
	const spring = createSpring(0, { jumpToFinal: () => true });
	spring.jump(9);
	assertEquals(spring.value.value, 9);
	assertEquals(spring.target.value, 9);
	assertEquals(spring.settled.value, true);
	spring.stop();
	assertEquals(spring.value.value, 9);
	assertEquals(spring.settled.value, true);
	spring.dispose();
});

Deno.test("prefersJumpToFinal — no DOM, no matchMedia: falls through to false without throwing", () => {
	// Deno's test runtime has neither, which is exactly the SSR shape. The point is that the gate is
	// total: a caller reading it on the server must get an answer, not an exception.
	assertEquals(typeof prefersJumpToFinal(), "boolean");
});
// #endregion
