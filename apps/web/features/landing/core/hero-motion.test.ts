/**
 * hero-motion.test — the hero timeline's scheduler on a fake page and a fake clock: turns
 * alternate from `--bp-md` and stop after one pair per example, a board turn the theatre cannot play
 * yet is owed and played once it can, Save-Data plays no board turns, a typewriter turn stretches to
 * its longest example, the pause toggle / reduced motion / a hidden tab / the search hovered or
 * focused hold the clock and resume the same turn, below `--bp-md` the typewriter's whole run is five
 * seconds, using the search or a crossed breakpoint ends it, and participants share one run.
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { effect } from "@preact/signals";
import {
	boardTurnMs,
	HERO_TIMING,
	heroBoardAllowed,
	heroBoardReady,
	heroCanPause,
	heroDone,
	type HeroEnvironment,
	heroMotionAllowed,
	heroPaused,
	type HeroSearchSignals,
	heroTurn,
	heroTurnId,
	motionAllowed,
	startHeroTimeline,
} from "./hero-motion.ts";

// #region Fake page
interface PageState {
	reduced: boolean;
	wide: boolean;
	hidden: boolean;
	saveData: boolean;
}

/** A page whose media queries and visibility the test sets, with countable subscriptions. */
function fakePage(init: Partial<PageState> = {}) {
	const state: PageState = { reduced: false, wide: true, hidden: false, saveData: false, ...init };
	const watchers = new Set<() => void>();
	const searches = new Set<HeroSearchSignals>();
	const env: HeroEnvironment = {
		reducedMotion: () => state.reduced,
		wide: () => state.wide,
		hidden: () => state.hidden,
		saveData: () => state.saveData,
		watch(onChange) {
			watchers.add(onChange);
			return () => watchers.delete(onChange);
		},
		interactions(signals) {
			searches.add(signals);
			return () => searches.delete(signals);
		},
	};
	return {
		env,
		set(patch: Partial<PageState>) {
			Object.assign(state, patch);
			for (const watcher of [...watchers]) watcher();
		},
		/** The search field hovered or focused (`true`), or let go. */
		engage(engaged: boolean) {
			for (const signals of [...searches]) signals.engaged(engaged);
		},
		/** The visitor types, presses or picks in the search. */
		use() {
			for (const signals of [...searches]) signals.used();
		},
		subscriptions: () => watchers.size + searches.size,
	};
}

/** Every test starts from a closed timeline and a theatre that cannot play. */
function fresh(): void {
	heroBoardReady.value = false;
	heroPaused.value = false;
}

const BOARD_MS = 3000;
// #endregion

// #region Turns
Deno.test("from --bp-md the typewriter and the board take turns, one pair per example, then stop", () => {
	using time = new FakeTime();
	fresh();
	heroBoardReady.value = true;
	const page = fakePage();
	const first = heroTurnId.value;
	const stop = startHeroTimeline({ env: page.env, examples: 2, boardMs: BOARD_MS });

	assertEquals(heroTurn.value, "typewriter");
	assertEquals(heroTurnId.value, first + 1);
	assert(heroCanPause.value);
	time.tick(HERO_TIMING.typewriterMs - 1);
	assertEquals(heroTurn.value, "typewriter");
	time.tick(1);
	assertEquals(heroTurn.value, "board");
	assertEquals(heroTurnId.value, first + 2);
	time.tick(BOARD_MS);
	assertEquals(heroTurn.value, "typewriter");
	time.tick(HERO_TIMING.typewriterMs);
	assertEquals(heroTurn.value, "board");
	time.tick(BOARD_MS - 1);
	assertFalse(heroDone.value);
	time.tick(1);
	assertEquals(heroTurn.value, "idle");
	assert(heroDone.value);
	assertFalse(heroCanPause.value);
	assertEquals(heroTurnId.value, first + 4);

	time.tick(60_000);
	assertEquals(heroTurn.value, "idle");
	stop();
});

Deno.test("a board turn the theatre cannot play yet is owed: the typewriter goes on, then the board plays", () => {
	using time = new FakeTime();
	fresh();
	const page = fakePage();
	const first = heroTurnId.value;
	const stop = startHeroTimeline({ env: page.env, examples: 2, boardMs: BOARD_MS });

	time.tick(HERO_TIMING.typewriterMs);
	assertEquals(heroTurn.value, "typewriter");
	assertEquals(heroTurnId.value, first + 2);
	time.tick(HERO_TIMING.typewriterMs);
	assertEquals(heroTurn.value, "idle", "every typewriter turn played: waiting for the theatre");
	assertFalse(heroDone.value);
	assert(heroCanPause.value, "the owed loop can still be paused");
	time.tick(60_000);
	assertEquals(heroTurn.value, "idle");

	heroBoardReady.value = true;
	assertEquals(heroTurn.value, "board");
	time.tick(BOARD_MS);
	assertEquals(heroTurn.value, "board", "the second owed loop");
	time.tick(BOARD_MS);
	assert(heroDone.value);
	assertEquals(heroTurnId.value, first + 4);
	stop();
});

