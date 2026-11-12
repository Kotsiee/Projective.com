import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
/*
 * The event surface carries its OWN stylesheet.
 *
 * Shared CSS reaches a page only through an ISLAND's module graph (root CLAUDE.md §8 Decision #39),
 * and this modal is opened from two different islands across five routes. Importing the sheet here
 * makes the component self-contained, so any island that mounts an event gets the event's appearance
 * with it and no call site has to know the list. Vite dedupes, so a second import costs nothing.
 */
import "../styles/event-modal.css";
import { Backdrop, BodyPortal, useFrameScroll, useFrameState } from "@projective/ui/overlay";
import { useDismiss, useFocusTrap, useOverlayStack } from "@projective/ui/hooks";
import { Splitter, SplitterPanel } from "@projective/ui/layout";
import { MoneyView } from "@projective/ui/display/money";
import { MetaLine } from "@projective/ui/display";
import { Button, InputText, SelectButton } from "@projective/ui/fields";
import { ConfirmPopup, Message, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { styleVars } from "@ui/core/style.ts";
import { calendarTime } from "@projective/ui/calendar";
import type {
	CalendarEvent,
	CalendarEventKind,
	EntryReminder,
	RescheduleAction,
	RsvpResponse,
	SchedulingTarget,
} from "@projective/types/scheduling";
import { type CallActionInput, eventLiveStatus } from "@projective/types/scheduling";
import { readDevSeam } from "@web/utils/dev-seam.ts";
import { callViewOf } from "../core/call-view.ts";
import { ScheduleService } from "../core/ScheduleService.ts";
import type { EventAccess } from "../core/event-access.ts";
import { checkJoinLink } from "../core/meeting-link.ts";
import { pastNotice } from "../core/event-recurrence.ts";
import {
	canAnswer,
	composesAsMoment,
	durationLabel,
	entryEditable,
	eventFingerprint,
	type EventMode,
	eventMoney,
	eventStack,
	type EventTab,
	eventTabs,
	isEventPartyView,
	panelFor,
	rescheduleView,
	RSVP_ACTIONS,
	timesLabel,
	viewerSeat,
} from "../core/event-view.ts";
import { EventLiveBadge, EventMetaBar } from "./EventMetaBar.tsx";
import { EventAttendeePanel } from "./EventAttendeePanel.tsx";
import { EventClashWarning } from "./EventClashNote.tsx";
import { CallActionBar, CallProposePanel } from "./CallActionBar.tsx";
import { EventDetailsTab } from "./tabs/EventDetailsTab.tsx";
import { EventRescheduleTab } from "./tabs/EventRescheduleTab.tsx";
import { EventAttachmentsTab } from "./tabs/EventAttachmentsTab.tsx";
import { EventFinanceTab } from "./tabs/EventFinanceTab.tsx";
import { EventHistoryTab } from "./tabs/EventHistoryTab.tsx";
import { UserAvatarStack } from "@web/components/UserAvatar.tsx";

/**
 * EventModal — the ONE calendar-event surface. Creating an entry, reading one, and negotiating a new
 * time for one are the same modal.
 *
 * It replaces the 26rem `EventDialog`, which was two `<dl>` branches selected by whether an event was
 * passed in: a create form with a raw `<select>`, and a five-row fact list. That shape had nowhere to
 * put the things an occurrence actually needs — an agenda, a room, a participant list with answers, a
 * ballot, a ledger, an audit log — so it grew none of them.
 *
 * **Editing is composing.** On `/calendar` reading an entry belongs to the inspector, so what opens here
 * for its host is the composer again: the same title field, the same Event · Reminder switch, the same
 * two columns and the same occurrence line in the footer, with the entry's other tabs beside Details.
 *
 * Three region rules govern the layout, mirroring the ticket modal it is a sibling of:
 *
 *  - **The left area answers, the right area orients.** Tabs hold content; the side panel holds who
 *    is coming, on exactly the two tabs where that is the second question a reader has. A column that
 *    is usually empty teaches the reader to ignore that side.
 *  - **Separation is spacing, tone and a single hairline** — never a box inside a box (§B.4). The
 *    only full borders belong to controls.
 *  - **A capability the seat lacks is ABSENT.** The Finances tab does not exist for a buyer, the
 *    agenda editor does not exist for an attendee, the drop zone does not exist for a guest. A
 *    disabled control advertises a capability and then refuses it. The one deliberate exception is a
 *    reschedule action refused by the STATE rather than the seat: those stay visible and carry the
 *    reason, because "too close to the start" is something the reader can act on and a missing button
 *    is not.
 *
 * Edits to the agenda and the room are STAGED — a working copy diverges from the event the modal
 * opened on, the footer grows a Save the moment it does, and nothing reaches the calendar until it is
 * pressed. RSVP and reschedule are NOT staged: they are writes to a shared negotiation, they go
 * straight to the fat service, and the refreshed event comes back.
 *
 * Mounted through {@link BodyPortal} so its `position: fixed` resolves against the viewport rather
 * than the glass-blurred shell that opened it. Its live UI state — working copy, tab, panel, per-tab
 * scroll — is held in the {@link eventStack} frame's cache.
 */
export interface EventModalProps {
	/** The frame's identity in the modal stack — the key its cached state hangs off. */
	uid: number;
	/** Whether this occurrence exists yet. */
	mode: EventMode;
	/** The tab to open on, when the press that opened the modal was asking for one. */
	initialTab?: EventTab;
	event: CalendarEvent;
	/** IANA display zone — every instant on this surface renders in the schedule's own zone. */
	tz: string;
	hour12: boolean;
	/**
	 * The instant this surface reasons from — the ORIGIN of the modal's own clock, which advances from
	 * it at wall rate (see {@link useEventClock}). Every gate on this modal and the header badge read
	 * that one clock, so they cannot contradict each other.
	 *
	 * Every host currently passes its page's reference instant, which is the fixtures' fixed clock;
	 * pass `Date.now()` once the reads are live and the surface simply becomes the real clock.
	 */
	nowMs: number;
	access: EventAccess;
	/**
	 * Which surface this event lives on. A calendar event id is unique only WITHIN the page that
	 * derived it, so every write carries its scope and the server re-resolves the event through the
	 * very same reader — never trusting a bare id.
	 */
	target: Omit<SchedulingTarget, "eventId">;
	/**
	 * The entry kinds this surface offers while composing. `instant` marks a kind that is a moment:
	 * choosing it collapses the range to its start, and leaving it restores the length.
	 */
	createKinds: { value: CalendarEventKind; label: string; instant?: boolean }[];
	/** Whether a bookable slot can be booked from here. */
	canBook: boolean;
	/**
	 * Whether this surface keeps an edit to an existing entry (`authoringFor`; default yes). A body with
	 * no write door — an engagement's calendar, a public schedule — opens every entry read-only, even
	 * one its reader hosts (Decision #343, ruling C7 (a)).
	 */
	editable?: boolean;
	onClose: () => void;
	/**
	 * Fold this surface back into the calendar's lightweight composer, carrying what has been entered.
	 *
	 * Absent -> no control is drawn at all, rather than a disabled one: a capability the host cannot
	 * honour is absent, never offered and then refused. Only meaningful while CREATING — an existing
	 * event has no composer to fold back into — so the header gates it on that as well.
	 *
	 * It hands back the staged draft rather than the prop, because the reader has been typing into the
	 * staged copy and the whole point of the round trip is that nothing they wrote is lost.
	 */
	onMinimise?: (event: CalendarEvent) => void;
	/** Commit the working copy — creates the entry, or saves the staged edits. */
	onSubmit: (event: CalendarEvent) => void;
	/** Take a bookable slot. */
	onBook: (event: CalendarEvent) => void;
	/** A server write returned a refreshed event — replace it on the grid. */
	onServerUpdate: (event: CalendarEvent) => void;
	/** A server write took this event off the calendar (a declined or cancelled call). */
	onServerRemove?: (id: string) => void;
	/**
	 * Take the entry off the calendar. Offered to its host only, past or not — an entry the reader
	 * created stays theirs to remove after it has happened. Absent -> no Delete is drawn.
	 */
	onDelete?: (event: CalendarEvent) => void;
	/**
	 * Save the viewer's own alerts for an entry that exists. Not staged: like an RSVP they are the
	 * person's rather than the entry's, in any seat. Absent -> this surface offers no reminders.
	 */
	onReminders?: (event: CalendarEvent, reminders: EntryReminder[] | null) => void;
}

const tabId = (t: EventTab) => `evm-tab-${t}`;
const panelId = (t: EventTab) => `evm-panel-${t}`;

/**
 * How often the surface re-reads its clock.
 *
 * A timer, deliberately NOT an animation frame: `requestAnimationFrame` does not fire in a
 * backgrounded tab, so a badge driven by one would freeze on whatever it last said and go on
 * asserting "Upcoming in 3 hours" through the meeting. A timer is throttled in the background but it
 * still fires, and the coarsest thing that reads this clock speaks in whole minutes — so half a
 * minute of granularity can never make it more than half a unit stale.
 */
const TICK_MS = 30_000;

/** The span a deadline turned back into a timed entry runs for when it was opened as an instant. */
const FALLBACK_SPAN_MS = 30 * 60_000;

/**
 * The ONE clock this surface reasons with.
 *
 * Everything time-dependent on this modal — the header badge, whether the thing is still bookable,
 * whether an RSVP can still be given, and the whole reschedule projection — reads this and nothing
 * else. It was two: the badge snapped to `Date.now()` on mount while every gate read the reference
 * instant its host passed in, and because that instant is the fixtures' fixed clock (a month behind
 * the wall clock), the header said "Passed" directly above live RSVP buttons and a Book action.
 *
 * The reference instant WINS, and the clock advances from it at wall rate. That direction is not
 * arbitrary: the fixtures are pinned to an instant on purpose — that pinning is what makes them
 * deterministic — so every event on the page is positioned in that frame, and moving the gates to the
 * wall clock would declare the entire seeded corpus finished rather than fixing anything. Advancing
 * from the origin keeps the one property the badge exists for (it stays true as time passes) without
 * putting it in a different frame from the surface it sits on. When the reads go live the origin IS
 * the wall clock and this is the wall clock exactly.
 */
function useEventClock(referenceMs: number): number {
	const now = useSignal(referenceMs);

	useEffect(() => {
		now.value = referenceMs;
		const origin = Date.now();
		const id = setInterval(() => {
			now.value = referenceMs + (Date.now() - origin);
		}, TICK_MS);
		return () => clearInterval(id);
	}, [referenceMs]);

	return now.value;
}

export function EventModal(props: EventModalProps): JSX.Element {
	const { uid, mode, tz, hour12, access, onClose, onMinimise } = props;
	const creating = mode === "create";

	// `layer: "modal"` is not cosmetic — the default `"popover"` band (1100) would put this below any
	// sibling that correctly declares itself a modal (1300).
	const stack = useOverlayStack({ active: true, lockScroll: true, layer: "modal" });
	const panelRef = useRef<HTMLDivElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	useFocusTrap({ active: true, containerRef: panelRef });
	// An entry being composed has unsaved work in it by definition, so a stray backdrop click cannot
	// dismiss it. Escape and Cancel still do. The backdrop is the only outside-click channel: it sits
	// beneath anything stacked above, so a click there can only ever belong to this modal.
	useDismiss({
		open: true,
		enabled: stack.isTop,
		onDismiss: onClose,
		panelRef,
		closeOnOutside: false,
	});

	/*
	 * Everything below survives the frame being replaced and restored, which is why none of it is a
	 * plain `useSignal`. The WORKING COPY is cached with the rest: a half-written agenda must still be
	 * there when the reader comes back.
	 */
	const draft = useFrameState<CalendarEvent>(eventStack, uid, "draft", props.event);
	const baseline = useFrameState<string>(
		eventStack,
		uid,
		"baseline",
		eventFingerprint(props.event),
	);
	const tab = useFrameState<EventTab>(eventStack, uid, "tab", props.initialTab ?? "details");
	const showPanel = useFrameState<boolean>(eventStack, uid, "panel", true);
	/*
	 * Bumped by Discard, and by nothing else.
	 *
	 * The Details fields are UNCONTROLLED — `useControllable` seeds an internal signal once and the
	 * draft is updated through `onValueChange` — which is right while typing and wrong the moment the
	 * reader throws the edit away: restoring the draft moves a value the fields are no longer reading,
	 * so a discarded join link would sit there on screen looking saved. Keying the tab on this counter
	 * re-mounts the form and re-seeds every field from the restored copy. It is NOT bumped on Save,
	 * where the values are already identical and a remount would only cost the reader their caret.
	 */
	const formRev = useFrameState<number>(eventStack, uid, "rev", 0);

	const event = draft.value;
	const tabs = eventTabs(event, mode, access);
	// A tab can disappear beneath the reader — a write that closes a negotiation removes the
	// Reschedule tab — so an orphaned selection falls back to the one tab that always exists.
	// Resolved before the scroll key and the panel, because both follow the tab actually RENDERED
	// rather than the one that happened to be selected last.
	const activeTab = tabs.some((t) => t.key === tab.value) ? tab.value : "details";

	// Keyed PER TAB, not per modal: the tabs share one scroll container, so a single key would let a
	// glance at the ledger overwrite where the reader had got to in a long history.
	useFrameScroll(eventStack, uid, `scroll:${activeTab}`, bodyRef);

	/** In flight, so a control cannot be pressed twice and a refusal cannot race a success. */
	const busy = useSignal(false);
	/** The server's own words for a refused write — never a second wording of the same rule. */
	const refusal = useSignal<string | null>(null);

	/** The one clock. Read here, so a tick re-evaluates every gate below it and the badge together. */
	const nowMs = useEventClock(props.nowMs);

	const dirty = eventFingerprint(event) !== baseline.value;
	const canEdit = creating || (props.editable !== false && entryEditable(event));
	const seat = viewerSeat(event);
	const party = isEventPartyView(event);
	const live = eventLiveStatus(nowMs, event.start, event.end);
	const money = eventMoney(event, access);
	const view = rescheduleView(event, nowMs);
	/** A new entry may start in the past; the footer says so rather than holding Create back. */
	const pastWarning = creating ? pastNotice(event, tz, nowMs) : null;
	/** A Reminder or a deadline has no end to move, decided by its kind rather than its span. */
	const moment = composesAsMoment(event, props.event, props.createKinds);
	/** An Event that no longer ends after it starts; the End field says why beside itself. */
	const backwards = canEdit && !moment && !event.allDay && event.end <= event.start;
	// The field states why beside itself; here it only holds Create and Save back.
	const linkCheck = canEdit && event.meeting?.joinUrl ? checkJoinLink(event.meeting.joinUrl) : null;
	const linkRefused = !!linkCheck && !linkCheck.ok;
	const unsaveable = !event.title.trim() || linkRefused || backwards;

	/** Where a discovery call stands for this viewer, and what they may do about it. */
	const callView = callViewOf(event, readDevSeam()?.discoveryCall ?? "auto", nowMs);
	const proposingTime = useSignal(false);

	const panelKind = panelFor(activeTab);
	const sidePanel = panelKind === "attendees" && showPanel.value && party && event.roster
		? "attendees"
		: null;

	// The title is the required field on a new entry, so the caret is already in it. The focus trap
	// parks focus on the panel first, so this runs after it.
	useEffect(() => {
		if (!creating) return;
		panelRef.current?.querySelector<HTMLInputElement>(".evm__titlefield input")?.focus();
	}, [creating]);

	/** Apply a patch to the working copy. Nothing derives from these fields, so it is a plain merge. */
	function patch(next: Partial<CalendarEvent>): void {
		draft.value = { ...draft.value, ...next };
	}

	/**
	 * Change what an entry is. A Reminder or a deadline is a moment (`end === start`), so choosing one
	 * collapses the range and takes its room with it, here where the reader can see that, rather than
	 * silently on Save (`roomOf`). Leaving it restores the length and the room it was opened with.
	 */
	function setKind(kind: CalendarEventKind): void {
		const { start, end } = draft.value;
		const span = props.event.end - props.event.start || FALLBACK_SPAN_MS;
		patch(
			props.createKinds.find((k) => k.value === kind)?.instant
				? { kind, end: start, meeting: undefined }
				: end === start
				? { kind, end: start + span, meeting: props.event.meeting }
				: { kind },
		);
	}

	function commit(): void {
		if (!canEdit || unsaveable) return;
		const committed: CalendarEvent = { ...draft.value, title: draft.value.title.trim() };
		draft.value = committed;
		baseline.value = eventFingerprint(committed);
		props.onSubmit(committed);
	}

	function discard(): void {
		draft.value = props.event;
		baseline.value = eventFingerprint(props.event);
		formRev.value++;
	}

	/**
	 * Fold a server response back into the working copy.
	 *
	 * The server owns the roster, the negotiation and the log; the staged fields (title, agenda, room,
	 * pack) are the reader's unsaved work and are kept, because losing a half-written agenda because
	 * somebody voted would be a worse outcome than a moment's divergence.
	 *
	 * WHEN it runs is staged too (the meta bar's pickers) and is deliberately NOT on that list. A
	 * response that carries a time carries a SETTLED one — a confirmed reschedule the whole party
	 * agreed to — and a local, unsaved drag must not paint over it. So the reader's staged time is the
	 * one edit the server can overrule, and the footer still shows Save for whatever else they had in
	 * flight.
	 */
	function applyServer(next: CalendarEvent): void {
		// Re-measured HERE rather than read from the render closure: a write is a round trip, and a
		// keystroke that landed while it was in flight would otherwise be judged against a fingerprint
		// taken before it — and then discarded.
		const stale = eventFingerprint(draft.value) !== baseline.value;
		draft.value = stale
			? {
				...next,
				title: draft.value.title,
				description: draft.value.description,
				meeting: draft.value.meeting,
				attachments: draft.value.attachments,
			}
			: next;
		if (!stale) baseline.value = eventFingerprint(next);
		props.onServerUpdate(next);
	}

	async function respond(response: RsvpResponse): Promise<void> {
		if (busy.value) return;
		busy.value = true;
		refusal.value = null;
		const res = await ScheduleService.respond({ ...props.target, eventId: event.id, response });
		busy.value = false;
		if (res.ok && res.data) applyServer(res.data.event);
		else refusal.value = res.message ?? "That response could not be recorded.";
	}

	/** One move on a discovery call. The door judges it; a refusal comes back in its own words. */
	async function moveCall(move: DistributiveOmit<CallActionInput, "callId">): Promise<void> {
		if (busy.value || !event.callId) return;
		busy.value = true;
		refusal.value = null;
		const res = await ScheduleService.callAction({ ...move, callId: event.callId });
		busy.value = false;
		if (!res.ok || !res.data) {
			refusal.value = res.message ?? "That change could not be made.";
			return;
		}
		proposingTime.value = false;
		if (res.data.event) applyServer(res.data.event);
		else props.onServerRemove?.(event.id);
	}

	async function negotiate(
		action: RescheduleAction,
		payload: { start?: number; end?: number; proposalId?: string; note?: string } = {},
	): Promise<void> {
		if (busy.value) return;
		busy.value = true;
		refusal.value = null;
		const res = await ScheduleService.reschedule({
			...props.target,
			eventId: event.id,
			action,
			...payload,
		});
		busy.value = false;
		if (res.ok && res.data) applyServer(res.data.event);
		else refusal.value = res.message ?? "That change could not be made.";
	}

	/** Roving-tabindex arrow navigation across the strip (WAI-ARIA tabs pattern). */
	function onTabKey(e: JSX.TargetedKeyboardEvent<HTMLButtonElement>, index: number): void {
		const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
		if (delta === 0) return;
		e.preventDefault();
		const next = tabs[(index + delta + tabs.length) % tabs.length];
		tab.value = next.key;
		// `closest`, not `parentElement`: each tab sits inside its Tooltip's anchor span.
		(e.currentTarget.closest('[role="tablist"]')?.querySelector(`#${tabId(next.key)}`) as
			| HTMLElement
			| null)
			?.focus();
	}

	// An open slot, not cancelled or passed. A session's seat is bought from its listing, which this
	// modal has no door to.
	const bookable = props.canBook && !creating && event.kind === "availability" &&
		event.status !== "cancelled" && live.state !== "passed";

	const canRsvp = canAnswer(event, nowMs);

	return (
		<BodyPortal>
			<div
				class="evm"
				data-state="open"
				style={styleVars({ "--evm-z": String(stack.zIndex) })}
			>
				<Backdrop visible onClick={creating ? undefined : onClose} />
				<div
					ref={panelRef}
					class="evm__panel"
					data-state="open"
					data-mode={mode}
					role="dialog"
					aria-modal="true"
					aria-label={creating ? "New calendar entry" : `Event: ${event.title}`}
					tabIndex={-1}
				>
					{/* #region Header — identity, who is coming, and the two controls */}
					<header class="evm__top">
						<div class="evm__ident">
							{canEdit
								? (
									<InputText
										// Uncontrolled, so a Discard has to re-seed it as it does the Details form.
										key={formRev.value}
										class="evm__titlefield"
										variant="bare"
										block
										value={event.title}
										maxLength={200}
										placeholder="Name this entry"
										aria-label="Entry title"
										onValueChange={(title: string) => patch({ title })}
									/>
								)
								: <h2 class="evm__title">{event.title || "Untitled event"}</h2>}
						</div>

						{canEdit && props.createKinds.some((k) => k.value === event.kind) &&
								props.createKinds.length > 1
							? (
								<SelectButton
									key={formRev.value}
									class="evm__kind"
									size="sm"
									value={event.kind}
									options={props.createKinds}
									aria-label="Entry type"
									onValueChange={(v) => setKind(v as CalendarEventKind)}
								/>
							)
							: null}

						<div class="evm__who">
							{event.roster && event.roster.length > 0
								? (
									<Tooltip
										content={`${event.roster.length} attending: ${
											event.roster.map((a) => a.name).join(", ")
										}`}
									>
										<span class="evm__stack" tabIndex={0}>
											<UserAvatarStack
												people={event.roster}
												max={4}
												size={24}
												ringColor="var(--surface)"
												aria-label={`${event.roster.length} attendees: ${
													event.roster.map((a) => a.name).join(", ")
												}`}
											/>
										</span>
									</Tooltip>
								)
								: null}
						</div>

						<div class="evm__acts">
							{panelKind === "attendees" && party && event.roster
								? (
									<Tooltip
										content={showPanel.value ? "Hide attendees" : "Show attendees"}
										density="compact"
									>
										<button
											type="button"
											class="evm__act"
											aria-label={showPanel.value ? "Hide attendees" : "Show attendees"}
											aria-pressed={showPanel.value ? "true" : "false"}
											onClick={() => (showPanel.value = !showPanel.value)}
										>
											<Icon name="panel-right" size="sm" />
										</button>
									</Tooltip>
								)
								: null}
							{creating && onMinimise
								? (
									<Tooltip content="Minimise to the quick composer" density="compact">
										<button
											type="button"
											class="evm__act"
											aria-label="Minimise to the quick composer"
											onClick={() => onMinimise(event)}
										>
											<Icon name="collapse" size="sm" />
										</button>
									</Tooltip>
								)
								: null}
							<Tooltip content="Close" density="compact">
								<button
									type="button"
									class="evm__act evm__act--close"
									aria-label="Close"
									onClick={onClose}
								>
									<Icon name="close" size="sm" />
								</button>
							</Tooltip>
						</div>
					</header>
					{/* #endregion */}

					{/* #region Meta bar + tab strip — a host's times are the Details tab's, as when composing */}
					{creating || (canEdit && tabs.length < 2) ? null : (
						<div class="evm__bar">
							{canEdit ? null : (
								<EventMetaBar
									event={event}
									tz={tz}
									hour12={hour12}
									nowMs={nowMs}
									canEdit={false}
									onPatch={patch}
								/>
							)}

							{tabs.length > 1
								? (
									<div class="evm-tabs" role="tablist" aria-label="Event views">
										{tabs.map((t, i) => (
											// A labelled tab's name shows only while its label is collapsed to the
											// visually-hidden box (below 640px); the glyph-only History tab always.
											<Tooltip key={t.key} content={t.label} whenTruncated={!t.iconOnly}>
												<button
													type="button"
													id={tabId(t.key)}
													role="tab"
													class="evm-tabs__tab"
													data-icononly={t.iconOnly ? "true" : undefined}
													aria-selected={activeTab === t.key ? "true" : "false"}
													// Only the SELECTED tab points at a panel, because only one panel is ever
													// rendered — the body re-points as the selection moves. Setting it on every
													// tab left n−1 `aria-controls` referencing element ids that are not in the
													// document, which is a worse answer than the attribute being absent: the
													// tabs pattern only requires it on the tab whose panel exists.
													aria-controls={activeTab === t.key ? panelId(t.key) : undefined}
													// Always named, not only when icon-only: below 640px the labels collapse to
													// their glyphs so every tab fits without a hidden horizontal scroller, and a
													// tab that loses its visible text must not lose its name with it. The value
													// is identical to the visible label, so "label in name" (WCAG 2.5.3) holds
													// in both presentations.
													aria-label={t.label}
													tabIndex={activeTab === t.key ? 0 : -1}
													onKeyDown={(e) => onTabKey(e, i)}
													onClick={() => (tab.value = t.key)}
												>
													<Icon name={t.icon} size="xs" class="evm-tabs__mark" />
													{t.iconOnly ? null : <span class="evm-tabs__label">{t.label}</span>}
													{!t.iconOnly && t.count
														? <span class="evm-tabs__count">{t.count}</span>
														: null}
												</button>
											</Tooltip>
										))}
									</div>
								)
								: null}
						</div>
					)}
					{/* #endregion */}

					{/* #region Body — the splitter: tabs left, the roster right */}
					<div class="evm__regions">
						<Splitter layout="horizontal" stateKey="event-modal" class="evm__split">
							<SplitterPanel
								size={sidePanel ? 68 : 100}
								minSize={sidePanel ? 50 : 100}
								class="evm__main"
							>
								{
									/*
									 * A tabpanel only when there is a strip to be a panel OF. A one-tab modal — a
									 * new entry, or an event a stranger opened, where the privacy projection left
									 * nothing else to show — renders no strip, and pointing `aria-labelledby` at a
									 * tab that was never rendered would name the body after nothing.
									 */
								}
								<div
									ref={bodyRef}
									class="evm__body"
									id={tabs.length > 1 ? panelId(activeTab) : undefined}
									role={tabs.length > 1 ? "tabpanel" : undefined}
									aria-labelledby={tabs.length > 1 ? tabId(activeTab) : undefined}
									tabIndex={0}
								>
									{activeTab === "details"
										? (
											<EventDetailsTab
												key={`${event.id}:${formRev.value}`}
												event={event}
												mode={mode}
												tz={tz}
												hour12={hour12}
												canEdit={canEdit}
												moment={moment}
												when={canEdit
													? (
														<>
															<EventMetaBar
																event={event}
																tz={tz}
																hour12={hour12}
																nowMs={nowMs}
																canEdit={canEdit}
																moment={moment}
																timesOnly
																onPatch={patch}
															/>
															{props.target.scope === "personal"
																? (
																	<EventClashWarning
																		start={event.start}
																		end={event.end}
																		id={event.id}
																		tz={tz}
																	/>
																)
																: null}
														</>
													)
													: undefined}
												onPatch={patch}
												onReminders={props.onReminders
													? (next) => {
														patch({ reminders: next });
														props.onReminders?.(event, next);
													}
													: undefined}
											/>
										)
										: null}
									{activeTab === "reschedule"
										? (
											<EventRescheduleTab
												event={event}
												view={view}
												tz={tz}
												hour12={hour12}
												nowMs={nowMs}
												busy={busy.value}
												onPropose={(start, end, note) =>
													void negotiate("propose", { start, end, note })}
												onApprove={(proposalId) => void negotiate("approve", { proposalId })}
												onOpen={() => void negotiate("open")}
												onVote={(proposalId) => void negotiate("vote", { proposalId })}
												onConfirm={(proposalId) =>
													void negotiate("confirm", proposalId ? { proposalId } : {})}
												onWithdraw={() => void negotiate("withdraw")}
											/>
										)
										: null}
									{activeTab === "attachments"
										? (
											<EventAttachmentsTab
												event={event}
												canUpload={canEdit}
												onPatch={patch}
											/>
										)
										: null}
									{activeTab === "finances" ? <EventFinanceTab event={event} /> : null}
									{activeTab === "history"
										? (
											<EventHistoryTab
												event={event}
												onFollow={(entry) => {
													// A log line points at a proposal or an attendee, so following it is a
													// jump to the tab that holds the thing — the row itself never navigates.
													if (view.proposals.some((p) => p.id === entry.targetId)) {
														tab.value = "reschedule";
													} else showPanel.value = true;
												}}
											/>
										)
										: null}
								</div>
							</SplitterPanel>

							{sidePanel && event.roster
								? (
									<SplitterPanel size={32} minSize={22} maxSize={44} class="evm__side">
										<EventAttendeePanel
											roster={event.roster}
											note={activeTab === "reschedule" && view.mode === "vote"
												? `${view.voters} can vote`
												: null}
										/>
									</SplitterPanel>
								)
								: null}
						</Splitter>
					</div>
					{/* #endregion */}

					{/* #region Footer — how long, what it is worth, and what to do about it */}
					{proposingTime.value && callView
						? (
							<CallProposePanel
								event={event}
								tz={tz}
								hour12={hour12}
								nowMs={nowMs}
								busy={busy.value}
								onSend={(start, end) => void moveCall({ action: "propose", start, end })}
								onClose={() => (proposingTime.value = false)}
							/>
						)
						: null}

					<footer class="evm__foot">
						{canEdit
							? (
								<div class="evm__occurrence-row">
									<EventLiveBadge
										startMs={event.start}
										endMs={event.end}
										whenLabel={`${calendarTime.fmtFullDate(event.start, tz)} · ${
											timesLabel(event, tz, hour12)
										}`}
										nowMs={nowMs}
									/>
									<MetaLine
										class="evm__occurrence"
										items={[
											calendarTime.fmtFullDate(event.start, tz),
											{ text: timesLabel(event, tz, hour12), tabular: true },
											{
												text: event.allDay ? "" : durationLabel(event.start, event.end) ?? "",
												tabular: true,
											},
											{ text: tz, title: "Every time here is in the schedule's own zone" },
										]}
									/>
								</div>
							)
							: null}
						{!canEdit || money
							? (
								<div class="evm-money">
									{canEdit ? null : (
										<span class="evm-money__fig">
											<span class="evm-money__k">
												{event.allDay || durationLabel(event.start, event.end) ? "Runs for" : "Due"}
											</span>
											<span class="evm-money__v">
												{event.allDay ? "All day" : durationLabel(event.start, event.end) ??
													calendarTime.fmtTime(event.start, tz, hour12)}
											</span>
										</span>
									)}
									{money
										? (
											<span class="evm-money__fig" data-role="money">
												<span class="evm-money__k">{money.label}</span>
												<span class="evm-money__v">
													<MoneyView value={money.value} size="key" />
												</span>
												{money.note ? <span class="evm-money__note">{money.note}</span> : null}
											</span>
										)
										: null}
								</div>
							)
							: null}

						{refusal.value || pastWarning
							? (
								<Message severity="warning" class="evm__refusal">
									{refusal.value ?? pastWarning}
								</Message>
							)
							: callView?.note
							? <span class="evm__gate evm-callnote">{callView.note}</span>
							: <span class="evm__gate evm__gate--spacer" />}

						<div class="evm__footacts">
							{callView
								? (
									<CallActionBar
										view={callView}
										busy={busy.value}
										proposing={proposingTime.value}
										onMove={(move) => void moveCall(move)}
										onPropose={() => (proposingTime.value = !proposingTime.value)}
									/>
								)
								: null}

							{canRsvp
								? (
									<div
										class="evm-rsvp"
										role="group"
										aria-label="Your answer"
									>
										{RSVP_ACTIONS.map((a) => (
											<Button
												key={a.value}
												variant={seat?.response === a.value ? "filled" : "outlined"}
												severity={a.severity}
												size="sm"
												disabled={busy.value}
												aria-pressed={seat?.response === a.value ? "true" : "false"}
												onClick={() => void respond(a.value)}
											>
												{a.label}
											</Button>
										))}
									</div>
								)
								: null}

							{bookable
								? (
									<Button
										variant="filled"
										size="sm"
										onClick={() => props.onBook(event)}
									>
										Book this slot
									</Button>
								)
								: null}

							{creating
								? (
									<>
										<Button variant="text" size="sm" onClick={onClose}>Cancel</Button>
										<Button
											variant="filled"
											severity="primary"
											size="sm"
											disabled={unsaveable}
											onClick={commit}
										>
											Create
										</Button>
									</>
								)
								: dirty
								? (
									<>
										<Button variant="text" size="sm" onClick={discard}>Discard changes</Button>
										<Button variant="filled" size="sm" disabled={unsaveable} onClick={commit}>
											Save changes
										</Button>
									</>
								)
								: null}

							{!creating && canEdit && props.onDelete
								? (
									<ConfirmPopup
										label="Delete this event"
										message="Delete this event from your calendar?"
										acceptLabel="Delete"
										rejectLabel="Keep"
										acceptSeverity="danger"
										placement="top-end"
										onAccept={() => props.onDelete?.(event)}
										trigger={(api) => (
											<Button
												triggerRef={api.ref}
												variant="text"
												severity="danger"
												size="sm"
												aria-expanded={api.expanded ? "true" : "false"}
												aria-controls={api.panelId}
												onClick={api.toggle}
											>
												Delete
											</Button>
										)}
									/>
								)
								: null}
						</div>
					</footer>
					{/* #endregion */}
				</div>
			</div>
		</BodyPortal>
	);
}

/**
 * The three answers, in the order a person weighs them.
 *
 * `pending` is deliberately not offered as a fourth button: clearing an answer back to "no answer
 * yet" is a real move the service accepts, but as a CONTROL it reads as a fourth opinion rather than
 * the withdrawal of one, and there is nowhere on a three-way group for it to sit honestly.
 */
/** `Omit` that keeps a union a union, so each move keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
