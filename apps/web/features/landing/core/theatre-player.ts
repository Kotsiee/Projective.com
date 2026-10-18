/// <reference lib="dom" />

/**
 * theatre-player — plays the hero theatre's scripted loop on the server-rendered board (`flows/
 * LANDING.md` §2.3 note 5, §2.7). Loaded only through `import()` by the HeroTheatre island, once the
 * theatre comes into view from `--bp-md` with motion allowed, so none of it is in the page's
 * initial JavaScript; it lives outside `islands/` because every module there is an island the
 * server snapshot evaluates (Decision #285 (D)).
 *
 * The board is never re-rendered on the client. Each frame is a short list of facts per card — its
 * lane, stage, tag and whether it waits on approval — that the player writes onto the existing DOM:
 * it moves a card's list item into its lane's body, sets the tag's text and tone, the counts and the
 * money line. A move animates FLIP-style with `transform` only, measured in layout offsets so the
 * stage's 3D tilt does not skew it. Everything it touches sits inside the theatre's inert subtree.
 */
import { HERO_TIMING } from "./hero-motion.ts";

// #region Frames
/** One card in a {@link TheatreFrame}: everything about it that the loop can change. */
export interface TheatreCardFrame {
	id: string;
	/** The lane it sits in (`data-lp-lane` on that lane's title). */
	lane: string;
	/** The stage it stands on. */
	stage: string | null;
	/** Its tag's text, or `null` for none. */
	tag: string | null;
	/** Its tag's role tone (`data-tone`), or `null`. */
	tone: string | null;
	/** Whether it shows "Approve and pay". */
	approve: boolean;
}

/** One still of the loop, as the server formatted it. */
export interface TheatreFrame {
	cards: TheatreCardFrame[];
	/** The money line ("1 task needs £400 to start"), or `null` when nothing waits on payment. */
	needs: string | null;
	/** The card this frame calls attention to, and why. */
	beat: { cardId: string; kind: string } | null;
}

/** The loop, driven by the island from the hero timeline. */
export interface TheatrePlayer {
	/** A new board turn: back to the first frame, then play the loop. */
	restart(): void;
	/** Carry on from where {@link hold} stopped. */
	resume(): void;
	/** Stop where it is: the step in flight lands, the clock holds. */
	hold(): void;
	/** Back to the first frame and stay there (motion is no longer allowed). */
	rest(): void;
	dispose(): void;
}
// #endregion

// #region DOM
/** The nodes the loop writes for one card. */
interface CardNodes {
	face: HTMLElement;
	item: HTMLElement;
	tag: HTMLElement | null;
	approve: HTMLElement | null;
	stage: HTMLElement | null;
}

/** One lane's body and its count. */
interface LaneNodes {
	body: HTMLElement;
	count: HTMLElement | null;
}

/** `el`'s offset inside `root`, summed through its offset parents (layout px, untransformed). */
function offsetIn(el: HTMLElement, root: HTMLElement): { x: number; y: number } {
	let x = 0;
	let y = 0;
	let node: HTMLElement | null = el;
	while (node && node !== root) {
		x += node.offsetLeft;
		y += node.offsetTop;
		node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null;
	}
	return { x, y };
}

/** A custom property of `el`, trimmed, or `fallback` when unset. */
function cssValue(el: HTMLElement, name: string, fallback: string): string {
	return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}
// #endregion

// #region Player
/**
 * A player for `frames` on the theatre `stage` (the `.lp-theatre` figure). The first frame is the
 * one the server rendered.
 */
