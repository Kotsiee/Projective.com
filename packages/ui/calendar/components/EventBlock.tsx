/**
 * @projective/ui/calendar — a single positioned event block. Interactive (a full surface + accent is
 * allowed, §B.4). Honours privacy masking (§Part 1.4): a `masked` block renders ONLY its privacy-safe
 * status label (Available / Busy / Tentative) — never the real title, location, or attendees. Public
 * group sessions show an attendee counter. The accent is a per-kind token unless overridden.
 */
import type { JSX } from "preact";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import type { CalendarEvent, CalendarEventKind } from "../core/types.ts";
import { fmtRange } from "../core/time.ts";
import { AttendeesIcon } from "./glyphs.tsx";

/** The default accent token per event kind. */
export function accentFor(kind: CalendarEventKind): string {
	switch (kind) {
		case "deadline":
			return "--danger";
		case "milestone":
			return "--tertiary";
		case "sync":
			return "--primary";
		case "session":
			return "--secondary";
		case "booking":
			return "--success";
		case "availability":
			return "--success";
		case "holiday":
			return "--warning";
		case "busy":
			return "--on-surface-variant";
		default:
			return "--primary";
	}
}

/** The privacy-safe label a masked block is allowed to show. */
function maskLabel(event: CalendarEvent): string {
	switch (event.status) {
		case "available":
			return "Available";
		case "tentative":
			return "Tentative";
		default:
			return "Busy";
	}
}

export interface EventBlockProps {
	event: CalendarEvent;
	tz: string;
	hour12: boolean;
	/** Absolute-position style (top/height/left/width) supplied by the day column. */
	style?: JSX.CSSProperties;
	/** Compact rendering for dense contexts (month cell chip). */
	compact?: boolean;
	/** Whether the block is tall enough to show a second line. */
	roomy?: boolean;
	onOpen?: (event: CalendarEvent) => void;
}

export function EventBlock(
	{ event, tz, hour12, style, compact, roomy = true, onOpen }: EventBlockProps,
): JSX.Element {
	const masked = !!event.masked;
	const accent = event.accent ?? accentFor(event.kind);
	const title = masked ? maskLabel(event) : event.title;
	const timeLabel = event.allDay ? "All day" : fmtRange(event.start, event.end, tz, hour12);
	const showAttendees = !masked && typeof event.attendees === "number";

	const content = (
		<>
			<span class="cal-event__bar" aria-hidden="true" />
			<span class="cal-event__body">
				<span class="cal-event__title">{title}</span>
				{compact ? null : (
					<span class="cal-event__meta">
						{event.source ? <span class="cal-event__source" aria-hidden="true" /> : null}
						<span class="cal-event__time">{timeLabel}</span>
						{event.location && roomy && !masked
							? <span class="cal-event__loc">{event.location}</span>
							: null}
					</span>
				)}
				{showAttendees && roomy
					? (
						<span class="cal-event__attendees">
							<AttendeesIcon size={13} />
							<span>
								{event.attendees}
								{typeof event.capacity === "number" ? ` / ${event.capacity}` : ""}
							</span>
						</span>
					)
					: null}
			</span>
		</>
	);

	const cls = cx(
		"cal-event",
		compact && "cal-event--compact",
		masked && "cal-event--masked",
		event.status === "cancelled" && "cal-event--cancelled",
		`cal-event--${event.kind}`,
	);
	const vars = styleVars({ "--cal-accent": `var(${accent})` }, style);
	const label = `${masked ? maskLabel(event) : event.title}, ${timeLabel}`;

	if (onOpen) {
		return (
			<button
				type="button"
				class={cls}
				style={vars}
				onClick={() => onOpen(event)}
				aria-label={label}
			>
				{content}
			</button>
		);
	}
	return (
		<div class={cls} style={vars} role="listitem" aria-label={label}>
			{content}
		</div>
	);
}
