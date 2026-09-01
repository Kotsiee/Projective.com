import type { JSX, VNode } from "preact";
import { useEffect, useRef } from "preact/hooks";

// #region Types

export interface CalendarMonthTrackProps {
	/** First of the month currently in view. The single source of truth for what is shown. */
	viewDate: Date;
	/** Renders one month's grid. Called for the previous, current and next month. */
	renderMonth: (monthDate: Date) => VNode;
	/** A gesture settled on an adjacent month. */
	onStep: (months: number) => void;
	/** Refuse a step that would leave the selectable range. */
	stepBlocked?: (months: number) => boolean;
}

// #endregion

// #region Constants

/**
 * Pointer travel, px, before a press becomes a drag.
 *
 * Below this a press is a click on whatever day it landed on. Without a threshold every selection
 * would also nudge the track, and a calendar that scrolls a few pixels each time you pick a date is
 * a calendar that feels broken in a way nobody can quite describe.
 */
const DRAG_THRESHOLD = 6;

/**
 * Fraction of a page a gesture must cross to count as a step, rather than a change of mind.
 *
 * A drag that stops short springs back to the month it started on: the reader looked and decided
 * against it, and committing on a 10% drag would move the calendar under a hand that was already
 * on its way back.
 */
const COMMIT_FRACTION = 0.3;

/** Page index of the month actually in view. The track always parks here at rest. */
const CENTRE = 1;

/**
 * How long to wait for a smooth scroll before forcing the track back onto its page, ms.
 *
 * A watchdog, not an animation. `scroll-behavior: smooth` is compositor-driven and simply does not
 * run in a background tab, an occluded window, or several remote-display setups — so the position
 * it was going to settle at has to be reachable without it (root CLAUDE.md §8 Decision #75). This
 * fires on a timer, which runs where a frame does not.
 */
const SETTLE_MS = 420;

// #endregion

// #region Helpers

/** Absolute month number, so two dates can be compared without month/year wrap arithmetic. */
function monthIndex(d: Date): number {
	return d.getFullYear() * 12 + d.getMonth();
}

