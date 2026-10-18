/// <reference lib="dom" />
import "@ui/kanban/styles/kanban.css";
import "../styles/lp-theatre.css";
import type { JSX } from "preact";
import { effect, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
	heroBoardAllowed,
	heroBoardReady,
	heroCanPause,
	heroMotionAllowed,
	heroPaused,
	heroTurn,
	heroTurnId,
	startHeroTimeline,
} from "../core/hero-motion.ts";
import type { TheatreFrame, TheatrePlayer } from "../core/theatre-player.ts";

// #region Contract
/** Props for {@link HeroTheatre}. */
export interface HeroTheatreProps {
	/** The loop's frames, formatted on the server; the first is the board as it was rendered. */
	frames: TheatreFrame[];
	/** How long one board turn lasts (`boardTurnMs` of the loop's steps). */
	boardMs: number;
}

/** The loop plays only while at least this much of the theatre is on screen (§2.2 note 5). */
const VISIBLE_RATIO = 0.5;
// #endregion

// #region Component
/**
 * HeroTheatre — the hero theatre's small client half (`flows/LANDING.md` §2.2 note 5, §2.3 note 5,
 * §2.7, §4.1). It renders only the "Pause the example" toggle — and only once hydrated, from
 * `--bp-md`, while motion is allowed and the hero timeline still has something to play, so no
 * control renders that would do nothing (root CLAUDE.md §3 gate 11). The board beside it is the
 * server's: this island never re-renders it.
 *
 * It joins the hero timeline (`hero-motion.ts`), and when the theatre first comes into view — with
 * motion allowed and Save-Data off (`heroBoardAllowed`; §2.2 note 5) — it loads the player
 * (`core/theatre-player.ts`, a lazy chunk) that writes the scripted loop's frames onto the
 * server-rendered board. The board is ready for a turn only while at least half of it is visible;
 * it plays on the timeline's board turns, holds its frame when the visitor pauses, and goes back to
 * its still first frame whenever either reduced-motion channel turns on, whatever the turn.
 *
 * It also carries the theatre's stylesheet and the kanban sheet the static board needs: a
 * stylesheet imported by a server component never reaches the page.
 */
export default function HeroTheatre({ frames, boardMs }: HeroTheatreProps): JSX.Element {
	const anchor = useRef<HTMLSpanElement>(null);
	const focused = useSignal(false);

	useEffect(() => {
		const release = startHeroTimeline({ boardMs });
		const stage = anchor.current?.closest(".lp-showcase")?.querySelector<HTMLElement>(
			".lp-theatre",
		);
		if (!stage || frames.length < 2 || typeof IntersectionObserver !== "function") return release;

		let player: TheatrePlayer | null = null;
		let loading = false;
		let intersecting = false;
		let visible = false;
		let lastTurn = -1;
		let disposed = false;

		const ready = () => {
			heroBoardReady.value = visible && player !== null;
		};
		const drive = (turn: string, turnId: number, motion: boolean) => {
			if (!player) return;
			if (!motion) {
				player.rest();
				// The turn it rested in plays again from its first frame, should motion come back.
				lastTurn = -1;
				return;
			}
			if (turn !== "board") {
				player.hold();
				return;
			}
			if (turnId !== lastTurn) {
				lastTurn = turnId;
				player.restart();
			} else {
				player.resume();
			}
		};
		const load = () => {
			if (loading || !intersecting || !heroBoardAllowed.value) return;
			loading = true;
			import("../core/theatre-player.ts")
				.then(({ createTheatrePlayer }) => {
					if (disposed) return;
					player = createTheatrePlayer(stage, frames);
					ready();
					drive(heroTurn.value, heroTurnId.value, heroMotionAllowed.value);
				})
				.catch(() => {
					loading = false;
				});
		};

		const observer = new IntersectionObserver((entries) => {
			const entry = entries[entries.length - 1];
			if (!entry) return;
			intersecting = entry.isIntersecting;
			visible = entry.intersectionRatio >= VISIBLE_RATIO;
			load();
			ready();
		}, { threshold: [0, VISIBLE_RATIO] });
		observer.observe(stage);

		const stopDrive = effect(() =>
			drive(heroTurn.value, heroTurnId.value, heroMotionAllowed.value)
		);
		const stopLoad = effect(() => {
			if (heroBoardAllowed.value) load();
		});

		return () => {
			disposed = true;
			observer.disconnect();
			stopDrive();
			stopLoad();
			player?.dispose();
			heroBoardReady.value = false;
			release();
		};
	}, []);

	const shown = heroCanPause.value || focused.value;
	return (
		<span ref={anchor} class="lp-showcase__toggle">
			{shown
				? (
					<button
						type="button"
						class="lp-btn lp-btn--ghost lp-showcase__pause"
						aria-pressed={heroPaused.value ? "true" : "false"}
						onClick={() => (heroPaused.value = !heroPaused.value)}
						onFocus={() => (focused.value = true)}
						onBlur={() => (focused.value = false)}
					>
						Pause the example
					</button>
				)
				: null}
		</span>
	);
}
// #endregion
