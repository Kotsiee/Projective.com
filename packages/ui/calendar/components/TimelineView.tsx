/**
 * @projective/ui/calendar — the TIMELINE view: every event on a horizontal time axis, one lane per
 * KIND, drawn by the `@projective/ui/gantt` engine.
 *
 * This component is a MAPPING and nothing else. It translates the calendar's events into the
 * Gantt's lanes and items, and the Gantt's gestures back into the calendar's own callbacks — the
 * same `onOpenEvent`, `onQuickCreate`, `onExpandCreate`, `onMoveEvent` and `renderEventActions` the
 * Day, Week and Month views report through — so a host that already wired the calendar gets the
 * fourth view for free, and there is no second vocabulary for "an event was opened". Geometry,
 * zoom, panning, fly mode, the popover and the accessible layer are all the engine's.
 *
 * Lanes are the event KINDS present (in a fixed reading order), because a lane is a category on a
 * Gantt and the kind is the calendar's one category: a meeting and a deadline in the same week read
 * as two rows rather than one column, which is the whole point of the view. A masked block keeps
 * its privacy — the lane it sits on names the kind the viewer is entitled to see, and its label is
 * the status word the mask permits, exactly as in the other three views (§Part 1.4).
 */
import type { JSX, VNode } from "preact";
import { useMemo } from "preact/hooks";
import Gantt from "../../gantt/islands/Gantt.tsx";
import type {
	GanttItem,
	GanttItemActionContext,
	GanttLane,
	GanttRange,
} from "../../gantt/core/types.ts";
import type {
	CalendarEvent,
	CalendarEventKind,
	CalendarRange,
	EventPopoverActionContext,
} from "../core/types.ts";
import { accentFor, CALENDAR_KIND_LABEL, effectiveAccent, maskLabel } from "../core/kinds.ts";

/** Lane order — commitments first, then the things that bound them, then the blocks around them. */
const KIND_ORDER: readonly CalendarEventKind[] = [
	"session",
	"booking",
	"sync",
	"milestone",
	"deadline",
	"availability",
	"busy",
	"holiday",
	"general",
];

const STATUS_WORD: Record<string, string> = {
	confirmed: "Confirmed",
	tentative: "Tentative",
	busy: "Busy",
	available: "Available",
	cancelled: "Cancelled",
};

export interface TimelineViewProps {
	events: readonly CalendarEvent[];
	/** IANA display timezone. */
	tz: string;
	hour12: boolean;
	/** The focused instant — the engine centres on it and re-centres when it changes. */
	focusMs: number;
	/** "Now", epoch ms — the today rule. `null` before mount (SSR paints no clock), then the engine's. */
	todayMs: number | null;
	canCreate?: boolean;
	/** localStorage key the engine persists its own zoom under (already suffixed by the caller). */
	storageKey?: string;
	renderEventActions?: (ctx: EventPopoverActionContext) => VNode | null;
	onSelectRange?: (range: CalendarRange) => void;
	onQuickCreate?: (range: CalendarRange, title: string) => void;
	onExpandCreate?: (range: CalendarRange, title: string) => void;
	onOpenEvent?: (event: CalendarEvent) => void;
	onMoveEvent?: (event: CalendarEvent, range: CalendarRange) => void;
	/** The viewport's centre day moved. */
	onFocusChange?: (ms: number) => void;
	/** Selectors the engine's popover must never overlap. */
	avoid?: readonly string[];
}

const laneIdOf = (kind: CalendarEventKind): string => `kind:${kind}`;

/** The calendar event an engine item was built from. */
function eventOf(item: GanttItem): CalendarEvent | null {
	const data = item.data as CalendarEvent | undefined;
	return data && typeof data === "object" && "kind" in data ? data : null;
}

/** One item per event, on its kind's lane. */
function toItem(event: CalendarEvent): GanttItem {
	const masked = !!event.masked;
	const label = masked ? maskLabel(event.status) : event.title;
	const status = event.status ? STATUS_WORD[event.status] ?? event.status : undefined;
	return {
		id: event.id,
		laneId: laneIdOf(event.kind),
		label,
		kind: event.end === event.start ? "milestone" : "bar",
		start: event.start,
		end: event.end,
		accent: event.accent ?? effectiveAccent(event.kind, event.status, masked, event.allDay),
		progress: null,
		meta: masked ? undefined : (event.meta ?? event.location ?? undefined),
		status,
		// A masked block is somebody else's commitment; it is not the viewer's to drag.
		movable: !masked,
		href: masked ? undefined : event.href,
		data: event,
	};
}

export function TimelineView(props: TimelineViewProps): JSX.Element {
	const { events, canCreate = false, onMoveEvent } = props;

	const { lanes, items } = useMemo(() => {
		const present = new Set(events.map((e) => e.kind));
		const counts = new Map<CalendarEventKind, number>();
		for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
		const lanes: GanttLane[] = KIND_ORDER.filter((k) => present.has(k)).map((kind) => ({
			id: laneIdOf(kind),
			label: CALENDAR_KIND_LABEL[kind],
			accent: accentFor(kind),
			meta: String(counts.get(kind) ?? 0),
			creatable: canCreate,
		}));
		// A calendar with nothing on it still needs somewhere to create: one lane, for the kind a
		// quick-create defaults to on every other view.
		if (lanes.length === 0 && canCreate) {
			lanes.push({
				id: laneIdOf("sync"),
				label: CALENDAR_KIND_LABEL.sync,
				accent: accentFor("sync"),
				creatable: true,
			});
		}
		return { lanes, items: events.map(toItem) };
	}, [events, canCreate]);

	const range = (r: GanttRange): CalendarRange => ({ start: r.start, end: r.end });

	return (
		<Gantt
			class="cal-timeline"
			lanes={lanes}
			items={items}
			timezone={props.tz}
			hour12={props.hour12}
			now={props.todayMs ?? undefined}
			focus={props.focusMs}
			storageKey={props.storageKey}
			readOnly={!canCreate && !onMoveEvent}
			canCreate={canCreate}
			laneHeading="Event types"
			ariaLabel="Timeline"
			avoid={props.avoid}
			onOpenItem={(item) => {
				const ev = eventOf(item);
				if (ev) props.onOpenEvent?.(ev);
			}}
			onCreateRange={(_lane, r, _anchor, title) => {
				if (props.onExpandCreate) props.onExpandCreate(range(r), title ?? "");
				else props.onSelectRange?.(range(r));
			}}
			onQuickCreate={props.onQuickCreate
				? (_lane, r, title) => props.onQuickCreate?.(range(r), title)
				: undefined}
			onMoveItem={onMoveEvent
				? (item, r) => {
					const ev = eventOf(item);
					if (ev) onMoveEvent(ev, range(r));
				}
				: undefined}
			onFocusChange={props.onFocusChange}
			renderItemActions={props.renderEventActions
				? (ctx: GanttItemActionContext) => {
					const ev = eventOf(ctx.item);
					return ev ? props.renderEventActions!({ event: ev, close: ctx.close }) : null;
				}
				: undefined}
			empty={<p class="cal-timeline__empty">Nothing scheduled.</p>}
		/>
	);
}
