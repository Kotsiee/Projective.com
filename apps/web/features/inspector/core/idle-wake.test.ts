import { assertEquals } from "@std/assert";
import { createIdleWake, type IdleClock, TOOLBAR_IDLE_MS } from "./idle-wake.ts";

function fakeClock(): IdleClock & { advance(ms: number): void; pending(): number } {
	let now = 0;
	let next = 1;
	const timers = new Map<number, { at: number; run: () => void }>();
	return {
		set(run, ms) {
			const id = next++;
			timers.set(id, { at: now + ms, run });
			return id;
		},
		clear(handle) {
			timers.delete(handle);
		},
		advance(ms) {
			const until = now + ms;
			for (;;) {
				const due = [...timers.entries()].filter(([, t]) => t.at <= until)
					.sort((a, b) => a[1].at - b[1].at)[0];
				if (!due) break;
				timers.delete(due[0]);
				now = due[1].at;
				due[1].run();
			}
			now = until;
		},
		pending: () => timers.size,
	};
}

Deno.test("idle-wake: the toolbar sleeps 1.8s after the last sign of a hand", () => {
	assertEquals(TOOLBAR_IDLE_MS, 1800);
	const clock = fakeClock();
	const wake = createIdleWake({ clock });
	assertEquals(wake.awake.value, true);
	clock.advance(TOOLBAR_IDLE_MS - 1);
	assertEquals(wake.awake.value, true);
	clock.advance(1);
	assertEquals(wake.awake.value, false);
});

Deno.test("idle-wake: activity shows it at once and restarts the idle period", () => {
	const clock = fakeClock();
	const wake = createIdleWake({ clock });
	clock.advance(TOOLBAR_IDLE_MS);
	assertEquals(wake.awake.value, false);
	wake.wake();
	assertEquals(wake.awake.value, true);
	clock.advance(1000);
	wake.wake();
	clock.advance(1000);
	assertEquals(wake.awake.value, true);
	assertEquals(clock.pending(), 1);
	clock.advance(TOOLBAR_IDLE_MS);
	assertEquals(wake.awake.value, false);
});

Deno.test("idle-wake: a hold keeps it up for another period, and releasing lets it sleep", () => {
	const clock = fakeClock();
	let held = true;
	const wake = createIdleWake({ clock, hold: () => held });
	clock.advance(TOOLBAR_IDLE_MS * 3);
	assertEquals(wake.awake.value, true);
	held = false;
	clock.advance(TOOLBAR_IDLE_MS);
	assertEquals(wake.awake.value, false);
});

Deno.test("idle-wake: dispose stops the timer and ignores later activity", () => {
	const clock = fakeClock();
	const wake = createIdleWake({ clock, ms: 500 });
	wake.dispose();
	assertEquals(clock.pending(), 0);
	wake.wake();
	clock.advance(10_000);
	assertEquals(wake.awake.value, true);
	assertEquals(clock.pending(), 0);
});
