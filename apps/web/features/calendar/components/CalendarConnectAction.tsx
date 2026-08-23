import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { ConnectCalendarDialog } from "./ConnectCalendarDialog.tsx";
import "../styles/calendar-chrome.css";

/**
 * CalendarConnectAction — the header-slot trigger for the unified Connect-a-calendar modal.
 *
 * It exists because removing the old integration chips would otherwise have left the in-app project
 * calendar with nothing at all where they were. The chips were spans, not buttons: they reported a
 * connection state nothing had asked the integrations service for, and pressing one did nothing.
 * This is one button that opens the ONE dialog, so the state a reader sees is a real answer from
 * `integrations.user_connections` and the affordance beside it actually starts a consent.
 *
 * Its `open` signal is LOCAL rather than the shared `connectOpen` from `calendar-state`: this trigger
 * is mounted on surfaces that are not the `/calendar` hub, and a module signal shared with the hub's
 * footer rig would let one surface's dialog be opened by another's control.
 *
 * `returnTo` is a same-origin PATH, validated server-side — an absolute URL is refused there, because
 * an attacker-chosen return target turns a consent screen into an open redirect wearing this
 * domain's credibility.
 */
export interface CalendarConnectActionProps {
	/** Where the consent round trip should come back to. */
	returnTo: string;
}

export function CalendarConnectAction(props: CalendarConnectActionProps): JSX.Element {
	const open = useSignal(false);
	return (
		<>
			<Tooltip content="Connect a calendar">
				<button
					type="button"
					class="cal-band__iconbtn"
					aria-label="Connect a calendar"
					aria-haspopup="dialog"
					aria-expanded={open.value ? "true" : "false"}
					onClick={() => (open.value = true)}
				>
					<Icon name="link" size="xs" />
				</button>
			</Tooltip>
			<ConnectCalendarDialog open={open} returnTo={props.returnTo} />
		</>
	);
}
