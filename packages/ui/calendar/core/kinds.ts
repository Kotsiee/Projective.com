/**
 * @projective/ui/calendar — the ONE plain-language name for each of the nine event kinds.
 *
 * It lives in the ENGINE rather than in the Zod SSOT, and that is a boundary decision rather than a
 * convenience. `packages/ui` may not import `@projective/types` (the package stays copy-paste
 * portable and depends only on the token contract), so a map owned by the SSOT could never be read
 * by the engine's own filter chips — while a map owned here is readable by BOTH, because every
 * consuming surface already imports this sub-path. The engine also already owns the kind union
 * itself, its accent map and its per-block spoken labels, so the group name belongs with them.
 *
 * It had been written out three times — twice in the app's `/calendar` chrome and once privately in
 * {@link Calendar} — and the copies disagreed: the same `sync` was "Meetings" on the personal
 * calendar and "Syncs" on a project's, and `availability` was "Open slots" against "Available". A
 * filter control is named after the group it hides, so two names for one group is two different
 * answers to what the control does.
 *
 * The words are the PLAIN ones (§B.6 and the product's ELI5 register — "Meetings", not "Syncs"),
 * plural because each names a GROUP of entries rather than one of them. The singular a single block
 * announces to a screen reader is a different register and lives with the block, in `EventBlock`'s
 * `KIND_META`.
 *
 * 2026-08-20 palette pass: a card's identity now rides exactly three channels — the FILL
 * ({@link effectiveAccent}, layering the status overlays over this file's per-kind default), the
 * GLYPH ({@link CALENDAR_KIND_PATH}), and the spoken label — down from four. The fourth, a leading
 * bar texture keyed off a now-removed `CalendarKindBar` union, was a decorative rectangle competing
 * with the card's own rounded shape for the reader's attention; retiring it is what let the corner
 * radius grow into the shape doing the identity work alone.
 */
import type { CalendarEventKind, CalendarEventStatus } from "./types.ts";

/**
 * A "conflicting/attention" red for a MASKED external busy block or a genuinely double-booked slot,
 * distinct from `deadline`'s red: the two never render in the same context (a deadline is never
 * masked, a masked block never carries a deadline's point-in-time glyph), so the shared hue reads as
 * "urgent" in both places rather than as two things pretending to be one.
 */
const RED = "--danger";
/**
 * The four NAMED EVENT GROUPS the palette is organised around, declared in `styles/shell.css`.
 *
 * They replace the six generated theme roles a card used to reach for (`--primary`, `--secondary`,
 * `--success`, `--tertiary`, `--warning`, `--on-surface-variant`), and the reduction is the point:
 * the design asks for four legible groups rather than nine near-hues, and a card's identity has never
 * ridden colour alone — {@link CALENDAR_KIND_PATH} still supplies nine distinct glyphs and
 * {@link CALENDAR_KIND_SINGULAR} still supplies nine spoken names, so a kind stays recoverable with
 * no colour at all (WCAG SC 1.4.1). What is lost is the ability to tell a Meeting from a Session at a
 * glance by hue; what is gained is that Confirmed, Tentative and Busy — the three states a reader
 * actually scans for — no longer share a ramp with each other.
 *
 * Each has an `--on-` twin declared beside it, because {@link onAccentFor} derives a card's ink from
 * its fill's NAME and a fill with no twin silently falls back to `--on-surface`.
 */
const CONFIRMED = "--cal-ev-confirmed";
const ALLDAY = "--cal-ev-allday";
const TENTATIVE = "--cal-ev-tentative";
const BUSY_SLATE = "--cal-ev-busy";
/**
 * The two kinds the four groups deliberately do NOT cover.
 *
 * A DEADLINE is not drawn as a card at all — it is a point in time, rendered as a rule and a chip —
 * so folding it into "confirmed" would paint an urgent mark in the same teal as the meeting it sits
 * inside, and the one thing a deadline has to do is separate from its surroundings. An OPEN SLOT is
 * an invitation rather than an entry: it is the only thing on the grid a reader can BOOK, and it
 * reads as available precisely because it does not look like the confirmed events around it. Both
 * keep the generated semantic role that already meant what they mean.
 */
const DEADLINE_RED = RED;
const OPEN_BLUE = "--info";

/** The plain-language plural name for each event kind — what a filter control calls the group. */
export const CALENDAR_KIND_LABEL: Record<CalendarEventKind, string> = {
	deadline: "Deadlines",
	milestone: "Milestones",
	sync: "Meetings",
	session: "Sessions",
	booking: "Bookings",
	availability: "Open slots",
	busy: "Busy",
	holiday: "Time off",
	general: "Other",
};

/**
 * The label for one kind, tolerating a slug the union does not cover.
 *
 * A consumer whose data has drifted ahead of this package gets the raw kind back rather than
 * `undefined` rendered as an empty control name.
 */
export function calendarKindLabel(kind: string): string {
	return CALENDAR_KIND_LABEL[kind as CalendarEventKind] ?? kind;
}

