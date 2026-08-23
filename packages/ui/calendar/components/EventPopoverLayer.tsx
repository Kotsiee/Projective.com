/**
 * @projective/ui/calendar — the HTML popover layer that floats OVER the grid.
 *
 * WHY IT IS A LAYER AND NOT A CHILD OF THE GRID. The Week view is a canvas and the Day/Month views
 * scroll inside clipped viewports, so a panel drawn where its anchor is would be clipped by the very
 * element it points at. Worse, the surfaces this engine is mounted into are a stacking context
 * (`position: sticky`), `overflow: clip`, and glass (`backdrop-filter`) — all three at once in the
 * authenticated shell's middle-nav lane — and any one of them defeats a `position: fixed` panel that
 * merely stays in the tree: the first caps its paint order, the second clips it outright, the third
 * re-bases `fixed` onto that ancestor's own box. So the panel is projected into `document.body` by
 * {@link BodyPortal}, exactly as every other anchored surface in this package is.
 *
 * THE CANVAS-ANCHOR PROBLEM, AND WHY THERE ARE TWO PROXIES. {@link useFloating} measures a DOM
 * element, and this layer's anchor is a painted rectangle — there is no node to measure. Both halves
 * of "anchored overlay" therefore need a stand-in, and they need DIFFERENT ones, because they ask
 * different questions:
 *
 *  - **Position** is asked of the VIEWPORT. Its proxy (`.cal-pop__anchor`) is portalled beside the
 *    panel, so no transformed or filtered ancestor can re-base it and hand `getBoundingClientRect`
 *    a rect that is honest about the element but wrong about the anchor.
 *  - **Ownership** is asked of the TREE. `overlay-registry` derives parentage as "A owns B iff A's
 *    panel contains B's TRIGGER", and the trigger is the one element that is never portalled — it
 *    stays where the author wrote it. Its proxy (`.cal-pop__tether`) therefore renders inline, in
 *    the calendar. That is what makes a calendar mounted INSIDE a dialog read a click on this
 *    popover as a click inside itself rather than as an outside click that closes it.
 *
 * A single element cannot be both: portalled, it is a body child whose ownership chain leads
 * nowhere; inline, its measured rect is only as trustworthy as its ancestors' filters.
 *
 * MOTION. The entry is a SPRING on `--cal-pop-scale` ({@link createSpring} with `SPRING_SNAPPY`),
 * written to the panel as a resolved number rather than interpolated by CSS; the exit is an opacity
 * fade off `[data-state]`. Both touch only `transform` and `opacity`. The stylesheet's resting state
 * is the CLOSED one and is corrected by `[data-state="open"]`, so a tab that never services a frame
 * still arrives open — and {@link prefersJumpToFinal} makes the spring write its final value
 * synchronously, so nothing here waits on a frame that may not come.
 */
import type { JSX, VNode } from "preact";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Signal } from "@preact/signals";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { createSpring, prefersJumpToFinal, SPRING_SNAPPY } from "../../core/motion.ts";
import { BodyPortal } from "../../overlay/components/BodyPortal.tsx";
import { usePresence } from "../../overlay/core/usePresence.ts";
import { useDismiss } from "../../hooks/useDismiss.ts";
import { useFloating } from "../../hooks/useFloating.ts";
import { useFocusTrap } from "../../hooks/useFocusTrap.ts";
import { useId } from "../../hooks/useId.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import type {
	CalendarAttendee,
	CalendarEvent,
	CalendarEventKind,
	CalendarRange,
	EventPopoverActionContext,
} from "../core/types.ts";
import {
	CALENDAR_KIND_PATH,
	CALENDAR_KIND_SINGULAR,
	CALENDAR_KIND_STROKE,
	CALENDAR_KIND_VIEWBOX,
	effectiveAccent,
	maskLabel,
	onAccentFor,
} from "../core/kinds.ts";
import { AVATAR_MAX, initialsOf } from "../core/scene-build.ts";
import { fmtFullDate, fmtRange } from "../core/time.ts";
import { ChevronLeftIcon, ClockIcon, ExpandIcon, GlobeIcon, PlusIcon } from "./glyphs.tsx";
import { EventBlock } from "./EventBlock.tsx";

// #region Contract
/**
 * Where the popover points, in VIEWPORT (client) px — the same frame `getBoundingClientRect` reports
 * in, so a caller hands over a canvas hit rect already translated to the screen and nothing
 * downstream has to know which view painted it.
 */
