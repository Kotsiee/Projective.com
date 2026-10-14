import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import "@web/features/calendar/styles/event-modal.css";
import "../../styles/client-drawer.css";
import { Tag } from "@projective/ui/display";
import { Button } from "@projective/ui/fields";
import { dmConversationId } from "@projective/types/messaging";
import type { CalendarEvent, RescheduleAction } from "@projective/types/scheduling";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { PopoutChat } from "@web/features/messaging/components/PopoutChat.tsx";
import { conversationHref } from "@web/features/messaging/core/conversation-model.ts";
import type { PopoutState } from "@web/features/messaging/core/popout-state.ts";
import { EventRescheduleTab } from "@web/features/calendar/components/tabs/EventRescheduleTab.tsx";
import { rescheduleView } from "@web/features/calendar/core/event-view.ts";
import { ScheduleService } from "@web/features/calendar/core/ScheduleService.ts";
import type { ClientDetail, ClientEngagement } from "../../types/catalogue-types.ts";
import {
	ACTION_LABELS,
	type ClientReadScope,
	ENGAGEMENT_LABELS,
	HANDOFF_LABELS,
	LANE_LABELS,
	nextEventAt,
	statusLabel,
} from "../../core/client-model.ts";
import { type ClientSurface, pipelineRevision, readClient } from "../../core/client-store.ts";

/** Props for {@link ClientDrawerBody}. */
export interface ClientDrawerBodyProps {
	surface: ClientSurface;
	/** The buyer, `@handle`. */
	handle: string;
	scope: ClientReadScope;
	/** Distinguishes the docked and slide-over copies' ids. */
	idBase: string;
	/** The docked body's own Close; the slide-over closes from its header instead, so it passes none. */
	onClose?: () => void;
}

function zone(): { tz: string; hour12: boolean } {
	const opts = Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions();
	return { tz: opts.timeZone, hour12: opts.hour12 ?? false };
}

function when(at: string | number, hour12: boolean): string {
	return new Intl.DateTimeFormat(undefined, {
		weekday: "short",
		day: "numeric",
		month: "short",
		hour: "numeric",
		minute: "2-digit",
		hour12,
	}).format(new Date(at));
}

/**
 * ClientDrawerBody — one buyer, in the client drawer: who they are and the way to their profile,
 * every engagement with them in scope (its status, and a deep link for the heavy action), the
 * conversation with them — the same thread `/messages` opens, sent through the same door — and the
 * reschedule rounds waiting on either side with the calendar's own propose and accept controls.
 *
 * The thread is the pair's one conversation (a buyer's inquiry IS that thread); before either party
 * has written it is addressed as `dm-<handle>`, which the first send mints.
 */
