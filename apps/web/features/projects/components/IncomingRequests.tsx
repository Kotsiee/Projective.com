import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { InboxIcon } from "./glyphs.tsx";

/**
 * IncomingRequests — the footer's single icon-only toggle that surfaces engagements awaiting the
 * viewer's acceptance (incoming client hire requests + paid service purchases pending vetting). A
 * small count tag rides the button with the number of incoming requests; the description shows on
 * hover via a floating `@projective/ui` {@link Tooltip}. Toggling it filters the feed to just those
 * inbound requests (and back).
 */

export interface IncomingRequestsProps {
	/** Number of incoming requests awaiting acceptance (drives the count tag). */
	count: number;
	/** Whether the incoming-requests filter is currently active. */
	active: boolean;
	onToggle: () => void;
}

export function IncomingRequests({ count, active, onToggle }: IncomingRequestsProps): JSX.Element {
	const tip = count > 0 ? `Incoming requests (${count})` : "Incoming requests";
	return (
		<Tooltip content={tip} placement="top">
			<button
				type="button"
				class="proj-incoming"
				data-on={active ? "true" : undefined}
				aria-pressed={active}
				aria-label={count > 0 ? `Incoming requests, ${count} awaiting` : "Incoming requests"}
				onClick={onToggle}
			>
				<span class="proj-incoming__icon" aria-hidden="true">{InboxIcon}</span>
				{count > 0 && <span class="proj-incoming__tag" aria-hidden="true">{count}</span>}
			</button>
		</Tooltip>
	);
}
