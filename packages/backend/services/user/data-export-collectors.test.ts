import { assertEquals, assertFalse, assertThrows } from "@std/assert";
import { DataExportDomain } from "@projective/types/org";
import {
	collectCalendar,
	collectContributions,
	collectDomain,
	collectEmails,
	collectFiles,
	collectInvoices,
	collectMessages,
	collectNotifications,
	collectPreferences,
	collectProfile,
	collectProjects,
	collectReviews,
	collectSaved,
	collectSearch,
	collectSecurity,
	collectWallet,
	recordCount,
} from "./data-export-collectors.ts";

const CTX = { origin: "https://projective.test/" };
const AT = "2026-11-18T10:00:00+00:00";

function keys(value: unknown): string[] {
	return value && typeof value === "object" ? Object.keys(value) : [];
}

Deno.test("profile: keeps the listed fields, drops anything else", () => {
	const file = collectProfile({
		account: {
			user_id: "u1",
			email: "a@x.test",
			email_confirmed_at: AT,
			created_at: AT,
			last_sign_in_at: null,
		},
		profile: {
			username: "ana",
			first_name: "Ana",
			last_name: "B",
			headline: null,
			bio: { ops: [] },
			city: null,
			country: "GB",
			timezone: "Europe/London",
			languages: ["en"],
			interests: null,
			dob: "1990-01-01",
			visibility: "public",
			is_freelancer: true,
			created_at: AT,
			updated_at: AT,
			avatar_file_id: "secret",
		},
		freelancer: null,
		languages: [{ code: "en", level: "native" }],
		education: [],
		experience: [],
		certifications: [],
		portfolio: [],
		handle_changes: [{ old_handle: "a", new_handle: "ana", changed_at: AT }],
		identity_provider_ref: "vs_123",
	});
	assertEquals(file.profile?.username, "ana");
	assertFalse(keys(file.profile).includes("avatar_file_id"));
	assertFalse(keys(file).includes("identity_provider_ref"));
});

Deno.test("emails: every address, nothing else", () => {
	const file = collectEmails([{
		email: "a@x.test",
		is_primary: true,
		verified_at: AT,
		created_at: AT,
		id: "e1",
	}]);
	assertEquals(file, [{ email: "a@x.test", is_primary: true, verified_at: AT, created_at: AT }]);
});

Deno.test("preferences: display, notifications and categories", () => {
	const file = collectPreferences({
		display: {
			theme: "system",
			locale: "en-GB",
			preferred_display_currency: "GBP",
			layout_direction: "auto",
			contrast: "standard",
			font: "sans",
			cvd: "none",
			motion: "standard",
			date_format: null,
			ui_settings: {},
		},
		notifications: null,
		notification_categories: [{
			category: "money",
			in_app: true,
			push: null,
			email: true,
			sms: null,
			digest_frequency: null,
		}],
	});
	assertEquals(file.display?.preferred_display_currency, "GBP");
	assertEquals(file.notification_categories.length, 1);
});

Deno.test("projects: each project gets the absolute address it opens at", () => {
	const [project] = collectProjects([{
		slug: "prj-abc2345678",
		role: "owner",
		title: "Site",
		description: null,
		format: "project",
		status: "active",
		visibility: "private",
		currency: "GBP",
		budget_type: null,
		budget_amount_cents: null,
		created_at: AT,
		updated_at: AT,
		archived_at: null,
		stages: [],
		tickets: [],
		owner_user_id: "u1",
	}], CTX);
	assertEquals(project.url, "https://projective.test/projects/prj-abc2345678");
	assertFalse(keys(project).includes("owner_user_id"));
});

Deno.test("contributions: the four kinds of work elsewhere", () => {
	const file = collectContributions({
		memberships: [{ project_slug: "prj-x", project_title: "X", role: "assignee", joined_at: AT }],
		stage_assignments: [],
		claimed_tickets: [{
			project_slug: "prj-x",
			ticket_slug: "tkt-y",
			title: "T",
			status: "done",
			claimed_at: AT,
		}],
		submissions: [],
	});
	assertEquals(recordCount(file), 2);
});

Deno.test("messages: sent messages and thread metadata; other participants only by handle", () => {
	const file = collectMessages({
		direct: [{
			id: "m1",
			thread: "cht-a",
			body: "Hi",
			has_attachments: false,
			is_audio: false,
			reply_to_id: null,
			created_at: AT,
			deleted_at: null,
			sender_user_id: "u1",
		}],
		channel: [],
		threads: [{
			ref: "cht-a",
			kind: "direct",
			title: null,
			created_at: AT,
			last_message_at: AT,
			joined_at: AT,
			last_read_at: null,
			is_starred: false,
			is_muted: false,
			inbox_folder: "inbox",
			left_at: null,
			participants: ["noor"],
		}],
	});
	assertFalse(keys(file.direct[0]).includes("sender_user_id"));
	assertEquals(file.threads[0].participants, ["noor"]);
	assertThrows(() =>
		collectMessages({
			direct: [],
			channel: [],
			threads: [{ ...file.threads[0], participants: [{ user_id: "u2" }] }],
		})
	);
});

