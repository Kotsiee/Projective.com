import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/calendar-page.css";
import "@features/view/styles/service-booking.css";
import "@features/profile/styles/profile-hire.css";
import { Calendar, type CalendarViewMode } from "@projective/ui/calendar";
import { Message } from "@projective/ui/feedback";
import type { CalendarEvent, SchedulePage } from "@projective/types/scheduling";
import { EventModal } from "../components/EventModal.tsx";
import { renderCalendarSource } from "../components/provider-marks.tsx";
import { type EventMode, eventStack } from "../core/event-view.ts";
import {
	type EventAccess,
	readDevSeam,
	resolveEventAccess,
	subscribeDevSeam,
} from "../core/event-access.ts";
import { ScheduleService } from "../core/ScheduleService.ts";
import { type CalendarAddress, dateFocus } from "../core/calendar-address.ts";
import { authoringFor } from "../core/calendar-authoring.ts";
import { useCalendarComposer } from "../hooks/useCalendarComposer.ts";
import {
	useCalendarAddressWriter,
	useCalendarWindowReader,
	useOwnedTimelineScale,
} from "../hooks/useCalendarAddress.ts";
import ConsultationModal from "@features/profile/components/hire/ConsultationModal.tsx";

/** What a public schedule authors: nothing — it is someone else's (C7 (a), S-33). */
const AUTHORING = authoringFor("schedule");

/** The engine's own key for this calendar's densities, and the Timeline scale held here. */
const STORAGE_KEY = "pj.calendar.schedule";

/**
 * ScheduleView — the body island for `/[handle]/availability`.
 *
 * Hydrates from the SSR `initial` {@link SchedulePage} (weekly working hours + timezone + blackouts +
 * privacy-masked bookable/busy blocks + public group sessions), renders the `@projective/ui/calendar`
 * engine with the availability overlay, and opens the {@link EventModal} from the grid.
 *
 * These are the platform's guest-reachable calendars, so the modal a stranger opens is genuinely
 * thinner than the one a party opens: the service withholds the roster, the room, the money and the
 * negotiation from anyone who is not on the event, and {@link eventTabs} then has nothing to build
 * those tabs from. That is the privacy contract working, not a missing feature.
 *
 * It authors nothing ({@link AUTHORING}): the schedule is someone else's, and its owner edits their
 * hours at `/calendar?view=availability`. A slot is booked from an open availability block, whose
 * Book this slot opens the call request (`ConsultationModal`). The view is addressed as
 * `?view=&date=&zoom=` (Decision #413), and the grid reads the next window as the reader moves (S-29).
 */
export interface ScheduleViewProps {
	scope: "availability" | "schedule";
	initial: SchedulePage | null;
	/** For the fallback refetch when SSR produced nothing. */
	handle?: string;
	entityId?: string;
	/** Fill the whole page (the `/[handle]/availability` full-page surface) instead of an embedded block. */
	fullPage?: boolean;
	/** The provider's display name, for the call request a picked slot opens. */
	sellerName?: string;
	authed?: boolean;
	/** What the URL asked to be shown; the engine's defaults answer the rest. */
	address?: CalendarAddress;
}

