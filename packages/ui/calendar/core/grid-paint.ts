/// <reference lib="dom" />
/**
 * @projective/ui/calendar — the time grid's CANVAS backdrop: the scene it takes, the palette it is
 * painted with, and the pure paint routine itself.
 *
 * The `dom` lib reference above is explicit for the same reason `hooks/overlay-registry.ts` carries
 * one: this module imports nothing, so it never receives the DOM globals transitively through
 * Preact's type definitions, and `CanvasRenderingContext2D` would be unresolved the moment it is
 * type-checked on its own — which is exactly what `deno test` does to reach the colour tests.
 *
 * WHY A CANVAS. The backdrop used to be an ELEMENT per drawn thing — one per visible hour rule, one
 * per working-hours window of every visible day, one per blacked-out day — so its node count tracked
 * how much axis was on screen and how many days were in the block, and every one of them was
 * absolutely positioned and re-keyed as the viewport moved. Measured on `/@handle/availability` at
 * 1440×900: 52 nodes in Week (1 line layer + 21 hour rules + 3 blocks × 10 working windows) and 105
 * in Day (1 + 4 days × 24 rules + 8 windows), against 7 now — and 7 at every zoom, scroll depth and
 * column count. None of it is content either: every fact it draws (which hour, where a day begins,
 * "this window is bookable", "this day is off") is already carried by the DOM around it — the
 * gutter's hour labels, the column headers, the availability panel — so it is decoration, and
 * decoration is what a canvas is for.
 *
 * WHAT SITS ON TOP DIFFERS BY VIEW, and the difference is the reason the scene below has so many
 * optional layers. The hybrid Day {@link DayTimeline} keeps its event cards as HTML over this
 * lattice. The Week {@link TimeGrid} does not: it is a pure immediate-mode canvas whose cards, hour
 * scale and chrome are painted by {@link paintScene}, with a real focusable ACCESSIBLE LAYER beside
 * the viewport carrying the role, name, focus and activation that pixels cannot. Neither view gives
 * those up — one keeps them in the card, the other moves them one element sideways.
 *
 * WHY THIS FILE IS PURE. Everything here takes its geometry as an argument and emits nothing but
 * pixels, so the two timed views share ONE renderer — {@link TimeGrid}'s stacked 24-hour blocks and
 * {@link DayTimeline}'s continuous elapsed-time axis differ only in the scene they hand over — and
 * the colour normalisation below is unit-testable with no DOM at all.
 *
 * CORRECTNESS RULE (not a testing convenience — the same rule the overlay scrollbar follows).
 * `requestAnimationFrame`, CSS transitions and CSS `@keyframes` are ALL frozen in a hidden or
 * background tab. Nothing in this file schedules a frame: a draw is a synchronous function of its
 * inputs, so the grid a reader is asked to trust is complete the instant those inputs are, whether or
 * not a frame ever runs.
 */

// #region Scene
/** One horizontal rule across the grid — an hour, emphasised where a day begins. */
export interface GridRule {
	/** Content-space y (px) — the same axis the event cards are positioned on. */
	y: number;
	/** Whether this rule is a day boundary (midnight), drawn in the stronger tone. */
	boundary: boolean;
}

/** A shaded region inside ONE day column: a working-hours band, or a whole-day blackout. */
export interface GridRegion {
	/** 0-based day-column index within the block (always 0 on the single-column Day timeline). */
	column: number;
	/** Content-space y (px) of the region's top edge. */
	y: number;
	/** Region height (px). */
	h: number;
}

/**
 * Everything the backdrop needs for one frame.
 *
 * Vertical positions are CONTENT space (the scroller's own coordinates, matching the event cards);
 * `scrollTop` is what maps them into the canvas. Horizontal position is a COLUMN INDEX rather than a
 * pixel, because the canvas is the only party that knows its own measured width — handing it an
 * index means the column geometry is computed once, where it is known, instead of being predicted by
 * two callers that would then have to agree.
 */
export interface GridScene {
	/** The scroll offset (px) of the container the canvas is pinned over. */
	scrollTop: number;
	/** Day columns across the canvas. Separators are drawn between them, never at either edge. */
	columns: number;
	rules: GridRule[];
	bands: GridRegion[];
	blackouts: GridRegion[];
	/**
	 * Width (px) reserved at the INLINE START for the hour scale, measured from the canvas's own
	 * leading edge. Zero (the default) when the host has already inset the canvas past its gutter in
	 * CSS, which is how the hybrid Day timeline is composed; the pure-canvas Week viewport sets it,
	 * because there its hour labels are drawn by this same pass and the canvas is full-bleed.
	 */
	gutter?: number;

	// The layers below are what turn the lattice backdrop into the WHOLE viewport. Every one of them
	// is optional and absent on the hybrid Day timeline, whose events are still HTML.
	/** Hour-scale labels, in the gutter. Absent when the host keeps its labels in the DOM. */
	hours?: SceneHourLabel[];
	/** Period markers drawn at a block seam ("Mon, Jul 13 – Sun, Jul 19"). */
	markers?: SceneMarker[];
	/** Laid-out event cards, in painting order (a later card draws over an earlier one). */
	events?: SceneEvent[];
	/**
	 * How many cards the host laid out for this window BEFORE culling, when it cares to say.
	 *
	 * Painted by nothing — it exists so a frame can report what it skipped as well as what it drew.
	 * `events.length` alone says a frame was cheap without saying whether that is because the corpus
	 * is small or because the culling is working, and those call for opposite responses.
	 */
	eventsTotal?: number;
	/** The live current-time rule, or null when today is not on the axis. */
	now?: SceneNowLine | null;
	/** The drag-to-create preview, or the landing preview of an event being dragged. */
	selection?: SceneSelection | null;
	/** The overlay depth gauge. */
	scrollbar?: SceneScrollbar | null;
	/** The return-to-present pill, or null when the now-line is in view. */
	present?: ScenePresent | null;
	/** The id of the event the accessible layer currently has focus on — drawn as a focus ring. */
	focusId?: string | null;
	/** The id of the event under the pointer — drawn one step brighter, like the DOM card's hover. */
	hoverId?: string | null;
	/**
	 * Whether the accessible layer's scroll REGION itself holds focus.
	 *
	 * It is a focus stop with no pixels of its own — the element is visually hidden, so its own
	 * `:focus-visible` outline is clipped away — and it owns Arrow/Page/Home/End. A keyboard reader
	 * who cannot see that they have landed on the control that scrolls the grid has no indicator at
	 * all, so the canvas draws one around the whole viewport (WCAG 2.4.7).
	 */
	focusRegion?: boolean;
}
// #endregion

