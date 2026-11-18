import { assert, assertEquals } from "@std/assert";
import type { ClaimedDelivery, OutboundChannel } from "@projective/types/comms";
import {
	type DispatchDb,
	type DispatchDeps,
	isWellFormedDispatchSecret,
	MAX_DISPATCH_LIMIT,
	NotificationDispatchService,
} from "./NotificationDispatchService.ts";
import {
	configuredChannels,
	configuredTransports,
	type DispatchTransport,
	type TransportOutcome,
} from "./dispatch-transports.ts";
import type { DispatchPayload } from "./dispatch-payload.ts";

// #region Fixtures
const APP = "https://staging.projective.test";
const NOTIFICATION = "6f3d2b0a-1c4e-4d8a-9b7f-0a1b2c3d4e5f";
const USER = "0b8e6c4a-2d1f-4e3b-8a7c-9d0e1f2a3b4c";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function row(n: number, overrides: Record<string, unknown> = {}) {
	return {
		delivery_id: id(n),
		notification_id: NOTIFICATION,
		user_id: USER,
		channel: "email",
		status: "queued",
		attempts: 1,
		suppressed_reason: null,
		destination: { address: `person${n}@example.test` },
		title: "Stage 2 was funded",
		action_url: "/projects/prj-abc123",
		type: "escrow.funded",
		category: "money",
		...overrides,
	};
}

interface FakeDb extends DispatchDb {
	claims: { channels: OutboundChannel[]; notificationId: string | null; limit: number }[];
	recorded: { deliveryId: string; outcome: TransportOutcome }[];
}

function fakeDb(rows: unknown[], flag = true): FakeDb {
	const db: FakeDb = {
		claims: [],
		recorded: [],
		claim(channels, notificationId, limit) {
			db.claims.push({ channels, notificationId, limit });
			return Promise.resolve(rows);
		},
		record(deliveryId, outcome) {
			db.recorded.push({ deliveryId, outcome });
			return Promise.resolve();
		},
		enabled: () => Promise.resolve(flag),
	};
	return db;
}

function fakeTransport(
	channel: OutboundChannel,
	answer: (d: ClaimedDelivery) => Promise<TransportOutcome>,
): DispatchTransport & { sent: { delivery: ClaimedDelivery; payload: DispatchPayload }[] } {
	const sent: { delivery: ClaimedDelivery; payload: DispatchPayload }[] = [];
	return {
		channel,
		provider: "fake",
		sent,
		send(delivery, payload) {
			sent.push({ delivery, payload });
			return answer(delivery);
		},
	};
}

function deps(db: DispatchDb, transports: DispatchTransport[], live = true): DispatchDeps {
	return {
		live,
		db,
		transports: () => new Map(transports.map((t) => [t.channel, t])),
		appUrl: APP,
	};
}
// #endregion

Deno.test("the shipped registry: email once Resend is configured (NT3); no push or SMS until NT4–NT5", () => {
	const keep = ["RESEND_API_KEY", "MAIL_FROM"].map((k) => [k, Deno.env.get(k)] as const);
	try {
		Deno.env.set("RESEND_API_KEY", "XXXX-XXXX");
		Deno.env.set("MAIL_FROM", "Projective <no-reply@example.test>");
		assertEquals(configuredTransports().size, 0);
		assertEquals(configuredChannels(), { email: false, push: false, sms: false });

		Deno.env.set("RESEND_API_KEY", "re_test_key");
		assertEquals([...configuredTransports().keys()], ["email"]);
		assertEquals(configuredChannels(), { email: true, push: false, sms: false });
	} finally {
		for (const [k, v] of keep) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
	}
});

Deno.test("dispatch — with no transport configured, nothing is claimed and every delivery waits", async () => {
	const db = fakeDb([row(1)]);
	const result = await NotificationDispatchService.dispatch(NOTIFICATION, 200, deps(db, []));
	assertEquals(result.ok, true);
	assertEquals(result.data, { claimed: 0, sent: 0, failed: 0, skipped: 0, suppressed: 0 });
	assertEquals(db.claims.length, 0);
});

Deno.test("dispatch — claims only the channels it can send, then sends and records each queued row", async () => {
	const db = fakeDb([
		row(1),
		row(2, { status: "skipped", destination: null, suppressed_reason: "no_target" }),
		row(3, {
			status: "suppressed",
			destination: null,
			suppressed_reason: "suppressed_destination",
		}),
	]);
	const email = fakeTransport(
		"email",
		() => Promise.resolve({ status: "sent", provider: "fake", providerRef: "msg_1" }),
	);
	const result = await NotificationDispatchService.dispatch(NOTIFICATION, 200, deps(db, [email]));

	assertEquals(db.claims, [{ channels: ["email"], notificationId: NOTIFICATION, limit: 200 }]);
	assertEquals(result.data, { claimed: 3, sent: 1, failed: 0, skipped: 1, suppressed: 1 });
	assertEquals(email.sent.length, 1);
	assertEquals(email.sent[0].payload, {
		notificationId: NOTIFICATION,
		title: "Stage 2 was funded",
		link: `${APP}/projects/prj-abc123`,
	});
	assertEquals(db.recorded, [{
		deliveryId: id(1),
		outcome: { status: "sent", provider: "fake", providerRef: "msg_1" },
	}]);
});

