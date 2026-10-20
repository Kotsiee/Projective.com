import "../../styles/demos/booking.css";
import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useId, useRef } from "preact/hooks";
import type { DemoProps } from "../../core/demos/demo-contract.ts";
import {
	announcementFor,
	BOOKING_COPY,
	type BookingAction,
	type BookingFrame,
	bookingFrames,
	type BookingState,
	createBooking,
	GROUP_SCRIPT,
	reduceBooking,
	slotById,
	timeLabel,
	VIEWER_ATTENDEE_ID,
	VIEWER_ZONE,
} from "../../core/demos/booking-model.ts";
import {
	BookedSummary,
	FrameStill,
	GroupBody,
	LABEL,
	SlotList,
	ZONE_NOTE,
} from "./BookingPicture.tsx";

// #region Constants
/** The pause between the other attendees' votes arriving after the host's offer. */
const VOTE_STEP_MS = 900;

/** The six frames, computed once from the reducer (pure: no clock, no DOM). */
const FRAMES: readonly BookingFrame[] = bookingFrames();

/** A control the demo moves focus to after an action removes the one that was pressed. */
type FocusTarget = "propose-one" | "half-one" | "half-group" | "vote" | "close" | "outcome";
// #endregion

// #region Live mode
/** Props for {@link BookingLive}. */
interface ModeProps {
	announce: (message: string) => void;
}

/**
 * The live demo: pick a time on your clock and book it; try to move it (too late: it starts in
 * under 12 hours); then move a group session by vote, with the other attendees' votes arriving on
 * their own. On a wide stage both halves sit side by side; on a narrow one a text switch moves
 * between them.
 */
function BookingLive({ announce }: ModeProps): JSX.Element {
	const state = useSignal<BookingState>(createBooking());
	const root = useRef<HTMLDivElement>(null);
	const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
	const ids = { one: useId(), group: useId() };

	useEffect(() => () => {
		for (const timer of timers.current) clearTimeout(timer);
		timers.current = [];
	}, []);

	/** Focus a control after the render that replaces the one that was pressed. */
	const focusSoon = (target: FocusTarget) => {
		const timer = setTimeout(() => {
			root.current?.querySelector<HTMLElement>(`[data-bk-focus="${target}"]`)?.focus();
		}, 0);
		timers.current.push(timer);
	};

	const dispatch = (action: BookingAction) => {
		const result = reduceBooking(state.value, action);
		state.value = result.state;
		const line = announcementFor(result);
		if (line) announce(line);
		return result;
	};

	const playOthers = () => {
		GROUP_SCRIPT.forEach((vote, index) => {
			timers.current.push(setTimeout(() => dispatch(vote), VOTE_STEP_MS * (index + 1)));
		});
	};

	const s = state.value;
	const selected = slotById(s.selectedId);
	return (
		<div class="lp-bk" data-view={s.view} ref={root}>
			<div class="lp-bk__halves">
				<div
					class="lp-bk__half lp-bk__half--one"
					role="group"
					aria-labelledby={ids.one}
					tabIndex={-1}
					data-bk-focus="half-one"
				>
					<div class="lp-bk__top">
						<p class="lp-bk__kicker" id={ids.one}>{LABEL.oneToOne}</p>
						<button
							type="button"
							class="lp-bk__switch"
							onClick={() => {
								dispatch({ type: "show", view: "group" });
								focusSoon("half-group");
							}}
						>
							{LABEL.tryGroup}
							<span aria-hidden="true">→</span>
						</button>
					</div>
					<p class="lp-bk__zone">{ZONE_NOTE}</p>
					{s.bookedId
						? (
							<BookedSummary
								state={s}
								onPropose={() => dispatch({ type: "propose_one_to_one" })}
							/>
						)
						: (
							<>
								<SlotList state={s} onPick={(slotId) => dispatch({ type: "pick", slotId })} />
								<div class="lp-bk__foot">
									{selected
										? (
											<button
												type="button"
												class="lp-demo-btn lp-demo-btn--money"
												onClick={() => {
													if (dispatch({ type: "book" }).outcome.kind === "booked") {
														focusSoon("propose-one");
													}
												}}
											>
												{BOOKING_COPY.book(timeLabel(selected.startsAt, VIEWER_ZONE))}
											</button>
										)
										: <p class="lp-bk__hint">{LABEL.pickHint}</p>}
								</div>
							</>
						)}
				</div>
				<div
					class="lp-bk__half lp-bk__half--group"
					role="group"
					aria-labelledby={ids.group}
					tabIndex={-1}
					data-bk-focus="half-group"
				>
					<div class="lp-bk__top">
						<p class="lp-bk__kicker" id={ids.group}>{LABEL.group}</p>
						<button
							type="button"
							class="lp-bk__switch"
							onClick={() => {
								dispatch({ type: "show", view: "one_to_one" });
								focusSoon("half-one");
							}}
						>
							<span aria-hidden="true">←</span>
							{LABEL.backToBooking}
						</button>
					</div>
					<GroupBody
						state={s}
						onPropose={() => {
							if (dispatch({ type: "propose_group" }).outcome.kind === "offered") {
								playOthers();
								focusSoon("vote");
							}
						}}
						onVote={(proposalId) => {
							const result = dispatch({
								type: "vote",
								attendeeId: VIEWER_ATTENDEE_ID,
								proposalId,
							});
							if (result.outcome.kind !== "refused") {
								focusSoon(result.state.group.reschedule.status === "voting" ? "close" : "outcome");
							}
						}}
						onClose={() => {
							if (dispatch({ type: "close_voting" }).outcome.kind !== "refused") {
								focusSoon("outcome");
							}
						}}
					/>
				</div>
			</div>
		</div>
	);
}
// #endregion