// #region Overlay scene layers
/** One hour-scale label, positioned by its RULE and drawn centred on it. */
export interface SceneHourLabel {
	/** Content-space y (px) of the hour rule this labels. */
	y: number;
	text: string;
}

/** A period marker pinned at a block seam. */
export interface SceneMarker {
	/** Content-space y (px) of the seam. */
	y: number;
	text: string;
	/** Whether this seam is the block containing today. */
	today: boolean;
}

/**
 * One face on a card's avatar stack (§Part 2 Avatars) — generic (photo-or-initials), unlike the
 * BRAND {@link SceneEvent.sources} count, which stays a consumer-owned VNode in the DOM card and a
 * neutral dot count here for the same reason.
 */
export interface SceneFace {
	id: string;
	/** 1–2 letter fallback, and the always-present half of the accessible provenance line. */
	initials: string;
	/** A photo URL to draw once it loads (see `core/avatar-cache.ts`) — absent or unloaded → initials. */
	photoUrl?: string;
	isHost: boolean;
}

/**
 * How one card's box was resolved against everything it collides with.
 *
 * `"solo"` no collision, full width · `"nested"` fully contained by a parent and drawn inside it ·
 * `"split"` a side-by-side share, the explicit fallback where containment cannot express the overlap
 * · `"folded"` collapsed under another card, drawing no pixels until its cluster is unfolded.
 *
 * RESTATED rather than imported from `core/layout.ts`, which is where the exported `PlacementMode` a
 * consumer sees is declared. This module imports nothing at all — see the `dom` lib note in the
 * header, which is a consequence of exactly that — and reaching into `layout.ts` would drag
 * `types.ts` and `scene-paint.ts` behind it into a type cycle for four string literals. The two
 * declarations are structurally identical and each carries a comment naming the other; if a fifth
 * member is ever added, it is added in both or `SceneEvent` silently stops accepting a placement.
 */
type PlacementMode = "solo" | "nested" | "split" | "folded";

/**
 * How far a card has stepped back behind whatever the reader is currently doing.
 *
 * `"drag"` while something is being moved, resized or drawn; `"focus"` while a row in the overlap
 * list is being pointed at; `"none"` at rest. It names the STATE and never carries an opacity — how
 * faint each depth is is a token decision, resolved from `--cal-dim-drag` / `--cal-dim-focus` through
 * {@link ScenePalette.dimDrag}. See {@link SceneEvent.recede}.
 *
 * Exported, unlike {@link PlacementMode} above, because it is this module's OWN vocabulary rather
 * than a restatement of `core/layout.ts`'s — the placement engine has no opinion about focus.
 */
export type SceneRecede = "none" | "drag" | "focus";

/**
 * A laid-out event card in CONTENT space.
 *
 * Horizontal geometry is a column index PLUS a normalised inset pair, and the pair is what a reader
 * of the 2026-08-20 rewrite will not expect. That pass deleted fractional side-by-side columns
 * outright, because three or four concurrent events fanned out into slivers nobody could read. It is
 * still true that a colliding card is not SPLIT by default — the default is full column width, and
 * {@link insetStart}/{@link insetWidth} are `0`/`1` for the overwhelming majority of cards. What
 * changed is that a card fully CONTAINED by another is now drawn inside it, which is an inset rather
 * than a split, and that two events of identical extent — the one case containment cannot express,
 * since neither contains the other — fall back to sharing the box. {@link mode} says which of the
 * four a given card is, and both numbers are fractions of ONE column so an inset can never exceed
 * the column it insets into.
 *
 * The canvas is still the only party that has measured its own width, so the column index is
 * resolved once here and shared with the hit test.
 */
