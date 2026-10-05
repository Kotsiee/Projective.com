import { assert, assertEquals, assertFalse } from "@std/assert";
import { createEscapeStack, type EscapeEvent, type EscapeLayer } from "./escape-stack.ts";

interface FakeEvent extends EscapeEvent {
	stopped: boolean;
	prevented: boolean;
}

function press(key = "Escape"): FakeEvent {
	const e: FakeEvent = {
		key,
		stopped: false,
		prevented: false,
		stopImmediatePropagation() {
			e.stopped = true;
		},
		preventDefault() {
			e.prevented = true;
		},
	};
	return e;
}

interface Probe {
	layer: EscapeLayer;
	closed: number;
	enabled: boolean;
	closeOnEscape: boolean;
}

function probe(): Probe {
	const p: Probe = {
		closed: 0,
		enabled: true,
		closeOnEscape: true,
		layer: {
			enabled: () => p.enabled,
			closeOnEscape: () => p.closeOnEscape,
			dismiss: () => {
				p.closed++;
			},
		},
	};
	return p;
}

Deno.test("escape closes only the top-most layer (ticket → asset picker)", () => {
	const stack = createEscapeStack();
	const ticket = probe();
	const picker = probe();
	const releaseTicket = stack.push(ticket.layer);
	const releasePicker = stack.push(picker.layer);

	const e = press();
	assert(stack.dispatch(e));
	assertEquals([ticket.closed, picker.closed], [0, 1]);
	assert(e.stopped && e.prevented);

	releasePicker();
	assert(stack.dispatch(press()));
	assertEquals([ticket.closed, picker.closed], [1, 1]);

	releaseTicket();
	assertEquals(stack.size, 0);
});

Deno.test("a lower layer is never consulted, even when the top refuses", () => {
	const stack = createEscapeStack();
	const below = probe();
	const top = probe();
	top.closeOnEscape = false;
	stack.push(below.layer);
	stack.push(top.layer);

	const e = press();
	assertFalse(stack.dispatch(e));
	assertEquals([below.closed, top.closed], [0, 0]);
	assertFalse(e.stopped, "a refused press travels on untouched");
});

Deno.test("a disabled top layer (something non-dismissing above it) is a no-op", () => {
	const stack = createEscapeStack();
	const modal = probe();
	modal.enabled = false;
	stack.push(modal.layer);
	assertFalse(stack.dispatch(press()));
	assertEquals(modal.closed, 0);
});

Deno.test("non-Escape keys are ignored", () => {
	const stack = createEscapeStack();
	const modal = probe();
	stack.push(modal.layer);
	const e = press("Enter");
	assertFalse(stack.dispatch(e));
	assertFalse(e.stopped);
	assertEquals(modal.closed, 0);
});

Deno.test("out-of-order release keeps the remaining order, and release is idempotent", () => {
	const sizes: number[] = [];
	const stack = createEscapeStack((n) => sizes.push(n));
	const a = probe();
	const b = probe();
	const c = probe();
	stack.push(a.layer);
	const releaseB = stack.push(b.layer);
	stack.push(c.layer);

	releaseB();
	releaseB();
	assertEquals(stack.size, 2);

	stack.dispatch(press());
	assertEquals([a.closed, b.closed, c.closed], [0, 0, 1]);
	assertEquals(sizes, [1, 2, 3, 2]);
});
