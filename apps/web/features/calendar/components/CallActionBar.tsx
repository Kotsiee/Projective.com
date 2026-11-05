import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Button, DatePicker, type DateValue, Select } from "@projective/ui/fields";
import { ConfirmPopup } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { calendarTime } from "@projective/ui/calendar";
import {
	type CalendarEvent,
	type CallActionInput,
	type CallSide,
	RESCHEDULE_LOCKOUT_MS,
	RESCHEDULE_REFUSAL_COPY,
} from "@projective/types/scheduling";
import type { CallView } from "../core/call-view.ts";
import { slotOptions } from "./tabs/EventRescheduleTab.tsx";

/**
 * CallActionBar — a discovery call's moves, in place of an RSVP (audit S-27).
 *
 * It draws only what the read says the viewer may do now, so nothing here can be pressed and then
 * refused for a reason the screen already knew (root CLAUDE.md §3.11). Confirm is the one filled
 * button. Decline and Cancel ask first, because neither can be undone, and name what will happen.
 */
export interface CallActionBarProps {
	view: CallView;
	busy: boolean;
	proposing: boolean;
	onMove: (move: BarMove) => void;
	onPropose: () => void;
}

/** A move the bar makes by itself. Proposing a time goes through {@link CallProposePanel}. */
type BarMove =
	| { action: "confirm" }
	| { action: "decline" }
	| { action: "cancel" }
	| { action: "no_show"; party: CallSide };

export function CallActionBar(props: CallActionBarProps): JSX.Element | null {
	const { view, busy } = props;
	if (view.moves.length === 0) return null;
	const other: CallSide = view.side === "host" ? "requester" : "host";
	const can = (move: CallActionInput["action"]) => view.moves.includes(move);

	return (
		<div class="evm-callbar" role="group" aria-label="Your answer to this call">
			{can("decline")
				? (
					<ConfirmPopup
						label="Decline this call"
						message="Decline this call? The time opens up again and they are told."
						acceptLabel="Decline"
						rejectLabel="Keep"
						acceptSeverity="danger"
						placement="top-end"
						onAccept={() => props.onMove({ action: "decline" })}
						trigger={(api) => (
							<Button triggerRef={api.ref} variant="text" size="sm" disabled={busy} onClick={api.toggle}>
								Decline
							</Button>
						)}
					/>
				)
				: null}
			{can("cancel")
				? (
					<ConfirmPopup
						label="Cancel this call"
						message="Cancel this call? The time opens up again and they are told."
						acceptLabel="Cancel call"
						rejectLabel="Keep"
						acceptSeverity="danger"
						placement="top-end"
						onAccept={() => props.onMove({ action: "cancel" })}
						trigger={(api) => (
							<Button triggerRef={api.ref} variant="text" size="sm" disabled={busy} onClick={api.toggle}>
								Cancel call
							</Button>
						)}
					/>
				)
				: null}
			{can("no_show")
				? (
					<ConfirmPopup
						label="Report a no-show"
						message="Report that they did not join? They are told, and it stays on the call's record."
						acceptLabel="Report"
						rejectLabel="Keep"
						acceptSeverity="danger"
						placement="top-end"
						onAccept={() => props.onMove({ action: "no_show", party: other })}
						trigger={(api) => (
							<Button triggerRef={api.ref} variant="text" size="sm" disabled={busy} onClick={api.toggle}>
								Report a no-show
							</Button>
						)}
					/>
				)
				: null}
			{can("propose")
				? (
					<Button
						variant="outlined"
						size="sm"
						disabled={busy}
						aria-expanded={props.proposing ? "true" : "false"}
						onClick={props.onPropose}
					>
						Propose a new time
					</Button>
				)
				: null}
			{can("confirm")
				? (
					<Button
						variant="filled"
						size="sm"
						disabled={busy}
						onClick={() => props.onMove({ action: "confirm" })}
					>
						Confirm
					</Button>
				)
				: null}
		</div>
	);
}

/** Props for {@link CallProposePanel}. */
export interface CallProposePanelProps {
	event: CalendarEvent;
	/** IANA zone the picked time is read in: the schedule's own, like every instant on this modal. */
	tz: string;
	hour12: boolean;
	nowMs: number;
	busy: boolean;
	onSend: (start: number, end: number) => void;
	onClose: () => void;
}

/**
 * Offer a call a new time. The call keeps its length, so only a start is picked, and a time inside the
 * lockout is refused here, before the press, in the words the door would use.
 */
export function CallProposePanel(props: CallProposePanelProps): JSX.Element {
	const { event, tz, hour12, nowMs, busy } = props;
	const day = useSignal<DateValue>(null);
	const minute = useSignal<string>("");
	const durationMs = event.end - event.start;

	function pickedStart(): number | null {
		const picked = Array.isArray(day.value) ? day.value[0] ?? null : day.value;
		if (!picked || Number.isNaN(picked.getTime()) || minute.value === "") return null;
		const mins = Number(minute.value);
		return calendarTime.zonedTimeToMs(
			picked.getFullYear(),
			picked.getMonth() + 1,
			picked.getDate(),
			Math.floor(mins / 60),
			mins % 60,
			tz,
		);
	}

	const start = pickedStart();
	const tooSoon = start !== null && start <= nowMs + RESCHEDULE_LOCKOUT_MS;

	return (
		<section class="evm-callmove" aria-label="Propose a new time">
			<div class="evm-form">
				<label class="evm-field">
					<span class="evm-field__label">Day</span>
					<DatePicker
						size="sm"
						value={day}
						placeholder="Pick a day"
						aria-label="Day for the new time"
						dateFormat="M d, yy"
						disabled={busy}
					/>
				</label>
				<label class="evm-field">
					<span class="evm-field__label">Start</span>
					<Select
						size="sm"
						value={minute}
						placeholder="Pick a time"
						aria-label="Start time for the new time"
						options={slotOptions(hour12)}
						disabled={busy}
					/>
				</label>
			</div>

			{start !== null && !tooSoon
				? (
					<p class="evm-note">
						<Icon name="clock" size="2xs" />
						That is {calendarTime.fmtFullDate(start, tz)} ·{" "}
						{calendarTime.fmtRange(start, start + durationMs, tz, hour12)} in {tz}. The other person
						confirms it.
					</p>
				)
				: null}
			{tooSoon ? <p class="evm-note">{RESCHEDULE_REFUSAL_COPY.proposal_inside_lockout}</p> : null}

			<div class="evm-actions">
				<Button
					variant="filled"
					size="sm"
					disabled={busy || start === null || tooSoon}
					onClick={() => start !== null && props.onSend(start, start + durationMs)}
				>
					Send this time
				</Button>
				<Button variant="text" size="sm" disabled={busy} onClick={props.onClose}>Not now</Button>
			</div>
		</section>
	);
}
