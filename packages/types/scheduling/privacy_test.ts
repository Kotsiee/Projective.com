import { assert, assertEquals, assertFalse, assertStrictEquals } from "@std/assert";
import type { CalendarEvent } from "./scheduling.ts";
import type { SchedulingViewer } from "./privacy.ts";
import {
	ANONYMOUS_VIEWER,
	isEventParty,
	PUBLIC_EVENT_FIELDS,
	redactEventForViewer,
	redactEventsForViewer,
} from "./privacy.ts";

/**
 * The withholding rule, tested where it is defined.
 *
 * The defect it replaces was not a missing check but a check on the wrong thing: the projection was
 * gated on {@link CalendarEvent.masked}, and a public group session is deliberately unmasked, so an
 * anonymous visitor received the roster, the join URL, the passcode, the attendees' notes and the
 * host's earnings. Every case below is therefore written against an UNMASKED event — the one the old
 * gate waved through.
 */

// #region Fixtures
const NOW = Date.parse("2026-07-17T16:20:00Z");
const HOUR = 3_600_000;

/** A fully-decorated public group session: unmasked, titled, and carrying every private field. */
function session(over: Partial<CalendarEvent> = {}): CalendarEvent {
	return {
		id: "ses-1",
		title: "Open office hours",
		kind: "session",
		status: "confirmed",
		start: NOW + 48 * HOUR,
		end: NOW + 49 * HOUR,
		attendees: 4,
		capacity: 12,
		meta: "Group session",
		location: "Live",
		organiser: { name: "Ada Lovelace", avatar: null, handle: "ada" },
		viewerIsHost: false,
		roster: [
			{
				id: "ses-1:host",
				name: "Ada Lovelace",
				avatar: null,
				handle: "ada",
				role: "host",
				response: "accepted",
				respondedAt: NOW - 72 * HOUR,
				isViewer: false,
				note: null,
			},
			{
				id: "ses-1:a0",
				name: "Grace Hopper",
				avatar: null,
				handle: "grace",
				role: "participant",
				response: "tentative",
				respondedAt: NOW - 6 * HOUR,
				isViewer: false,
				note: "Joining ten minutes late.",
			},
		],
		meeting: {
			provider: "zoom",
			providerLabel: "Zoom",
			joinUrl: "https://call.example.com/zoom/405586303",
			passcode: "587642",
			details: "Dial-in: +44 20 7946 0000, then the passcode.",
			pending: false,
		},
		// The agenda: what will be SAID in the session, as opposed to the title, which advertises what
		// it is. A public schedule publishes the second and never the first.
		description: "<p>Reviewing the unreleased Q3 roadmap.</p>",
		// Every attachment carries a resolvable asset URL, so publishing the array publishes the pack.
		attachments: [asset()],
		pricing: {
			model: "per_seat",
			unitPrice: { minor: 9000, currency: "GBP", display: "£90.00", origin: null },
			paidSeats: 4,
			occurrenceEarnings: { minor: 36000, currency: "GBP", display: "£360.00", origin: null },
			seriesEarnings: { minor: 72000, currency: "GBP", display: "£720.00", origin: null },
			remainingOccurrences: 2,
			viewerHasPaid: false,
		},
		reschedule: {
			mode: "vote",
			status: "voting",
			openedBy: { name: "Ada Lovelace", avatar: null, handle: "ada" },
			openedAt: NOW - 14 * HOUR,
			proposals: [],
			resolvesAt: NOW + 36 * HOUR,
			resolvedProposalId: null,
			round: 0,
		},
		history: [
			{
				id: "ses-1-h0",
				kind: "created",
				actor: { name: "Ada Lovelace", avatar: null, handle: "ada" },
				summary: "Created this event",
				detail: null,
				at: new Date(NOW - 14 * 24 * HOUR).toISOString(),
				dateLabel: "3 Jul, 16:20",
				unread: false,
				targetId: null,
			},
		],
		...over,
	};
}