export function ClientDrawerBody(props: ClientDrawerBodyProps): JSX.Element {
	const detail = useSignal<ClientDetail | null>(null);
	const error = useSignal<string | null>(null);
	const attempt = useSignal(0);
	const busy = useSignal(false);
	const refusal = useSignal<string | null>(null);
	const now = useSignal(Date.now());
	const key = `${props.handle}|${JSON.stringify(props.scope)}`;
	const readKey = useSignal(key);
	if (readKey.peek() !== key) readKey.value = key;
	const { tz, hour12 } = zone();

	useSignalEffect(() => {
		const cut = readKey.value.indexOf("|");
		const handle = readKey.value.slice(0, cut);
		const scope = readKey.value.slice(cut + 1);
		void attempt.value;
		let live = true;
		error.value = null;
		void readClient(handle, JSON.parse(scope) as ClientReadScope).then((res) => {
			if (!live) return;
			if (res.ok && res.data) detail.value = res.data;
			else error.value = res.message ?? "We couldn't load this client just now.";
		});
		return () => {
			live = false;
		};
	});

	async function negotiate(
		event: CalendarEvent,
		action: RescheduleAction,
		payload: { start?: number; end?: number; proposalId?: string; note?: string } = {},
	): Promise<void> {
		if (busy.value) return;
		busy.value = true;
		refusal.value = null;
		const res = await ScheduleService.reschedule({
			scope: "personal",
			eventId: event.id,
			action,
			...payload,
		});
		busy.value = false;
		now.value = Date.now();
		if (!res.ok || !res.data) {
			refusal.value = res.message ?? "That change could not be made.";
			return;
		}
		const next = res.data.event;
		const current = detail.peek();
		if (current) {
			detail.value = {
				...current,
				reschedules: current.reschedules.map((r) =>
					r.eventId === next.id
						? { ...r, start: next.start, event: next, reschedule: next.reschedule ?? r.reschedule }
						: r
				),
			};
		}
		pipelineRevision.value++;
	}

	const data = detail.value;
	const handle = props.handle;
	const id = (part: string) => `cat-cdrawer-${props.idBase}-${part}`;

	const head = (
		<header class="cat-cdrawer__head">
			<UserAvatar
				class="cat-cdrawer__avatar"
				image={data?.client.avatar || null}
				placeholder={data?.client.avatarPlaceholder ?? null}
				label={data?.client.name ?? handle.slice(1)}
				size="md"
			/>
			<div class="cat-cdrawer__id">
				<h2 class="cat-cdrawer__name" id={id("name")}>{data?.client.name ?? handle}</h2>
				<p class="cat-cdrawer__meta">
					<span class="cat-cdrawer__meta-part">{handle}</span>
					{data && <span class="cat-cdrawer__meta-part">{LANE_LABELS[data.lane]}</span>}
					{data && <span class="cat-cdrawer__meta-part cat-cdrawer__gross">{data.grossLabel}</span>}
				</p>
				<a class="cat-cdrawer__link" href={`/${handle}`}>View profile</a>
			</div>
			{props.onClose && (
				<Button
					class="cat-cdrawer__close"
					label="Close"
					size="sm"
					severity="neutral"
					variant="outlined"
					onClick={props.onClose}
				/>
			)}
		</header>
	);

	if (!data) {
		return (
			<div class="cat-cdrawer" aria-labelledby={id("name")}>
				{head}
				{error.value
					? (
						<div class="cat-cdrawer__state" role="alert">
							<p class="cat-cdrawer__text">{error.value}</p>
							<Button
								label="Try again"
								size="sm"
								severity="neutral"
								variant="outlined"
								onClick={() => attempt.value++}
							/>
						</div>
					)
					: <p class="cat-cdrawer__text" role="status">Loading client…</p>}
			</div>
		);
	}

	const conversationId = data.threadId ?? dmConversationId(handle);
	const chat: PopoutState = {
		scope: "conversation",
		projectId: conversationId,
		channelId: conversationId,
		conversationId,
		title: data.client.name,
		href: conversationHref(conversationId),
		source: "page",
		avatar: data.client.avatar || null,
	};
	const next = nextEventAt(data.engagements);

	return (
		<div class="cat-cdrawer" aria-labelledby={id("name")}>
			{head}

			<section class="cat-cdrawer__sec" aria-labelledby={id("eng")}>
				<h3 class="cat-cdrawer__sec-head" id={id("eng")}>Engagements</h3>
				<ul class="cat-cdrawer__list">
					{data.engagements.map((e) => (
						<EngagementRow key={e.id} engagement={e} consoleScope={props.surface === "console"} />
					))}
				</ul>
			</section>

			<section class="cat-cdrawer__sec" aria-labelledby={id("chat")}>
				<h3 class="cat-cdrawer__sec-head" id={id("chat")}>Conversation</h3>
				<div class="cat-cdrawer__thread">
					<PopoutChat key={conversationId} state={chat} />
				</div>
				<a class="cat-cdrawer__link" href={chat.href}>Open in Messages</a>
			</section>

			<section class="cat-cdrawer__sec" aria-labelledby={id("sched")}>
				<h3 class="cat-cdrawer__sec-head" id={id("sched")}>Scheduling</h3>
				<p class="cat-cdrawer__text">
					{next ? `Next on the calendar · ${when(next, hour12)}` : "Nothing scheduled ahead."}
				</p>
				{refusal.value && <p class="cat-cdrawer__refusal" role="alert">{refusal.value}</p>}
				{data.reschedules.map((r) => (
					<div key={r.eventId} class="cat-cdrawer__round">
						<p class="cat-cdrawer__round-title">
							<a class="cat-cdrawer__link" href={r.href}>{r.title}</a>
							<span class="cat-cdrawer__meta-part">{when(r.start, hour12)}</span>
						</p>
						<EventRescheduleTab
							event={r.event}
							view={rescheduleView(r.event, now.value)}
							tz={tz}
							hour12={hour12}
							nowMs={now.value}
							busy={busy.value}
							onPropose={(start, end, note) =>
								void negotiate(r.event, "propose", { start, end, note })}
							onApprove={(proposalId) => void negotiate(r.event, "approve", { proposalId })}
							onOpen={() => void negotiate(r.event, "open")}
							onVote={(proposalId) => void negotiate(r.event, "vote", { proposalId })}
							onConfirm={(proposalId) =>
								void negotiate(r.event, "confirm", proposalId ? { proposalId } : {})}
							onWithdraw={() => void negotiate(r.event, "withdraw")}
						/>
					</div>
				))}
			</section>
		</div>
	);
}

/** One engagement: what it is, its source status (a lifecycle container), and the hand-off link. */
function EngagementRow(
	props: { engagement: ClientEngagement; consoleScope: boolean },
): JSX.Element {
	const e = props.engagement;
	return (
		<li class="cat-cdrawer__eng">
			<p class="cat-cdrawer__eng-head">
				<span class="cat-cdrawer__eng-kind">{ENGAGEMENT_LABELS[e.kind]}</span>
				<Tag
					class="cat-cdrawer__status"
					value={e.actionReasons[0] ? ACTION_LABELS[e.actionReasons[0]] : statusLabel(e.status)}
					severity={e.actionReasons[0] ? "warning" : "secondary"}
					variant="subtle"
				/>
			</p>
			{props.consoleScope && e.listingTitle && (
				<p class="cat-cdrawer__meta">
					<span class="cat-cdrawer__meta-part">{e.listingTitle}</span>
				</p>
			)}
			<a class="cat-cdrawer__link" href={e.href}>{HANDOFF_LABELS[e.kind]}</a>
		</li>
	);
}
