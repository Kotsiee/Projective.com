import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/calendar-page.css";
import "@features/view/styles/service-booking.css";
import "@features/profile/styles/profile-hire.css";
import { Calendar } from "@projective/ui/calendar";
import type { CalendarRange } from "@projective/ui/calendar";
import { Message } from "@projective/ui/feedback";
import type { CalendarEvent, CalendarEventKind, SchedulePage } from "@projective/types/scheduling";
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
import { useCalendarComposer } from "../hooks/useCalendarComposer.ts";
import ConsultationModal from "@features/profile/components/hire/ConsultationModal.tsx";

/** What a schedule surface can create. */
const CREATE_KINDS: { value: CalendarEventKind; label: string }[] = [
	{ value: "session", label: "Session" },
	{ value: "booking", label: "Booking" },
	{ value: "sync", label: "Meeting" },
];

/**
 * ScheduleView — the body island for the schedule surfaces: `/[handle]/availability`,
 * `/view/[entity]/schedule` and its profile-namespace mirror.
 *
 * Hydrates from the SSR `initial` {@link SchedulePage} (weekly working hours + timezone + blackouts +
 * privacy-masked bookable/busy blocks + public group sessions), renders the `@projective/ui/calendar`
 * engine with the availability overlay, and opens the {@link EventModal} from the grid.
 *
 * These are the platform's guest-reachable calendars, so the modal a stranger opens is genuinely
 * thinner than the one a party opens: the service withholds the roster, the room, the money and the
 * negotiation from anyone who is not on the event, and {@link eventTabs} then has nothing to build
 * those tabs from. That is the privacy contract working, not a missing feature.
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

	/**
	 * Pull the page fresh.
	 *
	 * A failure is SURFACED rather than dropped: a stale page left on screen with no word of the failure
	 * reads as the current one.
	 */
	async function load(): Promise<void> {
		const res = props.scope === "availability" && props.handle
			? await ScheduleService.availability(props.handle)
			: props.entityId
			? await ScheduleService.schedule(props.entityId)
			: null;
		if (res && res.ok && res.data) {
			loadError.value = null;
			page.value = res.data.page;
			events.value = res.data.page.events;
		} else {
			loadError.value = res?.message ?? "This schedule couldn’t be refreshed.";
		}
	}

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
				view="week"
				// The server's instant, not the client's clock: the SSR paint and the hydrated grid open
				// on the same week, and "Passed" means what the server meant by it.
				focus={p.now}
				title={p.subtitle ?? p.title}
				canCreate={p.viewerCanBook}
				renderSource={renderCalendarSource}
				storageKey="pj.calendar.schedule"
				compose={composer.compose}
				/*
				 * A drag leaves a DRAFT block and the lightweight composer beside it; the full surface is
				 * one deliberate press away. There is deliberately no `onQuickCreate` HERE, unlike the
				 * personal and project calendars: on a schedule the thing being created is a SESSION
				 * somebody is booking, and "Enter creates it with defaults" would skip every question a
				 * booking has to answer. The composer offers the expand control and nothing else.
				 */
				onSelectRange={() => {}}
				onExpandCreate={(range: CalendarRange, title: string) => {
					if (p.viewerCanBook) composer.expandCreate(range, title);
				}}
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
						createKinds={CREATE_KINDS}
						canBook={p.viewerCanBook && !!p.callOffer && !!props.handle}
						onClose={composer.close}
						onMinimise={composer.minimise}
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
