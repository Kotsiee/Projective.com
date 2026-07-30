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

/**
 * The default accent token per event kind.
 *
 * `availability` used to return `--success` as well, so a bookable open slot and a confirmed booking
 * were the SAME hue — and since no per-kind CSS modifier existed either, the two rendered pixel for
 * pixel identically. `--info` separates them by meaning as well as by hue: a booking is settled
 * (`--success` = confirmed, done), an open slot is an invitation (informational).
 *
 * Hue is still only ONE of three channels here. `KIND_META` below supplies a glyph and a bar
 * treatment for every kind, because two of these pairs are exactly the ones colour cannot carry:
 * deadline (`--danger`) against holiday (`--warning`) is red-against-amber, the hardest pair under
 * protanopia, and sync against general share `--primary` outright.
 */
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
			return "--info";
		case "holiday":
			return "--warning";
		case "busy":
			return "--on-surface-variant";
		default:
			return "--primary";
	}
}

/**
 * Per-kind non-colour channels.
 *
 * `bar` groups the nine kinds into four treatments that each MEAN something, rather than assigning a
 * decorative texture per kind:
 *   - `solid`  — a committed block of time you own (sync · session · booking · general)
 *   - `point`  — a moment, not a span; the bar tapers to a notch (deadline · milestone)
 *   - `open`   — bookable, nothing committed yet; a dashed bar (availability)
 *   - `hatched`— time that is not yours to act on (busy · holiday)
 *
 * `label` is spoken, not drawn: it is prefixed to the block's `aria-label`, which previously carried
 * the title and time but never the kind — so a screen-reader user could not tell a deadline from a
 * holiday at all, whatever the hue did.
 */
const KIND_META: Record<
	CalendarEventKind,
	{ bar: "solid" | "point" | "open" | "hatched"; label: string }
> = {
	deadline: { bar: "point", label: "Deadline" },
	milestone: { bar: "point", label: "Milestone" },
	sync: { bar: "solid", label: "Sync" },
	session: { bar: "solid", label: "Session" },
	booking: { bar: "solid", label: "Booking" },
	availability: { bar: "open", label: "Open slot" },
	busy: { bar: "hatched", label: "Busy" },
	holiday: { bar: "hatched", label: "Time off" },
	general: { bar: "solid", label: "Event" },
};

/** The drawn channel: one small mark per kind, in a single consistent 1.6px stroke. */
function KindIcon({ kind }: { kind: CalendarEventKind }): JSX.Element {
	const p: Record<CalendarEventKind, JSX.Element> = {
		// flag on a pole
		deadline: <path d="M4 13V3m0 0h7l-1.4 2.2L11 7.4H4" />,
		// diamond waypoint
		milestone: <path d="M8 2.5 13.5 8 8 13.5 2.5 8Z" />,
		// two arrows chasing each other
		sync: (
			<path d="M3 6.5A5 5 0 0 1 12.4 5M13 9.5A5 5 0 0 1 3.6 11M12.4 2.2V5h-2.8M3.6 13.8V11h2.8" />
		),
		// a presenter and a screen
		session: <path d="M2.5 3.5h11v7h-11zM8 10.5v3M5.5 13.5h5" />,
		// a check inside a slot
		booking: <path d="M2.5 4.5h11v9h-11zM2.5 7h11M5.5 2v2.5M10.5 2v2.5M6 10l1.6 1.6L10.5 8.7" />,
		// an empty slot with a plus
		availability: <path d="M2.5 4.5h11v9h-11zM2.5 7h11M5.5 2v2.5M10.5 2v2.5M8 9v3M6.5 10.5h3" />,
		// a filled-in block
		busy: <path d="M2.5 4.5h11v9h-11zM2.5 7h11M4.5 9.2l3 3M4.5 12.2l3-3M9 9.2l3 3M9 12.2l3-3" />,
		// a sun over a horizon
		holiday: (
			<path d="M8 4.5v-2M3.9 6.1 2.5 4.7M12.1 6.1l1.4-1.4M8 11a3 3 0 0 1 0-5 3 3 0 0 1 0 5ZM1.5 11.5h13" />
		),
		// a plain dot-in-circle
		general: <path d="M8 2.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8Z" />,
	};
	return (
		<svg
			class="cal-event__kind"
			viewBox="0 0 16 16"
			width="11"
			height="11"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			{p[kind]}
		</svg>
	);
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
	/*
	 * A masked block must not leak its real kind through ANY channel, and the glyph is a channel. It
	 * falls back to the privacy-safe pair: an open slot when the status says available, otherwise the
	 * generic busy mark. Same reasoning as the title, which is already replaced by `maskLabel`.
	 */
	const shownKind: CalendarEventKind = masked
		? (event.status === "available" ? "availability" : "busy")
		: event.kind;

	const content = (
		<>
			<span class="cal-event__bar" aria-hidden="true" />
			<span class="cal-event__body">
				<span class="cal-event__title">
					<KindIcon kind={shownKind} />
					<span class="cal-event__titletext">{title}</span>
				</span>
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

	const meta = KIND_META[shownKind] ?? KIND_META.general;
	const cls = cx(
		"cal-event",
		compact && "cal-event--compact",
		masked && "cal-event--masked",
		event.status === "cancelled" && "cal-event--cancelled",
		`cal-event--${event.kind}`,
	);
	// `data-bar` drives the treatment, so the four textures live on four CSS rules rather than nine.
	const vars = styleVars({ "--cal-accent": `var(${accent})` }, style);
	// A masked block must not leak its real kind — its privacy-safe status label is the whole story.
	const kindLabel = masked ? maskLabel(event) : meta.label;
	const label = `${kindLabel}: ${masked ? maskLabel(event) : event.title}, ${timeLabel}${
		event.status === "cancelled" ? ", cancelled" : ""
	}`;

	if (onOpen) {
		return (
			<button
				type="button"
				class={cls}
				style={vars}
				data-bar={meta.bar}
				onClick={() => onOpen(event)}
				aria-label={label}
			>
				{content}
			</button>
		);
	}
	return (
		<div class={cls} style={vars} data-bar={meta.bar} role="listitem" aria-label={label}>
			{content}
		</div>
	);
}