Deno.test("a board turn owed early plays as soon as the theatre is ready, between typewriter turns", () => {
	using time = new FakeTime();
	fresh();
	const page = fakePage();
	const stop = startHeroTimeline({ env: page.env, examples: 3, boardMs: BOARD_MS });

	time.tick(HERO_TIMING.typewriterMs);
	assertEquals(heroTurn.value, "typewriter", "the first board turn is owed");
	heroBoardReady.value = true;
	assertEquals(heroTurn.value, "typewriter", "a typewriter turn under way is not cut short");
	time.tick(HERO_TIMING.typewriterMs);
	assertEquals(heroTurn.value, "board");
	time.tick(BOARD_MS);
	assertEquals(heroTurn.value, "typewriter");
	time.tick(HERO_TIMING.typewriterMs);
	assertEquals(heroTurn.value, "board");
	time.tick(BOARD_MS);
	assertEquals(heroTurn.value, "board", "the owed one, after the last typewriter turn");
	time.tick(BOARD_MS);
	assert(heroDone.value);
	stop();
});

Deno.test("under Save-Data the theatre plays no board turn and the typewriter runs alone", () => {
	using time = new FakeTime();
	fresh();
	heroBoardReady.value = true;
	const page = fakePage({ saveData: true });
	const stop = startHeroTimeline({ env: page.env, examples: 2, boardMs: BOARD_MS });

	assert(heroCanPause.value, "the typewriter still runs past five seconds");
	assertFalse(heroBoardAllowed.value);
	time.tick(HERO_TIMING.typewriterMs);
	assertEquals(heroTurn.value, "typewriter");
	time.tick(HERO_TIMING.typewriterMs);
	assert(heroDone.value);
	stop();
});

Deno.test("a typewriter turn stretches to the longest example, even one asked for mid-turn", () => {
	using time = new FakeTime();
	fresh();
	heroBoardReady.value = true;
	const page = fakePage();
	const stopTheatre = startHeroTimeline({ env: page.env, examples: 2, boardMs: BOARD_MS });
	time.tick(1000);
	const longer = HERO_TIMING.typewriterMs + 600;
	const stopSearch = startHeroTimeline({ env: page.env, typewriterMs: longer });
	time.tick(longer - 1001);
	assertEquals(heroTurn.value, "typewriter");
	time.tick(1);
	assertEquals(heroTurn.value, "board");
	time.tick(BOARD_MS + longer);
	assertEquals(heroTurn.value, "board", "the next typewriter turn is the longer one too");
	const shorter = startHeroTimeline({ env: page.env, typewriterMs: 100 });
	time.tick(BOARD_MS);
	assert(heroDone.value, "a shorter ask never shrinks a turn");
	shorter();
	stopSearch();
	stopTheatre();
});

Deno.test("a board turn ends as soon as the theatre can no longer play it", () => {
	using time = new FakeTime();
	fresh();
	heroBoardReady.value = true;
	const page = fakePage();
	const stop = startHeroTimeline({ env: page.env, examples: 2, boardMs: BOARD_MS });

	time.tick(HERO_TIMING.typewriterMs + 1000);
	assertEquals(heroTurn.value, "board");
	heroBoardReady.value = false;
	assertEquals(heroTurn.value, "typewriter");
	time.tick(HERO_TIMING.typewriterMs - 1);
	assertEquals(heroTurn.value, "typewriter");
	time.tick(1);
	assertEquals(heroTurn.value, "idle", "the second board turn waits for the theatre");
	assertFalse(heroDone.value);
	heroBoardReady.value = true;
	assertEquals(heroTurn.value, "board");
	time.tick(BOARD_MS);
	assert(heroDone.value, "the interrupted turn counted as played");
	stop();
});

Deno.test("a participant never sees a new turn's id beside the previous turn's kind", () => {
	using time = new FakeTime();
	fresh();
	heroBoardReady.value = true;
	const page = fakePage();
	const seen: Array<[string, number]> = [];
	const stopWatching = effect(() => {
		seen.push([heroTurn.value, heroTurnId.value]);
	});
	const stop = startHeroTimeline({ env: page.env, examples: 2, boardMs: BOARD_MS });
	time.tick(2 * (HERO_TIMING.typewriterMs + BOARD_MS));
	stop();
	stopWatching();

	const kinds = new Map<number, Set<string>>();
	for (const [turn, id] of seen) {
		if (turn === "idle") continue;
		kinds.set(id, (kinds.get(id) ?? new Set()).add(turn));
	}
	assertEquals(kinds.size, 4);
	for (const [id, turns] of kinds) assertEquals(turns.size, 1, `turn ${id} read as ${[...turns]}`);
});

