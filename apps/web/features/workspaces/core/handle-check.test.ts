import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { HANDLE_REFUSALS, type HandleCheck } from "@projective/types/workspace";
import { fakeClock } from "@web/utils/debounce.testing.ts";
import type { WorkspaceResult } from "../types/results.ts";
import {
	createHandleChecker,
	HANDLE_CHECK_DELAY_MS,
	HANDLE_CHECK_FAILED,
	type HandleCheckEvent,
	type HandleCheckState,
	type HandleCheckStatus,
	handleProblem,
	handleReady,
	handleSuggestions,
	INITIAL_HANDLE_CHECK,
	reduceHandleCheck,
} from "./handle-check.ts";

// #region Helpers
/** Run a typed sequence through the reducer, collecting the status after each event. */
function run(events: HandleCheckEvent[], from = INITIAL_HANDLE_CHECK) {
	const states: HandleCheckState[] = [];
	let state = from;
	for (const event of events) {
		state = reduceHandleCheck(state, event);
		states.push(state);
	}
	return { state, statuses: states.map((s) => s.status) };
}

/** The keystrokes of typing `word` one character at a time. */
function typing(word: string): HandleCheckEvent[] {
	return [...word].map((_, i) => ({ type: "input", handle: word.slice(0, i + 1) }));
}

const free = (handle: string): HandleCheck => ({
	handle,
	available: true,
	reason: null,
	suggestions: [],
});
const held = (handle: string, suggestions: string[] = []): HandleCheck => ({
	handle,
	available: false,
	reason: HANDLE_REFUSALS.taken,
	suggestions,
});
// #endregion

// #region The reducer over typed sequences
Deno.test("typing a free handle: invalid while short, checking once well-formed, then available", () => {
	const typed = run(typing("grid"));
	assertEquals(typed.statuses, ["invalid", "invalid", "checking", "checking"]);
	assertEquals(typed.state.seq, 2, "each well-formed keystroke is its own probe");
	const answered = run([{ type: "settled", seq: 2, check: free("grid") }], typed.state);
	assertEquals(answered.statuses, ["available"]);
	assert(handleReady(answered.state));
	assertEquals(handleProblem(answered.state), null);
});

Deno.test("the claim rule is settled locally: short, charset, edge hyphen, reserved — no probe", () => {
	const cases: Array<[string, HandleCheckStatus, string]> = [
		["ab", "invalid", HANDLE_REFUSALS.short],
		["grid-", "invalid", HANDLE_REFUSALS.format],
		["-grid", "invalid", HANDLE_REFUSALS.format],
		["gr_id", "invalid", HANDLE_REFUSALS.format],
		["a".repeat(41), "invalid", HANDLE_REFUSALS.long],
		["teams", "reserved", HANDLE_REFUSALS.reserved],
		["settings", "reserved", HANDLE_REFUSALS.reserved],
	];
	for (const [handle, status, reason] of cases) {
		const { state } = run([{ type: "input", handle }]);
		assertEquals([state.status, state.reason, state.seq], [status, reason, 0], handle);
		assertEquals(handleProblem(state), reason, handle);
		assert(!handleReady(state), handle);
	}
});

Deno.test("a stale answer never overwrites a newer keystroke", () => {
	const typed = run([...typing("grid"), { type: "input", handle: "gridx" }]);
	assertEquals(typed.state.seq, 3);
	const stale = reduceHandleCheck(typed.state, { type: "settled", seq: 2, check: free("grid") });
	assertStrictEquals(stale, typed.state, "an answer for probe 2 is dropped while 3 is out");
	const fresh = reduceHandleCheck(stale, { type: "settled", seq: 3, check: held("gridx") });
	assertEquals(fresh.status, "taken");
});

Deno.test("an answer after the reader typed into the claim rule is dropped", () => {
	const typed = run([...typing("grid"), { type: "input", handle: "grid-" }]);
	assertEquals(typed.state.status, "invalid");
	const late = reduceHandleCheck(typed.state, { type: "settled", seq: 2, check: free("grid") });
	assertStrictEquals(late, typed.state);
});

Deno.test("taken: the reason, and at most three well-formed suggestions that are not the handle", () => {
	const typed = run(typing("grid"));
	const { state } = run([{
		type: "settled",
		seq: typed.state.seq,
		check: held("grid", ["grid", "grid-hq", "Grid_2", "grid-co", "grid-2", "grid-3"]),
	}], typed.state);
	assertEquals(state.status, "taken");
	assertEquals(handleProblem(state), HANDLE_REFUSALS.taken);
	assertEquals(handleSuggestions(state), ["grid-hq", "grid-co", "grid-2"]);
});

Deno.test("the namespace's reserved / format verdicts keep their own states", () => {
	const typed = run(typing("grid"));
	const reserved = reduceHandleCheck(typed.state, {
		type: "settled",
		seq: typed.state.seq,
		check: { handle: "grid", available: false, reason: HANDLE_REFUSALS.reserved, suggestions: [] },
	});
	assertEquals(reserved.status, "reserved");
	const format = reduceHandleCheck(typed.state, {
		type: "settled",
		seq: typed.state.seq,
		check: { handle: "grid", available: false, reason: HANDLE_REFUSALS.format, suggestions: [] },
	});
	assertEquals(format.status, "invalid");
	assertEquals(handleSuggestions(format), []);
});