export interface SceneEvent {
	/**
	 * This CARD's identity, unique within the scene.
	 *
	 * Not the event's id: an event that runs past midnight is clipped into one card per day, so a
	 * single event can be on screen twice. Focus, hover and the accessible layer's list all key off
	 * the card, because "the one the reader is pointing at" is a card rather than an event.
	 */
	id: string;
	/** The SOURCE event's id — what an open or a move callback is given back. */
	eventId: string;
	/** Local midnight of the day this card sits in, epoch ms. */
	dayStart: number;
	/** 0-based day-column index. */
	column: number;
	/** Content-space y (px) of the top edge. */
	y: number;
	/** Card height (px). */
	h: number;
	/**
	 * The transitive collision cluster this card belongs to (`core/layout.ts` `packDayEvents`).
	 *
	 * Stable across a re-layout, and what an unfold is addressed by — so the fold is a property of the
	 * GROUP rather than of whichever card happens to be drawing the `+N` chip this frame.
	 */
	clusterId: string;
	/** How many cards share the cluster. Feeds the accessible name's overlap clause only. */
	clusterSize: number;
	/** How this card's box was resolved — see `core/layout.ts` `PlacementMode`. */
	mode: PlacementMode;
	/** Containment level: 0 at the top of a cluster, +1 per nest. */
	nestDepth: number;
	/** The card this one is drawn inside, or null. */
	parentCardId: string | null;
	/** Directly nested children — what a "contains N" clause counts, not the whole cluster. */
	childCount: number;
	/** What the `+N` chip prints. `0` when nothing is hidden or the cluster is unfolded. */
	foldedCount: number;
	/**
	 * Draw this card as a PLAIN COLOUR BLOCK — its fill and its shape, and nothing else.
	 *
	 * Set by the placement engine on every member of an EXPANDED cluster of more than one (see
	 * `DaySlot.bare` in `core/layout.ts`), which is the one situation where text costs more than it
	 * buys: six concurrent cards at their true positions are six narrow lanes, and six titles clipped
	 * to three characters each is noise where the reader is trying to read a SHAPE. Their names are in
	 * the list popover the expansion opens with, at a full line each.
	 *
	 * PRESENTATION ONLY. The card keeps its rect, its hit target and its full accessible name — see
	 * `eventAccessibleName`, which does not consult this flag.
	 */
	bare: boolean;
	/** Inline start as a fraction of one column, `0..1`. */
	insetStart: number;
	/** Inline width as a fraction of one column, `0..1`. */
	insetWidth: number;
	/**
	 * Whether the paint pass draws pixels for this card.
	 *
	 * Replaces the implicit `stackDepth > 0` skip that lived in two files and had to be kept in
	 * agreement by hand. It is a FIELD because the nesting model has three separate reasons a card
	 * might not be drawn, and one boolean is cheaper to keep honest than three predicates that agree
	 * today and quietly stop agreeing after the next edit.
	 *
	 * Every card is still IN the scene whether or not it is drawn, so the accessible layer built from
	 * this list stays complete — a card that draws no pixels is not a card a reader may not reach.
	 */
	drawn: boolean;
	/**
	 * `end === start`: a point in time, painted as a pin marker rather than as a box.
	 *
	 * Orthogonal to {@link mode}: an instant can still be nested inside a meeting and can still be
	 * folded. Falling through to a card would assert a span the event does not have — a deadline drawn
	 * as a plausible twelve-minute meeting is worse than one drawn as nothing.
	 */
	instant: boolean;
	/**
	 * Extra height (px) this card is currently expanded by on hover, already RESOLVED.
	 *
	 * `0` at rest. It arrives as a number, exactly as {@link SceneScrollbar.opacity} does, so a frozen
	 * animation clock cannot strand a card mid-expansion. `eventRect` adds it to `h`, so the expanded
	 * box is both what is drawn and what is hit — the two may not come apart, or the pointer
	 * oscillates on the expansion's own edge.
	 */
	hoverExpandPx: number;
	/**
	 * How far this card has RECEDED behind the current interaction.
	 *
	 * The visual-hierarchy channel: while one card is being dragged, resized, or pointed at from the
	 * overlap list, every OTHER card steps back so the reader's eye has exactly one place to be.
	 *
	 * It names the STATE rather than carrying an opacity, and that is the token rule rather than
	 * fastidiousness: this package may not hold a number that is a design decision, and "how faint is
	 * receded" is one. The two depths are authored in `calendar.css` as `--cal-dim-drag` and
	 * `--cal-dim-focus` and reach the canvas through {@link ScenePalette.dimDrag} / `dimFocus`, so the
	 * DOM day timeline and the Week canvas recede by the same amount without either restating it.
	 *
	 * TWO depths and not one, because a thing the reader is DOING needs less separation than a thing
	 * they are LOOKING FOR — a drag already announces itself through movement, where a list hover has
	 * only this.
	 */
	recede: SceneRecede;
	/**
	 * Ring this card and hold it at full strength — the answer to "which of these is the one I am
	 * pointing at".
	 *
	 * Its counterpart is {@link recede} on everything else. A ring alone is not enough on a grid of
	 * plain colour blocks that may share a fill, and a recession alone leaves the reader comparing
	 * degrees of faintness; the pair says "this one" in a single glance.
	 */
	highlighted: boolean;
	/** Host + participant faces, already privacy-filtered (empty on a masked card). Capped by the paint pass to the leading few — see `AVATAR_MAX` in `scene-paint.ts`. */
	faces: SceneFace[];
	/** The accent token NAME as authored (e.g. `"--danger"`) — the key into {@link ScenePalette}. */
	accent: string;
	/** SVG path data for the kind mark, on a 16-unit box. */
	glyph: string;
	/** The drawn title — already privacy-masked where the source event was. */
	title: string;
	/** The time range line. */
	time: string;
	/** An optional third line (location), drawn only when the card is tall enough. */
	location: string;
	/** An attendee counter (`"6 / 12"`), or `""`. */
	attendees: string;
	/**
	 * What KIND this is, in the singular spoken register — "Deadline", "Meeting", "Open slot".
	 *
	 * Carried on the card rather than looked up from the event, because a masked card must not leak
	 * its real kind through this channel either, and the masking is already resolved here.
	 */
	kindLabel: string;
	masked: boolean;
	cancelled: boolean;
	/**
	 * How many calendars this occurrence is on — the provenance channel, as a COUNT.
	 *
	 * The DOM card asks {@link CalendarProps.renderSource} for one consumer-supplied brand mark per
	 * source; a canvas cannot host a VNode, so this pass draws one neutral dot each and the card's
	 * accessible name says "on N calendars" — which is the fact a reader is actually after, and the
	 * only half of the channel that survives being read aloud in the DOM card either. Always `0` on a
	 * MASKED card: §Part 1.4 allows it exactly one fact, and which calendars an appointment lives on
	 * is not that fact.
	 */
	sources: number;
}

/** The current-time rule. */
export interface SceneNowLine {
	/** Content-space y (px). */
	y: number;
	/** The column it is confined to, or null to span every column (the single-column timeline). */
	column: number | null;
}

/** A translucent preview rectangle — drag-to-create, a dragged card's landing slot, or a DRAFT. */
export interface SceneSelection {
	column: number;
	/** Content-space y (px) of the top edge. */
	y: number;
	h: number;
	/** A label drawn inside it ("09:15 – 10:15"), or `""`. */
	text: string;
	/**
	 * This preview is a live DRAFT — an event the reader has begun creating, whose quick-create
	 * popover is open, and which they may still drag or resize before committing.
	 *
	 * It changes two things. It is drawn with a DASHED stroke (`palette.selectionDash`), because a
	 * dash is the one shape channel that reads as "provisional" without spending a colour the palette
	 * has already given four meanings to. And it becomes a pointer TARGET, with grab bands at its two
	 * horizontal edges — which a preview that only exists while a button is held never needed to be.
	 *
	 * A preview mid-drag is NOT a draft: it is the live shape of the gesture in flight, it is already
	 * being dragged, and drawing it dashed would say "provisional" about the one thing on screen the
	 * reader is directly controlling.
	 */
	draft?: boolean;
}