export interface EventPopoverAnchor {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * What the layer is currently showing, or `null` for nothing.
 *
 * A discriminated union rather than three optional fields, because the three states carry genuinely
 * different data and are mutually exclusive: a stack has no single event, a create has no event at
 * all, and any shape that could express two at once would need a rule about which one wins.
 */
export type EventPopoverState =
	| { kind: "event"; event: CalendarEvent; anchor: EventPopoverAnchor }
	| { kind: "stack"; events: CalendarEvent[]; anchor: EventPopoverAnchor; clusterId: string }
	| {
		kind: "create";
		range: CalendarRange;
		anchor: EventPopoverAnchor;
		/**
		 * A title already typed elsewhere — what a full modal hands BACK when the reader minimises it.
		 *
		 * The composer seeds its local field from this and then owns it, so re-publishing the state on
		 * every pointer move of a live drag (which the grid does) cannot type over what the reader is
		 * in the middle of writing.
		 */
		title?: string;
	};

/** Props for {@link EventPopoverLayer}. */
export interface EventPopoverLayerProps {
	/**
	 * The live state. The layer both READS and CLEARS it: dismissal is the layer's own job (Escape, an
	 * outside pointer, a committed quick-create), and a host that had to be told to close would be a
	 * second owner of a fact the layer already knows.
	 *
	 * `anchor` is expected to MOVE while a drag-create is in flight, so it is tracked rather than
	 * snapshotted at open. Reassigning `state.value` is the reliable way to publish a move; for a host
	 * that mutates the anchor object in place the layer additionally re-reads it on every
	 * `pointermove` of a live drag, which is the case the in-place path exists for.
	 */
	state: Signal<EventPopoverState | null>;
	/** IANA display timezone — the same one the grid resolved its positions in. */
	tz: string;
	/** 12-hour clock. */
	hour12: boolean;
	/**
	 * Draw the action header for one event. Absent -> the header is not drawn AT ALL, rather than
	 * drawn empty or drawn disabled: a capability the host cannot honour is absent, never offered and
	 * then refused.
	 */
	renderEventActions?: (ctx: EventPopoverActionContext) => VNode | null;
	/** Open the full event surface. Absent -> the title is plain text rather than a dead control. */
	onOpenEvent?: (event: CalendarEvent) => void;
	/** Commit a quick-create. Absent -> the create popover reads the range back and offers no submit. */
	onQuickCreate?: (range: CalendarRange, title: string) => void;
	/**
	 * Open the FULL creation surface, carrying whatever the reader has already entered here.
	 *
	 * Absent -> the composer offers no expand control at all, rather than a disabled one: a capability
	 * the host cannot honour is absent, never offered and then refused. The `title` argument is the
	 * whole point of the handoff — nothing the reader typed may be lost on the way through.
	 */
	onExpandCreate?: (range: CalendarRange, title: string) => void;
	/**
	 * The event the reader is currently pointing at IN THIS PANEL, published so the grid can ring it.
	 *
	 * The grid cannot work this out for itself: the panel is body-portalled, so a pointer travelling
	 * from a card into this list fires the grid viewport's own `pointerleave` and clears its hover —
	 * on the very card the row under the pointer stands for. One extra channel is what stops the two
	 * from cancelling each other out.
	 */
	highlight?: Signal<string | null>;
	/**
	 * While true, an outside POINTER does not dismiss the panel.
	 *
	 * It exists for one situation the containment model cannot see: the create composer's DRAFT BLOCK
	 * is painted pixels on a canvas, not an element, so `overlay-registry` — which answers "is this
	 * click mine?" by walking the DOM — correctly reports a press on it as outside and closes the
	 * panel the reader was about to drag the block for. The grid raises this for the duration of such a
	 * press, from a document CAPTURE listener registered at mount, which is ahead of `useDismiss`'s
	 * own; that ordering is the whole mechanism.
	 *
	 * It gates the POINTER channel only. Escape still closes, which is right: a reader holding the
	 * block and pressing Escape is cancelling the drag, and the grid clears the flag on release.
	 */
	pointerGuard?: Signal<boolean>;
	/**
	 * Higher-level layout zones the panel must never intersect, as live CSS selectors — the site-nav
	 * sidebar, the shell header. Re-measured on every reposition, so a rail that collapses mid-session
	 * keeps constraining the panel.
	 */
	avoid?: readonly string[];
}

export type { EventPopoverActionContext };
// #endregion

// #region Constants
/**
 * The scale the panel grows FROM. Small enough to read as an arrival, large enough that the text
 * inside is never legibly wrong on the way in — a panel that starts at half size is a zoom, and a
 * zoom on a surface full of words reads as a mistake being corrected.
 */
const ENTRY_SCALE = 0.94;

/** Exit-transition budget before the panel leaves the DOM. Matches `Popover`'s, deliberately. */
const EXIT_MS = 150;

/** Gap between the anchor rectangle and the panel, px. */
const ANCHOR_OFFSET = 8;

/** Inset the panel keeps from the viewport edge, px — comfort, not layout, so it is its own number. */
const VIEWPORT_PAD = 12;
// #endregion

// #region Marks
/**
 * The kind mark, drawn from the same path data the canvas feeds a `Path2D` and the DOM card feeds a
 * `<path>`. Size and weight come from CSS (`.cal-pop__kindglyph`), because a CSS declaration outranks
 * an SVG presentation attribute — the attributes below are the no-stylesheet fallback, and
 * `vector-effect` is what keeps the weight a rendered width rather than a fraction of the 16-unit
 * path box.
 */
function KindMark({ kind }: { kind: CalendarEventKind }): JSX.Element {
	return (
		<svg
			class="cal-pop__kindglyph"
			viewBox={`0 0 ${CALENDAR_KIND_VIEWBOX} ${CALENDAR_KIND_VIEWBOX}`}
			width="14"
			height="14"
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
 * One face circle. A photo where given, with a plain `onerror` collapse back to the initials
 * underneath — a broken image box is worse than never having tried — and its own ring weight for the
 * host, so the person running the thing is findable without a row of their own.
 *
 * The names are NOT put on a `title` attribute: a native tooltip cannot be styled, cannot be reached
 * by keyboard, and is announced twice by some screen readers. They ride the row's own text instead,
 * which is where a reader will actually meet them.
 */
function Face({ face }: { face: CalendarAttendee }): JSX.Element {
	return (
		<span class={cx("cal-pop__face", face.isHost && "cal-pop__face--host")}>
			{face.avatarUrl
				? (
					<img
						class="cal-pop__facephoto"
						src={face.avatarUrl}
						alt=""
						loading="lazy"
						onError={(e) => {
							(e.currentTarget as HTMLImageElement).style.display = "none";
						}}
					/>
				)
				: null}
			<span class="cal-pop__faceinitials" aria-hidden="true">{initialsOf(face.name)}</span>
		</span>
	);
}

/** Host-first, capped at {@link AVATAR_MAX}, then a `+N` chip — the convention a grid card uses. */
function Faces({ faces }: { faces: readonly CalendarAttendee[] }): JSX.Element | null {
	if (faces.length === 0) return null;
	const ordered = faces.slice().sort((a, b) => Number(!!b.isHost) - Number(!!a.isHost));
	const shown = ordered.slice(0, AVATAR_MAX);
	const overflow = ordered.length - shown.length;
	const names = ordered.map((f) => (f.isHost ? `${f.name} (host)` : f.name)).join(", ");
	return (
		<p class="cal-pop__fact">
			<span class="cal-pop__faces" aria-hidden="true">
				{shown.map((f) => <Face key={f.id} face={f} />)}
				{overflow > 0 ? <span class="cal-pop__face cal-pop__face--more">+{overflow}</span> : null}
			</span>
			<span class="cal-pop__facttext">{names}</span>
		</p>
	);
}
// #endregion

// #region Panes
/** Props for the single-event pane. */
interface EventPaneProps {
	event: CalendarEvent;
	tz: string;
	hour12: boolean;
	onOpenEvent?: (event: CalendarEvent) => void;
}

/**
 * The single-event view.
 *
 * PRIVACY (§Part 1.4) is enforced HERE rather than left to the consumer, because this panel is
 * reachable from guest surfaces: a masked block carries its privacy-safe status label and its
 * position in the day, and NOTHING else — no title, no kind glyph (the glyph is a channel), no
 * location, no faces, no provenance and no attendee counter. The mask substitutes the privacy-safe
 * pair for the real kind exactly as a grid card does, so the two presentations of one block cannot
 * disagree about what they are willing to say.
 */
function EventPane({ event, tz, hour12, onOpenEvent }: EventPaneProps): JSX.Element {
	const masked = !!event.masked;
	const accent = event.accent ?? effectiveAccent(event.kind, event.status, masked, event.allDay);
	const shownKind: CalendarEventKind = masked
		? (event.status === "available" ? "availability" : "busy")
		: event.kind;
	const title = masked ? maskLabel(event.status) : event.title;
	const timeLabel = event.allDay ? "All day" : fmtRange(event.start, event.end, tz, hour12);
	const faces = masked ? [] : (event.attendeeFaces ?? []);
	const showAttendees = !masked && typeof event.attendees === "number";

	const heading = (
		<>
			<span class="cal-pop__kindchip">
				<KindMark kind={shownKind} />
			</span>
			<span class="cal-pop__titletext">{title}</span>
		</>
	);

	return (
		<div
			class={cx("cal-pop__event", masked && "cal-pop__event--masked")}
			style={styleVars({
				"--cal-accent": `var(${accent})`,
				"--cal-accent-on": `var(${onAccentFor(accent)})`,
			})}
		>
			{onOpenEvent
				? (
					<button
						type="button"
						class="cal-pop__title cal-pop__title--open"
						onClick={() => onOpenEvent(event)}
					>
						{heading}
					</button>
				)
				: <p class="cal-pop__title">{heading}</p>}

			<p class="cal-pop__kindname">
				{masked ? maskLabel(event.status) : CALENDAR_KIND_SINGULAR[shownKind]}
			</p>

			<div class="cal-pop__facts">
				<p class="cal-pop__fact">
					<ClockIcon size={14} class="cal-pop__facticon" />
					<span class="cal-pop__facttext">
						{fmtFullDate(event.start, tz)}
						<span class="cal-pop__facttime">{timeLabel}</span>
					</span>
				</p>
				{!masked && event.location
					? (
						<p class="cal-pop__fact">
							<GlobeIcon size={14} class="cal-pop__facticon" />
							<span class="cal-pop__facttext">{event.location}</span>
						</p>
					)
					: null}
				{!masked && event.meta
					? <p class="cal-pop__fact cal-pop__fact--quiet">{event.meta}</p>
					: null}
				{showAttendees
					? (
						<p class="cal-pop__fact cal-pop__fact--quiet">
							{event.attendees}
							{typeof event.capacity === "number" ? ` / ${event.capacity}` : ""} attending
						</p>
					)
					: null}
				<Faces faces={faces} />
			</div>
		</div>
	);
}

/** Props for the stacked-cluster list. */
interface StackPaneProps {
	events: readonly CalendarEvent[];
	tz: string;
	hour12: boolean;
	onPick: (event: CalendarEvent) => void;
	listRef: { current: HTMLDivElement | null };
	/** Publish which row is under the pointer, so the grid can ring the block it stands for. */
	onPoint: (id: string | null) => void;
}

/**
 * Step 1 of the two-step flow: the cluster as a list of high-fidelity previews.
 *
 * The previews are literally {@link EventBlock}s — the same component the grid mounts — rather than a
 * second, popover-flavoured card. A cluster list exists precisely so a reader can recognise the card
 * they were reaching for, and a preview that restated it in a different visual language would defeat
 * the one job it has. It also means the accent, the kind glyph, the masking rules and the accessible
 * name are inherited rather than re-derived, so they cannot drift apart.
 */
function StackPane(
	{ events, tz, hour12, onPick, listRef, onPoint }: StackPaneProps,
): JSX.Element {
	return (
		/*
		 * The clearing handler is on the LIST rather than on each row, so travelling from one row to the
		 * next never passes through a frame with nothing highlighted. A per-row `pointerleave` fires
		 * before the next row's `pointerenter`, which reads as a flicker on the grid at exactly the
		 * moment the reader is comparing two blocks.
		 */
		<div
			class="cal-pop__list"
			ref={listRef}
			tabIndex={-1}
			onPointerLeave={() => onPoint(null)}
		>
			{events.map((ev) => (
				<div
					class="cal-pop__item"
					key={ev.id}
					data-cal-event={ev.id}
					onPointerEnter={() => onPoint(ev.id)}
					/*
					 * FOCUS mirrors hover, so the same answer reaches a keyboard reader. `focusin`/`focusout`
					 * rather than `focus`/`blur` because the focusable element is the EventBlock's own button
					 * one level down, and the non-bubbling pair would never reach this row.
					 */
					onFocusIn={() => onPoint(ev.id)}
					onFocusOut={() => onPoint(null)}
				>
					<EventBlock event={ev} tz={tz} hour12={hour12} onOpen={onPick} />
				</div>
			))}
		</div>
	);
}
// #endregion

/**
 * The popover layer. Renders nothing until the host publishes a state, and nothing again once the
 * exit has played out.
 *
 * Mount it ONCE per calendar, as a sibling of the views rather than inside one, so a view switch
 * cannot tear down an open panel — and so the inline ownership tether stays at a stable point in the
 * tree for `overlay-registry` to reason about.
 */
export function EventPopoverLayer(props: EventPopoverLayerProps): JSX.Element | null {
	const {
		state,
		tz,
		hour12,
		renderEventActions,
		onOpenEvent,
		onQuickCreate,
		onExpandCreate,
		avoid,
	} = props;

	const live = state.value;
	const isOpen = live !== null;

	/*
	 * The last non-null state, kept so the exit transition still has something to draw. Written during
	 * render rather than in an effect because the render that sets `live` to `null` is the very render
	 * that needs the previous value — an effect would arrive one paint too late and blank the panel
	 * before it had faded.
	 */
	const lastRef = useRef<EventPopoverState | null>(null);
	if (live) lastRef.current = live;
	const shown = live ?? lastRef.current;

	const { mounted, state: presence } = usePresence(isOpen, EXIT_MS);

	const panelRef = useRef<HTMLDivElement>(null);
	/** The portalled positioning proxy — measured by `useFloating`. See the module doc. */
	const anchorRef = useRef<HTMLDivElement>(null);
	/** The inline ownership tether — registered as this overlay's trigger. See the module doc. */
	const tetherRef = useRef<HTMLSpanElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const backRef = useRef<HTMLButtonElement>(null);
	const panelId = useId(undefined, "cal-pop");

	const stack = useOverlayStack({ active: mounted, layer: "popover" });
	/*
	 * `right-start` because a calendar card is tall and narrow and its neighbours are directly above
	 * and below it: a panel opened downward would cover the next hour, which is usually the thing the
	 * reader is comparing against. The flip handles the far edge of the week, and the `avoid` zones
	 * handle the nav rails, which a viewport clamp alone cannot see.
	 */
	const floating = useFloating({
		open: mounted,
		triggerRef: anchorRef,
		panelRef,
		placement: "right-start",
		offset: ANCHOR_OFFSET,
		collisionPadding: VIEWPORT_PAD,
		avoid,
	});

	const close = useCallback(() => {
		state.value = null;
		// The highlight is this panel's to publish and therefore this panel's to retract. A ring left
		// behind on a card whose list has closed is a card claiming to be the answer to a question
		// nobody is asking any more.
		if (props.highlight) props.highlight.value = null;
	}, [state, props.highlight]);

	// Non-modal: the grid beneath stays live, so focus is confined for keyboard convenience only and
	// the page is NOT marked inert — hiding a genuinely interactive page from assistive tech would
	// describe it wrongly.
	useFocusTrap({
		active: mounted,
		containerRef: panelRef,
		initialFocusRef: inputRef,
		inertBackground: false,
	});
	/*
	 * Dismissal, with the one guard the containment model cannot express — see `pointerGuard`. It is
	 * checked here rather than inside `close` so the submit path, the Escape path and the host's own
	 * clearing are all unaffected: only an OUTSIDE POINTER can be vetoed, and only for the duration of
	 * a press the grid has claimed.
	 */
	const dismiss = useCallback(() => {
		if (props.pointerGuard?.peek()) return;
		close();
	}, [close, props.pointerGuard]);
	useDismiss({
		open: mounted,
		enabled: stack.isTop,
		onDismiss: dismiss,
		panelRef,
		triggerRef: tetherRef,
	});

	/*
	 * Publishing which row is under the pointer. A no-op when the host wired no channel, so the panel
	 * stays usable on a surface that has not opted into the grid highlight.
	 */
	const point = useCallback((id: string | null) => {
		if (props.highlight) props.highlight.value = id;
	}, [props.highlight]);

	// A panel torn down mid-hover would otherwise strand its last published row: `pointerleave` never
	// fires on an element that has been removed from under the pointer.
	useLayoutEffect(() => {
		if (mounted) return;
		if (props.highlight) props.highlight.value = null;
	}, [mounted, props.highlight]);

	// #region Anchor tracking
	/** The rect currently written to the proxy, so an unchanged anchor costs no work. */
	const placedRef = useRef<EventPopoverAnchor | null>(null);

	/**
	 * Move the positioning proxy and ask `useFloating` to re-measure.
	 *
	 * The reposition is requested through a `resize` event because that is the hook's own live
	 * listener — the same mechanism `useEdgeDetection.recompute` uses. Writing the geometry straight
	 * to the element rather than through the render body keeps ONE writer: a drag publishes many
	 * anchors per second, and a second writer diffing the same four numbers would fight this one.
	 */
	const place = useCallback((a: EventPopoverAnchor) => {
		const el = anchorRef.current;
		if (!el) return;
		const prev = placedRef.current;
		if (prev && prev.x === a.x && prev.y === a.y && prev.w === a.w && prev.h === a.h) return;
		placedRef.current = { x: a.x, y: a.y, w: a.w, h: a.h };
		el.style.setProperty("--cal-pop-anchor-x", `${a.x}px`);
		el.style.setProperty("--cal-pop-anchor-y", `${a.y}px`);
		el.style.setProperty("--cal-pop-anchor-w", `${a.w}px`);
		el.style.setProperty("--cal-pop-anchor-h", `${a.h}px`);
		if (typeof globalThis.dispatchEvent === "function") {
			globalThis.dispatchEvent(new Event("resize"));
		}
	}, []);

	const anchor = shown?.anchor;
	const ax = anchor?.x;
	const ay = anchor?.y;
	const aw = anchor?.w;
	const ah = anchor?.h;
	useLayoutEffect(() => {
		if (!mounted || !anchor) return;
		place(anchor);
	}, [mounted, anchor, ax, ay, aw, ah, place]);

	useLayoutEffect(() => {
		if (!mounted) placedRef.current = null;
	}, [mounted]);
	// #endregion

	// #region Entry spring
	const scale = useMemo(() => createSpring(ENTRY_SCALE, { config: SPRING_SNAPPY }), []);
	useLayoutEffect(() => () => scale.dispose(), [scale]);

	/*
	 * The spring writes a RESOLVED number to the panel; it is never handed to CSS as a transition.
	 * Subscribing rather than reading the signal in the render body is deliberate: a tick that
	 * re-rendered the whole panel would re-render a list of preview cards sixty times a second for a
	 * six-percent scale change.
	 *
	 * The stylesheet's `--cal-pop-scale` default is the CLOSED value and `[data-state="open"]` corrects
	 * it, so a panel whose spring never got to run still opens; the inline value simply wins where it
	 * does. `createSpring` writes its target synchronously under `prefersJumpToFinal`, which is the
	 * hidden-tab and reduced-motion path.
	 */
	useLayoutEffect(() => {
		if (!mounted) return;
		const el = panelRef.current;
		if (!el) return;
		scale.jump(ENTRY_SCALE);
		const unsub = scale.value.subscribe((v) => {
			el.style.setProperty("--cal-pop-scale", v.toFixed(4));
		});
		scale.set(1);
		return unsub;
	}, [mounted, scale]);
	// #endregion

	// #region Two-step flow
	const [detail, setDetail] = useState<CalendarEvent | null>(null);
	const [slide, setSlide] = useState<"forward" | "back" | null>(null);
	const [title, setTitle] = useState("");
	const listScrollRef = useRef(0);
	const returnToRef = useRef<string | null>(null);

	/**
	 * The identity of the thing being shown. A drag-create keeps ONE key for the whole gesture, so a
	 * moving anchor never wipes what the reader has already typed into it.
	 */
	const subjectKey = shown === null
		? ""
		: shown.kind === "stack"
		? `stack:${shown.clusterId}`
		: shown.kind === "event"
		? `event:${shown.event.id}`
		: "create";

	/*
	 * Seeded from the state, not cleared to empty. A create popover the reader has just MINIMISED back
	 * out of the full modal arrives carrying what they typed there, and the whole point of the round
	 * trip is that nothing is lost on the way. It is read once per subject and then owned locally, so
	 * the grid re-publishing the state sixty times a second during a drag cannot type over them.
	 */
	const seedTitle = shown?.kind === "create" ? (shown.title ?? "") : "";
	useLayoutEffect(() => {
		setDetail(null);
		setSlide(null);
		setTitle(seedTitle);
		listScrollRef.current = 0;
		returnToRef.current = null;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [subjectKey]);

	const openDetail = useCallback((ev: CalendarEvent) => {
		listScrollRef.current = listRef.current?.scrollTop ?? 0;
		returnToRef.current = ev.id;
		setSlide(prefersJumpToFinal() ? null : "forward");
		setDetail(ev);
	}, []);

	const backToList = useCallback(() => {
		setSlide(prefersJumpToFinal() ? null : "back");
		setDetail(null);
	}, []);

	/*
	 * Step changes move focus themselves, because the focus trap only places focus once, on activate.
	 * Going forward lands on Back — the control that undoes what just happened — and coming back lands
	 * on the row the reader left, at the scroll offset they left it at, so returning from a detour puts
	 * them where they were rather than at the top of a list they have already read.
	 *
	 * `stepRef` skips the run that happens on mount: the trap is already placing initial focus there,
	 * and two owners of the same focus produce a visible fight.
	 */
	const stepRef = useRef<string | null>(null);
	useLayoutEffect(() => {
		if (!mounted) {
			stepRef.current = null;
			return;
		}
		const step = detail ? `d:${detail.id}` : "l";
		const prev = stepRef.current;
		stepRef.current = step;
		if (prev === null || prev === step) return;
		if (detail) {
			backRef.current?.focus({ preventScroll: true });
			return;
		}
		const list = listRef.current;
		if (!list) return;
		list.scrollTop = listScrollRef.current;
		const id = returnToRef.current;
		const row = id
			? list.querySelector<HTMLElement>(`[data-cal-event="${CSS.escape(id)}"] button`)
			: null;
		(row ?? list).focus({ preventScroll: true });
	}, [mounted, detail]);
	// #endregion

	// #region Live drag
	/**
	 * Whether a pointer is currently dragging the selection this create popover belongs to.
	 *
	 * While it is, the panel does not accept the pointer: the popover spawns UNDER the cursor that is
	 * still drawing the range, and a panel that swallowed those moves would end the gesture the moment
	 * it appeared. The listener doubles as the recovery path for a host that mutates `anchor` in place
	 * rather than reassigning the signal — a mutation publishes no notification, so the only honest way
	 * to see it is to look while the drag is happening.
	 */
	const [dragging, setDragging] = useState(false);
	const isCreate = shown?.kind === "create";
	useLayoutEffect(() => {
		if (!mounted || !isCreate || typeof document === "undefined") return;
		let held = false;
		const onMove = (e: PointerEvent) => {
			if (e.buttons === 0) return;
			if (!held) {
				held = true;
				setDragging(true);
			}
			const a = state.peek()?.anchor;
			if (a) place(a);
		};
		const onEnd = () => {
			if (!held) return;
			held = false;
			setDragging(false);
		};
		document.addEventListener("pointermove", onMove, true);
		document.addEventListener("pointerup", onEnd, true);
		document.addEventListener("pointercancel", onEnd, true);
		return () => {
			document.removeEventListener("pointermove", onMove, true);
			document.removeEventListener("pointerup", onEnd, true);
			document.removeEventListener("pointercancel", onEnd, true);
			setDragging(false);
		};
	}, [mounted, isCreate, state, place]);
	// #endregion

	if (!mounted || !shown) return null;

	// #region Resolved view
	const detailEvent = shown.kind === "event" ? shown.event : detail;
	const showingList = shown.kind === "stack" && detail === null;

	/*
	 * A MASKED event names itself with its privacy-safe status and nothing else — not even the
	 * `kind: title` shape a real event uses, which on a masked block would read "Busy: Busy" and, worse,
	 * would tell a listener the panel is withholding something. The absence is the honest description.
	 */
	const label = shown.kind === "create"
		? "New event"
		: shown.kind === "stack" && showingList
		? `${shown.events.length} overlapping events`
		: detailEvent
		? detailEvent.masked
			? maskLabel(detailEvent.status)
			: `${CALENDAR_KIND_SINGULAR[detailEvent.kind]}: ${detailEvent.title}`
		: "Event";

	/*
	 * The action header is withheld from a MASKED event on the engine's own authority. Every action it
	 * offers — a deep link, an export, an edit — names the thing it acts on, and a masked block is one
	 * the viewer is not entitled to identify (§Part 1.4). The host cannot make that call for us,
	 * because it is handed the event and would have to remember to check.
	 */
	const actions = detailEvent && !detailEvent.masked && renderEventActions
		? renderEventActions({ event: detailEvent, close })
		: null;
	const showBack = shown.kind === "stack" && detail !== null;
	const showHead = actions !== null || showBack;

	const paneKey = shown.kind === "create" ? "create" : detailEvent ? `d:${detailEvent.id}` : "list";
	const slideClass = slide === "forward"
		? "cal-pop__pane--forward"
		: slide === "back"
		? "cal-pop__pane--back"
		: null;

	const range = shown.kind === "create" ? shown.range : null;
	const canSubmit = title.trim().length > 0 && typeof onQuickCreate === "function";
	// #endregion

	return (
		<>
			{/* Zero-size, inline, never hit: the ownership tether. See the module doc. */}
			<span class="cal-pop__tether" ref={tetherRef} aria-hidden="true" />
			<BodyPortal>
				<div class="cal-pop__anchor" ref={anchorRef} aria-hidden="true" />
				<div
					ref={panelRef}
					id={panelId}
					role="dialog"
					aria-label={label}
					data-state={presence}
					data-placement={floating?.placement ?? "right-start"}
					class={cx("cal-pop", dragging && "cal-pop--dragging")}
					style={styleVars({
						"--float-top": floating ? `${floating.top}px` : undefined,
						"--float-left": floating ? `${floating.left}px` : undefined,
						"--float-available-h": floating?.availableHeight != null
							? `${floating.availableHeight}px`
							: undefined,
						"--z-portal": String(stack.zIndex),
					})}
					tabIndex={-1}
				>
					<div class="cal-pop__panel">
						{showHead
							? (
								<div class="cal-pop__head">
									{showBack
										? (
											<button
												type="button"
												class="cal-pop__back"
												ref={backRef}
												onClick={backToList}
												aria-label="Back to the list"
											>
												<ChevronLeftIcon size={16} />
											</button>
										)
										: null}
									{actions ? <div class="cal-pop__actions">{actions}</div> : null}
								</div>
							)
							: null}

						<div class={cx("cal-pop__pane", slideClass)} key={paneKey}>
							{shown.kind === "create" && range
								? (
									<form
										class="cal-pop__form"
										onSubmit={(e) => {
											e.preventDefault();
											const t = title.trim();
											if (!t || !onQuickCreate) return;
											onQuickCreate(range, t);
											close();
										}}
									>
										<p class="cal-pop__range">
											<ClockIcon size={14} class="cal-pop__facticon" />
											<span class="cal-pop__facttext">
												{fmtFullDate(range.start, tz)}
												<span class="cal-pop__facttime">
													{range.allDay ? "All day" : fmtRange(range.start, range.end, tz, hour12)}
												</span>
											</span>
										</p>
										{onQuickCreate
											? (
												<>
													<label class="cal-pop__label" for={`${panelId}-title`}>Title</label>
													<input
														id={`${panelId}-title`}
														ref={inputRef}
														class="cal-pop__input"
														type="text"
														value={title}
														placeholder="Add a title"
														autocomplete="off"
														onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)}
													/>
													<button type="submit" class="cal-pop__submit" disabled={!canSubmit}>
														<PlusIcon size={15} />
														<span>Create</span>
													</button>
												</>
											)
											: null}
										{
											/*
											 * The escape hatch to the full surface, carrying whatever has been typed here.
											 *
											 * `type="button"` is load-bearing inside a form: the default is `submit`, so
											 * without it pressing this would ALSO commit the quick-create and the reader
											 * would end up with an event they had not finished describing and a modal
											 * offering to describe it again.
											 *
											 * It is rendered outside the `onQuickCreate` gate above, so a host that offers
											 * only the full surface still gets a route to it — and it is absent entirely
											 * when the host wired neither, rather than present and inert.
											 */
										}
										{onExpandCreate
											? (
												<button
													type="button"
													class="cal-pop__expand"
													onClick={() => {
														onExpandCreate(range, title.trim());
														close();
													}}
												>
													<ExpandIcon size={14} />
													<span>Expand to full details</span>
												</button>
											)
											: null}
									</form>
								)
								: shown.kind === "stack" && showingList
								? (
									<StackPane
										events={shown.events}
										tz={tz}
										hour12={hour12}
										onPick={openDetail}
										listRef={listRef}
										onPoint={point}
									/>
								)
								: detailEvent
								? (
									<EventPane
										event={detailEvent}
										tz={tz}
										hour12={hour12}
										onOpenEvent={onOpenEvent}
									/>
								)
								: null}
						</div>
					</div>
				</div>
			</BodyPortal>
		</>
	);
}