/** One item of the agenda pack, carrying a URL that resolves to the bytes. */
function asset(): NonNullable<CalendarEvent["attachments"]>[number] {
	return {
		id: "ses-1-a0",
		kind: "pdf",
		category: "Document",
		name: "q3-roadmap-draft.pdf",
		ext: "pdf",
		url: "https://assets.example.com/packs/q3-roadmap-draft.pdf",
		thumbnailUrl: null,
		sizeBytes: 248_311,
		sizeLabel: "243 KB",
		width: null,
		height: null,
		durationLabel: null,
		channelId: null,
		channelName: null,
		channelKind: null,
		messageId: null,
		messageText: null,
		messageAudioUrl: null,
		sender: null,
		createdAt: new Date(NOW - 12 * HOUR).toISOString(),
		timeLabel: "04:20",
		dayLabel: "Yesterday",
		dateLabel: "16 Jul",
		starred: false,
		source: "supabase",
		status: "uploaded",
		visibility: "link",
		ownerType: "user",
		ownerId: "ada",
		folderId: null,
		folderPath: [],
		contentHash: null,
		hashSampled: false,
		external: null,
		link: null,
		shareSlug: null,
		downloadCount: 0,
		downloadedByViewer: false,
		canManage: false,
	};
}

const GUEST = ANONYMOUS_VIEWER;
const SIGNED_IN: SchedulingViewer = { authenticated: true, handle: "grace" };

/**
 * Everything the redactor is expected to strip, by key.
 *
 * This list is what makes the allow-list testable, so every private field on {@link CalendarEvent}
 * has to be ON it — a field the redactor strips but this list omits is a field that can be published
 * tomorrow with the suite still green, which is precisely the silent regression these tests exist to
 * catch. `attachments` (every row resolves to bytes) and `description` (the agenda itself, as opposed
 * to the title that advertises the session) were the two that were missing.
 */
const PRIVATE_KEYS = [
	"roster",
	"organiser",
	"viewerIsHost",
	"meeting",
	"pricing",
	"reschedule",
	"history",
	"attachments",
	"description",
	"callId",
	"meetingUrl",
] as const;
// #endregion

// #region Who counts as a party
Deno.test("isEventParty — a guest is never a party, whatever the payload says", () => {
	// The event below is decorated as though the viewer were seated. Authentication is the first gate:
	// no session, no party, so a forged or stale payload cannot promote a stranger.
	assertFalse(isEventParty(session({ viewerIsHost: true }), GUEST));
	const seated = session();
	seated.roster![1].isViewer = true;
	assertFalse(isEventParty(seated, GUEST));
});

Deno.test("isEventParty — the host is a party, and so is anyone the server seated", () => {
	assert(isEventParty(session({ viewerIsHost: true }), SIGNED_IN));
	const seated = session();
	seated.roster![1].isViewer = true;
	assert(isEventParty(seated, SIGNED_IN));
});

Deno.test("isEventParty — a signed-in stranger is not a party to somebody else's event", () => {
	// The case the `masked` gate could never express: authenticated, but nobody on this roster.
	assertFalse(isEventParty(session(), SIGNED_IN));
	assertFalse(isEventParty(session({ roster: undefined, viewerIsHost: undefined }), SIGNED_IN));
});
// #endregion

// #region What a non-party receives
Deno.test("redactEventForViewer — an UNMASKED public session withholds everything private", () => {
	// This is the exact shape that leaked: unmasked by design, so the old `if (event.masked)` gate
	// returned it whole to an anonymous caller.
	const out = redactEventForViewer(session(), GUEST);
	for (const key of PRIVATE_KEYS) {
		assertStrictEquals(
			(out as Record<string, unknown>)[key],
			undefined,
			`${key} survived redaction`,
		);
	}
	// Not merely undefined — absent, so it cannot be serialised as an explicit null either.
	for (const key of PRIVATE_KEYS) {
		assertFalse(key in out, `${key} is still a key on the payload`);
	}
});

