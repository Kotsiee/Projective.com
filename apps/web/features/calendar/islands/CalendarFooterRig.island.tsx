import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/calendar-chrome.css";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { IconName } from "@projective/ui/icons";
import type { SchedulePage } from "@projective/types/scheduling";
import { buildIcsCalendar } from "@projective/types/finance";
import { ConnectCalendarDialog } from "../components/ConnectCalendarDialog.tsx";
import { IcsImportDialog } from "../components/IcsImportDialog.tsx";
import {
	CALENDAR_VIEWS,
	calendarPage,
	calendarView,
	connectOpen,
	importedEvents,
	importOpen,
	requestCreate,
	visibleEvents,
} from "../core/calendar-state.ts";

/**
 * CalendarFooterRig — the middle-nav FOOTER band on every `/calendar` route: which view the grid is
 * in, every action the surface offers, and the action layer they open.
 *
 * **The layer is mounted HERE, not in a route body.** `/wallet` shipped it in one of eight route
 * bodies while the rig that opens it rendered on all eight, so seven routes had actions that opened
 * nothing. The layer belongs to whatever triggers it.
 *
 * **The band owns the view switch at EVERY width**, which is why it is here rather than in the lane:
 * the shell removes the lane below 767px, so a switch living there had to be duplicated into the
 * header band to survive a phone — one fact with two controls, the defect `/messages` shipped as two
 * Starred toggles 160px apart. A control the footer holds at all widths needs no understudy.
 *
 * **The rig contains itself.** `container-type: inline-size` is load-bearing twice: it stops this
 * `nowrap` row contributing its min-content to the middle-nav's `minmax(0, 1fr)` content track — the
 * defect that starved the `/wallet` lane to 2px at an 820px viewport — and it makes the tier switch a
 * real container query rather than a client width observer.
 *
 * **There is no overflow menu, so no tier may remove a control.** `/wallet`'s
 * `nth-child(n + 3) { display: none }` deleted three money actions on four pages that had nothing to
 * recover them from, and a menu was the answer here while one existed. It does not now: the tiers
 * relocate a LABEL onto the tooltip each control already carries — first the actions' names, then the
 * view names down to their initials — and the whole rig still fits inside 320px with a coarse pointer.
 * Adding an action that does not fit means adding a tier, never hiding one.
 */
export interface CalendarFooterRigProps {
	/** The SSR page — the rig exports what the surface is showing, so it needs the same data. */
	initial: SchedulePage | null;
	/** Same-origin path a consent round trip returns to. */
	returnTo: string;
}

/**
 * One rig action. `primary` is the single filled control; everything else is quiet.
 *
 * `hint` is the accessible name and the tooltip where the visible LABEL has to stay short enough to
 * survive the tier collapse: "Export .ics" fits the row, and what the control actually does is
 * export what is on screen — a docstring claiming the label says so does not make it say so. A hint
 * always OPENS with its own visible label, so the accessible name still contains it (WCAG 2.5.3
 * "Label in Name"); a name that merely paraphrases the button is unusable by voice control.
 */
interface RigAction {
	key: string;
	label: string;
	hint?: string;
	icon: IconName;
	primary?: boolean;
	run: () => void;
}