Deno.test("dispatch — a throwing transport is recorded as a failure, and the pass carries on", async () => {
	const db = fakeDb([row(1), row(2)]);
	const email = fakeTransport(
		"email",
		(d) =>
			d.deliveryId === id(1)
				? Promise.reject(new Error("Resend answered 500"))
				: Promise.resolve({ status: "sent", provider: "fake" }),
	);
	const result = await NotificationDispatchService.dispatch(null, 50, deps(db, [email]));

	assertEquals(result.data, { claimed: 2, sent: 1, failed: 1, skipped: 0, suppressed: 0 });
	const failed = db.recorded.find((r) => r.deliveryId === id(1));
	assertEquals(failed?.outcome, {
		status: "failed",
		provider: "fake",
		error: "Resend answered 500",
	});
});

Deno.test("dispatch — an unreadable claim row is closed as failed, not left queued", async () => {
	const db = fakeDb([row(1, { destination: { surprise: true } })]);
	const email = fakeTransport("email", () => Promise.resolve({ status: "sent", provider: "fake" }));
	const result = await NotificationDispatchService.dispatch(null, 50, deps(db, [email]));

	assertEquals(result.data?.failed, 1);
	assertEquals(email.sent.length, 0);
	assertEquals(db.recorded[0].outcome.error, "unreadable_claim");
});

Deno.test("dispatch — the batch is bounded, and an environment that is not live answers 503", async () => {
	const db = fakeDb([]);
	const email = fakeTransport("email", () => Promise.resolve({ status: "sent", provider: "fake" }));
	await NotificationDispatchService.dispatch(null, 10_000, deps(db, [email]));
	await NotificationDispatchService.dispatch(null, 0, deps(db, [email]));
	assertEquals(db.claims.map((c) => c.limit), [MAX_DISPATCH_LIMIT, 200]);

	const offline = await NotificationDispatchService.dispatch(
		null,
		50,
		deps(fakeDb([]), [email], false),
	);
	assertEquals([offline.ok, offline.status], [false, 503]);
});

Deno.test("dispatch — a claim error answers 503 and never echoes the database's message", async () => {
	const db = fakeDb([]);
	db.claim = () => Promise.reject(new Error("comms.fn_claim_deliveries failed (PGRST301)"));
	const email = fakeTransport("email", () => Promise.resolve({ status: "sent", provider: "fake" }));
	const result = await NotificationDispatchService.dispatch(null, 50, deps(db, [email]));
	assertEquals([result.ok, result.status], [false, 503]);
	assert(!result.message?.includes("PGRST"));
});

Deno.test("isDispatchAuthorised — the right bearer passes; a wrong, short or placeholder one never does", () => {
	const secret = "s".repeat(40);
	const before = Deno.env.get("COMMS_DISPATCH_SECRET");
	try {
		Deno.env.set("COMMS_DISPATCH_SECRET", secret);
		assertEquals(NotificationDispatchService.isDispatchAuthorised(`Bearer ${secret}`), true);
		assertEquals(
			NotificationDispatchService.isDispatchAuthorised(`Bearer ${"t".repeat(40)}`),
			false,
		);
		assertEquals(NotificationDispatchService.isDispatchAuthorised(null), false);
		Deno.env.set("COMMS_DISPATCH_SECRET", "XXXX-XXXX");
		assertEquals(NotificationDispatchService.isDispatchAuthorised("Bearer XXXX-XXXX"), false);
	} finally {
		before === undefined
			? Deno.env.delete("COMMS_DISPATCH_SECRET")
			: Deno.env.set("COMMS_DISPATCH_SECRET", before);
	}
});

Deno.test("isRunning — the flag and a well-formed bearer together; the flag read is reused", async () => {
	assertEquals(isWellFormedDispatchSecret("XXXX-XXXX"), false);
	assertEquals(isWellFormedDispatchSecret(` ${"s".repeat(32)} `), true);

	const before = Deno.env.get("COMMS_DISPATCH_SECRET");
	try {
		Deno.env.set("COMMS_DISPATCH_SECRET", "s".repeat(40));
		NotificationDispatchService.resetFlagCache();
		let reads = 0;
		const db = fakeDb([], true);
		db.enabled = () => {
			reads += 1;
			return Promise.resolve(true);
		};
		assertEquals(await NotificationDispatchService.isRunning(deps(db, []), 1_000), true);
		assertEquals(await NotificationDispatchService.isRunning(deps(db, []), 2_000), true);
		assertEquals(reads, 1);

		NotificationDispatchService.resetFlagCache();
		assertEquals(
			await NotificationDispatchService.isRunning(deps(fakeDb([], false), []), 3_000),
			false,
		);

		NotificationDispatchService.resetFlagCache();
		const broken = fakeDb([]);
		broken.enabled = () => Promise.reject(new Error("unreachable"));
		assertEquals(await NotificationDispatchService.isRunning(deps(broken, []), 4_000), false);
		assertEquals(await NotificationDispatchService.isRunning(deps(db, [], false), 5_000), false);
	} finally {
		NotificationDispatchService.resetFlagCache();
		before === undefined
			? Deno.env.delete("COMMS_DISPATCH_SECRET")
			: Deno.env.set("COMMS_DISPATCH_SECRET", before);
	}
});
