import { type ReadonlySignal, signal } from "@preact/signals";
import {
	HANDLE_REFUSALS,
	type HandleCheck,
	handleRefusalOf,
	localHandleRefusal,
} from "@projective/types/workspace";
import { debounce, type DebounceClock } from "@web/utils/debounce.ts";
import type { WorkspaceResult } from "../types/results.ts";

/**
 * handle-check — the live `@handle` availability check, as a pure state machine plus the small
 * controller that drives it.
 *
 * Six states, and which side decides each one is the point:
 *
 *   - `idle`      — nothing typed yet, or the last probe could not be answered (`failed`).
 *   - `invalid`   — too short, too long, or outside the charset: decided HERE, by the SSOT's own
 *                   `localHandleRefusal` (the TypeScript twin of `org.fn_handle_refusal`), with no
 *                   request at all.
 *   - `reserved`  — a route word (`RESERVED_HANDLES`): also decided here, also without a request.
 *   - `checking`  — well-formed and unreserved, so only the namespace can answer; a probe is due.
 *   - `available` / `taken` — the namespace's answer, and only ever the namespace's: it alone sees
 *                   people, teams, businesses, enterprises and the 90-day holds on renamed handles.
 *
 * Every probe carries a sequence number, and an answer is applied only while it is still the latest
 * one — a slow verdict for a handle the reader has typed past must never overwrite a newer one.
 *
 * The reducer is pure and the controller takes its transport and clock as parameters, so a typed
 * sequence (keystroke, wait, answer, keystroke…) is unit-tested with no DOM, no network and no real
 * time. `hooks/useHandleCheck.ts` is the component binding every handle field shares.
 */

// #region State
/** Where the handle field's availability check stands. */
export type HandleCheckStatus =
	| "idle"
	| "checking"
	| "available"
	| "taken"
	| "reserved"
	| "invalid";

/** The check's whole state — what the field, its live line and its suggestions render from. */
export interface HandleCheckState {
	readonly status: HandleCheckStatus;
	/** The handle this state describes, exactly as it was typed (already normalised by the form). */
	readonly handle: string;
	/** The latest probe's sequence number; an answer for any other number is stale. */
	readonly seq: number;
	/** Why the handle cannot be had (`invalid` · `reserved` · `taken`), or the failure sentence. */
	readonly reason: string | null;
	/** Free alternatives the namespace offered for a `taken` handle — at most three. */
	readonly suggestions: readonly string[];
	/** The last probe could not be answered: the state is `idle` and a retry is the way on. */
	readonly failed: boolean;
}

/** The sentence an unanswered probe leaves on the field's live line. */
export const HANDLE_CHECK_FAILED = "We couldn't check that handle just now.";

/** The most alternatives ever offered for a taken handle. */
export const MAX_HANDLE_SUGGESTIONS = 3;

/** Before anything is typed. */
export const INITIAL_HANDLE_CHECK: HandleCheckState = {
	status: "idle",
	handle: "",
	seq: 0,
	reason: null,
	suggestions: [],
	failed: false,
};
// #endregion

// #region Events
/** Everything that can happen to the check. */
export type HandleCheckEvent =
	/** The field's value changed (the form has already lower-cased it). */
	| { type: "input"; handle: string }
	/** The namespace answered probe `seq`. */
	| { type: "settled"; seq: number; check: HandleCheck }
	/** Probe `seq` could not be answered (a network or server failure). */
	| { type: "failed"; seq: number }
	/** Ask the namespace again about the current handle — after a failure, or a lost create race. */
	| { type: "recheck" }
	/** Back to the start (the dialog closed). */
	| { type: "reset" };
// #endregion

// #region Reducer
/** The state for a handle the client can judge on its own, or `null` when only the namespace can. */
function judgedLocally(handle: string, seq: number): HandleCheckState | null {
	if (handle === "") return { ...INITIAL_HANDLE_CHECK, seq };
	const code = localHandleRefusal(handle);
	if (code === null) return null;
	return {
		status: code === "reserved" ? "reserved" : "invalid",
		handle,
		seq,
		reason: HANDLE_REFUSALS[code],
		suggestions: [],
		failed: false,
	};
}

/** A fresh probe of `handle`: `checking`, under the next sequence number. */
function probing(handle: string, seq: number): HandleCheckState {
	return { status: "checking", handle, seq: seq + 1, reason: null, suggestions: [], failed: false };
}

/** The state a namespace answer moves a `checking` state to. */
function settle(state: HandleCheckState, check: HandleCheck): HandleCheckState {
	const base = { handle: state.handle, seq: state.seq, failed: false };
	if (check.available) return { ...base, status: "available", reason: null, suggestions: [] };
	const code = handleRefusalOf(check.reason) ?? "taken";
	if (code !== "taken") {
		return {
			...base,
			status: code === "reserved" ? "reserved" : "invalid",
			reason: HANDLE_REFUSALS[code],
			suggestions: [],
		};
	}
	const suggestions = check.suggestions
		.filter((s) => s !== state.handle && localHandleRefusal(s) === null)
		.slice(0, MAX_HANDLE_SUGGESTIONS);
	return { ...base, status: "taken", reason: check.reason ?? HANDLE_REFUSALS.taken, suggestions };
}

