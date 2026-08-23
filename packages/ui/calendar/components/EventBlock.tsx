/**
 * @projective/ui/calendar — a single positioned event block. Interactive (a full surface + accent is
 * allowed, §B.4). Honours privacy masking (§Part 1.4): a `masked` block renders ONLY its privacy-safe
 * status label (Available / Busy / Tentative) — never the real title, location, or attendees. Public
 * group sessions show an attendee counter. The accent is a per-kind token unless overridden.
 *
 * TWO PRESENTATIONS, ONE COMPONENT. A span of time is a BOX whose height is its duration; a point in
 * time — `end === start`, a deadline — is a PIN: a rule across the band, a chip carrying the kind
 * glyph, and a timestamp. They share this component rather than splitting into two because the half
 * that must never diverge is the half neither presentation shows: masking. §Part 1.4 is
 * security-sensitive, and a second component re-deriving "which title, which glyph, which label"
 * is exactly how a mask comes to hold in one view and leak in another.
 *
 * OMIT, NEVER CLIP. Only the TITLE is allowed to truncate — it is the one line a card cannot be
 * without, so half of it beats none of it. Every metadata item is either absent or complete: a whole
 * row is OMITTED below the container width at which it could be read at all (a `@container` query on
 * the card's own inline size, so a card narrowed by a split lane or by nesting reacts to ITS width
 * rather than to the viewport's), and above that threshold the row WRAPS rather than truncating.
 * There is no width at which a reader is shown four characters of a location and left to guess.
 *
 * The card's VERTICAL overflow is a different question with a different answer: the resting card
 * clips it, and the Day timeline's hover expansion is what reveals it — see `DayTimeline.tsx`.
 */
import type { JSX, VNode } from "preact";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import type { CalendarAttendee, CalendarEvent, CalendarEventKind } from "../core/types.ts";
import { fmtRange, fmtTime } from "../core/time.ts";
import {
	accentFor,
	CALENDAR_KIND_PATH,
	CALENDAR_KIND_SINGULAR,
	CALENDAR_KIND_STROKE,
	CALENDAR_KIND_VIEWBOX,
	edgeFor,
	effectiveAccent,
	maskLabel,
	onAccentFor,
} from "../core/kinds.ts";
import { initialsOf } from "../core/scene-build.ts";
import { AttendeesIcon } from "./glyphs.tsx";

/*
 * The kind channels — hue and glyph, plus the privacy-safe mask label — now live in `core/kinds.ts`,
 * because the Week grid draws the same nine marks on a canvas and a paint routine importing a
 * component would be backwards. `accentFor` is re-exported here so the sub-path's public surface is
 * unchanged.
 */
export { accentFor };

/** Faces drawn before the avatar stack collapses into a `+N` chip — matches `AVATAR_MAX` in
 *  `core/scene-build.ts` (kept as its own literal: importing the canvas-only module here for one
 *  number would pull `avatar-cache.ts`'s DOM `Image()` usage into a component that draws real
 *  `<img>` tags of its own and has no use for it). */
const AVATAR_MAX = 3;

/**
 * The drawn channel: one small mark per kind, in a single consistent stroke.
 *
 * Size and weight come from the §B.7 icon contract via `.cal-event__kind` — a CSS declaration
 * outranks an SVG presentation attribute, which is exactly how `.ui-icon` normalises every other
 * glyph in the product. The attributes below stay as the no-stylesheet fallback, and
 * `vector-effect` is what makes the weight a RENDERED width rather than a fraction of the 16-unit
 * path box, so this mark and the one the Week grid's canvas paints land on the same line.
 */
function KindIcon({ kind }: { kind: CalendarEventKind }): JSX.Element {
	return (
		<svg
			class="cal-event__kind"
			viewBox={`0 0 ${CALENDAR_KIND_VIEWBOX} ${CALENDAR_KIND_VIEWBOX}`}
			width="11"
			height="11"
			fill="none"
			stroke="currentColor"
			stroke-width={CALENDAR_KIND_STROKE}
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			<path d={CALENDAR_KIND_PATH[kind]} vector-effect="non-scaling-stroke" />
		</svg>
	);
}

