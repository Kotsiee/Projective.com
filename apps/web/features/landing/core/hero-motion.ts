/// <reference lib="dom" />

/**
 * hero-motion — the hero's one motion timeline (`flows/LANDING.md` §2.7, §9 rows 17 and 26;
 * Decisions #284 (a), (o), #287).
 *
 * At most two things move in any viewport and the background is one of them, so the hero's own
 * motion — the search's typewriter placeholder and the theatre's board loop — takes TURNS on one
 * shared clock and never moves together:
 *
 *   - From `--bp-md`: typewriter, board, typewriter, board … one typewriter turn per example and as
 *     many board turns; once all of them have played the timeline is done and nothing in the hero
 *     moves again. A board turn the theatre cannot play yet ({@link heroBoardReady} false: under
 *     half visible, its player not loaded) is owed rather than lost: the typewriter goes on, and an
 *     owed board turn plays as soon as the theatre is ready — after the typewriter's last turn the
 *     timeline waits for it, still. A board turn the theatre stops being able to play ends there.
 *     Under Save-Data the theatre stays a still poster, so the timeline has no board turns.
 *   - Below `--bp-md` the theatre is a still poster, so the timeline is a single typewriter turn
 *     capped at five seconds in all (WCAG 2.2.2), then done.
 *   - The visitor's "Pause the example" toggle ({@link heroPaused}, from `--bp-md`), either
 *     reduced-motion channel (`prefers-reduced-motion` and `:root[data-motion="reduced"]`, both
 *     watched live), a hidden tab, and the search field hovered or holding focus hold the clock
 *     where it is; releasing them resumes the same turn. Using the search — typing, a key other
 *     than Tab, a press, a new category — or the viewport crossing `--bp-md` ends the timeline for
 *     good. So the field's B9 ring, which turns on hover and focus, never moves beside the hero's
 *     own motion, and a keyboard visitor can tab past the search to the toggle.
 *
 * {@link heroTurn} is the one thing a participant reads: it names who may move right now and reads
 * `"idle"` whenever nothing may — paused, held, reduced motion, a hidden tab, waiting for the
 * theatre, finished or not started. {@link heroTurnId} tells a new turn from a resumed one.
 * Participants never write either.
 *
 * Module state with no top-level browser globals: the server snapshot evaluates this module through
 * both hero islands, so every browser read happens inside {@link motionAllowed} and
 * {@link startHeroTimeline}.
 */
import { batch, computed, type ReadonlySignal, type Signal, signal } from "@preact/signals";

// #region Timing
/**
 * The timeline's clock (ms). `beatMs` and `holdMs` mirror `--lp-dur-demo` and `--lp-dur-demo-hold`
 * in `lp-theme.css` (pinned by `hero-motion.test.ts`), so a board turn lasts exactly as long as the
 * steps the theatre animates with those tokens.
 */
export const HERO_TIMING = {
	/** One typewriter turn at least: one example typed, held and cleared. */
	typewriterMs: 4200,
	/** One simulated board step (`--lp-dur-demo`). */
	beatMs: 900,
	/** The pause before and after each board step (`--lp-dur-demo-hold`). */
	holdMs: 1600,
	/** Below `--bp-md`, the typewriter's whole run (WCAG 2.2.2). */
	narrowCapMs: 5000,
	/** Typewriter turns, one per example, unless a participant asks for more (§4.1: 4–6). */
	examples: 5,
} as const;

/**
 * How long a board turn that plays `steps` simulated steps lasts: an opening hold on the starting
 * frame, then each step followed by its hold.
 */
export function boardTurnMs(steps: number): number {
	return HERO_TIMING.holdMs + Math.max(0, steps) * (HERO_TIMING.beatMs + HERO_TIMING.holdMs);
}
// #endregion

// #region Signals
/** Who may move in the hero right now. */
export type HeroTurn = "typewriter" | "board" | "idle";

/** The visitor's "Pause the example" toggle (`aria-pressed`): holds the timeline while true. */
export const heroPaused: Signal<boolean> = signal(false);