Deno.test("files: a manifest with sign-in links, never a storage path, share slug or signed URL", () => {
	const [entry] = collectFiles([{
		id: "f1",
		name: "Brief.pdf",
		original_name: "brief.pdf",
		folder: null,
		mime_type: "application/pdf",
		size_bytes: 1024,
		category: "document",
		content_hash: "abc",
		hash_algo: "sha-256",
		hash_sampled: false,
		status: "ready",
		visibility: "private",
		is_archived: false,
		starred: false,
		link_url: null,
		link_title: null,
		created_at: AT,
		updated_at: AT,
		storage_path: "u1/f1/brief.pdf",
		share_slug: "shr-secret",
	}], CTX);
	assertEquals(entry.open_url, "https://projective.test/inspect/f1");
	assertEquals(entry.download_url, "https://projective.test/api/media/proxy/f1?download=1");
	assertFalse(keys(entry).includes("storage_path"));
	assertFalse(keys(entry).includes("share_slug"));
	assertFalse(JSON.stringify(entry).includes("token="));
});

Deno.test("files and projects refuse a malformed answer instead of exporting nothing", () => {
	assertThrows(() => collectFiles({ not: "a list" }, CTX));
	assertThrows(() => collectProjects([null], CTX));
});

Deno.test("wallet: only a client or earnings wallet, with its ledger", () => {
	const file = collectWallet([{
		id: "w1",
		kind: "freelancer",
		currency: "USD",
		balance_cents: 100,
		created_at: AT,
		transactions: [{
			id: "t1",
			direction: "credit",
			amount_cents: 100,
			currency: "USD",
			reason: "escrow_release",
			ref_table: "escrows",
			ref_id: "e1",
			balance_after_cents: 100,
			fund_state: "available",
			fx_rate: null,
			fx_base: null,
			fx_as_of: null,
			created_at: AT,
		}],
	}]);
	assertEquals(file[0].transactions.length, 1);
	assertThrows(() => collectWallet([{ ...file[0], kind: "team" }]));
});

Deno.test("invoices: issued, statements and orders", () => {
	const file = collectInvoices({ issued: [], statements: [], orders: [] });
	assertEquals(recordCount(file), 0);
});

Deno.test("reviews: received ones never carry the reviewer", () => {
	const file = collectReviews({
		written: [],
		received: [{
			about: "you",
			listing_title: null,
			rating: 4.8,
			title: "Great",
			comment: "Thanks",
			reply: null,
			replied_at: null,
			created_at: AT,
			reviewer_user_id: "u9",
		}],
	});
	assertFalse(keys(file.received[0]).includes("reviewer_user_id"));
});

Deno.test("saved: collections and bookmarks", () => {
	const file = collectSaved({ collections: [{ name: "Later", created_at: AT }], bookmarks: [] });
	assertEquals(file.collections[0].name, "Later");
});

Deno.test("calendar: entries never carry a meeting link or passcode", () => {
	const file = collectCalendar({
		entries: [{
			id: "e1",
			kind: "busy",
			status: "confirmed",
			title: "Focus",
			starts_at: AT,
			ends_at: AT,
			all_day: false,
			location: null,
			description: null,
			meeting_provider: null,
			recurrence_rule: null,
			availability_behavior: null,
			created_at: AT,
			updated_at: AT,
			archived_at: null,
			meeting_url: "https://meet.test/x",
			meeting_passcode: "1234",
		}],
		invitations: [],
	});
	assertFalse(keys(file.entries[0]).includes("meeting_url"));
	assertFalse(keys(file.entries[0]).includes("meeting_passcode"));
});

Deno.test("notifications: never the actor or payload", () => {
	const [notice] = collectNotifications([{
		type: "escrow.released",
		category: "money",
		urgency: "high",
		title: "Paid",
		body: null,
		action_url: null,
		created_at: AT,
		seen_at: null,
		read_at: null,
		archived_at: null,
		actor_user_id: "u2",
		payload: { a: 1 },
	}]);
	assertFalse(keys(notice).includes("actor_user_id"));
	assertFalse(keys(notice).includes("payload"));
});

Deno.test("search: queries and recent views, never an embedding", () => {
	const file = collectSearch({
		queries: [{
			query: "logo",
			filters: {},
			entity_type: null,
			result_count: 3,
			created_at: AT,
			query_embedding: [0.1],
		}],
		recent_views: [],
	});
	assertFalse(keys(file.queries[0]).includes("query_embedding"));
});

Deno.test("security: sign-ins, sessions and activity, never a refresh-token key", () => {
	const file = collectSecurity({
		sign_ins: [{ action: "login", provider: "email", ip_address: "127.0.0.1", at: AT }],
		sessions: [{
			created_at: AT,
			updated_at: AT,
			refreshed_at: null,
			user_agent: "UA",
			ip: "127.0.0.1",
			aal: "aal1",
			not_after: null,
			refresh_token_hmac_key: "secret",
		}],
		activity: [],
	});
	assertFalse(keys(file.sessions[0]).includes("refresh_token_hmac_key"));
});

Deno.test("collectDomain dispatches every domain", () => {
	for (const domain of DataExportDomain.options) {
		assertThrows(() => collectDomain(domain, "not a domain answer", CTX), Error, undefined, domain);
	}
});

Deno.test("recordCount: a list's length, or an object's arrays plus its single records", () => {
	assertEquals(recordCount([1, 2, 3]), 3);
	assertEquals(recordCount({ a: [1, 2], b: { x: 1 }, c: null }), 3);
	assertEquals(recordCount(null), 0);
});
