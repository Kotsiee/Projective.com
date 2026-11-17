import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { openSettings } from "@features/settings/core/settings-bridge.ts";
import "../styles/calendar-chrome.css";

/**
 * CalendarConnectAction — the header-slot Connect a calendar on a project calendar. It opens Settings
 * → Integrations on its Calendars block (Decision #440), the one place a connection is made, so the
 * state a reader sees there is a real answer from `integrations.user_connections` and the action
 * beside it starts a consent. A consent comes back to this calendar with Settings open over it.
 */
export function CalendarConnectAction(): JSX.Element {
	return (
		<Tooltip content="Connect a calendar" density="compact">
			<button
				type="button"
				class="cal-band__iconbtn"
				aria-label="Connect a calendar"
				aria-haspopup="dialog"
				onClick={() => void openSettings("integrations", "calendars")}
			>
				<Icon name="link" size="xs" />
			</button>
		</Tooltip>
	);
}
