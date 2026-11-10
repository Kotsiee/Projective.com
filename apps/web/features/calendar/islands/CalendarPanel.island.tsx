import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/calendar-chrome.css";
import { calendarTime, maskLabel, MiniMonth, useNowTick } from "@projective/ui/calendar";
import { Drawer } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { type LaneTabOption, LaneTabs, useMediaQuery } from "@projective/ui/navigation";
import type { SchedulePage } from "@projective/types/scheduling";
import {
	CONTEXT_PANEL_INFLOW_QUERY,
	contextDrawerOpen,
} from "@web/features/shell/core/context-panel-state.ts";
import { EventSummary } from "../components/EventSummary.tsx";
import { PanelAgenda } from "../components/PanelAgenda.tsx";
import { RoutineSummary } from "../components/RoutineSummary.tsx";
import {
	answerTargetFor,
	CALENDAR_PANEL_ID,
	calendarFocus,
	calendarPage,
	type CalendarSurface,
	calendarView,
	focusedAt,
	importedEvents,
	invitationsOnly,
	leaveInspector,
	panelReturn,
	type PanelTab,
	panelTab,
	routinesOn,
	selectedEventId,
	selectedRoutineId,
} from "../core/calendar-state.ts";

const ENTITY_TABS: readonly LaneTabOption<PanelTab>[] = [
	{ value: "month", label: "Month" },
	{ value: "events", label: "Events" },
];

/** Props for {@link CalendarPanel}. */
export interface CalendarPanelProps {
	/** The SSR page, so the month paints in the first byte on the page's own clock and zone. */
	initial: SchedulePage | null;
	/** The entry `?event=` names, so a linked entry paints in the first byte too, with no swap. */
	linkedEventId?: string | null;
	/** The routine `?routine=` names, by its slug, likewise. */
	linkedRoutineSlug?: string | null;
	/** Which calendar the panel frames (default `personal`). */
	surface?: CalendarSurface;
	/** The address asks for invitations alone, so the Events tab's first byte is already narrowed. */
	invitations?: boolean;
	/** The page the Events tab's Invitations row narrows (default `/calendar`). */
	path?: string;
}

/**
 * CalendarPanel — the calendar's middle-nav PANEL: the month navigator, and the inspector for the
 * entry or routine picked.
 *
 * From 1280px it docks in the frame and the header band's toggle opens and closes it through the
 * shell's shared panel state, exactly as `/messages` and `/catalogue/[id]` do. Below that the same
 * views arrive in a drawer: a pick opens it (`inspectInPanel`), and it leaves more of the grid in view
 * than the event modal it replaces.
 *
 * It opens on Month. A pick on the grid or in a list replaces the view with the entry
 * ({@link EventSummary}) or the routine ({@link RoutineSummary}), headed by a Back that returns to the
 * tab the pick covered and lets the entry go ({@link leaveInspector}). On a team's or business's
 * calendar the console's rail holds the lane, so the agenda list the `/calendar` lane carries moves in
 * here as an Events tab beside Month ({@link PanelAgenda}), and an answer given in the inspector is
 * addressed to the entry's own project ({@link answerTargetFor}).
 *
 * Browsing months here does not move the grid; picking a day does, through {@link calendarFocus},
 * and a pick, a step or a scroll that lands in another month brings the navigator with it.
 */