Deno.test("the theatre's own loop length sets the board turn, and the most examples asked for win", () => {
	using time = new FakeTime();
	fresh();
	heroBoardReady.value = true;
	const page = fakePage();
	const stopSearch = startHeroTimeline({ env: page.env, examples: 1 });
	const stopTheatre = startHeroTimeline({ env: page.env, examples: 3, boardMs: boardTurnMs(1) });

	time.tick(HERO_TIMING.typewriterMs);
	assertEquals(heroTurn.value, "board");
	time.tick(boardTurnMs(1));
	assertEquals(heroTurn.value, "typewriter");
	time.tick(HERO_TIMING.typewriterMs + boardTurnMs(1));
	time.tick(HERO_TIMING.typewriterMs);
	assertEquals(heroTurn.value, "board");
	time.tick(boardTurnMs(1));
	assert(heroDone.value);
	stopSearch();
	stopTheatre();
});
// #endregion

// #region Holding the clock
Deno.test("Pause the example holds the clock, and resuming continues the same turn", () => {
	using time = new FakeTime();
	fresh();
	heroBoardReady.value = true;
	const page = fakePage();
	const stop = startHeroTimeline({ env: page.env, examples: 1, boardMs: BOARD_MS });
	const turn = heroTurnId.value;

	time.tick(1000);
	heroPaused.value = true;
	assertEquals(heroTurn.value, "idle");
	assert(heroCanPause.value, "the toggle stays while there is something left to play");
	time.tick(60_000);
	assertEquals(heroTurn.value, "idle");
	assertEquals(heroTurnId.value, turn);

	heroPaused.value = false;
	assertEquals(heroTurn.value, "typewriter");
	assertEquals(heroTurnId.value, turn, "a resumed turn keeps its id");
	time.tick(HERO_TIMING.typewriterMs - 1001);
	assertEquals(heroTurn.value, "typewriter");
	time.tick(1);
	assertEquals(heroTurn.value, "board");
	stop();
});

Deno.test("either reduced-motion channel forces idle, watched live, and holds the clock", () => {
	using time = new FakeTime();
	fresh();
	heroBoardReady.value = true;
	const page = fakePage({ reduced: true });
	const stop = startHeroTimeline({ env: page.env, examples: 1, boardMs: BOARD_MS });

	assertEquals(heroTurn.value, "idle");
	assertFalse(heroCanPause.value, "nothing to pause under reduced motion");
	time.tick(60_000);
	assertEquals(heroTurn.value, "idle");
	assertFalse(heroDone.value);

	page.set({ reduced: false });
	assertEquals(heroTurn.value, "typewriter");
	assert(heroCanPause.value);
	time.tick(2000);
	page.set({ reduced: true });
	assertEquals(heroTurn.value, "idle");
	time.tick(60_000);
	page.set({ reduced: false });
	time.tick(HERO_TIMING.typewriterMs - 2001);
	assertEquals(heroTurn.value, "typewriter");
	time.tick(1);
	assertEquals(heroTurn.value, "board");
	stop();
});

Deno.test("a hidden tab holds the clock", () => {
	using time = new FakeTime();
	fresh();
	heroBoardReady.value = true;
	const page = fakePage();
	const stop = startHeroTimeline({ env: page.env, examples: 1 });

	time.tick(1000);
	page.set({ hidden: true });
	assertEquals(heroTurn.value, "idle");
	time.tick(60_000);
	page.set({ hidden: false });
	assertEquals(heroTurn.value, "typewriter");
	time.tick(HERO_TIMING.typewriterMs - 1001);
	assertEquals(heroTurn.value, "typewriter");
	time.tick(1);
	assertEquals(heroTurn.value, "board");
	stop();
});

Deno.test("the search hovered or holding focus holds the clock; letting go resumes the same turn", () => {
	using time = new FakeTime();
	fresh();
	heroBoardReady.value = true;
	const page = fakePage();
	const stop = startHeroTimeline({ env: page.env, examples: 2, boardMs: BOARD_MS });
	const turn = heroTurnId.value;

	time.tick(1000);
	page.engage(true);
	assertEquals(heroTurn.value, "idle", "the B9 ring may turn now, so nothing else moves");
	assert(heroCanPause.value, "the toggle stays reachable past the search");
	assertFalse(heroDone.value);
	time.tick(60_000);
	page.engage(false);
	assertEquals(heroTurn.value, "typewriter");
	assertEquals(heroTurnId.value, turn, "a resumed turn keeps its id");
	time.tick(HERO_TIMING.typewriterMs - 1000);
	assertEquals(heroTurn.value, "board");
	page.engage(true);
	assertEquals(heroTurn.value, "idle", "a board turn holds too");
	page.engage(false);
	assertEquals(heroTurn.value, "board");
	stop();
});

