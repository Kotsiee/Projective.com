import type { JSX } from "preact";
import { useId } from "preact/hooks";
import { DEMO_TABS } from "../../core/demo-stage.ts";
import {
	BOOKING_COPY,
	BOOKING_GRID,
	type BookingFrame,
	bookingFrames,
	type BookingState,
	dayLabel,
	daySlots,
	FREELANCER_ZONE,
	GROUP_SESSION,
	groupView,
	slotById,
	slotSummary,
	timeLabel,
	VIEWER_ZONE,
	type VoterView,
	whenLabel,
	zoneCity,
} from "../../core/demos/booking-model.ts";

/**
 * BookingPicture — the Booking tab's drawn parts (`flows/LANDING.md` §4.4 Booking, §6 V4): the
 * day's times on both clocks (the product's `SlotPicker` anatomy), the booked session, the group
 * session's roster, ballot and ending, and the frames' stills. Fixture-pure, so the live demo, its
 * frames and the stage's server-rendered poster ({@link BookingPoster}) draw the same picture. Its
 * stylesheet (`styles/demos/booking.css`) arrives with the DemoHost island and with the demo's own
 * chunk.
 */

// #region Constants
/** The demo's own labels. */
export const LABEL = BOOKING_COPY.labels;

/** The zone note (J8), named for this grid's two zones. */
export const ZONE_NOTE = BOOKING_COPY.zoneNote(
	BOOKING_GRID.viewerTimezone,
	BOOKING_GRID.providerTimezone,
);

/** The two clocks' headings: "You · London" and "The freelancer · New York". */
export const CLOCKS = {
	you: `${LABEL.you} · ${zoneCity(VIEWER_ZONE)}`,
	freelancer: `${LABEL.freelancer} · ${zoneCity(FREELANCER_ZONE)}`,
} as const;
// #endregion

// #region The slot list (SlotPicker's anatomy)
/** Props for {@link SlotList}. */
export interface SlotListProps {
	state: BookingState;
	/** A still frame: pills are drawn, not pressable. */
	still?: boolean;
	/** Frame 2 points at the taken rows. */
	emphasis?: "taken";
	onPick?: (slotId: string) => void;
}

/**
 * The day's times in two clocks: each slot a pill on your clock (the product's `SlotPicker` pill,
 * `aria-pressed`, refused when taken with the reason in its name only) and the same instant on the
 * freelancer's clock beside it.
 */
export function SlotList({ state, still = false, emphasis, onPick }: SlotListProps): JSX.Element {
	const slots = daySlots();
	const day = dayLabel(BOOKING_GRID.days[0].startsAt, VIEWER_ZONE);
	return (
		<>
			<div class="lp-bk__clocks lp-bk__meta">
				<span class="lp-bk__clock">
					{CLOCKS.you} <span class="lp-bk__date">{day}</span>
				</span>
				<span class="lp-bk__clock">
					{CLOCKS.freelancer}{" "}
					<span class="lp-bk__date">{dayLabel(slots[0].startsAt, FREELANCER_ZONE)}</span>
				</span>
			</div>
			<div
				class="lp-bk__slots"
				role="group"
				aria-label={LABEL.slotsGroup(BOOKING_GRID.durationMinutes)}
				data-emphasis={emphasis}
			>
				{slots.map((slot) => {
					const picked = state.selectedId === slot.id;
					const time = timeLabel(slot.startsAt, VIEWER_ZONE);
					const there = timeLabel(slot.startsAt, FREELANCER_ZONE);
					const face = (
						<>
							<span class="lp-bk-slot__time" aria-hidden="true">{time}</span>
							<span class="ui-visually-hidden">{slotSummary(slot, VIEWER_ZONE)}</span>
						</>
					);
					return (
						<div key={slot.id} class="lp-bk__row" data-taken={slot.available ? undefined : ""}>
							{still
								? (
									<span
										class="lp-bk-slot"
										data-selected={picked ? "" : undefined}
										data-blocked={slot.available ? undefined : ""}
									>
										{face}
									</span>
								)
								: (
									<button
										type="button"
										class="lp-bk-slot"
										aria-pressed={picked ? "true" : "false"}
										aria-disabled={slot.available ? undefined : "true"}
										data-selected={picked ? "" : undefined}
										data-blocked={slot.available ? undefined : ""}
										onClick={() => onPick?.(slot.id)}
									>
										{face}
									</button>
								)}
							<span class="lp-bk__there">
								{there}
								<span class="ui-visually-hidden">{` in ${zoneCity(FREELANCER_ZONE)}`}</span>
							</span>
						</div>
					);
				})}
			</div>
		</>
	);
}
// #endregion

// #region The booked summary
/** Props for {@link BookedSummary}. */
export interface BookedSummaryProps {
	state: BookingState;
	still?: boolean;
	onPropose?: () => void;
}

