import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Avatar } from "@projective/ui/display";
import { Button, DatePicker, type DateValue, InputText, Select } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { calendarTime } from "@projective/ui/calendar";
import type { CalendarEvent, RescheduleProposal } from "@projective/types/scheduling";
import {
	isProposalOnBallot,
	RESCHEDULE_LOCKOUT_HOURS,
	VOTE_RESOLUTION_LEAD_HOURS,
} from "@projective/types/scheduling";
import {
	isSeatRefusal,
	proposalGate,
	type RescheduleGate,
	type RescheduleView,
} from "../../core/event-view.ts";

/**
 * EventRescheduleTab — moving a time, and the negotiation that takes.
 *
 * **Not one rule is implemented in this file.** Every verdict it renders comes from
 * {@link RescheduleView}, which calls the scheduling SSOT's own predicates — the same functions the
 * fat service applies — so a refusal drawn here and a refusal issued by the server cannot disagree,
 * and the copy is the SSOT's rather than a second wording of it.
 *
 * **A refusal is explained, never merely greyed.** Two kinds, told apart deliberately:
 *
 *  - A refusal the viewer could do something about — too close to the start, not enough alternatives
 *    yet, already voted — renders the control DISABLED with the reason printed beside it, because
 *    hiding it would leave the reader with a missing affordance and no idea what to do about it.
 *  - A refusal that is simply not this seat's job (`not_permitted`) renders NOTHING. A host's approve
 *    button in front of an attendee advertises a capability and then takes it back, which is the one
 *    thing this codebase never does with a permission.
 *
 * Separately from either, this file decides what is worth OFFERING. The service accepts an `open` on
 * a round that is already out and a `withdraw` on one that was never opened, and both do nothing — so
 * the control is absent rather than refused. That is a presentation choice made here, deliberately,
 * instead of an invented rule made in {@link RescheduleView} where it would look like the SSOT's.
 *
 * The two negotiation MODES are the same surface with a different question at the end of it: a
 * cohort votes and the host confirms the winner; a 1-on-1 is settled by the party who did not offer
 * the time saying yes.
 */
export interface EventRescheduleTabProps {
	event: CalendarEvent;
	view: RescheduleView;
	tz: string;
	hour12: boolean;
	/** The instant the surface is reasoning about — the modal's own ticking clock. */
	nowMs: number;
	/** True while a write is in flight, so a control cannot be pressed twice. */
	busy: boolean;
	onPropose: (start: number, end: number, note: string) => void;
	onApprove: (proposalId: string) => void;
	onOpen: () => void;
	onVote: (proposalId: string) => void;
	onConfirm: (proposalId: string | null) => void;
	onWithdraw: () => void;
}

/** Half-hour slots across a day, labelled in the surface's own clock convention. */
function slotOptions(hour12: boolean): { value: string; label: string }[] {
	const out: { value: string; label: string }[] = [];
	for (let m = 0; m < 24 * 60; m += 30) {
		const h = Math.floor(m / 60);
		const min = m % 60;
		const pad = String(min).padStart(2, "0");
		const label = hour12
			? `${((h + 11) % 12) + 1}:${pad} ${h < 12 ? "AM" : "PM"}`
			: `${String(h).padStart(2, "0")}:${pad}`;
		out.push({ value: String(m), label });
	}
	return out;
}

/** One control's refusal, as a sentence the reader can act on. `not_permitted` renders nothing. */
function Refusal(props: { gate: RescheduleGate; id: string }): JSX.Element | null {
	if (props.gate.allowed || !props.gate.reason) return null;
	return <p class="evm-refuse" id={props.id} role="note">{props.gate.reason}</p>;
}