Deno.test("reduced motion turning on is heard while the turn is already idle", () => {
	using time = new FakeTime();
	fresh();
	heroBoardReady.value = true;
	const page = fakePage();
	const stop = startHeroTimeline({ env: page.env, examples: 1, boardMs: BOARD_MS });
	time.tick(HERO_TIMING.typewriterMs + 500);
	assertEquals(heroTurn.value, "board");
	heroPaused.value = true;
	assertEquals(heroTurn.value, "idle");
	assert(heroMotionAllowed.value);
	page.set({ reduced: true });
	assertFalse(heroMotionAllowed.value, "the theatre rests its board on this, whatever the turn");
	stop();
});
// #endregion

// #region Ending
Deno.test("below --bp-md the typewriter is the only turn and its whole run is five seconds", () => {
	using time = new FakeTime();
	fresh();
	heroBoardReady.value = true;
	const page = fakePage({ wide: false });
	const stop = startHeroTimeline({ env: page.env, examples: 6, boardMs: BOARD_MS });

	assertEquals(heroTurn.value, "typewriter");
	assertFalse(heroCanPause.value, "no toggle below --bp-md");
	time.tick(HERO_TIMING.narrowCapMs - 1);
	assertEquals(heroTurn.value, "typewriter");
	time.tick(1);
	assertEquals(heroTurn.value, "idle");
	assert(heroDone.value);
	stop();
});

Deno.test("using the hero search ends the timeline for good", () => {
	using time = new FakeTime();
	fresh();
	heroBoardReady.value = true;
	const page = fakePage();
	const stop = startHeroTimeline({ env: page.env, examples: 3, boardMs: BOARD_MS });

	time.tick(HERO_TIMING.typewriterMs);
	assertEquals(heroTurn.value, "board");
	page.use();
	assertEquals(heroTurn.value, "idle");
	assert(heroDone.value);
	heroPaused.value = true;
	heroPaused.value = false;
	time.tick(60_000);
	assertEquals(heroTurn.value, "idle");
	stop();
});

Deno.test("crossing --bp-md ends the timeline", () => {
	using time = new FakeTime();
	fresh();
	const page = fakePage();
	const stop = startHeroTimeline({ env: page.env, examples: 3 });

	time.tick(1000);
	page.set({ wide: false });
	assertEquals(heroTurn.value, "idle");
	assert(heroDone.value);
	stop();
});
// #endregion

// #region Sharing
Deno.test("participants share one run, and the last to let go closes it and resets every signal", () => {
	using time = new FakeTime();
	fresh();
	const page = fakePage();
	const stopSearch = startHeroTimeline({ env: page.env });
	const stopTheatre = startHeroTimeline({ env: page.env });
	assertEquals(page.subscriptions(), 2, "one run: one watch and one search listener");

	time.tick(1000);
	heroPaused.value = true;
	stopSearch();
	assertEquals(page.subscriptions(), 2);
	assertEquals(heroTurn.value, "idle");
	stopTheatre();
	stopTheatre();
	assertEquals(page.subscriptions(), 0);
	assertEquals(heroTurn.value, "idle");
	assertFalse(heroPaused.value);
	assertFalse(heroDone.value);
	assertFalse(heroCanPause.value);

	const again = startHeroTimeline({ env: page.env });
	assertEquals(heroTurn.value, "typewriter");
	again();
});

Deno.test("without a page nothing starts and motion is never allowed", () => {
	fresh();
	assertFalse(motionAllowed());
	const stop = startHeroTimeline();
	assertEquals(heroTurn.value, "idle");
	assertFalse(heroCanPause.value);
	stop();
});
// #endregion

// #region Tokens
Deno.test("a board turn is its opening hold plus each step and its hold", () => {
	assertEquals(boardTurnMs(0), HERO_TIMING.holdMs);
	assertEquals(boardTurnMs(2), HERO_TIMING.holdMs + 2 * (HERO_TIMING.beatMs + HERO_TIMING.holdMs));
});

Deno.test("HERO_TIMING mirrors the stage tokens in lp-theme.css", () => {
	const css = Deno.readTextFileSync(new URL("../styles/lp-theme.css", import.meta.url));
	const token = (name: string) => {
		const match = css.match(new RegExp(`${name}:\\s*(\\d+)ms;`));
		assert(match, `${name} is declared in ms`);
		return Number(match[1]);
	};
	assertEquals(token("--lp-dur-demo"), HERO_TIMING.beatMs);
	assertEquals(token("--lp-dur-demo-hold"), HERO_TIMING.holdMs);
});
// #endregion
