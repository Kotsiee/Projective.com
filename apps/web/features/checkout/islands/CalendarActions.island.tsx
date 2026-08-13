import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Icon } from "@projective/ui/icons";
import { Popover } from "@projective/ui/feedback";
import type { CalendarLinks } from "../types/checkout-types.ts";

/**
 * CalendarActions — the four ways a booked session leaves this page and lands in the buyer's own
 * calendar: Google, Outlook, Apple, and a plain `.ics` download.
 *
 * **It builds no URL.** All three destinations arrive pre-built on `OrderLine.calendar`, composed
 * server-side by `calendarLinksFor()` from one set of facts. That is not tidiness: a client that
 * assembled its own Google deep link would be a second implementation of the same event, and the two
 * would eventually disagree about the time — which is how a buyer ends up with two entries an hour
 * apart and no way to tell which is right. The same reasoning gives every export a stable `uid`, so
 * adding the session twice UPDATES one entry rather than duplicating it.
 *
 * **Apple Calendar and "Download .ics" are deliberately the same href.** Apple's calendar has no web
 * deep-link scheme; it consumes `text/calendar`, exactly as every desktop client does. Two rows
 * pointing at one file is honest — a separate "Apple" endpoint would be the same bytes behind a
 * different name, and hiding the mechanism from a buyer on a Mac who wants the file itself helps
 * nobody. The `.ics` path is same-origin, which is also what the CSP requires.
 *
 * The panel renders through the shared `Popover`, so it portals to `document.body` and escapes the
 * checkout region's `container-type: inline-size` — which makes every one of these regions a
 * containing block for `position: fixed`. A hand-rolled fixed panel here would be re-based onto the
 * region's box and clipped by the frame.
 */

// #region Props
/** Props for {@link CalendarActions}. */
export interface CalendarActionsProps {
	/** The three server-built export destinations for this session. */
	links: CalendarLinks;
	/** The session's title, so the trigger and every row name what they are adding. */
	title: string;
}
// #endregion

/** One row of the export menu. */
interface ExportRow {
	key: string;
	label: string;
	href: string;
	/** Whether the browser should save the target rather than navigate to it. */
	download: boolean;
	/** Whether the destination is a third-party site the buyer is leaving for. */
	external: boolean;
}

export default function CalendarActions(props: CalendarActionsProps): JSX.Element {
	const { links, title } = props;
	const open = useSignal(false);
	const trigger = useRef<HTMLButtonElement>(null);

	const rows: ExportRow[] = [
		{
			key: "google",
			label: "Google Calendar",
			href: links.google,
			download: false,
			external: true,
		},
		{
			key: "outlook",
			label: "Outlook Calendar",
			href: links.outlook,
			download: false,
			external: true,
		},
		{ key: "apple", label: "Apple Calendar", href: links.ics, download: true, external: false },
		{ key: "ics", label: "Download .ics", href: links.ics, download: true, external: false },
	];

	return (
		<div class="cko-order__cal">
			<button
				type="button"
				ref={trigger}
				class="cko-order__act"
				aria-haspopup="menu"
				aria-expanded={open.value ? "true" : "false"}
				aria-label={`Add ${title} to your calendar`}
				onClick={() => {
					open.value = !open.value;
				}}
			>
				<Icon name="calendar-plus" />
				<span>Add to calendar</span>
				<Icon name="chevron-down" size="2xs" />
			</button>

			<Popover
				open={open}
				targetRef={trigger}
				placement="bottom-start"
				class="cko-order__menu"
			>
				<ul class="cko-order__menulist" role="menu" aria-label={`Add ${title} to your calendar`}>
					{rows.map((row) => (
						<li key={row.key} role="none">
							<a
								role="menuitem"
								class="cko-order__menuitem"
								href={row.href}
								// Empty-valued, so the `.ics` route's own `content-disposition`
								// filename wins rather than being overridden by a guess.
								download={row.download ? "" : undefined}
								target={row.external ? "_blank" : undefined}
								rel={row.external ? "noopener noreferrer" : undefined}
								onClick={() => {
									open.value = false;
								}}
							>
								<Icon name={row.external ? "external-link" : "download"} size="sm" />
								<span>{row.label}</span>
							</a>
						</li>
					))}
				</ul>
			</Popover>

			{
				/*
				 * Said once, beside the control, rather than in a tooltip: a buyer who does not know the
				 * booking is already held will add it here believing that is what secures it.
				 */
			}
			<p class="cko-order__calnote">
				This session is already in your Projective calendar — these add a copy to your own.
			</p>
		</div>
	);
}
