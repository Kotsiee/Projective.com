import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { styleVars } from "@ui/core/style.ts";
import type { SplitStake } from "@projective/types/workspace";

/**
 * SplitBar — the signature instrument of the team payout editor.
 *
 * One shared rail. Each member's segment is sized by `flex-grow` from their `shareBp`, so **the
 * dividers ARE the total**: there is no arithmetic to trust, because the widths visibly consume one
 * whole. Dragging a divider moves share between neighbours and the sum stays exactly 100%, enforced by
 * the SSOT's own `rebalanceSplit` — this component never touches the maths. It reports a requested
 * share in basis points and the parent applies the pure function (see {@link SplitBarProps.onMove}).
 *
 * ### Three rules this component exists to keep
 *
 * 1. **Width is never animated.** A segment's width encodes somebody's money. A transition or keyframe
 *    on it means a frozen animation clock (a backgrounded tab, a paused compositor) can leave every
 *    share at zero — the bar would be showing a lie with total confidence. Only the drag handle's grip
 *    animates, and only via `transform`/`opacity`.
 * 2. **No stake is ever given a minimum width.** A 1% share is 1% wide. Fabricating a few pixels of
 *    floor would over-state a small stake at every other stake's expense, so a share below
 *    `--wsp-sliver` gets an overhanging *pip* above the rail instead: visibility decoupled from width,
 *    which is the only honest way to label a sliver.
 * 3. **Every drag is reachable from the keyboard.** A split editable only by pointer is a split a
 *    keyboard user cannot audit, so each divider is a real `role="slider"` with a visible focus ring,
 *    Arrow/Page/Home/End handling, and an `aria-valuetext` naming the person and their share. The
 *    segments themselves carry no text and no role — they contribute nothing to the accessibility tree,
 *    because {@link SplitLegend} is the record and this is the overview.
 *
 * ### Held stakes
 * A held stake is immovable and is never reassigned to anybody else (that is the entire point of
 * holding one). Its own divider locks, and it is excluded from the absorbing set, so the reachable
 * maximum for every other divider shrinks by the held total rather than the held share silently
 * becoming someone else's.
 */

// #region Props
export interface SplitBarProps {
	/** The live stakes, in render order. Their `shareBp` values are expected to sum to 10 000. */
	stakes: readonly SplitStake[];
	/**
	 * Requested new share, in basis points, for one member. The parent MUST resolve it through the SSOT's
	 * `rebalanceSplit(stakes, memberId, nextBp)` rather than assigning it directly — that function owns
	 * the 100% invariant, the held-stake exclusion and the integer-remainder placement.
	 */
	onMove?: (memberId: string, nextBp: number) => void;
	/** Member whose legend row is hovered/focused, so its segment lifts in sympathy. */
	highlightId?: string | null;
	/** Member ids whose share changed since the last save — their projections are no longer priced. */
	changedIds?: readonly string[];
	/** Read-only: a viewer without `manage_finances`, or a policy locked pending verification. */
	readOnly?: boolean;
}
// #endregion

// #region Geometry
/** Keyboard step sizes in basis points — 1% on an arrow, 5% on a page. */
const STEP_BP = 100;
const PAGE_BP = 500;

/**
 * Fallback sliver threshold in percent, mirroring `--wsp-sliver`. The token is authoritative and is read
 * from the live computed style on mount; this constant only covers the first render and SSR, where there
 * is no computed style to consult.
 */
const SLIVER_PCT = 3;

/** How close two sliver midpoints may sit, in percent of the rail, before their pips are staggered. */
const NEAR_PCT = 9;
/** One stagger level, in pixels — matched to the pip row height the stylesheet reserves. */
const LIFT_STEP_PX = 20;

/** The tone slot for a stake, cycling through the six palette stakes (`data-stake` is 1-based). */
function toneOf(index: number): number {
	return (index % 6) + 1;
}

/** Cumulative share, in basis points, of every stake BEFORE `index`. */
function shareBefore(stakes: readonly SplitStake[], index: number): number {
	let sum = 0;
	for (let i = 0; i < index; i++) sum += stakes[i].shareBp;
	return sum;
}

/** Total held share, in basis points, excluding the stake at `index`. */
function heldElsewhere(stakes: readonly SplitStake[], index: number): number {
	let sum = 0;
	for (let i = 0; i < stakes.length; i++) {
		if (i !== index && stakes[i].held) sum += stakes[i].shareBp;
	}
	return sum;
}