// #region Frame mode
/** Previous / Next through a fixed sequence, announced as it moves. */
function useStep(total: number, announce: (message: string) => void): {
	step: Signal<number>;
	go: (delta: number) => void;
} {
	const step = useSignal(0);
	const go = (delta: number) => {
		const next = Math.min(total - 1, Math.max(0, step.value + delta));
		if (next === step.value) return;
		step.value = next;
		announce(`${LABEL.step(next + 1, total)}. ${FRAMES[next].caption}`);
	};
	return { step, go };
}

/**
 * The frame mode (either reduced-motion channel): §4.4's six frames as a labelled sequence — the
 * step, its caption, a still of the demo in that state, and Previous step / Next step. Nothing
 * moves on its own.
 */
function BookingFrameMode({ announce }: ModeProps): JSX.Element {
	const total = FRAMES.length;
	const { step, go } = useStep(total, announce);
	const frame = FRAMES[step.value];
	return (
		<div class="lp-demo-frames lp-bk-frames">
			<div class="lp-demo-frames__head">
				<p class="lp-demo-counter">{LABEL.step(step.value + 1, total)}</p>
				<p class="lp-demo-frames__caption">{frame.caption}</p>
			</div>
			<div class="lp-demo-frames__picture">
				<FrameStill frame={frame} />
			</div>
			<div class="lp-demo-frames__nav">
				<button
					type="button"
					class="lp-demo-step"
					aria-disabled={step.value === 0 ? "true" : undefined}
					onClick={() => go(-1)}
				>
					{LABEL.previous}
				</button>
				<button
					type="button"
					class="lp-demo-step"
					aria-disabled={step.value === total - 1 ? "true" : undefined}
					onClick={() => go(1)}
				>
					{LABEL.next}
				</button>
			</div>
		</div>
	);
}
// #endregion

// #region Demo
/**
 * BookingDemo — the demo stage's Booking tab (V4; `flows/LANDING.md` §2.3 V4 wireframe, §4.4
 * Booking, §5 rows J2, J8–J12, §6 V4).
 *
 * You are in London and the freelancer is in New York: their four times show on your clock with
 * their clock beside it, taken times greyed out with the reason in the slot's name only, the way the
 * product's `SlotPicker` draws them. "Book 3:00 pm" holds the payment (a money verb, tier 1 per
 * §B.8.1, where the product's Book session is); moving that session is refused, since it starts in
 * under 12 hours. A group session — the host plus three attendees — then moves by vote: the host
 * offers two new times, Theo picks Thursday on his own, your vote decides whether more than half
 * agree, and Ines's silence counts against. Every rule is the product's (`core/demos/booking-model.ts`).
 *
 * With either reduced-motion channel on it renders the six frames instead. Pressing the stage's
 * "Start again" (a new {@link DemoProps.resetSignal}) remounts it from the fixture, cancelling any
 * vote still on its way. It never fetches and never writes.
 */
export default function BookingDemo(
	{ reducedMotion, resetSignal, announce }: DemoProps,
): JSX.Element {
	return reducedMotion
		? <BookingFrameMode key={`frames-${resetSignal}`} announce={announce} />
		: <BookingLive key={`live-${resetSignal}`} announce={announce} />;
}
// #endregion