Deno.test("a failed probe idles with a retry; recheck probes the same handle again", () => {
	const typed = run(typing("grid"));
	const failed = reduceHandleCheck(typed.state, { type: "failed", seq: typed.state.seq });
	assertEquals([failed.status, failed.failed, failed.reason], ["idle", true, HANDLE_CHECK_FAILED]);
	assertEquals(handleProblem(failed), null, "an unanswered probe is not the reader's mistake");
	const again = reduceHandleCheck(failed, { type: "recheck" });
	assertEquals([again.status, again.seq, again.failed], ["checking", typed.state.seq + 1, false]);
});

Deno.test("recheck after a lost create race re-asks about an available handle", () => {
	const typed = run(typing("grid"));
	const available = reduceHandleCheck(typed.state, {
		type: "settled",
		seq: typed.state.seq,
		check: free("grid"),
	});
	const again = reduceHandleCheck(available, { type: "recheck" });
	assertEquals(again.status, "checking");
	assert(!handleReady(again), "the create stays shut until the namespace answers again");
	const nothing = run([{ type: "input", handle: "ab" }, { type: "recheck" }]);
	assertEquals(
		nothing.statuses,
		["invalid", "invalid"],
		"a handle the rule refuses is not re-asked",
	);
});

Deno.test("the same value twice is not a new probe; an empty field is idle and required", () => {
	const typed = run(typing("grid"));
	assertStrictEquals(
		reduceHandleCheck(typed.state, { type: "input", handle: "grid" }),
		typed.state,
	);
	const cleared = reduceHandleCheck(typed.state, { type: "input", handle: "" });
	assertEquals(cleared.status, "idle");
	assertEquals(handleProblem(cleared), "Choose a handle.");
	const reset = reduceHandleCheck(typed.state, { type: "reset" });
	assertEquals([reset.status, reset.handle, reset.seq], ["idle", "", typed.state.seq]);
});
// #endregion

// #region The controller (debounce + transport)
/** A fetcher whose answers the test releases by hand, in any order. */
function manualFetcher() {
	const pending: Array<{ handle: string; resolve: (r: WorkspaceResult<HandleCheck>) => void }> = [];
	const fetcher = (handle: string) =>
		new Promise<WorkspaceResult<HandleCheck>>((resolve) => pending.push({ handle, resolve }));
	return { pending, fetcher };
}

/** Let resolved promises run their continuations. */
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

Deno.test("controller: a burst of keystrokes is ONE probe, for the last value, after the quiet period", async () => {
	const clock = fakeClock();
	const net = manualFetcher();
	const checker = createHandleChecker({ fetcher: net.fetcher, clock });
	for (const event of typing("north")) checker.input((event as { handle: string }).handle);
	assertEquals(checker.state.value.status, "checking");
	clock.advance(HANDLE_CHECK_DELAY_MS - 1);
	assertEquals(net.pending.length, 0);
	clock.advance(1);
	assertEquals(net.pending.map((p) => p.handle), ["north"]);
	net.pending[0].resolve({ ok: true, data: free("north") });
	await tick();
	assertEquals(checker.state.value.status, "available");
});

Deno.test("controller: the claim rule cancels a pending probe; a slow answer for an old value is dropped", async () => {
	const clock = fakeClock();
	const net = manualFetcher();
	const checker = createHandleChecker({ fetcher: net.fetcher, clock });
	checker.input("grid");
	checker.input("grid-");
	clock.advance(HANDLE_CHECK_DELAY_MS * 2);
	assertEquals(net.pending.length, 0, "an invalid value is never sent");

	checker.input("grid");
	clock.advance(HANDLE_CHECK_DELAY_MS);
	checker.input("grids");
	clock.advance(HANDLE_CHECK_DELAY_MS);
	assertEquals(net.pending.map((p) => p.handle), ["grid", "grids"]);
	net.pending[1].resolve({ ok: true, data: held("grids", ["grids-hq"]) });
	await tick();
	net.pending[0].resolve({ ok: true, data: free("grid") });
	await tick();
	assertEquals(checker.state.value.status, "taken", "the late answer for 'grid' did not land");
	assertEquals(handleSuggestions(checker.state.value), ["grids-hq"]);
});

Deno.test("controller: recheck skips the debounce; a throwing fetcher is an unanswered probe", async () => {
	const clock = fakeClock();
	let calls = 0;
	const checker = createHandleChecker({
		fetcher: () => {
			calls++;
			return Promise.reject(new Error("offline"));
		},
		clock,
	});
	checker.input("grid");
	clock.advance(HANDLE_CHECK_DELAY_MS);
	await tick();
	await tick();
	assertEquals(checker.state.value.failed, true);
	checker.recheck();
	assertEquals(calls, 2, "a deliberate re-check goes out at once");
});

Deno.test("controller: reset and dispose drop what is pending", async () => {
	const clock = fakeClock();
	const net = manualFetcher();
	const checker = createHandleChecker({ fetcher: net.fetcher, clock });
	checker.input("grid");
	checker.reset();
	clock.advance(HANDLE_CHECK_DELAY_MS);
	assertEquals(net.pending.length, 0);

	checker.input("grid");
	clock.advance(HANDLE_CHECK_DELAY_MS);
	checker.dispose();
	net.pending[0].resolve({ ok: true, data: free("grid") });
	await tick();
	assertEquals(checker.state.value.status, "checking", "nothing lands after dispose");
});
// #endregion
