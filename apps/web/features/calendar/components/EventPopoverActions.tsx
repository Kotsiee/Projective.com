import type { JSX, RefObject, VNode } from "preact";
import { useSignal } from "@preact/signals";
import type { CalendarEvent, EventPopoverActionContext } from "@projective/ui/calendar";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { IconName } from "@projective/ui/icons";
import type { CalendarEventInput } from "@projective/types/finance";
import { buildIcsCalendar, calendarLinksFor } from "@projective/types/finance";
import { eventStack } from "../core/event-view.ts";

/**
 * EventPopoverActions — the action header the calendar engine's event popover asks a consumer for.
 *
 * It lives in the APP rather than in `@projective/ui/calendar` because everything on it is a route
 * or a product decision: where an entry opens, which third-party calendars this product hands off
 * to, and what "archive" means here. The engine holds no route table and no vendor list, which is
 * why {@link EventPopoverActionContext} is a SLOT — and a slot a host cannot fill is drawn not at
 * all, never offered and then refused.
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
 * `null` and the popover draws no actions. That is the same rule the footer rig's export applies
 * (it drops masked entries before writing) expressed as absence rather than as a filter.
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
 * agenda body, matching the footer rig's export exactly: the agenda is rich text, and the writer's
 * TEXT escaping would carry its markup into the file verbatim.
 */