// #region The non-colour channels
/**
 * The SINGULAR name of one entry — what a single block announces to a screen reader, against
 * {@link CALENDAR_KIND_LABEL}'s plural group name that a filter control wears.
 *
 * The two agree word for word except for `general`, where the group is the catch-all ("Other") and
 * a single block is still an event. `sync` says "Meeting" for the same reason it does above: a
 * reader who unticks "Meetings" must not be left with blocks announcing "Sync".
 */
export const CALENDAR_KIND_SINGULAR: Record<CalendarEventKind, string> = {
	deadline: "Deadline",
	milestone: "Milestone",
	sync: "Meeting",
	session: "Session",
	booking: "Booking",
	availability: "Open slot",
	busy: "Busy",
	holiday: "Time off",
	general: "Event",
};

/**
 * Each kind's mark as SVG path data on a 16×16 box, stroked at {@link CALENDAR_KIND_STROKE}.
 *
 * Path DATA rather than a VNode, because the same nine marks are now drawn two ways: `EventBlock`
 * feeds them to a `<path>` for the all-day lane and the month chip, and the time grid's canvas feeds
 * them to a `Path2D`, which parses exactly this syntax. A VNode could serve only the first, and two
 * hand-copied sets of geometry for one iconographic channel is the drift this map exists to prevent.
 * They are deliberately NOT in `@projective/ui/icons`: an event kind is this engine's own vocabulary,
 * and the registry is sized/weighted for chrome rather than for an 11px mark inside a 20px card.
 */
export const CALENDAR_KIND_PATH: Record<CalendarEventKind, string> = {
	// flag on a pole
	deadline: "M4 13V3m0 0h7l-1.4 2.2L11 7.4H4",
	// diamond waypoint
	milestone: "M8 2.5 13.5 8 8 13.5 2.5 8Z",
	// two arrows chasing each other
	sync: "M3 6.5A5 5 0 0 1 12.4 5M13 9.5A5 5 0 0 1 3.6 11M12.4 2.2V5h-2.8M3.6 13.8V11h2.8",
	// a presenter and a screen
	session: "M2.5 3.5h11v7h-11zM8 10.5v3M5.5 13.5h5",
	// a check inside a slot
	booking: "M2.5 4.5h11v9h-11zM2.5 7h11M5.5 2v2.5M10.5 2v2.5M6 10l1.6 1.6L10.5 8.7",
	// an empty slot with a plus
	availability: "M2.5 4.5h11v9h-11zM2.5 7h11M5.5 2v2.5M10.5 2v2.5M8 9v3M6.5 10.5h3",
	// a filled-in block
	busy: "M2.5 4.5h11v9h-11zM2.5 7h11M4.5 9.2l3 3M4.5 12.2l3-3M9 9.2l3 3M9 12.2l3-3",
	// a sun over a horizon
	holiday:
		"M8 4.5v-2M3.9 6.1 2.5 4.7M12.1 6.1l1.4-1.4M8 11a3 3 0 0 1 0-5 3 3 0 0 1 0 5ZM1.5 11.5h13",
	// a plain dot-in-circle
	general: "M8 2.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8Z",
};

/** The one stroke weight every kind mark is drawn at, in its own 16-unit path space. */
export const CALENDAR_KIND_STROKE = 1.6;

/** The 16×16 box {@link CALENDAR_KIND_PATH} is authored in — the canvas scales against it. */
export const CALENDAR_KIND_VIEWBOX = 16;

/**
 * The default accent token per event kind — one of the four named GROUPS, or one of the two
 * deliberate carve-outs.
 *
 * The mapping, and why each kind lands where it does:
 *
 * | Kind                                  | Group                     |
 * | :------------------------------------ | :------------------------ |
 * | `sync` `session` `booking` `general`  | {@link CONFIRMED} teal    |
 * | `milestone`                           | {@link ALLDAY} amber      |
 * | `busy` `holiday`                      | {@link BUSY_SLATE}        |
 * | `deadline`                            | {@link DEADLINE_RED}      |
 * | `availability`                        | {@link OPEN_BLUE}         |
 *
 * A `milestone` shares the all-day amber because it IS the all-day case in kind form: both are
 * markers on a day rather than appointments within it, and {@link effectiveAccent} routes any event
 * carrying `allDay` here for the same reason.
 *
 * The four confirmed kinds collapsing to ONE hue is the deliberate reduction described on
 * {@link CONFIRMED}: hue now separates STATES (settled · not settled · not yours) rather than kinds,
 * and the glyph and the spoken label — which never collapsed — carry the kind.
 *
 * This is only the DEFAULT. {@link effectiveAccent} layers the all-day and status overlays on top,
 * and `event.accent` overrides the lot.
 */
export function accentFor(kind: CalendarEventKind): string {
	switch (kind) {
		case "deadline":
			return DEADLINE_RED;
		case "milestone":
			return ALLDAY;
		case "availability":
			return OPEN_BLUE;
		case "busy":
		case "holiday":
			return BUSY_SLATE;
		default:
			return CONFIRMED;
	}
}