/**
 * The overlay depth gauge, in CANVAS space (it does not scroll with the content).
 *
 * It carries DEPTH rather than a resolved rectangle, because the handle's box depends on palette
 * metrics — the track's inset and the bar's width — that only exist once the probe has been read.
 * One helper (`scrollbarRect`) turns this into a box, and both the painter and the hit test call it,
 * so the handle a reader grabs and the handle the canvas drew cannot come apart.
 */
export interface SceneScrollbar {
	/** 0…1 through the scrollable range. */
	progress: number;
	/** Handle length (px) frozen at grab time, or null while the gauge is free to follow depth. */
	frozen: number | null;
	/** 0…1 — a RESOLVED opacity, never a transition, so a frozen animation clock cannot strand it. */
	opacity: number;
	/** Whether the handle is grabbed or hovered (the brighter fill). */
	active: boolean;
	/**
	 * The live lever, or null when no drag is in flight.
	 *
	 * It replaces the signed edge-hold `pressure` this carried until now, and the replacement is
	 * conceptual rather than cosmetic: under a rate-based lever there is no track edge to overshoot,
	 * so "how far past the end are we" no longer describes the gesture at all. What describes it is
	 * how far the pointer has travelled from where it grabbed.
	 *
	 * `morph` is resolved by `core/chrome.ts`'s `leverBall` and is what tells the painter to draw a
	 * ball instead of a pill — a dedicated flag rather than overloading {@link frozen}, which is a
	 * LENGTH and was standing in for "a drag is live" only because nothing else was.
	 */
	lever: { grabY: number; displacement: number; morph: number } | null;
}

/** The return-to-present pill, in CANVAS space. */
export interface ScenePresent {
	/** Which way the now-line lies relative to the viewport. */
	direction: "up" | "down";
	text: string;
	/** Whether the pointer is over it. */
	hover: boolean;
	/**
	 * Whether the accessible layer's "Return to now" button holds focus.
	 *
	 * The DOM control this replaced carried `:focus-visible`; its parallel control is inside the
	 * visually-hidden layer, so the ring it would draw is clipped. Painting it here is what keeps the
	 * indicator, rather than losing it to the migration (WCAG 2.4.7).
	 */
	focused: boolean;
}

// #endregion

// #region Palette
/**
 * The resolved drawing values, all of them read from live computed styles (see `useGridCanvas`) —
 * a canvas cannot read a CSS custom property, and this package may not hold a colour of its own.
 *
 * Colours arrive already normalised by {@link toCanvasColor}, so the paint routine never parses in
 * its hot path. A width of `0` means the declaration did not resolve; the paint routine treats that
 * as "draw the thinnest honest line" for a rule and as "draw nothing" for an optional edge, rather
 * than substituting a number this package invented.
 */
export interface GridPalette {
	/** Hour rules AND the column separators — one hairline tone for the whole lattice. */
	rule: string;
	ruleWidth: number;
	/** The day-boundary rule, one step stronger than an hour rule. */
	boundary: string;
	boundaryWidth: number;
	/** The working-hours band's tint. */
	bandFill: string;
	/** The band's leading edge — the bar that says where a bookable window opens. */
	bandEdge: string;
	bandEdgeWidth: number;
	/** The blacked-out day's hatch. */
	blackout: string;
	/** Hatch stripe thickness (px), measured perpendicular to the stripe. */
	hatchStripe: number;
	/** Hatch repeat pitch (px), measured perpendicular to the stripe. */
	hatchPitch: number;
}

/**
 * One resolved text style. Assembled from the LONGHANDS rather than the `font` shorthand, because
 * `getComputedStyle` returns an empty string for the shorthand in more than one engine — and a
 * silently empty font string leaves the 2D context on its 10px sans-serif default, which looks like
 * a deliberate choice rather than a failed read.
 */
export interface TextStyle {
	/** The assembled `ctx.font` value, e.g. `"600 11.52px Inter, sans-serif"`. */
	font: string;
	/** Resolved fill colour. */
	color: string;
	/** Resolved size in px — the caller needs it for line spacing the font string cannot give back. */
	size: number;
	/**
	 * Resolved `letter-spacing`, and `word-spacing`, as CSS lengths (`"0.36px"`, or `"normal"`).
	 *
	 * These are not typographic garnish: the open-dyslexic overlay is a family swap PLUS more
	 * tracking, more word spacing and more leading, described in `styles/index.css` as documented
	 * reading aids rather than a stylistic preference. A canvas that took only the family would give
	 * a dyslexic reader a third of the accommodation while every DOM label beside it widened.
	 */
	letterSpacing: string;
	wordSpacing: string;
	/** Resolved `line-height` in px, or `0` when it computed to `normal` (the caller then derives one). */
	lineHeight: number;
}

/**
 * One event accent, resolved through the token layer for the kind (or the consumer's override).
 *
 * 2026-08-20: `fill` is now the FULL-STRENGTH accent (a rich, playful solid rather than a pastel 16%
 * wash), so a card needs a genuinely computed ink to sit on it rather than the flat `--on-surface` a
 * pale wash could get away with — that is {@link onAccent}, `core/kinds.ts`'s `onAccentFor()` reading
 * straight off the theme engine's own verified-AA "on-" pair for this same token.
 */
