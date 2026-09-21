import { assertEquals, assertThrows } from "@std/assert";
import { SlidingWindowLimiter } from "./rate-limit.ts";

const RULE = { max: 3, windowMs: 1_000 } as const;

Deno.test("allows up to the ceiling inside one window, then refuses", () => {
	const limiter = new SlidingWindowLimiter(RULE);
	assertEquals(limiter.take("a", 0).allowed, true);
	assertEquals(limiter.take("a", 100).allowed, true);
	const third = limiter.take("a", 200);
	assertEquals(third.allowed, true);
	assertEquals(third.remaining, 0);
	const fourth = limiter.take("a", 300);
	assertEquals(fourth.allowed, false);
	assertEquals(fourth.retryAfterMs, 700);
});

Deno.test("the window SLIDES — the allowance returns as the oldest event ages out", () => {
	const limiter = new SlidingWindowLimiter(RULE);
	limiter.take("a", 0);
	limiter.take("a", 400);
	limiter.take("a", 800);
	assertEquals(limiter.take("a", 999).allowed, false);
	// At 1001 the event stamped at 0 has left the window: one slot back, not a whole bucket.
	const back = limiter.take("a", 1_001);
	assertEquals(back.allowed, true);
	assertEquals(back.remaining, 0);
	assertEquals(limiter.take("a", 1_002).allowed, false);
});

Deno.test("a refused call does not count — hammering the door does not push it further away", () => {
	const limiter = new SlidingWindowLimiter(RULE);
	limiter.take("a", 0);
	limiter.take("a", 0);
	limiter.take("a", 0);
	for (let t = 1; t < 999; t += 100) assertEquals(limiter.take("a", t).allowed, false);
	assertEquals(limiter.take("a", 1_001).allowed, true);
});

Deno.test("keys are independent", () => {
	const limiter = new SlidingWindowLimiter(RULE);
	for (let i = 0; i < 3; i++) limiter.take("a", i);
	assertEquals(limiter.take("a", 3).allowed, false);
	assertEquals(limiter.take("b", 3).allowed, true);
});

Deno.test("peek reports without counting", () => {
	const limiter = new SlidingWindowLimiter(RULE);
	assertEquals(limiter.peek("a", 0).remaining, 3);
	assertEquals(limiter.peek("a", 0).remaining, 3);
	limiter.take("a", 0);
	assertEquals(limiter.peek("a", 0).remaining, 2);
});

Deno.test("reset forgets every counter, and a degenerate rule is refused at construction", () => {
	const limiter = new SlidingWindowLimiter(RULE);
	for (let i = 0; i < 3; i++) limiter.take("a", i);
	limiter.reset();
	assertEquals(limiter.take("a", 3).allowed, true);
	assertThrows(() => new SlidingWindowLimiter({ max: 0, windowMs: 1 }), RangeError);
});