export function createTheatrePlayer(
	stage: HTMLElement,
	frames: readonly TheatreFrame[],
): TheatrePlayer {
	const lanesRoot = stage.querySelector<HTMLElement>(".lp-theatre__lanes") ?? stage;
	const needs = stage.querySelector<HTMLElement>("[data-lp-needs]");
	const needsText = stage.querySelector<HTMLElement>("[data-lp-needs-text]");
	const lanes = new Map<string, LaneNodes>();
	for (const title of stage.querySelectorAll<HTMLElement>("[data-lp-lane]")) {
		const column = title.closest<HTMLElement>(".ui-kanban__column");
		const body = column?.querySelector<HTMLElement>(".ui-kanban__col-body");
		if (column && body && title.dataset.lpLane) {
			lanes.set(title.dataset.lpLane, {
				body,
				count: column.querySelector<HTMLElement>("[data-lp-count]"),
			});
		}
	}
	const cards = new Map<string, CardNodes>();
	for (const face of stage.querySelectorAll<HTMLElement>("[data-lp-card]")) {
		if (!face.dataset.lpCard) continue;
		cards.set(face.dataset.lpCard, {
			face,
			item: face.closest<HTMLElement>('[role="listitem"]') ?? face,
			tag: face.querySelector<HTMLElement>("[data-lp-tag]"),
			approve: face.querySelector<HTMLElement>("[data-lp-approve]"),
			stage: face.querySelector<HTMLElement>("[data-lp-stage]"),
		});
	}

	const easing = cssValue(stage, "--lp-ease-out", "ease-out");
	const pressScale = cssValue(stage, "--lp-press-scale", "1");
	const animations = new Set<Animation>();
	let index = 0;
	let playing = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let remaining = 0;
	let since = 0;

	const track = (animation: Animation) => {
		animations.add(animation);
		animation.addEventListener("finish", () => animations.delete(animation));
		animation.addEventListener("cancel", () => animations.delete(animation));
		return animation;
	};

	/** Writes `frame` onto the board; `animate` moves and fades instead of jumping. */
	function apply(frame: TheatreFrame, animate: boolean): void {
		const moves: Array<{ item: HTMLElement; from: { x: number; y: number } }> = [];
		for (const card of frame.cards) {
			const nodes = cards.get(card.id);
			const lane = lanes.get(card.lane);
			if (!nodes || !lane) continue;
			if (nodes.item.parentElement !== lane.body) {
				moves.push({ item: nodes.item, from: offsetIn(nodes.item, lanesRoot) });
				lane.body.append(nodes.item);
			}
			if (nodes.stage) nodes.stage.textContent = card.stage ?? "";
			if (nodes.tag) {
				const shows = card.tag !== null;
				const changed = nodes.tag.hidden === shows || nodes.tag.textContent !== (card.tag ?? "");
				nodes.tag.hidden = !shows;
				nodes.tag.textContent = card.tag ?? "";
				if (card.tone) nodes.tag.dataset.tone = card.tone;
				if (animate && changed && shows) {
					track(nodes.tag.animate([{ opacity: 0 }, { opacity: 1 }], {
						duration: HERO_TIMING.beatMs / 2,
						easing,
					}));
				}
			}
			if (nodes.approve) {
				const approve = nodes.approve;
				if (animate && !approve.hidden && !card.approve) {
					// The press, then the control goes: approving is what this step shows. The finish
					// event arrives after any later frame has been written, so it hides the control only
					// while this frame is still the one on screen.
					const shown = index;
					const press = track(approve.animate([
						{ transform: "scale(1)" },
						{ transform: `scale(${pressScale})` },
						{ transform: "scale(1)" },
					], { duration: HERO_TIMING.beatMs / 3, easing }));
					press.addEventListener("finish", () => {
						if (index === shown) approve.hidden = true;
					});
				} else {
					approve.hidden = !card.approve;
				}
			}
			if (frame.beat?.cardId === card.id) nodes.face.dataset.lpBeat = frame.beat.kind;
			else delete nodes.face.dataset.lpBeat;
		}
		for (const lane of lanes.values()) {
			if (lane.count) {
				lane.count.textContent = String(
					lane.body.querySelectorAll(':scope > [role="listitem"]').length,
				);
			}
		}
		if (needs) needs.hidden = frame.needs === null;
		if (needsText && frame.needs !== null) needsText.textContent = frame.needs;
		if (!animate) return;
		for (const move of moves) {
			const to = offsetIn(move.item, lanesRoot);
			const dx = move.from.x - to.x;
			const dy = move.from.y - to.y;
			if (dx === 0 && dy === 0) continue;
			track(move.item.animate([
				{ transform: `translate(${dx}px, ${dy}px)` },
				{ transform: "none" },
			], { duration: HERO_TIMING.beatMs, easing }));
		}
	}

	function clearTimer(): void {
		if (timer !== null) clearTimeout(timer);
		timer = null;
	}

	function schedule(delay: number): void {
		clearTimer();
		remaining = delay;
		since = Date.now();
		timer = setTimeout(step, delay);
	}

	function land(): void {
		for (const animation of [...animations]) animation.finish();
	}

	/** The next frame, then its hold; the loop ends on its last frame. */
	function step(): void {
		timer = null;
		if (index >= frames.length - 1) {
			playing = false;
			return;
		}
		index += 1;
		apply(frames[index], true);
		schedule(HERO_TIMING.beatMs + HERO_TIMING.holdMs);
	}

	function toStart(): void {
		land();
		clearTimer();
		if (index !== 0 && frames[0]) apply(frames[0], false);
		index = 0;
	}

	return {
		restart() {
			const moved = index !== 0;
			toStart();
			if (moved) {
				track(lanesRoot.animate([{ opacity: 0.4 }, { opacity: 1 }], {
					duration: HERO_TIMING.beatMs / 3,
					easing,
				}));
			}
			playing = frames.length > 1;
			if (playing) schedule(HERO_TIMING.holdMs);
		},
		resume() {
			if (!playing || timer !== null) return;
			schedule(remaining);
		},
		hold() {
			land();
			if (timer === null) return;
			clearTimer();
			remaining = Math.max(0, remaining - (Date.now() - since));
		},
		rest() {
			toStart();
			playing = false;
		},
		dispose() {
			clearTimer();
			for (const animation of [...animations]) animation.cancel();
			playing = false;
		},
	};
}
// #endregion