export interface AccentPaint {
	/** The card's resting fill — the accent token at full strength. */
	fill: string;
	/** The card's hovered fill, one step deeper. */
	fillHover: string;
	/** The masked card's fill — a quiet wash, deliberately NOT solid (§Part 1.4: masked is calm, not
	 *  attention-grabbing — see `paintCard`). */
	fillMasked: string;
	/** The accent itself — now used for the stack's shadow silhouettes and the bubble-mode pip. */
	accent: string;
	/** The verified-contrast ink for text/glyph/avatar-ring drawn ON {@link fill} or {@link fillHover}. */
	onAccent: string;
	/**
	 * The card's OPTIONAL border colour, and its width in px.
	 *
	 * Exactly one group in the shipped palette declares one — Tentative, whose pale wash cannot carry
	 * "not settled yet" on a page that is itself pale — but the channel belongs to every accent so the
	 * paint routine needs no branch. An accent that declares no edge resolves the probe's `var()`
	 * fallback to `transparent` at `0`, and a width of `0` is this palette's established "draw
	 * nothing" (see {@link GridPalette}), so an unbordered card costs one comparison and no pixels.
	 */
	edge: string;
	edgeWidth: number;
}

/**
 * Everything the FULL viewport pass needs, over and above the lattice.
 *
 * It extends rather than replaces {@link GridPalette} so the hybrid Day timeline, which paints only
 * the lattice, keeps taking exactly the palette it always did — and so `paintGrid` stays callable,
 * and testable, on its own.
 */