export default function ScheduleView(props: ScheduleViewProps): JSX.Element {
	const page = useSignal<SchedulePage | null>(props.initial);
	// A schedule page is somebody else's: the viewer is on the buying side of it unless the dev seam
	// says otherwise, which is exactly what `viewerIsClient: true` means to the access resolver.
	const access = useSignal<EventAccess>(resolveEventAccess({ viewerIsClient: true }, null));
	/** A refetch that failed. Held so the stale page on screen is never passed off as the new one. */
	const loadError = useSignal<string | null>(null);
	const consultOpen = useSignal(false);
	const consultFrom = useSignal<number | null>(null);
	const composer = useCalendarComposer({
		initial: props.initial?.events ?? [],
		kind: "session",
		timezone: () => page.peek()?.timezone ?? "UTC",
	});
	const { events } = composer;

	const address = props.address ?? {};
	/** Where the engine opened: the addressed day, else the page's own clock. Never moved after. */
	const opening = useSignal<number>(
		address.date && props.initial
			? dateFocus(address.date, props.initial.timezone)
			: props.initial?.now ?? Date.now(),
	);
	/** What the engine reports it is showing, for the address and the next window read. */
	const view = useSignal<CalendarViewMode>(address.view ?? "week");
	const focus = useSignal<number>(opening.peek());
	const timelineScale = useOwnedTimelineScale(STORAGE_KEY, address.zoom);
	/** The day the window on screen was read around; `null` is the page's own `now`. */
	const readAround = useRef<string | null>(address.date ?? null);

	/**
	 * Read the page around `around`. A failure is SURFACED rather than dropped: a stale page left on
	 * screen with no word of the failure reads as the current one.
	 */
	async function read(around: string | null): Promise<SchedulePage | null> {
		const res = props.scope === "availability" && props.handle
			? await ScheduleService.availability(props.handle, around)
			: props.entityId
			? await ScheduleService.schedule(props.entityId)
			: null;
		if (res && res.ok && res.data) {
			loadError.value = null;
			readAround.current = around;
			return res.data.page;
		}
		loadError.value = res?.message ?? "This schedule couldn’t be refreshed.";
		return null;
	}

	function publish(next: SchedulePage): void {
		page.value = next;
		events.value = next.events;
	}

	/** Read the window on screen again. */
	async function load(): Promise<void> {
		const next = await read(readAround.current);
		if (next) publish(next);
	}

	useCalendarAddressWriter({
		surface: "schedule",
		state: () => ({ view: view.value, focus: focus.value, timelineScale: timelineScale.value }),
		tz: () => page.peek()?.timezone ?? null,
	});

	useCalendarWindowReader<SchedulePage>({
		window: () => page.value?.window,
		view: () => view.value,
		focus: () => focus.value,
		tz: () => page.value?.timezone ?? null,
		read,
		apply: publish,
	});

	useEffect(() => {
		const apply = () => {
			access.value = resolveEventAccess({ viewerIsClient: true }, readDevSeam());
		};
		apply();
		return subscribeDevSeam(apply);
	}, []);

	// A page the server could not paint (a failed read, not a missing schedule) gets one retry on mount.
	useEffect(() => {
		if (!props.initial) void load();
	}, []);

	useEffect(() => () => eventStack.close(), []);

	const surfaceMod = props.fullPage ? "cal-surface--full" : "cal-surface--schedule";
	const p = page.value;
	if (!p) {
		return (
			<div class={`cal-surface ${surfaceMod} cal-surface--empty`}>
				<p class="cal-surface__empty">
					{loadError.value ?? "This schedule couldn’t be loaded."}
				</p>
			</div>
		);
	}

	const open = eventStack.top.value;
	const framed = composer.resolve(open);

	return (
		<div class={`cal-surface ${surfaceMod}`}>
			{loadError.value
				? (
					<Message severity="warning" size="sm" class="cal-surface__notice">
						{loadError.value} What you are looking at is the last version that loaded.
					</Message>
				)
				: null}
			<Calendar
				events={events.value}
				availability={p.availability}
				timezone={p.timezone}
				view={address.view ?? "week"}
				// The addressed day, else the server's instant rather than the client's clock: the SSR
				// paint and the hydrated grid open on the same week, and "Passed" means what the server
				// meant by it.
				focus={opening.value}
				timelineZoom={timelineScale}
				loaded={p.window ? { start: p.window.from, end: p.window.to } : null}
				title={p.subtitle ?? p.title}
				canCreate={AUTHORING.has("create")}
				renderSource={renderCalendarSource}
				storageKey={STORAGE_KEY}
				onViewChange={(v) => (view.value = v)}
				onFocusChange={(ms) => (focus.value = ms)}
				onOpenEvent={(ev) => composer.openEvent(ev as CalendarEvent)}
			/>
			{open && framed
				? (
					<EventModal
						key={open.uid}
						uid={open.uid}
						mode={(open.input?.mode ?? "view") as EventMode}
						event={framed}
						tz={p.timezone}
						hour12
						nowMs={p.now}
						access={access.value}
						target={{
							scope: props.scope,
							handle: props.handle,
							entityId: props.entityId,
						}}
						createKinds={[]}
						canBook={p.viewerCanBook && !!p.callOffer && !!props.handle}
						editable={AUTHORING.has("edit")}
						onClose={composer.close}
						onSubmit={composer.submit}
						onBook={(ev) => {
							// A slot is booked by asking for it: the call request the profile's Book a call
							// opens, on the picked day, whose answer is the host's (or auto-confirm's).
							composer.close();
							consultFrom.value = ev.start;
							consultOpen.value = true;
						}}
						onServerUpdate={composer.serverUpdate}
					/>
				)
				: null}
			{p.callOffer && props.handle
				? (
					<ConsultationModal
						open={consultOpen}
						handle={props.handle}
						sellerName={props.sellerName ?? props.handle}
						offer={p.callOffer}
						authed={props.authed ?? false}
						from={consultFrom.value}
						// A request occupies the provider's time, so the grid re-reads its busy spans.
						onNotice={() => void load()}
					/>
				)
				: null}
		</div>
	);
}