/**
 * Whose turn it is: the typewriter's, the board loop's, or nobody's (`"idle"` while paused or held,
 * under either reduced-motion channel, in a hidden tab, while waiting for the theatre, once finished,
 * and before the timeline starts). Read-only for participants.
 */
export const heroTurn: Signal<HeroTurn> = signal("idle");

/**
 * The ordinal of the current turn, incremented each time a NEW turn begins (never on a resume), so
 * a participant can restart its loop on a new turn and carry on from where it held on a resumed one.
 */
export const heroTurnId: Signal<number> = signal(0);

/** True once the timeline has finished (every turn played, or ended by using the search). */
export const heroDone: Signal<boolean> = signal(false);

/**
 * Set by the theatre: whether it can play a board turn right now (from `--bp-md`, at least half
 * visible, its player loaded). A board turn begins only while this is true.
 */
export const heroBoardReady: Signal<boolean> = signal(false);

const started = signal(false);
const wideMode = signal(false);
const motionOk = signal(false);
const saveDataOn = signal(false);

/**
 * Whether the "Pause the example" toggle has a job: the timeline is running from `--bp-md`, motion
 * is allowed and there is still something left to play.
 */
export const heroCanPause: ReadonlySignal<boolean> = computed(() =>
	started.value && wideMode.value && motionOk.value && !heroDone.value
);

/**
 * Whether the theatre may load its player and play its loop: what {@link heroCanPause} asks, and
 * Save-Data off (§2.2 note 5: the still poster under reduced motion or Save-Data).
 */
export const heroBoardAllowed: ReadonlySignal<boolean> = computed(() =>
	heroCanPause.value && !saveDataOn.value
);

/**
 * Whether neither reduced-motion channel is on, as the running timeline last read it — a signal, so
 * a participant whose turn is already idle still hears the change (the theatre goes back to its
 * still first frame).
 */
export const heroMotionAllowed: ReadonlySignal<boolean> = computed(() => motionOk.value);
// #endregion

// #region Environment
/** `prefers-reduced-motion`, the OS channel. */
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** `--bp-md`: the theatre plays its loop from here; below it is a still poster. */
const WIDE_QUERY = "(min-width: 768px)";

/** The hero search: focus resting in it holds the timeline, and using it ends the timeline. */
const HERO_SEARCH_SELECTOR = '#hero [role="search"], #hero .lp-search';

/** The field whose B9 ring turns on hover: the pointer over it holds the timeline. */
const HERO_FIELD_SELECTOR = "#hero .lp-search";

/** Keys that only move focus or modify another key: pressing them is not using the search. */
const PASSING_KEYS: ReadonlySet<string> = new Set(["Tab", "Shift", "Control", "Alt", "Meta"]);

/** What the search tells the timeline. */
export interface HeroSearchSignals {
	/** The field is hovered or focus rests in the search (`true`), or neither any more (`false`). */
	engaged: (engaged: boolean) => void;
	/** The visitor used the search: typed, pressed a key other than Tab, pressed it, or changed its category. */
	used: () => void;
}

/** What the timeline reads from the page — the browser by default, a fake in tests. */
export interface HeroEnvironment {
	/** Whether either reduced-motion channel is on. */
	reducedMotion(): boolean;
	/** Whether the viewport is at least `--bp-md`. */
	wide(): boolean;
	/** Whether the tab is hidden. */
	hidden(): boolean;
	/** Whether the visitor asked to save data (`navigator.connection.saveData`). */
	saveData(): boolean;
	/** Calls `onChange` whenever any of the four reads above may have changed; returns the unsubscribe. */
	watch(onChange: () => void): () => void;
	/** Reports the hero search's engagement and use; returns the unsubscribe. */
	interactions(signals: HeroSearchSignals): () => void;
}

/** `navigator.connection`, where the browser has it. */
type NetworkInformation = EventTarget & { saveData?: boolean };

/** True where there is a page to read (never on the server). */
function hasDom(): boolean {
	return typeof globalThis.matchMedia === "function" && typeof globalThis.document !== "undefined";
}

/**
 * Whether neither reduced-motion channel is on — `prefers-reduced-motion: reduce` and the app's
 * `:root[data-motion="reduced"]` overlay. `false` on the server, where nothing animates.
 */