/**
 * The booked session: when it is on both clocks and its status, the held payment (J2), the
 * calendar export line (J12), and "Propose a new time", refused inside the 12-hour lockout (J11).
 */
export function BookedSummary(
	{ state, still = false, onPropose }: BookedSummaryProps,
): JSX.Element | null {
	const refusalId = useId();
	const slot = slotById(state.bookedId);
	if (!slot) return null;
	return (
		<div class="lp-bk__booked">
			<p class="lp-bk__when">
				<span class="lp-bk__when-main">{whenLabel(slot.startsAt, VIEWER_ZONE)}</span>
				<span class="lp-bk-status" data-tone="success">{LABEL.bookedStatus}</span>
			</p>
			<p class="lp-bk__there">
				{timeLabel(slot.startsAt, FREELANCER_ZONE)} in {zoneCity(FREELANCER_ZONE)}
			</p>
			{still ? null : <p class="lp-bk__line">{BOOKING_COPY.booked}</p>}
			{still ? null : <p class="lp-bk__cal">{BOOKING_COPY.calendar}</p>}
			{still ? null : (
				<div class="lp-bk__foot">
					<button
						type="button"
						class="lp-demo-btn"
						data-bk-focus="propose-one"
						aria-describedby={state.oneToOneRefusal ? refusalId : undefined}
						onClick={onPropose}
					>
						{BOOKING_COPY.propose}
					</button>
					{state.oneToOneRefusal === "inside_lockout"
						? <p class="lp-bk__refuse" id={refusalId}>{BOOKING_COPY.lockout}</p>
						: null}
				</div>
			)}
		</div>
	);
}
// #endregion

// #region The group session
/** One attendee on the roster line: avatar, name, then their pick, "Waiting" or "Host". */
export function Voter({ voter }: { voter: VoterView }): JSX.Element {
	const said = voter.host ? LABEL.host : voter.pick ?? LABEL.waiting;
	return (
		<li class="lp-bk-voter">
			{voter.avatar
				? (
					<img
						class="lp-bk-voter__avatar"
						src={voter.avatar}
						alt=""
						width={20}
						height={20}
						loading="lazy"
						decoding="async"
					/>
				)
				: (
					<span class="lp-bk-voter__avatar lp-bk-voter__initial" aria-hidden="true">
						{voter.name.slice(0, 1)}
					</span>
				)}
			<span>
				<span class="lp-bk-voter__name">{voter.name}</span> · {said}
			</span>
		</li>
	);
}

/** Props for {@link GroupBody}. */
export interface GroupBodyProps {
	state: BookingState;
	still?: boolean;
	/** Frame 6's narrow still: only the moved session, its ending and the calendar destinations. */
	calendar?: boolean;
	/** List the calendar file's destinations under a resolved round (frame 6's wide still). */
	apps?: boolean;
	onPropose?: () => void;
	onVote?: (proposalId: string) => void;
	onClose?: () => void;
}

/**
 * The group session: its time and roster (the host plus three attendees), "Propose a new time",
 * then the host's two new times on the ballot with each one's tally against the quorum, "Vote for
 * this", the majority line, the skip to the deadline, and the ending (J10).
 */
