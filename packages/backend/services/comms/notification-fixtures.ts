import type { NotificationInboxItem } from "@projective/types/comms";
import { mockAvatar } from "../../mocks/assets.ts";

/**
 * notification-fixtures — the in-app inbox corpus `deno task dev:mock` serves through
 * {@link NotificationInboxBackendService}. Rows are {@link NotificationInboxItem}s, the exact shape the
 * live `comms.notification_feed` read (plus its party card) maps to, so a client cannot tell the two
 * paths apart.
 */

/** The fixture recipient; every row's `userId` is rewritten to the caller's on first read. */
const FIXTURE_USER = "00000000-0000-4000-8000-000000000001";

function item(
	n: number,
	fields:
		& Pick<NotificationInboxItem, "type" | "title" | "body" | "category" | "urgency" | "createdAt">
		& Partial<NotificationInboxItem>,
): NotificationInboxItem {
	return {
		id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
		userId: FIXTURE_USER,
		entityTable: null,
		entityId: null,
		contextType: null,
		contextId: null,
		actorUserId: null,
		actionUrl: null,
		payload: {},
		groupKey: null,
		groupCount: 1,
		channels: ["in_app"],
		readAt: null,
		seenAt: null,
		expiresAt: null,
		isUnread: fields.readAt == null,
		mandatory: false,
		digestible: true,
		typeDescription: null,
		actor: null,
		...fields,
	};
}

/** Newest first, as the feed orders them. */
export const NOTIFICATION_FIXTURES: readonly NotificationInboxItem[] = [
	item(1, {
		type: "escrow.funded",
		category: "money",
		urgency: "high",
		title: "Funded — you can start",
		body: 'Escrow is held for "Homepage hero". Work can begin.',
		actionUrl: "/wallet/transactions",
		mandatory: true,
		digestible: false,
		createdAt: "2026-10-09T15:20:00.000000+00:00",
	}),
	item(2, {
		type: "application.received",
		category: "work",
		urgency: "medium",
		title: "Ada Lovelace applied to Brand system",
		body: "Review the application before the stage fills.",
		actionUrl: "/projects",
		payload: { project_title: "Brand system" },
		actor: { name: "Ada Lovelace", avatar: mockAvatar("photo-1494790108377-be9c29b29330") },
		createdAt: "2026-10-09T11:05:00.000000+00:00",
	}),
	item(3, {
		type: "message.mention",
		category: "messages",
		urgency: "medium",
		title: "You were mentioned in #design",
		body: '"@you can you check the new hero crop?"',
		groupKey: "msg:fixture-design",
		groupCount: 3,
		actionUrl: "/messages",
		actor: { name: "Daniel Okafor", avatar: mockAvatar("photo-1500648767791-00dcc994a43e") },
		createdAt: "2026-10-08T17:40:00.000000+00:00",
	}),
	item(4, {
		type: "session.booked",
		category: "schedule",
		urgency: "medium",
		title: "Kick-off call booked",
		body: "Thursday 14:00 – 14:30.",
		seenAt: "2026-10-08T09:00:00.000000+00:00",
		createdAt: "2026-10-07T13:15:00.000000+00:00",
	}),
	item(5, {
		type: "payout.sent",
		category: "money",
		urgency: "high",
		title: "Payout on its way",
		body: "Your withdrawal has left Projective for your payout account.",
		actionUrl: "/wallet/payouts",
		mandatory: true,
		digestible: false,
		readAt: "2026-10-06T10:00:00.000000+00:00",
		seenAt: "2026-10-06T10:00:00.000000+00:00",
		createdAt: "2026-10-06T08:30:00.000000+00:00",
	}),
	item(6, {
		type: "account.kyc_verified",
		category: "account",
		urgency: "medium",
		title: "Identity verified",
		body: "Your identity check passed.",
		readAt: "2026-10-04T12:00:00.000000+00:00",
		seenAt: "2026-10-04T12:00:00.000000+00:00",
		createdAt: "2026-10-04T11:45:00.000000+00:00",
	}),
	item(7, {
		type: "discovery.match",
		category: "discovery",
		urgency: "low",
		title: "3 new projects match your skills",
		body: "Brand identity, motion and UI briefs posted this week.",
		actionUrl: "/explore",
		createdAt: "2026-10-03T09:00:00.000000+00:00",
	}),
	item(8, {
		type: "system.policy_update",
		category: "system",
		urgency: "low",
		title: "We updated our fee policy",
		body: "The change applies to stages funded from 1 November.",
		readAt: "2026-10-02T10:00:00.000000+00:00",
		seenAt: "2026-10-02T10:00:00.000000+00:00",
		createdAt: "2026-10-02T08:00:00.000000+00:00",
	}),
];