export function motionAllowed(): boolean {
	if (!hasDom()) return false;
	return !(globalThis.matchMedia(REDUCED_QUERY).matches ||
		document.documentElement.dataset.motion === "reduced");
}

/** The browser's {@link HeroEnvironment}: the media queries, visibility, Save-Data and the search. */
function browserEnvironment(): HeroEnvironment {
	const connection = () =>
		(globalThis.navigator as Navigator & { connection?: NetworkInformation }).connection;
	return {
		reducedMotion: () => !motionAllowed(),
		wide: () => globalThis.matchMedia(WIDE_QUERY).matches,
		hidden: () => document.visibilityState === "hidden",
		saveData: () => connection()?.saveData === true,
		watch(onChange) {
			const reduced = globalThis.matchMedia(REDUCED_QUERY);
			const wide = globalThis.matchMedia(WIDE_QUERY);
			const network = connection();
			const observer = new MutationObserver(onChange);
			reduced.addEventListener("change", onChange);
			wide.addEventListener("change", onChange);
			network?.addEventListener?.("change", onChange);
			document.addEventListener("visibilitychange", onChange);
			observer.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ["data-motion"],
			});
			return () => {
				reduced.removeEventListener("change", onChange);
				wide.removeEventListener("change", onChange);
				network?.removeEventListener?.("change", onChange);
				document.removeEventListener("visibilitychange", onChange);
				observer.disconnect();
			};
		},
		interactions({ engaged, used }) {
			const within = (target: EventTarget | null, selector: string) =>
				target instanceof Element && target.closest(selector) !== null;
			let hovered = false;
			let focused = false;
			const report = (nextHovered: boolean, nextFocused: boolean) => {
				if (nextHovered === hovered && nextFocused === focused) return;
				const was = hovered || focused;
				hovered = nextHovered;
				focused = nextFocused;
				if (was !== (hovered || focused)) engaged(hovered || focused);
			};
			const onOver = (event: Event) => report(within(event.target, HERO_FIELD_SELECTOR), focused);
			const onOut = (event: PointerEvent) => {
				if (event.relatedTarget === null) report(false, focused);
			};
			const onFocusIn = (event: Event) =>
				report(hovered, within(event.target, HERO_SEARCH_SELECTOR));
			const onFocusOut = (event: FocusEvent) =>
				report(hovered, within(event.relatedTarget, HERO_SEARCH_SELECTOR));
			const onUse = (event: Event) => {
				if (event instanceof KeyboardEvent && PASSING_KEYS.has(event.key)) return;
				if (within(event.target, HERO_SEARCH_SELECTOR)) used();
			};
			const uses = ["input", "change", "keydown", "pointerdown"] as const;
			document.addEventListener("pointerover", onOver);
			document.addEventListener("pointerout", onOut);
			document.addEventListener("focusin", onFocusIn);
			document.addEventListener("focusout", onFocusOut);
			for (const type of uses) document.addEventListener(type, onUse);
			return () => {
				document.removeEventListener("pointerover", onOver);
				document.removeEventListener("pointerout", onOut);
				document.removeEventListener("focusin", onFocusIn);
				document.removeEventListener("focusout", onFocusOut);
				for (const type of uses) document.removeEventListener(type, onUse);
			};
		},
	};
}
// #endregion

// #region Timeline
/** What a participant may tell the timeline when it starts it. */
export interface HeroTimelineOptions {
	/**
	 * Typewriter turns to play (one per example). The first count a participant gives replaces the
	 * default; after that the largest count asked for wins.
	 */
	examples?: number;
	/** How long one board turn lasts ({@link boardTurnMs}); the theatre passes its own loop's length. */
	boardMs?: number;
	/**
	 * How long a typewriter turn must be for the longest example to finish its cycle
	 * (`typewriterTurnMs`); a turn never lasts less than {@link HERO_TIMING.typewriterMs}.
	 */
	typewriterMs?: number;
	/** The page to read; the browser's when omitted. */
	env?: HeroEnvironment;
}

/** A turn that moves something. */
type MovingTurn = Exclude<HeroTurn, "idle">;