export interface ScenePalette extends GridPalette {
	/** Text styles, resolved from the same token layer the DOM around the canvas reads. */
	hourText: TextStyle;
	titleText: TextStyle;
	metaText: TextStyle;
	markerText: TextStyle;
	pillText: TextStyle;
	/**
	 * A MASKED card's title.
	 *
	 * The DOM card steps a masked title down on TWO axes (`font-weight: 500` and
	 * `--on-surface-variant`) so the privacy treatment does not ride the fill alone. Resolved as its
	 * own style rather than derived from {@link titleText}, because "one step quieter" is a token
	 * decision and this package may not make it in TypeScript.
	 */
	maskedText: TextStyle;
	/** The wash a period marker sits on, so it stays legible over a rule. */
	markerFill: string;
	/** A cancelled card's opacity (0…1) — the same declaration `.cal-event--cancelled` carries. */
	cancelledAlpha: number;
	/**
	 * The two RECESSION depths (0…1 opacity), for a card that is not the subject of the interaction.
	 *
	 * `dimDrag` while something is being moved or drawn, `dimFocus` while a row in the overlap list is
	 * being pointed at. They are the same `--cal-dim-drag` / `--cal-dim-focus` declarations
	 * `.cal-daycol__event` reads, so the DOM day timeline and this canvas recede by one number each
	 * rather than by two that agree today. See `SceneEvent.recede`.
	 */
	dimDrag: number;
	dimFocus: number;
	/** The current-time rule. */
	now: string;
	nowWidth: number;
	/** Diameter (px) of the dot that makes the current-time rule findable at a glance. */
	nowDotSize: number;
	/**
	 * How faint (0…1) the LEAD-IN run is drawn.
	 *
	 * In a multi-day view the rule spans only the active day, but the anchoring dot belongs on the
	 * time-gutter axis — that is the scale the reader reads a horizontal position against. When the
	 * active day is not the first column the two are separated by whole days, and the lead-in is the
	 * quiet run that joins them: strong enough to read as one continuous mark, faint enough not to be
	 * mistaken for a fifth hour rule crossing four other days.
	 */
	nowLeadAlpha: number;
	/** The drag-to-create preview. */
	selectionFill: string;
	selectionStroke: string;
	selectionStrokeWidth: number;
	/** The preview's logical inline insets (px) inside its column — leading, then trailing. */
	selectionInsetStart: number;
	selectionInsetEnd: number;
	/**
	 * The DRAFT block's dashed stroke: the dash length and the gap between dashes, in px.
	 *
	 * A dash is the one shape channel that reads as "this is provisional" without spending a colour,
	 * which matters on a grid whose four fills are already carrying four meanings. Both are lengths
	 * rather than a `border-style` keyword because `setLineDash` takes numbers and a computed
	 * `border-style` gives back only the word — see the swatch's own note. `0` for either means the
	 * stroke is drawn solid, which is what a drag-in-flight preview stays.
	 */
	selectionDash: number;
	selectionGap: number;
	/** The draft's own opacity (0…1) — its subtlety, kept apart from the stroke so the two tune apart. */
	selectionAlpha: number;
	/**
	 * How deep (px) the DRAFT block's two edge grab bands are.
	 *
	 * A drawing value that is only ever a TARGET: the edges are not painted differently, so this
	 * number never becomes pixels. It is a palette entry rather than a constant here for the same
	 * reason `barHit` is — a pointer target floor is a decision the design system makes, and 24px is
	 * not a number this package may pick for itself (WCAG 2.2 SC 2.5.8).
	 */
	selectionGrab: number;
	/** The overlay depth gauge. */
	barFill: string;
	barFillStrong: string;
	barEdge: string;
	barEdgeWidth: number;
	barRadius: number;
	barWidth: number;
	barInset: number;
	/**
	 * The gauge's minimum POINTER TARGET across the inline axis (px, WCAG 2.2 SC 2.5.8).
	 *
	 * Separate from {@link barWidth} because the two answer different questions: the handle is drawn
	 * at the width the design asks for (10px reads as a gauge, not as a scrollbar), and it is HIT
	 * across whatever the target floor requires. Widening the drawn bar to 24px to satisfy the floor
	 * would be letting an accessibility minimum redraw the design; widening only the target is not.
	 */
	barHit: number;
	/**
	 * The BALL a grabbed handle morphs into (§Part 4's lever) — its diameter and its fill.
	 *
	 * The fill is the same value {@link barFillStrong} resolves to today, and it is carried separately
	 * anyway: the ball is a distinct control state, and a design that later wants the held handle to
	 * read differently from the merely hovered one should not have to fork the palette to say so.
	 */
	barBallSize: number;
	barBallFill: string;
	/**
	 * The return-to-present pill.
	 *
	 * Its BOX is a palette value rather than a measurement of its own label, so the hit test can be a
	 * pure function of the scene: a rect derived from `ctx.measureText` would only exist inside a
	 * draw, and the click target would then depend on a frame having run.
	 */
	pillFill: string;
	pillStroke: string;
	pillStrokeWidth: number;
	/** The pill's hovered ring — a canvas control has no `:hover`, so the ring thickens instead. */
	pillStrokeWidthHover: number;
	pillAccent: string;
	pillW: number;
	pillH: number;
	pillInset: number;
	/**
	 * The focus indicator, TWO-TONE.
	 *
	 * A single tone cannot satisfy WCAG 2.4.11 here by computation rather than by opinion: the ring
	 * abuts the card's accent-tinted fill on one side and the grid on the other, and no one colour
	 * clears 3:1 against both across the generated palette. The halo is drawn touching the control
	 * and the ink outside it, exactly as `--focus-ring-shadow` composes them for every DOM control —
	 * and a canvas ring cannot be corrected later by a cascade the way a DOM one can.
	 */
	focusRing: string;
	focusRingHalo: string;
	focusRingWidth: number;
	/**
	 * The tooltip surface.
	 *
	 * The canvas tooltip itself is gone — hover now expands the CARD, and every popover is real HTML
	 * (see the `GridScene` doc). These three are the resolved surface it was painted on, kept because
	 * a palette entry nothing reads costs a computed-style read and nothing else, and removing them
	 * would touch a paint fixture owned elsewhere for no behavioural gain. They are a barrel-cleanup
	 * item, not a live channel.
	 */
	tooltipFill: string;
	tooltipStroke: string;
	tooltipStrokeWidth: number;
	/**
	 * The ring drawn INSIDE a highlighted card's edge, in px.
	 *
	 * Inside rather than around, and in the card's own verified `onAccent` ink rather than a new
	 * colour, because a ring drawn outside abuts the grid on one side and the card on the other and
	 * would need the same two-tone treatment `focusRing` documents. An inset ring has one background —
	 * the fill it sits on — whose contrast pair the theme engine has already verified.
	 */
	highlightRingWidth: number;
	/** Card corner radius — now a "pronounced, playful" step (`--radius-lg`, 12px) up from `--radius-sm`
	 *  (6px): with the leading bar gone, the card's whole silhouette carries its identity, and a tight
	 *  radius read as a a chip clipped from a spreadsheet rather than a tactile, held object. */
	eventRadius: number;
	/**
	 * The kind mark's drawn box (px) and its rendered stroke weight (px).
	 *
	 * Both come from the icon contract (§B.7's `--icon-2xs` / `--icon-stroke`) rather than from this
	 * engine, so the mark on a card matches the weight of every other glyph on the page. The stroke
	 * is a RENDERED width: the paint routine divides it by the path's own scale, which is what
	 * `vector-effect: non-scaling-stroke` does for the DOM twin of the same mark.
	 */
	glyphSize: number;
	glyphStroke: number;
	/**
	 * The hovered card's LIFT, decomposed.
	 *
	 * A canvas takes a shadow as three separate numbers where CSS takes one `box-shadow`, so the ink,
	 * the blur radius and the y offset arrive individually — read off a swatch that restates
	 * `--elevation-medium`'s own components, `--shadow-intensity` included, so the overlay that
	 * flattens shadows product-wide flattens this one too.
	 */
	liftShadow: string;
	liftBlur: number;
	liftOffsetY: number;
	/**
	 * The hovered card's scale, as a RATIO (`1.02`, not `102`).
	 *
	 * It rides a LENGTH on the swatch (`calc(ratio * 100px)`, divided by 100 on the read) because a
	 * computed `border-width` snaps to whole device pixels — the same trap {@link glyphStroke}
	 * documents, where `1.5` would come back as `1` and the mark would be drawn a third lighter than
	 * every other glyph on the page.
	 */
	liftScale: number;
	/**
	 * The instant (point-in-time) marker: rule thickness, chip width, neutral ink, chip corner radius.
	 *
	 * All four are fixed marks rather than measurements, because an instant has no duration and so has
	 * no height that could encode one. A card drawn for an instant would assert a span the event does
	 * not have.
	 */
	pinThickness: number;
	pinChipW: number;
	/**
	 * The pin RULE's extent as a fraction (0…1) of the band it is drawn in.
	 *
	 * A rule drawn the full width of a day column reads as a grid line: it lands on the same
	 * horizontal as the hour label in the gutter beside it and appears to strike through it. Half the
	 * band keeps the mark unmistakably an event — it starts where every card in that column starts and
	 * stops well short of the far edge, so nothing on the row continues the hour scale.
	 *
	 * A RATIO rather than a length, because the band is itself a fraction of a column whose width
	 * changes with the view, the zoom and the nesting depth. `1` (the fallback when the probe did not
	 * resolve) is the pre-2026-08-22 full-width behaviour.
	 */
	pinWidthFrac: number;
	pinInk: string;
	pinRadius: number;
	/**
	 * The `+N` chip's box — minimum width and height.
	 *
	 * Declared rather than measured from the drawn label, for the same reason {@link pillW}/{@link
	 * pillH} are: the chip is the target that UNFOLDS a cluster, and a rect that can only be known
	 * inside a draw makes a click target depend on a frame having run.
	 */
	badgeMinW: number;
	badgeH: number;
	/**
	 * The avatar/provider stack + the `+N` overflow chip (§Part 2). One circle diameter serves both a
	 * face and a provider dot, so the two stacks read as one visual family; text comes off the SAME
	 * step the card's meta line uses, sized down by the paint routine to fit inside the circle.
	 */
	avatarSize: number;
	badgeText: TextStyle;
	/** Per-accent-token card paints, keyed by the authored custom-property name. */
	accents: Record<string, AccentPaint>;
	/** The fallback accent for a token the probe did not resolve. */
	accentFallback: AccentPaint;
}
// #endregion

// #region Box
/** The canvas's measured box for one draw. */
export interface GridBox {
	/** CSS px. */
	width: number;
	/** CSS px. */
	height: number;
	/** Backing-store scale — 2 on a retina display. */
	dpr: number;
	/** Whether the surface is mirrored (`dir="rtl"`), in which case column 0 is the RIGHTmost. */
	rtl: boolean;
}
// #endregion