/**
 * The accent a card ACTUALLY paints, layering three cross-cutting overlays over {@link accentFor}'s
 * per-kind default — resolved in ONE place so the canvas ({@link buildSceneEvents}) and the DOM card
 * (`EventBlock.tsx`) can never disagree about which of a card's several signals wins.
 *
 * PRECEDENCE, most specific first:
 *
 *  1. **Masked wins outright.** A masked block's hue IS its status, because status is one of the
 *     exactly-one facts §Part 1.4 allows it to carry, and colour-coding "open, maybe, or taken" is
 *     more useful at a glance than a flat grey: `available` → {@link OPEN_BLUE} (an invitation, the
 *     same as a real open slot), `tentative` → {@link TENTATIVE}, everything else → {@link BUSY_SLATE}.
 *     A masked block deliberately does NOT reach for the deadline red it used to: a masked entry is
 *     never something the reader can act on, and an alarm colour on a block that says only "Busy"
 *     asks for an attention it cannot repay.
 *  2. **`tentative` and `busy` are STATUSES, not kinds**, and ride every kind they touch — a
 *     tentative meeting reads as tentative, not as a meeting, and an entry marked busy reads as
 *     time the reader does not control whatever it is called. Both beat the all-day overlay for
 *     the same reason: "we have not agreed this yet" is the more urgent fact about an all-day hold.
 *  3. **All-day is the third overlay.** An event flagged `allDay` takes {@link ALLDAY} whatever its
 *     kind, which is what makes the design's "All-Day / Milestones" one group rather than two.
 *  4. Otherwise the kind's own default.
 *
 * `event.accent` (an explicit consumer override) is checked by the CALLER, before this — the one
 * escape hatch stays outside the precedence chain rather than folded into it.
 *
 * @param kind    the event's kind, or the privacy-substituted kind for a masked entry
 * @param status  the event's status, if any
 * @param masked  whether the viewer is entitled to identify this entry at all
 * @param allDay  whether the entry occupies whole days rather than a span within one
 */
export function effectiveAccent(
	kind: CalendarEventKind,
	status: CalendarEventStatus | undefined,
	masked: boolean,
	allDay?: boolean,
): string {
	if (masked) {
		if (status === "available") return OPEN_BLUE;
		if (status === "tentative") return TENTATIVE;
		return BUSY_SLATE;
	}
	if (status === "tentative") return TENTATIVE;
	if (status === "busy") return BUSY_SLATE;
	if (allDay) return ALLDAY;
	return accentFor(kind);
}

/**
 * The verified-AA/AAA "on-" pair for an accent token (`theme-engine.ts` generates one for every role
 * this engine ever resolves — `--on-primary`, `--on-danger`, … — each computed to straddle mid-tone
 * against its own role, in both modes, at both contrast levels). Deriving it by NAME rather than by a
 * second switch is what makes {@link effectiveAccent}'s output — and a consumer's own `event.accent`
 * override, provided it follows the same `--x` / `--on-x` convention every token in the palette does
 * — resolve to real, dynamically-correct contrast with no colour math of this engine's own; an accent
 * this function does not recognise (a token authored outside that convention) degrades to
 * `--on-surface`, which is guaranteed legible against the neutral surface a masked/unresolved fill
 * falls back to.
 */
export function onAccentFor(accent: string): string {
	return accent.startsWith("--") ? `--on-${accent.slice(2)}` : "--on-surface";
}

/**
 * Every accent token the engine can pick on its own — what a palette probe has to cover.
 *
 * The list is EXHAUSTIVE by contract, not by convention: the canvas resolves a card's paint by
 * looking its accent name up in a map built from exactly these swatches, and a name that is not here
 * resolves to `NO_ACCENT` (every field an empty string) and draws nothing at all. A kind added to
 * {@link accentFor} without its token added here disappears from the Week grid.
 */
export const CALENDAR_ACCENTS: readonly string[] = [
	CONFIRMED,
	ALLDAY,
	TENTATIVE,
	BUSY_SLATE,
	DEADLINE_RED,
	OPEN_BLUE,
];

/**
 * The optional EDGE pair for an accent — a border colour and its width — derived from the accent's
 * own name by the same `--x` → `--x-…` convention {@link onAccentFor} uses for ink.
 *
 * Only {@link TENTATIVE} declares one. Every other accent resolves both halves through a `var()`
 * fallback (`transparent` / `0px`), so the channel exists for all of them and costs nothing on the
 * five that do not use it — which is what lets one accent swatch, one `AccentPaint` shape and one
 * paint routine serve a bordered group and five unbordered ones without a branch.
 *
 * A width of `0` is the palette's established "draw nothing" signal (see `GridPalette`), so an
 * unbordered card needs no test of its own anywhere downstream.
 */
export function edgeFor(accent: string): { colour: string; width: string } {
	return accent.startsWith("--")
		? { colour: `${accent}-edge`, width: `${accent}-edge-w` }
		: { colour: "", width: "" };
}

/**
 * The privacy-safe label a masked block is allowed to show (§Part 1.4) — the ONLY fact it may carry,
 * whether it is drawn as a DOM card or as pixels.
 */
export function maskLabel(status: CalendarEventStatus | undefined): string {
	switch (status) {
		case "available":
			return "Available";
		case "tentative":
			return "Tentative";
		default:
			return "Busy";
	}
}
// #endregion
