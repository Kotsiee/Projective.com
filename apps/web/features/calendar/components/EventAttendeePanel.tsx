import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { EventAttendee, RsvpResponse } from "@projective/types/scheduling";
import { RSVP_LABEL, rsvpTally } from "@projective/types/scheduling";
import { profileHref } from "@features/projects/core/routing.ts";

/**
 * EventAttendeePanel — who is coming, and what each of them said.
 *
 * The roster is the second question a reader has while looking at anything else on this modal ("can
 * this go ahead?"), which is why it lives in the side panel rather than a tab: it is context for the
 * agenda and for a proposed time, not a destination of its own.
 *
 * **A status is never colour alone.** Each row carries the WORD ("Going", "Maybe", "Not going", "No
 * answer yet") beside a shaped mark, and the tone only reinforces it — so the panel survives a
 * colour-blindness overlay and a monochrome print with every fact intact.
 *
 * `pending` is drawn as a real state rather than an omission: to a host deciding whether a session is
 * viable, "has not answered" and "said no" are different facts, and folding one into the other is how
 * a cohort of eight silently becomes a cohort of three.
 */
export interface EventAttendeePanelProps {
	roster: EventAttendee[];
	/** Head count of the seats entitled to vote, when the reader is looking at a ballot. */
	note?: string | null;
}

/** The tone each answer reinforces its own word with. */
const RSVP_TONE: Record<RsvpResponse, string> = {
	accepted: "success",
	rejected: "danger",
	tentative: "warning",
	pending: "muted",
};

export function EventAttendeePanel(props: EventAttendeePanelProps): JSX.Element {
	const { roster } = props;
	const tally = rsvpTally(roster);

	return (
		<aside class="evm-rail" aria-label="Attendees">
			<header class="evm-rail__head">
				<h3 class="evm-rail__title">Attendees</h3>
				<span class="evm-rail__count">{roster.length}</span>
			</header>

			<p class="evm-rail__tally">
				{tally.accepted} going · {tally.tentative} maybe · {tally.rejected} not going
				{tally.pending > 0 ? ` · ${tally.pending} unanswered` : ""}
			</p>

			<ul class="evm-people" aria-label="Participant list">
				{roster.map((a) => (
					<li key={a.id} class="evm-people__row" data-viewer={a.isViewer ? "true" : undefined}>
						<Avatar image={a.avatar ?? undefined} label={a.name} size={28} alt="" />
						<span class="evm-people__id">
							<span class="evm-people__name">
								{a.handle
									? (
										<a class="evm-people__link" href={profileHref(a.handle)}>
											{a.name}
										</a>
									)
									: a.name}
								{a.isViewer ? <span class="evm-people__you">You</span> : null}
							</span>
							<span class="evm-people__role">
								{a.role === "host" ? "Host" : a.role === "optional" ? "Optional" : "Participant"}
								{a.note ? ` · ${a.note}` : ""}
							</span>
						</span>
						<span class="evm-people__rsvp" data-tone={RSVP_TONE[a.response]}>
							<Icon
								name={a.response === "accepted"
									? "check"
									: a.response === "rejected"
									? "close"
									: a.response === "tentative"
									? "help"
									: "hourglass"}
								size="2xs"
								class="evm-people__mark"
							/>
							{RSVP_LABEL[a.response]}
						</span>
					</li>
				))}
			</ul>

			{props.note
				? (
					<Tooltip content="Everyone invited except the host, who authored the options.">
						<p class="evm-rail__note" tabIndex={0}>
							<Icon name="info" size="2xs" />
							{props.note}
						</p>
					</Tooltip>
				)
				: null}
		</aside>
	);
}