Deno.test("redactEventForViewer — no private VALUE survives, checked against the serialised body", () => {
	// Field-by-field assertions pass while a nested copy of the same secret slips through some other
	// key, so this looks at what actually goes over the wire.
	const body = JSON.stringify(redactEventForViewer(session(), GUEST));
	for (
		const secret of [
			"call.example.com",
			"587642",
			"Dial-in",
			"Grace Hopper",
			"grace",
			"Joining ten minutes late",
			"£360.00",
			"£720.00",
			"36000",
			"assets.example.com",
			"q3-roadmap-draft.pdf",
			"unreleased Q3 roadmap",
		]
	) {
		assertFalse(body.includes(secret), `the public payload still contains ${secret}`);
	}
});

Deno.test("redactEventForViewer — a MASKED block is withheld too, so the two rules compose", () => {
	// Masking hides what a block is; withholding hides who is in it. A masked block that somehow
	// carried coordination must not escape on the strength of being masked.
	const out = redactEventForViewer(session({ masked: true, title: "Busy" }), GUEST);
	for (const key of PRIVATE_KEYS) {
		assertFalse(key in out, `${key} survived redaction on a masked block`);
	}
	assertStrictEquals(out.masked, true);
});

Deno.test("redactEventForViewer — a MASKED block does not disclose which calendar it came from", () => {
	// Masking says "this time is taken" without saying what takes it. `sources` answers exactly the
	// question the mask refuses: learning that someone's unnamed Thursday block is a Google event —
	// while their named ones are not — is provenance about a private appointment. The surfaces already
	// decline to DRAW a provider mark on a masked block; this is what stops it crossing the wire.
	const hidden = redactEventForViewer(
		session({ masked: true, title: "Busy", sources: ["projective", "google"] }),
		GUEST,
	);
	assertFalse("sources" in hidden, "a masked block disclosed its provider");

	// And it stays public on an UNMASKED event, which is what the provider filter and the stacked
	// provider marks are built from — withholding it there would break the feature to fix nothing.
	const shown = redactEventForViewer(
		session({ sources: ["projective", "google"] }),
		GUEST,
	);
	assertEquals(shown.sources, ["projective", "google"]);
});

Deno.test("redactEventForViewer — the public facts survive, so a schedule still renders", () => {
	// §Part 1.4's whole exception: a public group session may say how many are coming precisely
	// because it names nobody.
	const out = redactEventForViewer(session(), GUEST);
	assertStrictEquals(out.id, "ses-1");
	assertStrictEquals(out.title, "Open office hours");
	assertStrictEquals(out.kind, "session");
	assertStrictEquals(out.status, "confirmed");
	assertStrictEquals(out.start, NOW + 48 * HOUR);
	assertStrictEquals(out.end, NOW + 49 * HOUR);
	assertStrictEquals(out.attendees, 4);
	assertStrictEquals(out.capacity, 12);
	assertStrictEquals(out.location, "Live");
});

Deno.test("redactEventForViewer — an absent optional stays absent rather than becoming null", () => {
	const out = redactEventForViewer(
		session({ status: undefined, location: undefined, capacity: undefined }),
		GUEST,
	);
	assertFalse("status" in out);
	assertFalse("location" in out);
	assertFalse("capacity" in out);
});

Deno.test("redactEventForViewer — a party receives the event untouched, by identity", () => {
	const full = session({ viewerIsHost: true });
	assertStrictEquals(redactEventForViewer(full, SIGNED_IN), full);
});

Deno.test("PUBLIC_EVENT_FIELDS — the allow-list carries nothing private", () => {
	// The list is the rule. If a private key is ever added to it the leak returns silently, so the
	// two sets are asserted disjoint rather than left to review.
	for (const key of PRIVATE_KEYS) {
		assertFalse(
			(PUBLIC_EVENT_FIELDS as readonly string[]).includes(key),
			`${key} is on the public allow-list`,
		);
	}
});

Deno.test("redactEventsForViewer — applies per event, so one party seat cannot open the page", () => {
	const mine = session({ id: "mine", viewerIsHost: true });
	const theirs = session({ id: "theirs" });
	const out = redactEventsForViewer([mine, theirs], SIGNED_IN);
	assertEquals(out[0].meeting?.joinUrl, "https://call.example.com/zoom/405586303");
	assertStrictEquals(out[1].meeting, undefined);
});
// #endregion