/**
 * One face circle: a photo where given (with a plain `onerror` fallback swap to initials — a broken
 * `<img>` box is worse than never having tried), else initials straight away. `isHost` gets its own
 * ring weight so the host is findable in the stack without a separate row.
 *
 * It carries NO `title` attribute. A native tooltip is not a control this design system uses (§B.6 —
 * an icon-only affordance gets a real `Tooltip` or nothing), and here it would be redundant as well
 * as non-compliant: every name in the stack is already spoken through the card's own `aria-label`,
 * so the attribute bought a hover delay and a UA-styled box in exchange for a fact the card states.
 */
function FaceCircle({ face }: { face: CalendarAttendee }): JSX.Element {
	const initials = initialsOf(face.name);
	return (
		<span class={cx("cal-event__face", face.isHost && "cal-event__face--host")}>
			{face.avatarUrl
				? (
					<img
						class="cal-event__facephoto"
						src={face.avatarUrl}
						alt=""
						loading="lazy"
						onError={(e) => {
							(e.currentTarget as HTMLImageElement).style.display = "none";
						}}
					/>
				)
				: null}
			<span class="cal-event__faceinitials" aria-hidden="true">{initials}</span>
		</span>
	);
}

/** The avatar stack: up to {@link AVATAR_MAX} faces, host first, then a `+N` overflow chip. */
function AvatarStack({ faces }: { faces: CalendarAttendee[] }): JSX.Element | null {
	if (faces.length === 0) return null;
	const ordered = faces.slice().sort((a, b) => Number(!!b.isHost) - Number(!!a.isHost));
	const shown = ordered.slice(0, AVATAR_MAX);
	const overflow = ordered.length - shown.length;
	return (
		<span class="cal-event__faces" aria-hidden="true">
			{shown.map((f) => <FaceCircle key={f.id} face={f} />)}
			{overflow > 0 ? <span class="cal-event__face cal-event__face--more">+{overflow}</span> : null}
		</span>
	);
}

export interface EventBlockProps {
	event: CalendarEvent;
	tz: string;
	hour12: boolean;
	/** Absolute-position style (top/height/left/width) supplied by the day column. */
	style?: JSX.CSSProperties;
	/** Compact rendering for dense contexts (month cell chip). */
	compact?: boolean;
	/**
	 * Whether the block may render its secondary rows at all.
	 *
	 * A consumer OPT-OUT, not a height test. In the timed views the card's own clip decides what a
	 * resting card shows and the hover expansion reveals the remainder, so gating the rows on a
	 * measured height as well would delete the very content the expansion exists to reveal. A context
	 * with neither a clip nor a hover — a static print-style listing — passes `false`.
	 */
	roomy?: boolean;
	/**
	 * Draw this block as a PIN rather than a box.
	 *
	 * Defaults to the same predicate `core/layout.ts` admits an instant by — `end === start` on a
	 * timed entry — so a caller that has already asked the placement engine (`DaySlot.instant`) and a
	 * caller that has not agree by construction. A `compact` chip is never a pin: a month cell's rows
	 * are a list, and a rule drawn across one of them would read as a divider between two others.
	 */
	pin?: boolean;
	/**
	 * Draw this block as a PLAIN COLOUR BLOCK — its fill and its shape, and nothing else.
	 *
	 * The DOM twin of `SceneEvent.bare`, set on every member of an EXPANDED overlap cluster. In that
	 * state the block is one of N narrow lanes whose job is to show WHERE each entry sits; N titles
	 * clipped to three characters each is noise rather than information, and the names are in the
	 * list popover the expansion opened with, at a full line each.
	 *
	 * It strips only the DRAWN content. The block keeps its element, its `aria-label` and its
	 * activation — a reader who cannot see the pixels loses nothing at all, which is what makes this a
	 * presentation flag rather than an accessibility one. A PIN ignores it: a rule with no chip and no
	 * stamp is a hairline, not a quieter mark.
	 */
	bare?: boolean;
	/**
	 * Draw one of {@link CalendarEvent.sources}. Supplied by the consumer, because a provider's brand
	 * mark is not an icon in the design system's sense and must not live in a portable package.
	 */
	renderSource?: (source: string) => VNode | null;
	onOpen?: (event: CalendarEvent) => void;
}