/**
 * The highest share a stake can reach: everything the unheld stakes could give up. A stake can never
 * claim a held neighbour's share, so the ceiling is 100% minus the held total elsewhere — mirroring the
 * cap `rebalanceSplit` applies, so the slider's advertised range and the function's behaviour agree
 * instead of the control promising a reach the rebalance then quietly clamps.
 */
function ceilingOf(stakes: readonly SplitStake[], index: number): number {
	return 10_000 - heldElsewhere(stakes, index);
}

/** Whether a divider can move at all: a held stake is fixed, and so is one with nothing to absorb it. */
function lockedAt(stakes: readonly SplitStake[], index: number): boolean {
	if (stakes[index].held) return true;
	return !stakes.some((s, i) => i !== index && !s.held);
}

/** One decimal place of percent from basis points, as a number fit for `aria-valuenow`. */
function pct(bp: number): number {
	return Math.round(bp / 10) / 10;
}

/**
 * The per-pip vertical lift, in pixels, keyed by member id, so two slivers never print their labels on
 * top of one another.
 *
 * Whether two pips collide depends on which stakes happen to be slivers in THIS split, so no static
 * stagger can know: a lone 1% stake needs no lift at all, while three consecutive 1% stakes need three
 * levels. The rule is positional — a sliver whose midpoint sits within {@link NEAR_PCT} of the previous
 * sliver's steps up a level, and one comfortably clear of it resets to the rail.
 */
function pipLifts(stakes: readonly SplitStake[], sliverPct: number): Map<string, number> {
	const lifts = new Map<string, number>();
	let cursorBp = 0;
	let lastMidPct = -Infinity;
	let level = 0;
	for (const stake of stakes) {
		const midPct = (cursorBp + stake.shareBp / 2) / 100;
		if (stake.shareBp > 0 && stake.shareBp / 100 < sliverPct) {
			level = midPct - lastMidPct < NEAR_PCT ? level + 1 : 0;
			lifts.set(stake.memberId, level * LIFT_STEP_PX);
			lastMidPct = midPct;
		}
		cursorBp += stake.shareBp;
	}
	return lifts;
}
// #endregion

// #region Component
/**
 * The multi-handle split bar. Controlled: it holds no share state of its own, only the transient drag
 * identity, so a rebalance the parent refuses (an all-held row) simply never arrives back as a width.
 */