export function GroupBody(
	{ state, still = false, calendar = false, apps = false, onPropose, onVote, onClose }:
		GroupBodyProps,
): JSX.Element {
	const view = groupView(state);
	const session = (
		<p class="lp-bk__session">
			<span class="lp-bk__title">{GROUP_SESSION.title}</span>
			<span class="lp-bk__meta">{view.when}</span>
		</p>
	);
	if (calendar) {
		return (
			<>
				{session}
				{view.outcome ? <p class="lp-bk__outcome" data-tone="success">{view.outcome}</p> : null}
				<p class="lp-bk__apps">{LABEL.calendarApps.join(" · ")}</p>
			</>
		);
	}
	return (
		<>
			{session}
			<ul class="lp-bk__voters">
				{view.voters.map((voter) => <Voter key={voter.id} voter={voter} />)}
			</ul>
			{view.status === "none"
				? (still ? null : (
					<div class="lp-bk__foot">
						<button
							type="button"
							class="lp-demo-btn"
							data-bk-focus="propose-group"
							onClick={onPropose}
						>
							{BOOKING_COPY.propose}
						</button>
					</div>
				))
				: (
					<>
						<ul class="lp-bk__ballot" aria-label={LABEL.ballot}>
							{view.options.map((option, index) => (
								<li
									key={option.id}
									class="lp-bk-opt"
									data-step={String(Math.round(option.share * 4))}
									data-won={option.won ? "" : undefined}
								>
									<span class="lp-bk-opt__head">
										<span class="lp-bk-opt__when">{option.when}</span>
										{option.mine
											? <span class="lp-bk-status" data-tone="progress">{LABEL.yourVote}</span>
											: null}
										{option.won
											? <span class="lp-bk-status" data-tone="success">{LABEL.chosen}</span>
											: null}
									</span>
									<span class="lp-bk-opt__tally">
										<span class="lp-bk-opt__track" aria-hidden="true">
											<span class="lp-bk-opt__fill" />
										</span>
										<span class="lp-bk-opt__figure">{option.tally}</span>
									</span>
									{!still && view.canVote
										? (
											<button
												type="button"
												class="lp-demo-btn lp-bk-opt__act"
												data-bk-focus={index === 0 ? "vote" : undefined}
												onClick={() => onVote?.(option.id)}
											>
												{LABEL.vote}
												<span class="ui-visually-hidden">: {option.when}</span>
											</button>
										)
										: null}
								</li>
							))}
						</ul>
						{view.majority && !still ? <p class="lp-bk__line">{BOOKING_COPY.majority}</p> : null}
						{view.status === "voting" && !still
							? (
								<div class="lp-bk__foot">
									<button
										type="button"
										class="lp-demo-btn"
										data-bk-focus="close"
										onClick={onClose}
									>
										{LABEL.closeVoting}
									</button>
								</div>
							)
							: null}
						{view.outcome
							? (
								<p
									class="lp-bk__outcome"
									data-tone={view.status === "resolved" ? "success" : undefined}
									data-bk-focus={still ? undefined : "outcome"}
									tabIndex={still ? undefined : -1}
								>
									{view.outcome}
								</p>
							)
							: null}
						{view.status === "resolved" && !still
							? <p class="lp-bk__cal">{BOOKING_COPY.calendar}</p>
							: null}
						{view.status === "resolved" && apps
							? <p class="lp-bk__apps">{LABEL.calendarApps.join(" · ")}</p>
							: null}
					</>
				)}
		</>
	);
}
// #endregion

// #region Frame stills
/** The part of the demo a frame's caption is about: a narrow stage's still. */
export function FrameCrop({ frame }: { frame: BookingFrame }): JSX.Element {
	switch (frame.focus) {
		case "slots":
		case "taken":
			return (
				<div class="lp-bk-still">
					<SlotList
						state={frame.state}
						still
						emphasis={frame.focus === "taken" ? "taken" : undefined}
					/>
				</div>
			);
		case "booked":
			return (
				<div class="lp-bk-still">
					<p class="lp-bk__zone">{ZONE_NOTE}</p>
					<BookedSummary state={frame.state} still />
				</div>
			);
		case "ballot":
		case "calendar":
			return (
				<div class="lp-bk-still">
					<GroupBody state={frame.state} still calendar={frame.focus === "calendar"} />
				</div>
			);
	}
}

/** The whole demo held in a frame's state, both halves side by side: a wide stage's still. */
export function FrameWhole({ frame }: { frame: BookingFrame }): JSX.Element {
	const { state, focus } = frame;
	return (
		<div class="lp-bk__halves">
			<div class="lp-bk__half lp-bk__half--one">
				<p class="lp-bk__kicker">{LABEL.oneToOne}</p>
				<p class="lp-bk__zone">{ZONE_NOTE}</p>
				{state.bookedId
					? <BookedSummary state={state} still />
					: <SlotList state={state} still emphasis={focus === "taken" ? "taken" : undefined} />}
			</div>
			<div class="lp-bk__half lp-bk__half--group">
				<p class="lp-bk__kicker">{LABEL.group}</p>
				<GroupBody state={state} still apps={focus === "calendar"} />
			</div>
		</div>
	);
}

/**
 * One frame's still. Both are rendered and a container query shows one: the whole demo from 40rem
 * of picture, the captioned part below that; the hidden one is `display: none`, never read out.
 */
export function FrameStill({ frame }: { frame: BookingFrame }): JSX.Element {
	return (
		<div class="lp-bk-frame">
			<div class="lp-bk-frame__full">
				<FrameWhole frame={frame} />
			</div>
			<div class="lp-bk-frame__crop">
				<FrameCrop frame={frame} />
			</div>
		</div>
	);
}
// #endregion

// #region Poster
/**
 * The tab's poster, rendered by the server (`flows/LANDING.md` §8: a real capture of the demo,
 * not a placeholder): frame 1's still — the day's times on your clock and the freelancer's, taken
 * ones greyed, beside the group session and its roster — held `inert` inside a `role="img"`
 * named for the tab.
 */
export function BookingPoster(): JSX.Element {
	return (
		<div class="lp-demo-poster" role="img" aria-label={DEMO_TABS.booking.posterLabel}>
			<div class="lp-demo-poster__still lp-bk" inert>
				<FrameStill frame={bookingFrames()[0]} />
			</div>
		</div>
	);
}
// #endregion