export function EventRescheduleTab(props: EventRescheduleTabProps): JSX.Element {
	const { event, view, tz, hour12, nowMs, busy } = props;

	/*
	 * CONTROLLED bindings — the SIGNALS are handed to the fields, never `signal.value`.
	 *
	 * `useControllable` treats a raw value as UNCONTROLLED: it seeds an internal signal from it exactly
	 * once (`useMemo(…, [])`) and nothing re-syncs it, so passing `day.value` produced a field that
	 * read the signal on its first render and never again. Clearing the three fields after a successful
	 * proposal then moved values nothing was reading — the picker, the select and the reason kept
	 * showing the slot that had just been sent while `draftStart()` returned null and the submit greyed
	 * out beside them. Passing the signal makes the control read and write it directly.
	 *
	 * They therefore carry no `onValueChange`: the write already lands in the signal, and a callback
	 * that wrote it a second time would be a redundant render on every keystroke. Typed as `DateValue`
	 * (rather than `Date | null`) because a `Signal` is invariant in its parameter and the control's own
	 * binding is the wider shape.
	 */
	const day = useSignal<DateValue>(null);
	const minute = useSignal<string>("");
	const note = useSignal<string>("");
	const slots = slotOptions(hour12);
	const durationMs = event.end - event.start;

	/** The instant the two controls describe, resolved in the SCHEDULE's zone rather than the device's. */
	function draftStart(): number | null {
		const picked = day.value;
		const d = Array.isArray(picked) ? picked[0] ?? null : picked;
		if (!d || Number.isNaN(d.getTime()) || minute.value === "") return null;
		const mins = Number(minute.value);
		return calendarTime.zonedTimeToMs(
			d.getFullYear(),
			d.getMonth() + 1,
			d.getDate(),
			Math.floor(mins / 60),
			mins % 60,
			tz,
		);
	}

	const draft = draftStart();
	/*
	 * The lockout applies to the slot being OFFERED as well as to the event being moved, so the gate is
	 * re-asked against the candidate rather than only against the event. Without it this control was
	 * enabled for a time the server would refuse `proposal_inside_lockout`.
	 */
	const draftGate = proposalGate(view.propose, nowMs, draft);
	const canSubmitDraft = draftGate.allowed && draft !== null && !busy;

	/*
	 * What is worth OFFERING, which is a presentation question and not a rule (see the note in
	 * `event-view.ts`). The service accepts an `open` on a round that is already out — re-opening is
	 * idempotent — and a `withdraw` on one that was never opened; neither does anything, and a control
	 * whose effect is a no-op is worse than an absent one. Refusing them in the view would have been a
	 * second rule, and the copy it borrowed ("Voting has closed for this session.") was actively false
	 * while a vote was running.
	 */
	const showOpen = !view.closed && (view.status === "none" || view.status === "collecting");
	const showWithdraw = !view.closed && view.status !== "none";

	return (
		<div class="evm-doc">
			{/* #region Where the negotiation stands */}
			<section class="evm-doc__sec">
				<h3 class="evm-h">
					{view.mode === "vote" ? "Cohort vote" : "Awaiting the other party"}
					<span class="evm-h__note">{statusLine(view, nowMs, tz, hour12)}</span>
				</h3>

				{view.mode === "vote"
					? (
						<p class="evm-note">
							<Icon name="info" size="2xs" />
							A time carries with {view.quorum} of {view.voters}{" "}
							{view.voters === 1 ? "vote" : "votes"}{" "}
							— a majority of everyone invited, not of everyone who answered. Voting closes{" "}
							{VOTE_RESOLUTION_LEAD_HOURS} hours before the earliest option.
						</p>
					)
					: (
						<p class="evm-note">
							<Icon name="info" size="2xs" />
							Two people settle a time between them: whoever did not offer it accepts it.
						</p>
					)}
			</section>
			{/* #endregion */}

			{/* #region The options */}
			<section class="evm-doc__sec">
				<h3 class="evm-h">
					Proposed times
					{view.proposals.length > 0
						? <span class="evm-h__count">{view.proposals.length}</span>
						: null}
				</h3>

				{view.proposals.length === 0
					? (
						<p class="evm-empty evm-empty--inline">
							Nothing has been put forward yet.
						</p>
					)
					: (
						<ul class="evm-props" aria-label="Proposed times">
							{view.proposals.map((p) => (
								<ProposalRow
									key={p.id}
									proposal={p}
									view={view}
									tz={tz}
									hour12={hour12}
									busy={busy}
									onApprove={props.onApprove}
									onVote={props.onVote}
									onConfirm={props.onConfirm}
								/>
							))}
						</ul>
					)}
			</section>
			{/* #endregion */}

			{/* #region Offer another time */}
			<section class="evm-doc__sec">
				<h3 class="evm-h">Offer another time</h3>

				{isSeatRefusal(view.propose) ? null : (
					<>
						<div class="evm-form">
							<label class="evm-field">
								<span class="evm-field__label">Day</span>
								<DatePicker
									size="sm"
									value={day}
									placeholder="Pick a day"
									aria-label="Day for the alternative time"
									dateFormat="M d, yy"
									disabled={!view.propose.allowed || busy}
								/>
							</label>
							<label class="evm-field">
								<span class="evm-field__label">Start</span>
								<Select
									size="sm"
									value={minute}
									placeholder="Pick a time"
									aria-label="Start time for the alternative"
									options={slots}
									disabled={!view.propose.allowed || busy}
								/>
							</label>
							<label class="evm-field evm-field--wide">
								<span class="evm-field__label">Why (optional)</span>
								<InputText
									size="sm"
									value={note}
									maxLength={280}
									placeholder="Clashes with a client review"
									aria-label="Reason for the alternative time"
									disabled={!view.propose.allowed || busy}
								/>
							</label>
						</div>

						{draft !== null
							? (
								<p class="evm-note">
									<Icon name="clock" size="2xs" />
									That is {calendarTime.fmtFullDate(draft, tz)} ·{" "}
									{calendarTime.fmtRange(draft, draft + durationMs, tz, hour12)} in{" "}
									{tz}, which is what everyone else will see.
								</p>
							)
							: null}

						<Refusal gate={draftGate} id="evm-propose-why" />

						<div class="evm-actions">
							<Button
								variant="filled"
								size="sm"
								disabled={!canSubmitDraft}
								aria-describedby={draftGate.allowed ? undefined : "evm-propose-why"}
								onClick={() => {
									if (draft === null) return;
									props.onPropose(draft, draft + durationMs, note.value.trim());
									day.value = null;
									minute.value = "";
									note.value = "";
								}}
							>
								Offer this time
							</Button>

							{showOpen && !isSeatRefusal(view.open)
								? (
									<>
										<Button
											variant="outlined"
											size="sm"
											disabled={!view.open.allowed || busy}
											aria-describedby={view.open.allowed ? undefined : "evm-open-why"}
											onClick={props.onOpen}
										>
											{view.mode === "vote" ? "Open the vote" : "Send it over"}
										</Button>
										<Refusal gate={view.open} id="evm-open-why" />
									</>
								)
								: null}

							{showWithdraw && !isSeatRefusal(view.withdraw)
								? (
									<>
										<Button
											variant="text"
											size="sm"
											severity="danger"
											disabled={!view.withdraw.allowed || busy}
											aria-describedby={view.withdraw.allowed ? undefined : "evm-withdraw-why"}
											onClick={props.onWithdraw}
										>
											Withdraw
										</Button>
										<Refusal gate={view.withdraw} id="evm-withdraw-why" />
									</>
								)
								: null}
						</div>
					</>
				)}

				<p class="evm-note">
					<Icon name="lock" size="2xs" />
					Nothing can be moved inside the last {RESCHEDULE_LOCKOUT_HOURS} hours —{" "}
					{calendarTime.fmtFullDate(view.lockoutAt, tz)} ·{" "}
					{calendarTime.fmtTime(view.lockoutAt, tz, hour12)}.
				</p>
			</section>
			{/* #endregion */}
		</div>
	);
}