/** First of the month `delta` months from `d`. */
function shiftMonth(d: Date, delta: number): Date {
	return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

// #endregion

/**
 * A horizontally swipeable, snap-scrolling strip of three month grids.
 *
 * The centre page is the month in view; the two either side exist so a gesture has somewhere to go.
 * When one settles, `onStep` moves the view and the strip re-renders with the new month in the
 * centre — the same trick every infinite carousel uses, and it is invisible because the page the
 * reader just scrolled to and the page they are re-parked on hold identical content.
 *
 * THE GESTURE IS DECORATION AND THE STATE IS NOT. `viewDate` is the only thing that decides which
 * month renders; scrolling merely reports that the reader asked for a different one. Everything the
 * track does to its own `scrollLeft` also lands synchronously — `scrollTo` sets the position
 * immediately and animates only if the engine feels like it, and a timer re-parks the strip
 * regardless — so a viewport where no frame ever runs still shows the right month rather than a
 * half-scrolled pair of them. That is the rule the wallet's frozen balance meter cost us
 * (Decision #60): motion may decorate a change, it may never be how the change arrives.
 *
 * Touch and trackpad are left to the browser's own snap implementation, which is smoother than
 * anything scripted and already handles momentum. Only a MOUSE drag is scripted, because there is no
 * native gesture for it.
 */
export function CalendarMonthTrack(props: CalendarMonthTrackProps): JSX.Element {
	const { viewDate, renderMonth, onStep, stepBlocked } = props;

	const trackRef = useRef<HTMLDivElement>(null);
	const lastViewRef = useRef<number>(monthIndex(viewDate));
	const settleTimer = useRef<number | undefined>(undefined);
	/** A drag is in flight; `moved` records whether it ever passed the threshold. */
	const drag = useRef<{ id: number; startX: number; startLeft: number; moved: boolean } | null>(
		null,
	);
	/** Set by a completed drag so the click it ends with does not also select a day. */
	const swallowClick = useRef(false);
	/** The page a programmatic scroll is heading for, or `null` when the track is the reader's. */
	const aiming = useRef<number | null>(null);

	const blocked = (months: number) => stepBlocked?.(months) ?? false;

	// #region Parking
	/** Left offset of a page, measured rather than computed from a width that padding may change. */
	const pageOffset = (index: number): number => {
		const track = trackRef.current;
		if (!track) return 0;
		const page = track.children[index] as HTMLElement | undefined;
		return page ? page.offsetLeft - track.offsetLeft : index * track.clientWidth;
	};

	/** Put the track on a page with no animation, suspending snap so the assignment sticks. */
	const park = (index: number) => {
		const track = trackRef.current;
		if (!track) return;
		aiming.current = index;
		const previous = track.style.scrollBehavior;
		track.style.scrollBehavior = "auto";
		track.scrollLeft = pageOffset(index);
		track.style.scrollBehavior = previous;
	};

	/**
	 * Glide to a page, and guarantee arrival.
	 *
	 * `scrollTo` with a smooth behaviour sets the target immediately and animates towards it where it
	 * can; where it cannot, the position is simply correct one tick later. The watchdog covers the
	 * third case — an animation that started and was then frozen by the tab going to the background
	 * mid-glide — which would otherwise leave two half-months on screen for as long as nobody looks.
	 */
	const glide = (index: number) => {
		const track = trackRef.current;
		if (!track) return;
		aiming.current = index;
		track.scrollTo({ left: pageOffset(index), behavior: "smooth" });
		clearTimeout(settleTimer.current);
		settleTimer.current = setTimeout(() => park(index), SETTLE_MS);
	};

	/**
	 * Has the track reached the page it was aimed at, so scroll events are the reader's again?
	 *
	 * Without this the component reads its OWN movement as a gesture: a committed step glides back to
	 * the centre, every frame of that glide fires a scroll event, and the debounced settle below sees
	 * a track sitting a long way off centre and commits a second month the reader never asked for.
	 * Bounded by arrival rather than by a fixed window, so a reader swiping twice quickly is not
	 * ignored for a fixed number of milliseconds — the second swipe is theirs the moment the first
	 * one has landed.
	 */
	const arrived = (): boolean => {
		const track = trackRef.current;
		if (aiming.current === null) return true;
		if (!track) return false;
		// A sub-pixel residue is normal after a snap; two pixels is not a gesture.
		if (Math.abs(track.scrollLeft - pageOffset(aiming.current)) > 2) return false;
		aiming.current = null;
		return true;
	};
	// #endregion

	// #region View synchronisation
	/**
	 * Re-park whenever the view moves, sliding for a single step and cutting for a jump.
	 *
	 * A one-month change is drawn as movement because the two months are adjacent and the reader can
	 * follow the travel. A jump of six — typing a month, or picking a year — is not: the four months
	 * in between are not rendered, so animating across them would be a lie about distance. It cuts
	 * instead, which is also what makes typing a date feel instant.
	 */
	useEffect(() => {
		const delta = monthIndex(viewDate) - lastViewRef.current;
		lastViewRef.current = monthIndex(viewDate);
		if (delta === 0) {
			park(CENTRE);
			return;
		}
		if (Math.abs(delta) === 1) {
			// The month that WAS centred is now the neighbour on the side the view came from. Start
			// there and glide back to the middle, so the strip travels the way the reader's gesture or
			// keystroke pointed.
			park(CENTRE - delta);
			glide(CENTRE);
			return;
		}
		park(CENTRE);
	}, [monthIndex(viewDate)]);

	useEffect(() => () => clearTimeout(settleTimer.current), []);
	// #endregion

	// #region Gestures
	/** Commit whichever page the track has come to rest nearest. */
	const settle = () => {
		const track = trackRef.current;
		if (!track) return;
		const width = track.clientWidth || 1;
		const travelled = (track.scrollLeft - pageOffset(CENTRE)) / width;
		const months = travelled > COMMIT_FRACTION ? 1 : travelled < -COMMIT_FRACTION ? -1 : 0;
		if (months === 0 || blocked(months)) {
			glide(CENTRE);
			return;
		}
		// The view change re-renders the strip and the effect above re-parks it, so the track is not
		// told to scroll here — doing both would fight itself.
		onStep(months);
	};

	const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		// Touch and trackpad already have a native snap gesture that handles momentum better than
		// anything written here; only the mouse has nothing.
		if (e.pointerType !== "mouse" || e.button !== 0) return;
		const track = trackRef.current;
		if (!track) return;
		// A hand on the track outranks whatever it was gliding towards.
		aiming.current = null;
		clearTimeout(settleTimer.current);
		drag.current = {
			id: e.pointerId,
			startX: e.clientX,
			startLeft: track.scrollLeft,
			moved: false,
		};
	};

	const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		const state = drag.current;
		const track = trackRef.current;
		if (!state || !track || e.pointerId !== state.id) return;
		const dx = e.clientX - state.startX;
		if (!state.moved) {
			if (Math.abs(dx) < DRAG_THRESHOLD) return;
			state.moved = true;
			track.dataset.dragging = "true";
			try {
				// Throws `NotFoundError` when the pointer is already gone. Capture is a convenience —
				// it keeps a drag alive past the panel's edge — so losing it must not lose the drag.
				e.currentTarget.setPointerCapture(state.id);
			} catch {
				// Ignored deliberately: the drag continues on the element's own move events.
			}
		}
		track.scrollLeft = state.startLeft - dx;
	};

	const endDrag = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		const state = drag.current;
		if (!state || e.pointerId !== state.id) return;
		drag.current = null;
		const track = trackRef.current;
		if (track) delete track.dataset.dragging;
		try {
			e.currentTarget.releasePointerCapture(state.id);
		} catch {
			// Ignored deliberately: releasing a capture that was never taken is not a failure.
		}
		if (!state.moved) return;
		// The pointerup that ends a drag is followed by a click on whatever day sits under it. The
		// reader was scrolling, not choosing.
		swallowClick.current = true;
		settle();
	};
	// #endregion

	return (
		<div
			class="ui-datepicker__track"
			ref={trackRef}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
			onScroll={() => {
				// A native (touch / trackpad) snap has no pointer sequence to hang off, so the scroll is
				// what reports it. Debounced, because a snap emits a stream of these on the way.
				if (drag.current) return;
				if (!arrived()) return;
				clearTimeout(settleTimer.current);
				settleTimer.current = setTimeout(settle, 120);
			}}
			onClickCapture={(e) => {
				if (!swallowClick.current) return;
				swallowClick.current = false;
				e.preventDefault();
				e.stopPropagation();
			}}
		>
			{[-1, 0, 1].map((offset) => {
				const month = shiftMonth(viewDate, offset);
				return (
					<div
						class="ui-datepicker__page"
						key={`${month.getFullYear()}-${month.getMonth()}`}
						// The neighbours exist to be scrolled to, not to be read or tabbed into. Without this
						// a Tab from the last day of the month lands on the 1st of the next one, twice.
						aria-hidden={offset === 0 ? undefined : "true"}
						{...(offset === 0 ? {} : { inert: true })}
					>
						{renderMonth(month)}
					</div>
				);
			})}
		</div>
	);
}