// #region Colour normalisation
/** A colour resolved to canvas-ready sRGB channels (`r`/`g`/`b` 0–255, `a` 0–1). */
export interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

const HEX = /^#([0-9a-f]+)$/i;
const FUNCTIONAL = /^(rgba?|color)\(([^)]*)\)$/i;

function clamp(n: number, lo: number, hi: number): number {
	return n < lo ? lo : n > hi ? hi : n;
}

/**
 * One channel token. A percentage is a fraction of the notation's own full-scale value — 255 for the
 * legacy `rgb()` channels, 1 for `color(srgb …)` and for every alpha — and `none` (CSS Color 4's
 * missing component) resolves to zero, which is what it composites as in sRGB.
 */
function channel(token: string, scale: number): number {
	if (token === "none") return 0;
	const n = parseFloat(token);
	if (!Number.isFinite(n)) return NaN;
	return token.endsWith("%") ? (n / 100) * scale : n;
}

/**
 * Parse a resolved CSS colour.
 *
 * The `color(srgb r g b / a)` form with 0–1 components is not an edge case here: this app generates
 * its palette through the Material colour engine and `getComputedStyle` hands back exactly that
 * notation for a `color-mix()` result, so a parser that only knew `rgb()` would fail on every token
 * the calendar actually draws with. Hex and the legacy/modern `rgb()`/`rgba()` forms are accepted too
 * because a consumer outside this app may well author them.
 *
 * Returns `null` for anything else — a named colour, `display-p3`, a gradient — so the caller can
 * hand the original string to the 2D context untouched rather than guess.
 */
export function parseCssColor(value: string): Rgba | null {
	const v = value.trim().toLowerCase();
	if (!v) return null;
	if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

	const hex = HEX.exec(v);
	if (hex) {
		const digits = hex[1];
		const short = digits.length === 3 || digits.length === 4;
		if (!short && digits.length !== 6 && digits.length !== 8) return null;
		const size = short ? 1 : 2;
		const at = (i: number): number => {
			const part = digits.slice(i * size, i * size + size);
			return parseInt(short ? part + part : part, 16);
		};
		const hasAlpha = digits.length === 4 || digits.length === 8;
		return { r: at(0), g: at(1), b: at(2), a: hasAlpha ? at(3) / 255 : 1 };
	}

	const fn = FUNCTIONAL.exec(v);
	if (!fn) return null;
	const name = fn[1];
	// A slash separates the alpha in every modern form; the legacy comma form leaves it as a fourth
	// positional token. Normalising both here is what lets one token walk cover all five notations.
	const [head, afterSlash] = fn[2].split("/");
	const parts = head.trim().split(/[\s,]+/).filter(Boolean);
	if (name === "color" && parts.shift() !== "srgb") return null;
	let alphaToken = afterSlash?.trim() ?? "";
	if (!alphaToken && parts.length === 4) alphaToken = parts.pop() as string;
	if (parts.length !== 3) return null;

	const scale = name === "color" ? 1 : 255;
	const raw = parts.map((p) => channel(p, scale));
	const alpha = alphaToken ? channel(alphaToken, 1) : 1;
	if (!raw.every(Number.isFinite) || !Number.isFinite(alpha)) return null;

	const to255 = (n: number) => clamp(Math.round(name === "color" ? n * 255 : n), 0, 255);
	return { r: to255(raw[0]), g: to255(raw[1]), b: to255(raw[2]), a: clamp(alpha, 0, 1) };
}

/**
 * A canvas-ready colour string.
 *
 * An unrecognised notation is passed through UNCHANGED rather than replaced by a fallback: the 2D
 * context parses colours itself and will very likely accept what this function did not, and a
 * confidently wrong colour is worse than one this function declined to touch.
 */