function icsInputFor(event: CalendarEvent): CalendarEventInput {
	return {
		title: event.title,
		startIso: new Date(event.start).toISOString(),
		durationMinutes: Math.max(1, Math.round((event.end - event.start) / 60_000)),
		description: event.meta,
		location: event.location,
		uid: `${event.id}@projective`,
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
 * that 404s — so the document is built client-side and handed over as a Blob, which is the approach
 * `CalendarFooterRig` settled. It is extracted here so the rig and this header cannot drift: the
 * masked filter, the one-minute floor and the anchor lifecycle are stated once.
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

// #region The action header
/**
 * The destructive-ish verbs a HOST can honour, if it has somewhere to write them.
 *
 * They are handlers rather than built-in behaviour because this module has nowhere to persist an
 * answer: the scheduling backend gate is off, and `calendar-state` holds narrowing axes (kinds,
 * source layers) but no per-entry set. A surface that CAN honour one passes it and the item appears;
 * a surface that cannot passes nothing and the item is absent. Both are honest; a control that
 * accepted the press and changed nothing is not.
 *
 * **There is no `onDelete`, and that is the decision, not an omission.** Nothing is hard-deleted in
 * this product (root CLAUDE.md §5 — use Archived), so a "Delete" control could only ever be Archive
 * wearing a name that promises more than it does, and the one thing a reader must be able to trust
 * about a destructive verb is that it means what it says. Archive is the real verb and it is the one
 * offered.
 */
export interface EventActionHandlers {
	/** Move the entry out of the active calendar. Optimistic until the scheduling backend lands. */
	onArchive?: (event: CalendarEvent) => void;
	/** Drop the entry from THIS reader's view only — chrome, not a change to the event. */
	onHide?: (event: CalendarEvent) => void;
}

/**
 * Build the popover's action-header slot, optionally wired to a host that can honour Archive/Hide.
 *
 * A factory rather than a plain function so a surface with somewhere to write those verbs can supply
 * it, while the default stays useful for the surfaces that have not got one yet.
 */
export function eventPopoverActions(
	handlers?: EventActionHandlers,
): (ctx: EventPopoverActionContext) => VNode | null {
	return (ctx) => <EventActionHeader ctx={ctx} handlers={handlers} />;
}

/**
 * The zero-configuration slot: everything that can be honoured with no host wiring at all.
 *
 * This is the value a surface passes to `Calendar`'s `renderEventActions` unless it has an Archive or
 * a Hide to offer.
 */
export function renderEventPopoverActions(ctx: EventPopoverActionContext): VNode | null {
	return <EventActionHeader ctx={ctx} />;
}

/**
 * The header itself, as a real component rather than inline JSX inside the slot function.
 *
 * Load-bearing: the menus and the status line are hook state, and hooks called from a render-prop
 * body run in whichever component happened to invoke it — so the first popover to open would own
 * state the second one then reads. A component gives the header its own identity, and closing the
 * popover unmounts it, which is also what clears a stale notice.
 */
function EventActionHeader(
	{ ctx, handlers }: { ctx: EventPopoverActionContext; handlers?: EventActionHandlers },
): JSX.Element | null {
	const event: CalendarEvent = ctx.event;
	const addOpen = useSignal(false);
	const menuOpen = useSignal(false);
	/** The one thing this header has to say back. Empty until an action has something to report. */
	const notice = useSignal("");

	// A masked block has nothing to hand over and nothing to open — see the module note.
	if (event.masked) return null;

	const when = whenLabelFor(event);
	// `calendarLinksFor` also returns an `ics` value, which is simply the path it was handed. There is
	// no such endpoint here, so the empty string is passed and the value is not read: the file is
	// built client-side by `downloadIcs` instead. Passing a plausible-looking route would be worse —
	// it would put a 404 behind a link that says "Apple Calendar".
	const links = calendarLinksFor(icsInputFor(event), "");

	function exportOne(): void {
		const result = downloadIcs([event], `${slugFor(event.title)}.ics`);
		notice.value = result.ok ? "Downloaded." : "The file couldn’t be written.";
	}

	function quickEdit(): void {
		// The existing full surface, not a second editor. It opens in `view` mode because that mode
		// edits in place — a separate "edit" mode would be the same fields behind a switch, and the
		// reader would lose their place every time they toggled it.
		ctx.close();
		eventStack.open("event", event.id, { mode: "view" });
	}

	function run(action: ((event: CalendarEvent) => void) | undefined, said: string): void {
		if (!action) return;
		action(event);
		menuOpen.value = false;
		notice.value = said;
	}

	const hasMenuVerb = Boolean(handlers?.onArchive || handlers?.onHide);

	return (
		<div class="cal-act">
			{event.href
				? (
					<Tooltip content="Open the full entry">
						<a
							class="ui-button ui-button--secondary ui-button--text ui-button--size-sm ui-button--icon-only"
							href={event.href}
							aria-label={`Open ${event.title}`}
						>
							<span class="ui-button__icon">
								<Icon name="external-link" size="sm" />
							</span>
						</a>
					</Tooltip>
				)
				: null}

			<Popover
				open={addOpen}
				placement="bottom-end"
				class="cal-act__menu"
				trigger={(api) => (
					<Tooltip content="Add to a calendar">
						<Button
							ref={api.ref as RefObject<HTMLButtonElement>}
							variant="text"
							severity="secondary"
							size="sm"
							iconOnly
							icon={<Icon name="calendar-plus" size="sm" />}
							aria-label="Add to a calendar"
							aria-haspopup="menu"
							aria-expanded={api.expanded ? "true" : "false"}
							aria-controls={api.panelId}
							onClick={api.toggle}
						/>
					</Tooltip>
				)}
			>
				<div role="menu" aria-label="Add to a calendar">
					<MenuLink
						href={links.google}
						icon="calendar"
						label="Google Calendar"
						onDone={() => (addOpen.value = false)}
					/>
					<MenuLink
						href={links.outlook}
						icon="calendar"
						label="Outlook"
						onDone={() => (addOpen.value = false)}
					/>
					<MenuButton
						icon="download"
						label="Download .ics"
						hint="Apple Calendar, and anything else that reads iCalendar"
						onSelect={() => {
							addOpen.value = false;
							exportOne();
						}}
					/>
					<MenuLink
						href={mailtoFor(event, when)}
						icon="mail"
						label="Email a copy"
						external={false}
						onDone={() => (addOpen.value = false)}
					/>
				</div>
			</Popover>

			<Tooltip content="Edit this entry">
				<Button
					variant="text"
					severity="secondary"
					size="sm"
					iconOnly
					icon={<Icon name="edit" size="sm" />}
					aria-label={`Edit ${event.title}`}
					onClick={quickEdit}
				/>
			</Tooltip>

			<Popover
				open={menuOpen}
				placement="bottom-end"
				class="cal-act__menu"
				trigger={(api) => (
					<Tooltip content="More actions">
						<Button
							ref={api.ref as RefObject<HTMLButtonElement>}
							variant="text"
							severity="secondary"
							size="sm"
							iconOnly
							icon={<Icon name="kebab" size="sm" />}
							aria-label="More actions"
							aria-haspopup="menu"
							aria-expanded={api.expanded ? "true" : "false"}
							aria-controls={api.panelId}
							onClick={api.toggle}
						/>
					</Tooltip>
				)}
			>
				<div role="menu" aria-label="Entry actions">
					{handlers?.onArchive
						? (
							<MenuButton
								icon="archive-box"
								label="Archive"
								hint="Moves it out of the active calendar. Nothing is deleted."
								onSelect={() => run(handlers?.onArchive, "Archived.")}
							/>
						)
						: null}
					{handlers?.onHide
						? (
							<MenuButton
								icon="eye-off"
								label="Hide from my calendar"
								hint="Only changes what you see."
								onSelect={() => run(handlers?.onHide, "Hidden from your calendar.")}
							/>
						)
						: null}
					<MenuButton icon="close" label="Close" onSelect={ctx.close} />
					{
						/*
						 * Stated where the verbs are, not in a docstring nobody reading the menu can see.
						 * Archive and Hide are optimistic while `PROJECTS_BACKEND_LIVE` / the scheduling
						 * gate are off — the established pattern for every sibling write on this surface —
						 * and a reader deciding whether to press one is entitled to know that.
						 */
					}
					{hasMenuVerb
						? <p class="cal-act__note">Changes stay on this device until sync lands.</p>
						: null}
				</div>
			</Popover>

			{
				/*
				 * `role="status"` rather than `alert`: everything this line reports is the outcome of a
				 * press the reader just made, and an assertive interruption for "Downloaded." talks over
				 * whatever they were reading.
				 *
				 * The element is rendered UNCONDITIONALLY, empty until there is something to say. A live
				 * region has to be in the accessibility tree BEFORE its text changes — one that arrives
				 * already carrying its message is, to most screen readers, an ordinary insertion and is
				 * announced late or not at all. `:empty` collapses it visually, so the resting header is
				 * unchanged.
				 */
			}
			<p class="cal-act__note" role="status">{notice.value}</p>
		</div>
	);
}

/** A filename that survives every filesystem, derived from the entry's own title. */
function slugFor(title: string): string {
	const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
	return slug || "calendar-entry";
}

/**
 * One menu row that navigates.
 *
 * A real anchor rather than a button calling `open()`, so middle-click, "copy link address" and a
 * screen reader's link list all behave — and `rel="noopener noreferrer"` because the target is a
 * third-party origin. A `mailto:` is NOT opened in a new tab: some clients leave a blank tab behind.
 */
function MenuLink(
	{ href, icon, label, hint, external = true, onDone }: {
		href: string;
		icon: IconName;
		label: string;
		hint?: string;
		external?: boolean;
		onDone: () => void;
	},
): JSX.Element {
	return (
		<a
			class="cal-act__item"
			role="menuitem"
			href={href}
			{...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
			onClick={onDone}
		>
			<Icon name={icon} size="sm" />
			<span class="cal-act__itemtext">
				{label}
				{hint ? <span class="cal-act__hint">{hint}</span> : null}
			</span>
		</a>
	);
}

/** One menu row that acts. */
function MenuButton(
	{ icon, label, hint, onSelect }: {
		icon: IconName;
		label: string;
		hint?: string;
		onSelect: () => void;
	},
): JSX.Element {
	return (
		<button type="button" class="cal-act__item" role="menuitem" onClick={onSelect}>
			<Icon name={icon} size="sm" />
			<span class="cal-act__itemtext">
				{label}
				{hint ? <span class="cal-act__hint">{hint}</span> : null}
			</span>
		</button>
	);
}
// #endregion