/** The one shared run, while any participant holds it. */
interface Run {
	env: HeroEnvironment;
	/** The viewport mode the run started in; crossing `--bp-md` ends it. */
	wide: boolean;
	examples: number;
	/** Whether a participant has given {@link examples}, so the default no longer applies. */
	examplesGiven: boolean;
	boardMs: number;
	typewriterMs: number;
	/** The current turn's kind, or `null` while waiting for the theatre. */
	kind: MovingTurn | null;
	/** Typewriter and board turns begun so far. */
	typed: number;
	boards: number;
	/** The search field is hovered or holds focus. */
	engaged: boolean;
	/** What is left of the current turn (ms). */
	remaining: number;
	/** When the clock last started counting `remaining` down (`Date.now()`), or `null` while held. */
	since: number | null;
	timer: ReturnType<typeof setTimeout> | null;
	cleanups: Array<() => void>;
}

let run: Run | null = null;
let holders = 0;

/** Typewriter turns the run plays: one per example from `--bp-md`, one capped turn below it. */
function typewriterTurns(r: Run): number {
	return r.wide ? r.examples : 1;
}

/** Board turns the run plays: one per example from `--bp-md` with Save-Data off, else none. */
function boardTurns(r: Run): number {
	return r.wide && !saveDataOn.value ? r.examples : 0;
}

/** How long a turn of `kind` lasts. */
function turnMs(r: Run, kind: MovingTurn): number {
	if (!r.wide) return HERO_TIMING.narrowCapMs;
	return kind === "board" ? r.boardMs : r.typewriterMs;
}

/**
 * The turn after one of `previous` (`null` at the start): a board turn after a typewriter turn when
 * the theatre is ready and one is left, else the next typewriter turn, else an owed board turn the
 * theatre can play now; `"wait"` while only board turns are left and the theatre cannot play them,
 * and `null` once nothing is left.
 */
function nextTurn(r: Run, previous: MovingTurn | null): MovingTurn | "wait" | null {
	const boardLeft = r.boards < boardTurns(r);
	const boardNow = boardLeft && heroBoardReady.value;
	if (previous === "typewriter" && boardNow) return "board";
	if (r.typed < typewriterTurns(r)) return "typewriter";
	if (boardNow) return "board";
	return boardLeft ? "wait" : null;
}

/** Whether the clock may run: a turn under way, not finished, paused or held, motion allowed, the tab visible. */
function clockRuns(r: Run): boolean {
	return r.kind !== null && !heroDone.value && !heroPaused.value && !r.engaged && motionOk.value &&
		!r.env.hidden();
}

/** Stops the clock and banks what is left of the turn. */
function stopClock(r: Run): void {
	if (r.timer === null) return;
	clearTimeout(r.timer);
	r.timer = null;
	r.remaining = Math.max(0, r.remaining - (Date.now() - (r.since ?? Date.now())));
	r.since = null;
}

/** Starts or holds the clock to match the page, and publishes whose turn it is. */
function sync(r: Run): void {
	const runs = clockRuns(r);
	if (runs && r.timer === null) {
		r.since = Date.now();
		r.timer = setTimeout(() => advance(r), r.remaining);
	} else if (!runs) {
		stopClock(r);
	}
	heroTurn.value = runs && r.kind !== null ? r.kind : "idle";
}

/** Ends the run for good: nothing in the hero moves again. */
function finish(r: Run): void {
	if (r.timer !== null) clearTimeout(r.timer);
	r.timer = null;
	r.since = null;
	r.kind = null;
	heroDone.value = true;
	heroTurn.value = "idle";
}

/** Begins the turn that follows one of `previous`, or waits for the theatre, or finishes. */
function begin(r: Run, previous: MovingTurn | null): void {
	const next = nextTurn(r, previous);
	if (next === null) {
		finish(r);
		return;
	}
	if (r.timer !== null) clearTimeout(r.timer);
	r.timer = null;
	r.since = null;
	if (next === "wait") {
		r.kind = null;
		heroTurn.value = "idle";
		return;
	}
	if (next === "board") r.boards += 1;
	else r.typed += 1;
	r.kind = next;
	r.remaining = turnMs(r, next);
	// One update: a participant never sees the new turn's id beside the old turn's kind.
	batch(() => {
		heroTurnId.value += 1;
		sync(r);
	});
}