export default function CalendarPanel(props: CalendarPanelProps): JSX.Element {
	const surface = props.surface ?? "personal";
	const entity = surface === "entity";
	const inflow = useMediaQuery(CONTEXT_PANEL_INFLOW_QUERY);
	const { now, mounted } = useNowTick();
	const todayMs = useComputed(() =>
		mounted.value
			? calendarTime.startOfDay(
				now.value,
				calendarPage.value?.timezone ?? props.initial?.timezone ?? "UTC",
			)
			: null
	);
	const monthMs = useSignal<number>(calendarFocus.peek() || props.initial?.now || Date.now());
	/** Off until the mount below has moved a linked entry, and the address's narrowing, into state. */
	const settled = useSignal(false);

	useEffect(() => {
		if (calendarFocus.value) monthMs.value = calendarFocus.value;
	}, [calendarFocus.value]);

	const page = calendarPage.value ?? props.initial;
	const tz = page?.timezone ?? "UTC";
	const all = [...(page?.events ?? []), ...importedEvents.value];
	const linked = props.linkedEventId ? all.find((e) => e.id === props.linkedEventId) ?? null : null;
	const routines = routinesOn(page);
	const linkedRoutine = linked || !props.linkedRoutineSlug
		? null
		: routines.find((r) => r.slug === props.linkedRoutineSlug) ?? null;

	useEffect(() => {
		if (linked && !selectedEventId.peek()) {
			selectedEventId.value = linked.id;
			panelTab.value = "event";
		} else if (linkedRoutine && !selectedRoutineId.peek()) {
			selectedRoutineId.value = linkedRoutine.id;
			panelTab.value = "event";
		}
		if (props.invitations) invitationsOnly.value = true;
		settled.value = true;
	}, []);

	const id = settled.value ? selectedEventId.value : linked?.id ?? null;
	const routineId = settled.value ? selectedRoutineId.value : linkedRoutine?.id ?? null;
	const showing = settled.value || !(linked || linkedRoutine) ? panelTab.value : "event";
	const picked = id ? all.find((e) => e.id === id) ?? null : null;
	const routine = routineId ? routines.find((r) => r.id === routineId) ?? null : null;
	const inspecting = showing === "event" && (picked !== null || routine !== null);
	const tab: PanelTab = !entity ? "month" : showing === "event" ? panelReturn.value : showing;
	const tabLabel = ENTITY_TABS.find((t) => t.value === tab)?.label ?? "Month";
	const invitesOn = settled.value ? invitationsOnly.value : props.invitations === true;
	const name = entity ? "Events and month" : "Event and month";

	/**
	 * Back leaves the inspector for the tab it covered. The control it was pressed on is gone after the
	 * render, so focus moves to the view that replaces it, one task later so that view exists.
	 */
	function back(): void {
		leaveInspector();
		setTimeout(() => {
			const view = [...document.querySelectorAll<HTMLElement>(".cal-panel__view")]
				.find((el) => el.getClientRects().length > 0);
			const active = document.activeElement;
			if (view && (!active || active === document.body)) view.focus();
		}, 0);
	}

	const month = () => (
		<div class="cal-panel__mini">
			<MiniMonth
				monthMs={monthMs.value}
				focusMs={focusedAt(page)}
				tz={tz}
				view={calendarView.value}
				todayMs={todayMs.value}
				onPick={(day) => (calendarFocus.value = day)}
				onMonthStep={(d) => (monthMs.value = calendarTime.addZonedMonths(monthMs.value, d, tz))}
			/>
		</div>
	);

	const inspector = () => (
		<div class="cal-panel__inspect">
			<div class="cal-panel__back">
				<Button
					size="sm"
					variant="text"
					severity="secondary"
					icon={<Icon name="chevron-left" size="sm" />}
					label="Back"
					aria-label={`Back to ${tabLabel}`}
					onClick={back}
				/>
			</div>
			{picked
				? (
					<EventSummary
						key={picked.id}
						event={picked}
						tz={tz}
						answerTarget={answerTargetFor(surface, picked)}
					/>
				)
				: routine
				? <RoutineSummary key={routine.id} routine={routine} tz={tz} />
				: null}
		</div>
	);

	const views = (viewId: string) =>
		inspecting ? inspector() : (
			<>
				{entity
					? (
						<LaneTabs<PanelTab>
							label="Panel view"
							value={tab}
							options={ENTITY_TABS}
							panelId={viewId}
							onSelect={(v) => (panelTab.value = v)}
							class="cal-panel__tabs"
						/>
					)
					: null}
				<div
					id={viewId}
					class="cal-panel__view"
					role={entity ? "tabpanel" : undefined}
					aria-labelledby={entity ? `${viewId}-tab-${tab}` : undefined}
					tabIndex={-1}
				>
					{tab === "events"
						? <PanelAgenda page={page} invitationsOn={invitesOn} path={props.path ?? "/calendar"} />
						: month()}
				</div>
			</>
		);

	return (
		<>
			<aside
				id={CALENDAR_PANEL_ID}
				class="cal-panel"
				data-view={inspecting ? "event" : tab}
				aria-label={name}
			>
				{views("cal-panel-view")}
				{
					/*
					 * A pick does not move focus, which stays on the row or the grid the reader is working
					 * through, so the inspector says what it now holds instead.
					 */
				}
				<p class="ui-visually-hidden" role="status">
					{!inspecting
						? ""
						: picked
						? `Showing ${picked.masked ? maskLabel(picked.status) : picked.title}`
						: routine
						? `Showing ${routine.name}`
						: ""}
				</p>
			</aside>
			{!inflow && (
				<Drawer
					visible={contextDrawerOpen}
					position="right"
					header={name}
					size="min(22rem, 100vw)"
					class="cal-panel-drawer"
				>
					<div class="cal-panel cal-panel--drawer" data-view={inspecting ? "event" : tab}>
						{views("cal-drawer-view")}
					</div>
				</Drawer>
			)}
		</>
	);
}