export function SplitBar(props: SplitBarProps): JSX.Element {
	const { stakes, readOnly = false } = props;
	const trackRef = useRef<HTMLDivElement | null>(null);
	const dragging = useSignal<string | null>(null);
	const sliver = useSignal<number>(SLIVER_PCT);
	const changed = new Set(props.changedIds ?? []);

	// The stylesheet owns the sliver threshold; read it once the rail exists so the two cannot drift.
	useEffect(() => {
		const track = trackRef.current;
		if (!track) return;
		const raw = getComputedStyle(track).getPropertyValue("--wsp-sliver").trim();
		const parsed = Number.parseFloat(raw);
		if (Number.isFinite(parsed) && parsed > 0) sliver.value = parsed;
	}, []);

	const lifts = pipLifts(stakes, sliver.value);

	/**
	 * Translate a pointer position into a requested share for the divider after `index`.
	 *
	 * The rail is `usable = width − gaps`, so the end of stake `index` sits at
	 * `usable × cumulativeShare + index × gap`. Inverting that gives the cumulative share the pointer is
	 * asking for, and subtracting everything before the stake gives the stake's own share. The gap comes
	 * from the live computed style rather than being assumed, and the measurement runs from the
	 * **inline-start** edge, so a right-to-left document drags in the direction its reader expects with
	 * no transform and no second code path.
	 */
	const shareAtPointer = (index: number, clientX: number): number | null => {
		const track = trackRef.current;
		if (!track) return null;
		const rect = track.getBoundingClientRect();
		if (rect.width <= 0) return null;

		const style = getComputedStyle(track);
		const gap = Number.parseFloat(style.columnGap) || 0;
		const usable = Math.max(1, rect.width - gap * Math.max(0, stakes.length - 1));
		const fromStart = style.direction === "rtl" ? rect.right - clientX : clientX - rect.left;

		const cumulative = (fromStart - index * gap) / usable;
		const requested = Math.round(cumulative * 10_000) - shareBefore(stakes, index);
		return Math.max(0, Math.min(ceilingOf(stakes, index), requested));
	};

	const move = (index: number, nextBp: number): void => {
		if (readOnly || lockedAt(stakes, index)) return;
		props.onMove?.(stakes[index].memberId, nextBp);
	};

	const onPointerDown = (index: number) => (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
		if (readOnly || lockedAt(stakes, index)) return;
		dragging.value = stakes[index].memberId;
		event.currentTarget.setPointerCapture(event.pointerId);
		// Suppress the native text-selection / scroll gesture without suppressing focus.
		event.preventDefault();
		event.currentTarget.focus();
	};

	const onPointerMove = (index: number) => (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
		if (dragging.value !== stakes[index].memberId) return;
		const next = shareAtPointer(index, event.clientX);
		if (next !== null) move(index, next);
	};

	const endDrag = (event: JSX.TargetedPointerEvent<HTMLButtonElement>): void => {
		if (dragging.value === null) return;
		dragging.value = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	};

	/**
	 * Full keyboard parity with the pointer. Horizontal arrows follow the reading direction (they invert
	 * under RtL, as the slider pattern requires); vertical arrows always mean more/less, which is the one
	 * unambiguous axis. `End` goes to the ceiling the held stakes leave rather than a blanket 100%, so the
	 * key never asks for a share the rebalance would silently clamp back.
	 */
	const onKeyDown = (index: number) => (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
		if (readOnly || lockedAt(stakes, index)) return;
		const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
		const current = stakes[index].shareBp;
		const ceiling = ceilingOf(stakes, index);
		let next: number;

		switch (event.key) {
			case "ArrowRight":
				next = current + (rtl ? -STEP_BP : STEP_BP);
				break;
			case "ArrowLeft":
				next = current + (rtl ? STEP_BP : -STEP_BP);
				break;
			case "ArrowUp":
				next = current + STEP_BP;
				break;
			case "ArrowDown":
				next = current - STEP_BP;
				break;
			case "PageUp":
				next = current + PAGE_BP;
				break;
			case "PageDown":
				next = current - PAGE_BP;
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = ceiling;
				break;
			default:
				return;
		}
		event.preventDefault();
		move(index, Math.max(0, Math.min(ceiling, next)));
	};

	return (
		<div class="wsp-split__bar">
			<div class="wsp-split__track" ref={trackRef}>
				{stakes.map((stake, index) => {
					const percent = pct(stake.shareBp);
					const lift = lifts.get(stake.memberId);
					const locked = lockedAt(stakes, index);
					const priced = changed.has(stake.memberId) ? null : stake.projected.display;

					return (
						<div
							class="wsp-split__seg"
							key={stake.memberId}
							data-stake={toneOf(index)}
							data-held={stake.held ? "true" : "false"}
							data-zero={stake.shareBp === 0 ? "true" : "false"}
							data-hover={props.highlightId === stake.memberId ? "true" : "false"}
							style={styleVars({ "--wsp-share": percent })}
						>
							{lift !== undefined && (
								<span class="wsp-split__pip" style={styleVars({ "--wsp-pip-lift": `${lift}px` })}>
									<span class="wsp-split__pip-dot" />
									<span>{percent}%</span>
									<span class="wsp-split__pip-stem" />
								</span>
							)}
							{index < stakes.length - 1 && (
								<button
									type="button"
									class="wsp-split__handle"
									role="slider"
									aria-orientation="horizontal"
									aria-label={`Share for ${stake.name}`}
									aria-valuemin={0}
									aria-valuemax={pct(ceilingOf(stakes, index))}
									aria-valuenow={percent}
									aria-valuetext={priced
										? `${stake.name}, ${percent}% — ${priced} of the next release`
										: `${stake.name}, ${percent}% — the amount re-prices when you save`}
									aria-readonly={readOnly ? "true" : undefined}
									aria-disabled={locked ? "true" : undefined}
									data-dragging={dragging.value === stake.memberId ? "true" : "false"}
									data-locked={locked || readOnly ? "true" : "false"}
									onPointerDown={onPointerDown(index)}
									onPointerMove={onPointerMove(index)}
									onPointerUp={endDrag}
									onPointerCancel={endDrag}
									onKeyDown={onKeyDown(index)}
								/>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
// #endregion
