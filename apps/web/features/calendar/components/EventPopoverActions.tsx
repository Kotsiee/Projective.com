import type { JSX, RefObject, VNode } from "preact";
import { useSignal } from "@preact/signals";
import type { CalendarEvent, EventPopoverActionContext } from "@projective/ui/calendar";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { IconName } from "@projective/ui/icons";
import type { CalendarEventInput } from "@projective/types/finance";
import { buildIcsCalendar, calendarLinksFor } from "@projective/types/finance";
import { normalizeLink } from "@projective/types/links";
import type { CalendarEvent as ScheduleEvent } from "@projective/types/scheduling";
import { inspectInPanel, openEventModal } from "../core/calendar-state.ts";
import { entryEditable } from "../core/event-view.ts";

/**
 * EventPopoverActions — the action header the calendar engine's event popover asks a consumer for.
 *
 * It lives in the APP rather than in `@projective/ui/calendar` because everything on it is a route
 * or a product decision: where an entry opens, and which third-party calendars this product hands
 * off to. The engine holds no route table and no vendor list, which is why
 * {@link EventPopoverActionContext} is a SLOT — and a slot a host cannot fill is drawn not at all,
 * never offered and then refused. It carries no Archive or Hide: an entry leaves the calendar only
 * through the event door's Delete, in the inspector and the modal.
 *
 * ## Every handoff goes through the platform's one iCalendar implementation
 *
 * `calendarLinksFor` and `buildIcsCalendar` (`@projective/types/finance` `order.ts`) are the only
 * iCalendar writer on the platform — they carry the RFC 5545 escaping, the 75-octet line folding and
 * the CRLF joins, each of which is a place a second implementation would quietly differ. So this
 * module composes them and adds none of its own; what it contributes is the FLOOR below, and the
 * decision about which of the returned links a reader is offered.
 *
 * ## A masked block gets no header at all
 *
 * A privacy-masked entry says "Busy" and nothing else — no title, no location, no agenda, no
 * provenance. Every control here would either hand that block to a third party, write it into a file
 * that leaves the application, or open a surface that has nothing to show; so a masked event returns
 * `null` and the popover draws no actions. That is the same rule the export modal applies (it never
 * writes a masked entry, whatever the filters say) expressed as absence rather than as a filter.
 */

// #region iCalendar handoff
/**
 * What one event looks like to the shared calendar writer.
 *
 * **The one-minute floor is deliberate and is not a rounding accident.** A deadline is an INSTANT
 * (`end === start`, see {@link CalendarEvent.end}), and RFC 5545 §3.8.2.2 requires a `VEVENT`'s
 * `DTEND` to be strictly later than its `DTSTART` — several desktop clients reject the file outright
 * rather than interpret it. A calendar that refuses the whole document is a worse answer than a
 * minute of length the entry did not have, so the minute is added at the BOUNDARY, where it is a
 * property of the export format, and never written back onto the event.
 *
 * The strapline ({@link CalendarEvent.meta}) is used as the description rather than the event's rich
 * agenda body, matching the export modal exactly: the agenda is rich text, and the writer's TEXT
 * escaping would carry its markup into the file verbatim.
 */
function icsInputFor(event: CalendarEvent): CalendarEventInput {
	return {
		title: event.title,
		startIso: new Date(event.start).toISOString(),
		durationMinutes: Math.max(1, Math.round((event.end - event.start) / 60_000)),
		description: event.meta,
		location: event.location,
		uid: `${event.id}@projective`,
		transparent: event.availabilityBehavior === "passive",
	};
}

/** What a download attempt did, so a caller can say something rather than return silently. */
export interface IcsDownloadResult {
	/** Whether a file was actually handed over. */
	ok: boolean;
	/** How many entries it contains — `0` means there was nothing exportable, which is not a failure. */
	count: number;
}

/**
 * Write `events` to a `.ics` file and hand it to the reader.
 *
 * There is no `/api/scheduling/export` endpoint, and inventing a link to one would ship a control
 * that 404s — so the document is built client-side and handed over as a Blob, with the anchor
 * lifecycle `calendar-download.ts` uses for the page's export. It stays on `buildIcsCalendar` rather
 * than the page export's `export-formats.ts` writer because the engine's popover context carries no
 * timezone, and that writer needs one to place an all-day entry on its dates.
 *
 * **Masked entries are dropped inside this function, not by its callers.** Filtering at the call
 * site is a rule every future caller has to remember, and forgetting it puts somebody's private
 * commitment into a file that leaves the application. A caller that has already filtered loses
 * nothing by the second pass.
 *
 * Concatenated `VCALENDAR` documents rather than one multi-`VEVENT` document: `buildIcsCalendar`
 * writes a complete document for one occurrence and every reader accepts a stream of them, so this
 * needs no folding or escaping of its own.
 *
 * The anchor is appended before the click and removed after, and the object URL is released on the
 * NEXT task rather than the same one — a detached anchor is ignored by some engines, and revoking
 * synchronously can pull the blob out from under a download that has not started reading it.
 */