export default function CalendarFooterRig(props: CalendarFooterRigProps): JSX.Element {
	/** The one thing this rig has to say back. Empty until an action has something to report. */
	const notice = useSignal("");

	/**
	 * Export what is ON SCREEN — the current filter and search, minus anything private.
	 *
	 * There is no `/api/scheduling/export` endpoint and inventing a link to one would ship a control
	 * that 404s. The file is built by {@link buildIcsCalendar} — the SSOT's own writer, the exact
	 * counterpart of the parser the import uses — so a calendar exported from here and re-imported
	 * here round-trips through one pair of implementations rather than two.
	 *
	 * Every exit says something. A filter that leaves nothing exportable used to return silently from
	 * an enabled button, which is the one failure the sibling import dialog's contract forbids
	 * outright ("A refusal is shown, never swallowed") — and a reader who has just pressed a control
	 * that did nothing has no way to tell a working export of an empty week from a broken button.
	 */
	function exportIcs(): void {
		notice.value = "";
		const page = calendarPage.value ?? props.initial;
		if (!page) {
			notice.value = "Nothing to export yet.";
			return;
		}
		const all = [...page.events, ...importedEvents.value];
		// A masked block carries no title, no location and no agenda — only "Busy". Writing it out
		// would put somebody's private commitment into a file that leaves this application, so the
		// export drops it rather than exporting a placeholder.
		const shown = visibleEvents(all).filter((e) => !e.masked);
		if (shown.length === 0) {
			notice.value = "Nothing to export — no entries are showing.";
			return;
		}

		// One VCALENDAR per event, concatenated: `buildIcsCalendar` writes a complete document for one
		// occurrence, and every reader accepts a stream of them. Re-implementing a multi-VEVENT writer
		// here would be a second escaping and folding implementation, which is precisely what the
		// parser's own module note warns against.
		//
		// `DTSTAMP` is the moment this DOCUMENT was written, which is genuinely now — it is not the
		// surface's reference clock, and stamping it with one would tell every calendar that imports
		// the file that the export is a year old. It is the one instant on this surface that has
		// nothing to agree with the server about.
		const stamp = new Date().toISOString();
		const ics = shown.map((e) =>
			buildIcsCalendar({
				title: e.title,
				startIso: new Date(e.start).toISOString(),
				durationMinutes: Math.max(1, Math.round((e.end - e.start) / 60_000)),
				description: e.meta,
				location: e.location,
				uid: `${e.id}@projective`,
			}, stamp)
		).join("");

		// Appended before the click and removed after, and the object URL released on the next task
		// rather than the same one: a detached anchor is ignored by some engines, and revoking
		// synchronously can pull the blob out from under a download that has not started reading it.
		// The `/checkout` and `/files` rigs settled this pattern; this one was written without it.
		let url = "";
		try {
			url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = "projective-calendar.ics";
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			notice.value = `Exported ${shown.length} ${shown.length === 1 ? "entry" : "entries"}.`;
		} catch {
			notice.value = "The file couldn’t be written.";
		} finally {
			if (url) setTimeout(() => URL.revokeObjectURL(url), 0);
		}
	}

	/*
	 * Read outward from the frame's edge: the rarest thing this surface does is furthest from the
	 * thumb, the commonest — and the only filled control — sits last, on the band's own trailing edge
	 * where every other surface in the product puts the action that commits.
	 */
	const actions: RigAction[] = [
		{
			key: "export",
			label: "Export .ics",
			hint: "Export .ics — what’s on screen",
			icon: "download",
			run: exportIcs,
		},
		{ key: "import", label: "Import .ics", icon: "upload", run: () => (importOpen.value = true) },
		{
			key: "connect",
			label: "Connect calendar",
			icon: "link",
			run: () => (connectOpen.value = true),
		},
		{ key: "create", label: "New event", icon: "plus", primary: true, run: requestCreate },
	];

	const page = calendarPage.value ?? props.initial;

	return (
		<div class="cal-rig">
			{
				/*
				 * Leading: which view the grid is in. The initial and the word are both rendered and CSS
				 * decides which is drawn — the word stays in the accessibility tree either way, so the
				 * narrow presentation is still "Week" to a screen reader and to voice control (WCAG 2.5.3),
				 * and there is no frame in which a client width observer has drawn the wrong one.
				 */
			}
			<div class="cal-rig__views" role="group" aria-label="Calendar view">
				{CALENDAR_VIEWS.map((v) => (
					<Tooltip content={`${v.label} view`} key={v.value}>
						<button
							type="button"
							class="cal-rig__view"
							data-on={calendarView.value === v.value ? "true" : undefined}
							aria-label={`${v.label} view`}
							aria-pressed={calendarView.value === v.value ? "true" : "false"}
							onClick={() => (calendarView.value = v.value)}
						>
							<span class="cal-rig__viewletter" aria-hidden="true">{v.label.charAt(0)}</span>
							<span class="cal-rig__viewname">{v.label}</span>
						</button>
					</Tooltip>
				))}
			</div>

			{
				/* Whatever the rig has to report — announced, and never a silent no-op. */
			}
			<p class="cal-rig__notice" role="status" data-said={notice.value ? "true" : undefined}>
				{notice.value}
			</p>

			<div class="cal-rig__actions">
				{actions.map((a) => (
					<Tooltip content={a.hint ?? a.label} key={a.key}>
						<button
							type="button"
							class="cal-rig__action"
							data-variant={a.primary ? "primary" : undefined}
							aria-label={a.hint ?? a.label}
							onClick={a.run}
						>
							<Icon name={a.icon} size="xs" class="cal-rig__glyph" />
							<span class="cal-rig__label">{a.label}</span>
						</button>
					</Tooltip>
				))}
			</div>

			<ConnectCalendarDialog open={connectOpen} returnTo={props.returnTo} />
			<IcsImportDialog open={importOpen} timezone={page?.timezone ?? "UTC"} />
		</div>
	);
}