export function toCanvasColor(value: string): string {
	const c = parseCssColor(value);
	if (!c) return value.trim();
	return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * 1000) / 1000})`;
}
// #endregion

// #region Paint
/**
 * Paint one complete frame of the grid backdrop.
 *
 * Order is meaning, not habit: the region tints go down first (they are the ground the day sits on),
 * then the column separators, then the hour rules and finally the day boundaries — so the structural
 * lattice always reads ON TOP of a tinted working window instead of being washed out by it.
 *
 * Everything is culled against the canvas box before it is drawn. That is not an optimisation
 * flourish: one Week block is 24 hours tall, which at the engine's maximum zoom is some 4000px
 * against a ~600px viewport, so an unculled blackout hatch would stroke hundreds of invisible lines
 * on every scroll frame.
 */
export function paintGrid(
	ctx: CanvasRenderingContext2D,
	scene: GridScene,
	palette: GridPalette,
	box: GridBox,
): void {
	const { width, height, dpr, rtl } = box;
	const deviceW = ctx.canvas.width;
	const deviceH = ctx.canvas.height;

	// Reset before every draw. A transform outlives the frame that set it and the backing store is
	// only re-created when the SIZE changes, so a draw that inherited the previous scale would
	// compound it — the classic canvas-goes-blurry-then-vanishes bug.
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, deviceW, deviceH);
	if (width <= 0 || height <= 0) return;

	/*
	 * Under `dir="rtl"` the hour gutter sits on the right and the day columns run right-to-left. The
	 * mirror is applied ONCE, as a negated horizontal scale, rather than by flipping every coordinate
	 * at every call site — six mirrored expressions is six chances to forget one, and this way the
	 * paint code below is written in pure logical coordinates where x grows from the inline start.
	 */
	if (rtl) ctx.setTransform(-dpr, 0, 0, dpr, deviceW, 0);
	else ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

	const gutter = scene.gutter ?? 0;
	const lattice = Math.max(0, width - gutter);
	const colW = scene.columns > 0 ? lattice / scene.columns : lattice;
	/** Snap a CSS-px position onto the device pixel grid, so a hairline stays a hairline. */
	const snap = (v: number) => Math.round(v * dpr) / dpr;
	/** A rule's drawn thickness: never thinner than one device pixel, never fatter than declared. */
	const thin = (v: number) => Math.max(1 / dpr, snap(v));

	/** A region's visible slice in canvas space, or null when it is entirely off-screen. */
	const slice = (r: GridRegion): { y0: number; y1: number } | null => {
		const y0 = Math.max(0, r.y - scene.scrollTop);
		const y1 = Math.min(height, r.y + r.h - scene.scrollTop);
		return y1 > y0 ? { y0, y1 } : null;
	};

	// Blackout — time that is not the schedule's to give away.
	if (palette.blackout) {
		for (const region of scene.blackouts) {
			const s = slice(region);
			if (!s) continue;
			hatch(
				ctx,
				snap(gutter + region.column * colW),
				s.y0,
				colW,
				s.y1 - s.y0,
				palette,
				region.y - scene.scrollTop,
			);
		}
	}

	// Working-hours bands — a tinted window plus the bar that marks where it opens.
	for (const region of scene.bands) {
		const s = slice(region);
		if (!s) continue;
		const x = snap(gutter + region.column * colW);
		if (palette.bandFill) {
			ctx.fillStyle = palette.bandFill;
			ctx.fillRect(x, s.y0, colW, s.y1 - s.y0);
		}
		if (palette.bandEdge && palette.bandEdgeWidth > 0) {
			ctx.fillStyle = palette.bandEdge;
			ctx.fillRect(x, s.y0, thin(palette.bandEdgeWidth), s.y1 - s.y0);
		}
	}

	// Column separators — between columns only, never at either outer edge.
	if (palette.rule && scene.columns > 1) {
		ctx.fillStyle = palette.rule;
		const w = thin(palette.ruleWidth);
		for (let i = 1; i < scene.columns; i++) ctx.fillRect(snap(gutter + i * colW), 0, w, height);
	}

	/*
	 * Day-boundary rules ONLY (2026-08-20 declutter pass). A dense hour-by-hour lattice was the
	 * single biggest contributor to the "corporate spreadsheet" reading the redesign asks against —
	 * every one of ~18 rows on screen at once, competing with the cards for the reader's eye, for
	 * information the gutter's own hour labels already carry. What survives is the ONE rule that is
	 * actual content rather than ruled paper: the line marking a real date transition (midnight),
	 * drawn in the stronger `boundary` tone. `scene.rules` still carries every hour (the gutter's
	 * hour-label loop and the virtualization window both key off it), so this is a paint-time filter,
	 * not a data one — a consumer wanting the old dense lattice back draws it from the same array.
	 */
	if (palette.boundary) {
		for (const rule of scene.rules) {
			if (!rule.boundary) continue;
			const y = rule.y - scene.scrollTop;
			if (y < -1 || y > height) continue;
			ctx.fillStyle = palette.boundary;
			ctx.fillRect(gutter, snap(y), lattice, thin(palette.boundaryWidth));
		}
	}
}

/**
 * The horizontal geometry of one draw, resolved ONCE so every layer lands on the same grid.
 *
 * The overlay pass and the hit test both read it, which is the point: a card the reader clicks and
 * the card the canvas drew have to be the same rectangle, and that only holds while one function
 * answers where a column is.
 */
export interface ColumnGeometry {
	/** Inline-start offset (px) of the first column. */
	gutter: number;
	/** One column's width (px). */
	colW: number;
	/** The lattice's total width (px) — the canvas box minus the gutter. */
	lattice: number;
}

/** Resolve {@link ColumnGeometry} for a scene inside a canvas of `width` CSS px. */
export function columnGeometry(scene: GridScene, width: number): ColumnGeometry {
	const gutter = scene.gutter ?? 0;
	const lattice = Math.max(0, width - gutter);
	return { gutter, lattice, colW: scene.columns > 0 ? lattice / scene.columns : lattice };
}

/**
 * The blacked-out day's diagonal hatch — the universal "not available" texture, and the one thing
 * here that has to reproduce a CSS gradient rather than a border.
 *
 * `repeating-linear-gradient(45deg, C 0 stripe, transparent stripe pitch)` measures both lengths
 * ALONG the gradient line, i.e. perpendicular to the stripes. A canvas `lineWidth` is already
 * perpendicular, so the thickness carries over directly; the spacing does not, because stepping the
 * stripes horizontally by the pitch would put them √2 too close together.
 *
 * With no resolvable stripe geometry it degrades to a flat wash of the same colour: still an honest
 * "this day is off", rather than nothing at all.
 */
function hatch(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	palette: GridPalette,
	originY: number = y,
): void {
	ctx.save();
	ctx.beginPath();
	ctx.rect(x, y, w, h);
	ctx.clip();
	if (palette.hatchStripe > 0 && palette.hatchPitch > palette.hatchStripe) {
		ctx.strokeStyle = palette.blackout;
		ctx.lineWidth = palette.hatchStripe;
		const step = palette.hatchPitch * Math.SQRT2;
		/*
		 * The stripes are phased against the region's OWN top, not against the visible slice.
		 *
		 * Each stripe is the line X - Y = x + d - y, so stepping `d` alone phases the pattern to
		 * whatever `y` happens to be — and `y` is the CLIPPED top, which changes with every pixel of
		 * scroll. The texture then crawls across a block that is not moving, which reads as the
		 * blackout itself shifting. Offsetting `d` by how far the slice has been cut into the region
		 * pins the phase to the content, so a scrolled region shows the same stripes in the same
		 * places.
		 */
		const phase = (((y - originY) % step) + step) % step;
		ctx.beginPath();
		for (let d = -h - step + phase; d <= w + step; d += step) {
			ctx.moveTo(x + d, y);
			ctx.lineTo(x + d + h, y + h);
		}
		ctx.stroke();
	} else {
		ctx.fillStyle = palette.blackout;
		ctx.fillRect(x, y, w, h);
	}
	ctx.restore();
}
// #endregion