export function EventBlock(
	{ event, tz, hour12, style, compact, roomy = true, pin, bare, renderSource, onOpen }:
		EventBlockProps,
): JSX.Element {
	const masked = !!event.masked;
	const accent = event.accent ?? effectiveAccent(event.kind, event.status, masked, event.allDay);
	const title = masked ? maskLabel(event.status) : event.title;
	/*
	 * A point in time gets ONE timestamp, not a range of itself. `fmtRange` on an instant reads
	 * "5:00 PM – 5:00 PM", which states a duration the entry does not have and states it twice; the
	 * accessible name is assembled from the same string, so that would be spoken as well as drawn.
	 */
	const instant = !event.allDay && event.end === event.start;
	const timeLabel = event.allDay
		? "All day"
		: instant
		? fmtTime(event.start, tz, hour12)
		: fmtRange(event.start, event.end, tz, hour12);
	const asPin = (pin ?? instant) && !compact;
	const showAttendees = !masked && typeof event.attendees === "number";
	/*
	 * A masked block must not leak its real kind through ANY channel, and the glyph is a channel. It
	 * falls back to the privacy-safe pair: an open slot when the status says available, otherwise the
	 * generic busy mark. Same reasoning as the title, which is already replaced by `maskLabel`.
	 */
	const shownKind: CalendarEventKind = masked
		? (event.status === "available" ? "availability" : "busy")
		: event.kind;

	/*
	 * The stacked provenance marks — one per calendar this occurrence is on.
	 *
	 * Resolved BEFORE the render so an empty stack renders no container at all: a consumer that
	 * suppresses its own platform's mark would otherwise leave an empty inline box holding a gap.
	 * The stack is `aria-hidden` and its content is spoken through the block's own `aria-label`
	 * instead, because a screen reader announcing four brand names before the meeting's title buries
	 * the one fact the listener came for.
	 *
	 * A MASKED block draws none of them, for the same reason it draws no kind glyph twenty lines up:
	 * §Part 1.4 allows a masked block exactly one fact — Available / Busy / Tentative — and where a
	 * block came from is not that fact. `/[handle]/availability` is guest-reachable, so a stranger
	 * looking at somebody's private appointment would otherwise be told which of their calendars it
	 * lives on, which is a leak whether or not the title survives it.
	 */
	const sourceMarks: { source: string; mark: VNode }[] = [];
	if (renderSource && event.sources && !masked) {
		for (const source of event.sources) {
			const mark = renderSource(source);
			// Keyed by the SOURCE, paired here rather than indexed later: a suppressed mark leaves the
			// two arrays different lengths, so an index into `event.sources` would key the third drawn
			// mark off the second source's slug.
			if (mark) sourceMarks.push({ source, mark });
		}
	}

	const faces = masked ? [] : (event.attendeeFaces ?? []);
	const showFaceRow = !compact && roomy && (faces.length > 0 || sourceMarks.length > 0);

	/*
	 * THE BOX. Every secondary row is emitted unconditionally (subject only to masking and the
	 * `roomy` opt-out) and the card's own `overflow: hidden` decides how much of the stack a resting
	 * card shows — which is what makes the Day timeline's hover expansion a REVEAL rather than a
	 * re-render with different content. Which rows survive the card's WIDTH is decided in CSS by a
	 * `@container` query, so that decision is made against the box that is actually too narrow.
	 */
	const boxContent = (
		<span class="cal-event__body">
			<span class="cal-event__title">
				<KindIcon kind={shownKind} />
				<span class="cal-event__titletext">{title}</span>
			</span>
			{compact ? null : <span class="cal-event__time">{timeLabel}</span>}
			{!compact && roomy && event.location && !masked
				? <span class="cal-event__loc">{event.location}</span>
				: null}
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
			{
				/*
				 * The identity row — faces, then provenance — sits on its OWN line at the card's foot
				 * rather than riding the title (its old position when the bar/gap made every other
				 * line tight): with the leading bar gone there is room, and "who else is here" reads
				 * more like a footer credit than a modifier on the title text.
				 *
				 * Being LAST is load-bearing beyond taste. On any card with something still to reveal,
				 * this row is below the resting fold BY CONSTRUCTION — so it is the one row the hover
				 * expansion may decorate with a fade and a settle without a row that was already on
				 * screen appearing to flicker into existence.
				 */
			}
			{showFaceRow
				? (
					<span class="cal-event__identity">
						<AvatarStack faces={faces} />
						{sourceMarks.length > 0
							? (
								<span class="cal-event__sources" aria-hidden="true">
									{sourceMarks.map((s) => (
										<span class="cal-event__source" key={s.source}>{s.mark}</span>
									))}
								</span>
							)
							: null}
					</span>
				)
				: null}
		</span>
	);

	/*
	 * THE PIN. A rule across the band carries the moment — it is the only mark here whose position
	 * means anything — with the kind chip and the timestamp riding it. There is deliberately no
	 * minimum height anywhere in this branch: a synthetic box would draw a plausible span for an entry
	 * that has none, which is the exact misreading `CalendarEvent.end`'s contract forbids. The PRESS
	 * TARGET comes from the positioned wrapper instead (`INSTANT_HIT_H`, mirrored by the canvas), so
	 * the drawing stays two pixels thick while the thing a reader can hit does not.
	 */
	const pinContent = (
		<>
			<span class="cal-event__pinrule" aria-hidden="true" />
			<span class="cal-event__pinchip">
				<KindIcon kind={shownKind} />
			</span>
			<span class="cal-event__pintitle">{title}</span>
			<span class="cal-event__pintime">{timeLabel}</span>
		</>
	);

	const asBare = !!bare && !asPin;
	const cls = cx(
		"cal-event",
		compact && "cal-event--compact",
		asPin && "cal-event--pin",
		asBare && "cal-event--bare",
		masked && "cal-event--masked",
		event.status === "cancelled" && "cal-event--cancelled",
		`cal-event--${event.kind}`,
	);
	const edge = edgeFor(accent);
	const vars = styleVars(
		{
			"--cal-accent": `var(${accent})`,
			"--cal-accent-on": `var(${onAccentFor(accent)})`,
			// The accent's OPTIONAL border, resolved through a `var()` fallback rather than a branch —
			// one accent in the shipped palette declares an edge and the other five resolve to
			// `transparent` at `0`, so every card writes the same two properties. Same convention the
			// canvas probe uses, so a bordered card is bordered identically in both renderings.
			"--cal-accent-edge": edge.colour ? `var(${edge.colour}, transparent)` : "transparent",
			"--cal-accent-edge-w": edge.width ? `var(${edge.width}, 0px)` : "0px",
		},
		style,
	);
	// A masked block must not leak its real kind — its privacy-safe status label is the whole story.
	const kindLabel = masked ? maskLabel(event.status) : CALENDAR_KIND_SINGULAR[shownKind];
	/*
	 * The stack is a COUNT here, not a list of names. The engine holds no provider vocabulary — the
	 * marks come from the consumer — so naming them would mean announcing raw slugs; and "on 3
	 * calendars" is the fact a listener is actually after, which is that this is already synced.
	 */
	const syncedLabel = sourceMarks.length > 1 ? `, on ${sourceMarks.length} calendars` : "";
	// Faces are visual-only above (`aria-hidden`); the names are the one part of the identity row
	// that survives being read aloud, and — unlike the provider stack — the engine already HOLDS them.
	const facesLabel = faces.length > 0
		? `, with ${faces.map((f) => f.isHost ? `${f.name} (host)` : f.name).join(", ")}`
		: "";
	const label = `${kindLabel}: ${
		masked ? maskLabel(event.status) : event.title
	}, ${timeLabel}${facesLabel}${syncedLabel}${event.status === "cancelled" ? ", cancelled" : ""}`;

	// A bare block renders NO children at all — not hidden ones, none. An empty flex column costs
	// nothing to lay out, and leaving the rows in the tree only to hide them would keep every one of
	// them in the accessibility tree, which is the opposite of the quiet this state is for. The
	// block's own `aria-label` (assembled above, unchanged) is what a reader gets, and it is complete.
	const content = asPin ? pinContent : asBare ? null : boxContent;

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
