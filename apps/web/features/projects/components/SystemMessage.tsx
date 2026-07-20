import type { JSX } from "preact";
import { cloneElement } from "preact";
import type { ChatMessage, SystemActivityType } from "../types/projects-types.ts";
import { CheckIcon, RevisionIcon, TicketIcon } from "./glyphs.tsx";
import {
	MemberJoinedIcon,
	MemberLeftIcon,
	PaymentIcon,
	SubmissionActivityIcon,
} from "./chat-glyphs.tsx";

/**
 * SystemMessage — a subtle, INTERACTIVE inline activity notice (task §4): submissions, tickets,
 * membership changes, escrow releases. Rendered centered between bubbles on a tonal pill (§B.4 — no
 * four-sided box on content; the pill is the interactive control, so its hover affordance is fine).
 * When the activity carries a `targetHref` the WHOLE notice is an anchor routing to its target (e.g. a
 * submission → `/projects/[projectId]/[channelId]/submissions/[id]`), so clicking anywhere on it
 * navigates; otherwise it renders as a plain, non-interactive line.
 */

export interface SystemMessageProps {
	message: ChatMessage;
}

/** The leading glyph for a system-activity kind. */
function activityGlyph(type: SystemActivityType): JSX.Element {
	switch (type) {
		case "submission_made":
			return SubmissionActivityIcon;
		case "ticket_created":
			return TicketIcon;
		case "ticket_closed":
		case "stage_completed":
			return CheckIcon;
		case "revision_requested":
			return RevisionIcon;
		case "member_joined":
			return MemberJoinedIcon;
		case "member_left":
			return MemberLeftIcon;
		case "payment_released":
			return PaymentIcon;
		default:
			return SubmissionActivityIcon;
	}
}

export function SystemMessage({ message }: SystemMessageProps): JSX.Element | null {
	const sys = message.system;
	if (!sys) return null;

	const inner = (
		<>
			<span class="msg-system__icon" aria-hidden="true">
				{cloneElement(activityGlyph(sys.type))}
			</span>
			<span class="msg-system__text">{sys.text}</span>
			<span class="msg-system__time">{message.timeLabel}</span>
		</>
	);

	if (sys.targetHref) {
		return (
			<div class="msg-system" data-type={sys.type}>
				<a class="msg-system__pill msg-system__pill--link" href={sys.targetHref}>
					{inner}
				</a>
			</div>
		);
	}
	return (
		<div class="msg-system" data-type={sys.type}>
			<span class="msg-system__pill">{inner}</span>
		</div>
	);
}