/** The current turn ran out, or the board can no longer play it: on to the next one. */
function advance(r: Run): void {
	begin(r, r.kind);
}

/** Re-reads the page after a change: a crossed breakpoint ends the run; anything else re-syncs. */
function onEnvironment(r: Run): void {
	motionOk.value = !r.env.reducedMotion();
	saveDataOn.value = r.env.saveData();
	if (heroDone.value) return;
	if (r.env.wide() !== r.wide) {
		finish(r);
		return;
	}
	if (r.kind === "board" && saveDataOn.value) {
		advance(r);
		return;
	}
	if (r.kind === null && nextTurn(r, null) === null) {
		finish(r);
		return;
	}
	sync(r);
}

/** Folds a participant's options into the shared run. */
function configure(r: Run, options: HeroTimelineOptions): void {
	if (options.examples !== undefined) {
		const asked = Math.max(0, Math.floor(options.examples));
		r.examples = r.examplesGiven ? Math.max(r.examples, asked) : asked;
		r.examplesGiven = true;
	}
	if (options.boardMs !== undefined) r.boardMs = Math.max(0, options.boardMs);
	if (options.typewriterMs !== undefined) {
		const extra = Math.max(0, options.typewriterMs - r.typewriterMs);
		r.typewriterMs += extra;
		// A turn already under way grows too, so its example still finishes.
		if (extra > 0 && r.wide && r.kind === "typewriter") {
			stopClock(r);
			r.remaining += extra;
			sync(r);
		}
	}
}

/** Opens the shared run and its subscriptions. */
function open(env: HeroEnvironment, options: HeroTimelineOptions): Run {
	const r: Run = {
		env,
		wide: env.wide(),
		examples: HERO_TIMING.examples,
		examplesGiven: false,
		boardMs: boardTurnMs(2),
		typewriterMs: HERO_TIMING.typewriterMs,
		kind: null,
		typed: 0,
		boards: 0,
		engaged: false,
		remaining: 0,
		since: null,
		timer: null,
		cleanups: [],
	};
	configure(r, options);
	heroDone.value = false;
	wideMode.value = r.wide;
	motionOk.value = !env.reducedMotion();
	saveDataOn.value = env.saveData();
	started.value = true;
	begin(r, null);
	r.cleanups.push(
		env.watch(() => onEnvironment(r)),
		env.interactions({
			engaged(engaged) {
				r.engaged = engaged;
				if (!heroDone.value) sync(r);
			},
			used() {
				if (!heroDone.value) finish(r);
			},
		}),
		heroPaused.subscribe(() => {
			if (!heroDone.value) sync(r);
		}),
		heroBoardReady.subscribe((ready) => {
			if (heroDone.value) return;
			if (!ready && r.kind === "board") advance(r);
			else if (ready && r.kind === null) begin(r, null);
		}),
	);
	return r;
}

/** Closes the run once its last participant lets go, and resets every signal for a later start. */
function close(r: Run): void {
	if (r.timer !== null) clearTimeout(r.timer);
	for (const cleanup of r.cleanups) cleanup();
	run = null;
	started.value = false;
	heroTurn.value = "idle";
	heroDone.value = false;
	heroPaused.value = false;
}

/**
 * Starts the hero timeline, or joins it when another participant already has. Both hero islands
 * call it from an effect; the run is shared and closes when the last returned function is called.
 * Calls on the server (no page to read) do nothing.
 *
 * @returns The function that lets go of the run (idempotent).
 */
export function startHeroTimeline(options: HeroTimelineOptions = {}): () => void {
	const env = options.env ?? (hasDom() ? browserEnvironment() : null);
	if (!env) return () => {};
	if (run) configure(run, options);
	else run = open(env, options);
	holders += 1;
	let held = true;
	return () => {
		if (!held) return;
		held = false;
		holders -= 1;
		if (holders === 0 && run) close(run);
	};
}
// #endregion