/** The one-line state of the round, in words rather than an enum name. */
function statusLine(view: RescheduleView, nowMs: number, tz: string, hour12: boolean): string {
	switch (view.status) {
		case "none":
			return "Nothing open";
		case "collecting":
			return "Collecting options";
		case "awaiting_counterparty":
			return "Waiting on a decision";
		case "voting":
			return view.resolvesAt
				? view.resolvesAt > nowMs
					? `Closes ${calendarTime.fmtFullDate(view.resolvesAt, tz)} · ${
						calendarTime.fmtTime(view.resolvesAt, tz, hour12)
					}`
					: "Closed"
				: "Open";
		case "resolved":
			return "A new time was chosen";
		case "lapsed":
			return "No majority — the original time stands";
		case "withdrawn":
			return "Withdrawn";
	}
}

/** One proposed slot: when, who offered it, where its support stands, and what to do about it. */
function ProposalRow(props: {
	proposal: RescheduleProposal;
	view: RescheduleView;
	tz: string;
	hour12: boolean;
	busy: boolean;
	onApprove: (proposalId: string) => void;
	onVote: (proposalId: string) => void;
	onConfirm: (proposalId: string | null) => void;
}): JSX.Element {
	const { proposal: p, view, tz, hour12, busy } = props;
	const onBallot = isProposalOnBallot(p);
	const mine = view.myVoteId === p.id;
	const won = view.resolvedId === p.id;
	// A share of the QUORUM, not of the votes cast — the bar answers "how close is this to carrying",
	// which is the only question a reader has while a vote is open.
	const share = view.quorum > 0
		? Math.min(100, Math.round((p.votes.length / view.quorum) * 100))
		: 0;

	return (
		<li class="evm-prop" data-state={won ? "won" : onBallot ? "open" : "pending"}>
			<div class="evm-prop__head">
				<span class="evm-prop__when">
					{calendarTime.fmtFullDate(p.start, tz)}
					<span class="evm-prop__time">{calendarTime.fmtRange(p.start, p.end, tz, hour12)}</span>
				</span>
				{won ? <span class="evm-chip" data-tone="success">Chosen</span> : null}
				{!onBallot ? <span class="evm-chip" data-tone="warning">Needs approval</span> : null}
				{mine ? <span class="evm-chip" data-tone="progress">Your vote</span> : null}
			</div>

			<div class="evm-prop__who">
				<Avatar
					image={p.proposedBy.avatar ?? undefined}
					label={p.proposedBy.name}
					size={22}
					alt=""
				/>
				<span class="evm-prop__by">
					{p.proposedBy.name}
					<span class="evm-prop__role">
						{p.proposedByRole === "host" ? "organiser" : "attendee"}
					</span>
				</span>
			</div>

			{p.note ? <p class="evm-prop__note">{p.note}</p> : null}

			{view.mode === "vote" && onBallot
				? (
					<div class="evm-tally">
						{
							/* A custom PROPERTY, not a declaration: the sheet owns the geometry and reads it
						    from here, which is the same binding the files grid uses for its column width.
						    Nothing animates it — a meter whose fill is a transition reads as empty in a tab
						    whose animation clock is frozen (root CLAUDE.md §8 Decision #60). */
						}
						<span
							class="evm-tally__track"
							data-carried={p.votes.length >= view.quorum ? "true" : undefined}
							style={`--evm-share:${share}%`}
							aria-hidden="true"
						>
							<span class="evm-tally__fill" />
						</span>
						<span class="evm-tally__figure">
							{p.votes.length} of {view.quorum} needed
						</span>
					</div>
				)
				: null}

			<div class="evm-prop__acts">
				{view.mode === "vote" && !onBallot && !isSeatRefusal(view.approve)
					? (
						<>
							<Button
								variant="outlined"
								size="sm"
								disabled={!view.approve.allowed || busy}
								aria-describedby={view.approve.allowed ? undefined : `evm-approve-${p.id}`}
								onClick={() => props.onApprove(p.id)}
							>
								Put it on the ballot
							</Button>
							<Refusal gate={view.approve} id={`evm-approve-${p.id}`} />
						</>
					)
					: null}

				{view.mode === "vote" && onBallot && !isSeatRefusal(view.vote)
					? (
						<>
							<Button
								variant={mine ? "outlined" : "filled"}
								size="sm"
								disabled={!view.vote.allowed || busy}
								aria-describedby={view.vote.allowed ? undefined : `evm-vote-${p.id}`}
								onClick={() => props.onVote(p.id)}
							>
								{mine ? "Voted" : "Vote for this"}
							</Button>
							<Refusal gate={view.vote} id={`evm-vote-${p.id}`} />
						</>
					)
					: null}

				{view.mode === "counterparty" && onBallot && !isSeatRefusal(view.confirm)
					? (
						<>
							<Button
								variant="filled"
								size="sm"
								disabled={!view.confirm.allowed || busy}
								aria-describedby={view.confirm.allowed ? undefined : `evm-confirm-${p.id}`}
								onClick={() => props.onConfirm(p.id)}
							>
								Accept this time
							</Button>
							<Refusal gate={view.confirm} id={`evm-confirm-${p.id}`} />
						</>
					)
					: null}

				{view.mode === "vote" && view.winnerId === p.id && !isSeatRefusal(view.confirm)
					? (
						<>
							<Button
								variant="filled"
								size="sm"
								disabled={!view.confirm.allowed || busy}
								aria-describedby={view.confirm.allowed ? undefined : `evm-settle-${p.id}`}
								onClick={() => props.onConfirm(p.id)}
							>
								Move the session here
							</Button>
							<Refusal gate={view.confirm} id={`evm-settle-${p.id}`} />
						</>
					)
					: null}
			</div>
		</li>
	);
}