export function downloadIcs(
	events: readonly CalendarEvent[],
	filename: string,
): IcsDownloadResult {
	const shown = events.filter((e) => !e.masked);
	if (shown.length === 0) return { ok: false, count: 0 };

	// The moment this DOCUMENT was written, which is genuinely now: it is not the surface's reference
	// clock, and stamping it with one would tell every calendar that imports the file that the export
	// is a year old. It is the one instant here that has nothing to agree with the server about.
	const stamp = new Date().toISOString();
	const ics = shown.map((e) => buildIcsCalendar(icsInputFor(e), stamp)).join("");

	let url = "";
	try {
		url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = filename;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		return { ok: true, count: shown.length };
	} catch {
		return { ok: false, count: shown.length };
	} finally {
		if (url) setTimeout(() => URL.revokeObjectURL(url), 0);
	}
}

/**
 * A `mailto:` that carries the entry as readable prose.
 *
 * Deliberately NOT an iCalendar attachment: `mailto:` has no way to attach one, and a link that
 * implied it did would be a promise the scheme cannot keep. What it can do honestly is put the title,
 * the time and the link in a draft the sender can read before they send it.
 */
function mailtoFor(event: CalendarEvent, whenLabel: string): string {
	const body = [
		event.title,
		whenLabel,
		event.location ? `Where: ${event.location}` : "",
		event.meta ?? "",
		event.href ? absoluteHref(event.href) : "",
	].filter(Boolean).join("\n");
	return `mailto:?subject=${encodeURIComponent(event.title)}&body=${encodeURIComponent(body)}`;
}

/**
 * A same-origin path resolved against the current origin, so a link pasted into an email or a
 * calendar description actually goes somewhere. Left untouched during SSR, where there is no origin
 * to resolve against and the relative path is the honest value.
 */
function absoluteHref(href: string): string {
	if (typeof location === "undefined") return href;
	try {
		return new URL(href, location.origin).toString();
	} catch {
		return href;
	}
}

/**
 * How the entry's time reads in a sentence.
 *
 * The reader's own locale, not the calendar's display timezone: this string goes into an email draft
 * and a file the reader keeps, both of which they read on this device. An INSTANT prints one time
 * rather than a range, because "17:00 – 17:00" states a span of nothing.
 */
function whenLabelFor(event: CalendarEvent): string {
	const start = new Date(event.start);
	const startLabel = start.toLocaleString(undefined, {
		weekday: "short",
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});
	if (event.end <= event.start) return startLabel;
	const endLabel = new Date(event.end).toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
	});
	return `${startLabel} – ${endLabel}`;
}
// #endregion

// #region The inspect header
/**
 * The header of the compact popover `/calendar` opens when its reader chose `popover` (Decision #388),
 * and of a cluster's detail either way: the engine's own pane draws the facts, and this adds the Join,
 * the handoff to another calendar, and the two ways up, to the inspector and to the modal. Editing
 * belongs to those two.
 */
export function renderInspectActions(ctx: EventPopoverActionContext): VNode | null {
	return <InspectActions ctx={ctx} />;
}

function InspectActions({ ctx }: { ctx: EventPopoverActionContext }): JSX.Element {
	const event = ctx.event as ScheduleEvent;
	const joinUrl = event.meeting?.joinUrl ?? event.meetingUrl;
	const joinHref = joinUrl ? normalizeLink(joinUrl) : null;
	return (
		<div class="cal-act">
			{joinHref
				? (
					<Button
						variant="filled"
						severity="primary"
						size="sm"
						icon={<Icon name="video-camera" size="sm" />}
						label="Join Meeting"
						onClick={() => globalThis.open(joinHref, "_blank", "noopener,noreferrer")}
					/>
				)
				: null}
			{event.masked ? null : <AddToCalendar event={ctx.event} />}
			<Tooltip content="Open in Panel" density="compact">
				<Button
					variant="text"
					severity="secondary"
					size="sm"
					iconOnly
					icon={<Icon name="panel-right" size="sm" />}
					aria-label="Open in Panel"
					onClick={() => {
						ctx.close();
						inspectInPanel(event);
					}}
				/>
			</Tooltip>
			<Tooltip content={entryEditable(event) ? "Edit in Modal" : "Open details"} density="compact">
				<Button
					variant="text"
					severity="secondary"
					size="sm"
					iconOnly
					icon={<Icon name={entryEditable(event) ? "edit" : "arrow-up-right"} size="sm" />}
					aria-label={entryEditable(event) ? "Edit in Modal" : "Open details"}
					onClick={() => {
						ctx.close();
						openEventModal(event.id);
					}}
				/>
			</Tooltip>
		</div>
	);
}