/**
 * The check's transition function. Pure: the same state and event always give the same next state,
 * and a stale or out-of-place event returns the state unchanged (the same object), so a caller can
 * tell "nothing happened" by identity.
 */
export function reduceHandleCheck(
	state: HandleCheckState,
	event: HandleCheckEvent,
): HandleCheckState {
	switch (event.type) {
		case "input": {
			if (event.handle === state.handle && !state.failed) return state;
			return judgedLocally(event.handle, state.seq) ?? probing(event.handle, state.seq);
		}
		case "settled":
			if (state.status !== "checking" || event.seq !== state.seq) return state;
			return settle(state, event.check);
		case "failed":
			if (state.status !== "checking" || event.seq !== state.seq) return state;
			return { ...state, status: "idle", reason: HANDLE_CHECK_FAILED, failed: true };
		case "recheck":
			if (judgedLocally(state.handle, state.seq) !== null) return state;
			return probing(state.handle, state.seq);
		case "reset":
			return { ...INITIAL_HANDLE_CHECK, seq: state.seq };
	}
}
// #endregion

// #region Derived
/** Whether the check has cleared the handle for a create — available, and nothing pending. */
export function handleReady(state: HandleCheckState): boolean {
	return state.status === "available";
}

/**
 * The field's validation problem, for `useFieldValidation`: what is wrong with the handle, or `null`
 * while nothing is (or nothing is known yet). An empty field is a missing required value; the
 * namespace's and the claim rule's refusals are their own sentences. `checking`, `available` and an
 * unanswered probe are not problems — the live line carries those.
 */
export function handleProblem(state: HandleCheckState): string | null {
	if (state.status === "idle") return state.failed ? null : "Choose a handle.";
	if (state.status === "invalid" || state.status === "reserved" || state.status === "taken") {
		return state.reason;
	}
	return null;
}

/** The alternatives to offer as one-tap fixes — only for a taken handle, never more than three. */
export function handleSuggestions(state: HandleCheckState): readonly string[] {
	return state.status === "taken" ? state.suggestions.slice(0, MAX_HANDLE_SUGGESTIONS) : [];
}
// #endregion

// #region Controller
/** The probe transport — `WorkspaceService.checkHandle` in the app, a stub in a test. */
export type HandleFetcher = (handle: string) => Promise<WorkspaceResult<HandleCheck>>;

/** Options for {@link createHandleChecker}. */
export interface HandleCheckerOptions {
	/** Asks the namespace about one handle. */
	fetcher: HandleFetcher;
	/** Quiet period after the last keystroke before a probe goes out, ms (default 400). */
	delayMs?: number;
	/** Timers for the debounce — the globals by default, a fake clock in a test. */
	clock?: DebounceClock;
}

/** A live handle check: one state signal and the four things a form does to it. */
export interface HandleChecker {
	/** The current state — read `.value` in render to subscribe. */
	readonly state: ReadonlySignal<HandleCheckState>;
	/** The field's value changed; a probe is scheduled when only the namespace can answer. */
	input(handle: string): void;
	/** Probe the current handle again, at once (no debounce: this is a deliberate act). */
	recheck(): void;
	/** Clear everything and drop any pending or in-flight probe. */
	reset(): void;
	/** Stop for good: no probe will run or land after this. */
	dispose(): void;
}

/** The default quiet period: a probe per keystroke would be a scraper, not a form. */
export const HANDLE_CHECK_DELAY_MS = 400;

/**
 * Build a handle checker over `fetcher`. Keystrokes are debounced; a deliberate re-check is not. A
 * fetcher that throws is treated as an unanswered probe, never an exception in the form.
 */
export function createHandleChecker(options: HandleCheckerOptions): HandleChecker {
	const state = signal<HandleCheckState>(INITIAL_HANDLE_CHECK);
	let disposed = false;

	const dispatch = (event: HandleCheckEvent) => {
		if (disposed) return;
		state.value = reduceHandleCheck(state.peek(), event);
	};

	const ask = async (handle: string, seq: number) => {
		let res: WorkspaceResult<HandleCheck>;
		try {
			res = await options.fetcher(handle);
		} catch {
			res = { ok: false };
		}
		dispatch(
			res.ok && res.data ? { type: "settled", seq, check: res.data } : { type: "failed", seq },
		);
	};

	const scheduled = debounce(
		(handle: string, seq: number) => void ask(handle, seq),
		options.delayMs ?? HANDLE_CHECK_DELAY_MS,
		options.clock,
	);

	/** Apply an event, then schedule or drop the probe the new state calls for. */
	const step = (event: HandleCheckEvent, now: boolean) => {
		const before = state.peek();
		dispatch(event);
		const after = state.peek();
		if (after === before) return;
		if (after.status !== "checking") {
			scheduled.cancel();
			return;
		}
		scheduled(after.handle, after.seq);
		if (now) scheduled.flush();
	};

	return {
		state,
		input: (handle) => step({ type: "input", handle }, false),
		recheck: () => step({ type: "recheck" }, true),
		reset: () => step({ type: "reset" }, false),
		dispose: () => {
			scheduled.cancel();
			disposed = true;
		},
	};
}
// #endregion
