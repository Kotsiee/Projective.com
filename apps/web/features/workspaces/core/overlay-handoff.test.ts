import { assertEquals } from "@std/assert";
import { afterPanelLeaves, type HandoffClock } from "./overlay-handoff.ts";

/**
 * The drawer → dialog hand-off (Decision #123): the dialog opens only once the drawer's panel has left
 * the DOM, and only after focus is back on what opened the drawer — never in the tick the drawer closes.
 */

// #region Fake clock
function fakeClock() {
	let now = 0;
	let seq = 0;
	const timers = new Map<number, { at: number; fn: () => void }>();
	const clock: HandoffClock = {
		setTimeout: (fn, ms) => {
			timers.set(++seq, { at: now + ms, fn });
			return seq;
		},
		clearTimeout: (id) => void timers.delete(id as number),
		now: () => now,
	};
	/** Advance time, firing every timer that falls due, in order. */
	const advance = (ms: number) => {
		const until = now + ms;
		for (;;) {
			const due = [...timers.entries()].filter(([, t]) =>
				t.at <= until
			).sort((a, b) => a[1].at - b[1].at)[0];
			if (!due) break;
			timers.delete(due[0]);
			now = due[1].at;
			due[1].fn();
		}
		now = until;
	};
	return { clock, advance, pending: () => timers.size };
}
// #endregion

Deno.test("hand-off: waits for the panel to leave, refocuses its opener, then opens the dialog", () => {
	const { clock, advance } = fakeClock();
	const log: string[] = [];
	let mounted = true;
	afterPanelLeaves({
		gone: () => !mounted,
		refocus: () => log.push("refocus"),
		then: () => log.push("open"),
		clock,
	});
	assertEquals(log, [], "nothing happens while the drawer is still animating out");
	advance(200);
	assertEquals(log, []);
	mounted = false;
	advance(40);
	assertEquals(log, ["refocus", "open"], "focus is parked before the dialog records it");
	advance(2000);
	assertEquals(log, ["refocus", "open"], "once");
});

Deno.test("hand-off: a panel already gone hands off at once", () => {
	const { clock, pending } = fakeClock();
	const log: string[] = [];
	afterPanelLeaves({
		gone: () => true,
		refocus: () => log.push("refocus"),
		then: () => log.push("open"),
		clock,
	});
	assertEquals(log, ["refocus", "open"]);
	assertEquals(pending(), 0);
});

Deno.test("hand-off: a panel that never leaves cannot strand the act — it hands off at the cap", () => {
	const { clock, advance } = fakeClock();
	const log: string[] = [];
	afterPanelLeaves({
		gone: () => false,
		refocus: () => log.push("refocus"),
		then: () => log.push("open"),
		capMs: 1000,
		clock,
	});
	advance(960);
	assertEquals(log, []);
	advance(80);
	assertEquals(log, ["refocus", "open"]);
});

Deno.test("hand-off: cancelled mid-wait, nothing runs", () => {
	const { clock, advance, pending } = fakeClock();
	const log: string[] = [];
	let mounted = true;
	const cancel = afterPanelLeaves({
		gone: () => !mounted,
		refocus: () => log.push("refocus"),
		then: () => log.push("open"),
		clock,
	});
	cancel();
	mounted = false;
	advance(2000);
	assertEquals(log, []);
	assertEquals(pending(), 0);
});