const ICON_BUTTON =
	"ui-button ui-button--secondary ui-button--text ui-button--size-sm ui-button--icon-only";

/**
 * Add to a calendar: Google, Outlook, an `.ics` file (Apple Calendar and anything else that reads
 * iCalendar) or a copy by email — one entry's handoff, and until calendar sync reaches an attendee's
 * own calendar (S-39), the one route there is.
 *
 * A component of its own because its open state and its status line are hook state. The trigger is a
 * NATIVE button carrying `api.ref`, because `Button` does not forward a ref and its panel would anchor
 * at the origin; and it sits inside the engine popover's panel, so the overlay registry reads a press
 * in this panel as a press inside that one.
 */
function AddToCalendar({ event }: { event: CalendarEvent }): JSX.Element {
	const open = useSignal(false);
	/** The one thing this control has to say back. Empty until a download has something to report. */
	const notice = useSignal("");
	// `calendarLinksFor` also returns an `ics` value, which is simply the path it was handed. There is
	// no such endpoint here, so the empty string is passed and the value is not read: the file is
	// built client-side by `downloadIcs` instead. Passing a plausible-looking route would be worse —
	// it would put a 404 behind a link that says "Apple Calendar".
	const links = calendarLinksFor(icsInputFor(event), "");
	const done = () => (open.value = false);

	function exportOne(): void {
		done();
		const result = downloadIcs([event], `${slugFor(event.title)}.ics`);
		notice.value = result.ok ? "Downloaded." : "The file couldn’t be written.";
	}

	return (
		<>
			<Popover
				open={open}
				placement="bottom-end"
				label="Add to a calendar"
				trigger={(api) => (
					<Tooltip content="Add to a calendar" density="compact">
						<button
							type="button"
							ref={api.ref as RefObject<HTMLButtonElement>}
							class={ICON_BUTTON}
							aria-label="Add to a calendar"
							aria-haspopup="dialog"
							aria-expanded={api.expanded ? "true" : "false"}
							aria-controls={api.panelId}
							onClick={api.toggle}
						>
							<span class="ui-button__icon">
								<Icon name="calendar-plus" size="sm" />
							</span>
						</button>
					</Tooltip>
				)}
			>
				<div role="group" aria-label="Add to a calendar">
					<MenuLink href={links.google} icon="calendar" label="Google Calendar" onDone={done} />
					<MenuLink href={links.outlook} icon="calendar" label="Outlook" onDone={done} />
					<MenuButton icon="download" label="Apple Calendar (.ics)" onSelect={exportOne} />
					<MenuLink
						href={mailtoFor(event, whenLabelFor(event))}
						icon="mail"
						label="Email a copy"
						external={false}
						onDone={done}
					/>
				</div>
			</Popover>
			{
				/*
				 * `role="status"`, rendered unconditionally and empty until there is something to say: a
				 * live region has to be in the tree BEFORE its text changes to be announced on time.
				 */
			}
			<span class="ui-visually-hidden" role="status">{notice.value}</span>
		</>
	);
}

/** A filename that survives every filesystem, derived from the entry's own title. */
function slugFor(title: string): string {
	const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
	return slug || "calendar-entry";
}

/**
 * One row that navigates.
 *
 * A real anchor rather than a button calling `open()`, so middle-click, "copy link address" and a
 * screen reader's link list all behave — and `rel="noopener noreferrer"` because the target is a
 * third-party origin. A `mailto:` is NOT opened in a new tab: some clients leave a blank tab behind.
 */
function MenuLink(
	{ href, icon, label, external = true, onDone }: {
		href: string;
		icon: IconName;
		label: string;
		external?: boolean;
		onDone: () => void;
	},
): JSX.Element {
	return (
		<a
			class="ui-menu-item"
			href={href}
			{...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
			onClick={onDone}
		>
			<Icon name={icon} size="sm" class="ui-menu-item__icon" />
			{label}
		</a>
	);
}

/** One row that acts. */
function MenuButton(
	{ icon, label, onSelect }: { icon: IconName; label: string; onSelect: () => void },
): JSX.Element {
	return (
		<button type="button" class="ui-menu-item" onClick={onSelect}>
			<Icon name={icon} size="sm" class="ui-menu-item__icon" />
			{label}
		</button>
	);
}
// #endregion
