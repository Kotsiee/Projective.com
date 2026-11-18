import { assert, assertEquals } from "@std/assert";
import {
	HANDLED_STRIPE_EVENTS,
	HANDLED_STRIPE_THIN_EVENTS,
	SETTLEMENT_CURRENCIES,
} from "@projective/types/finance";
import { STRIPE_API_VERSION } from "../../core/stripe.ts";
import {
	CONNECT_STRIPE_EVENTS,
	type DestinationView,
	maskId,
	type PreflightContext,
	type PreflightReport,
	redactSecrets,
	runStripePreflight,
	STRIPE_THIN_WEBHOOK_PATH,
	STRIPE_WEBHOOK_PATH,
	type StripePreflightPort,
} from "./stripe-preflight.ts";

// #region Fixture port
const APP = "https://projective.example";

const accountDestination = (over: Partial<DestinationView> = {}): DestinationView => ({
	id: "ed_test_61AccountDestination0001",
	type: "webhook_endpoint",
	status: "enabled",
	payload: "snapshot",
	eventsFrom: ["@self"],
	apiVersion: STRIPE_API_VERSION,
	url: `${APP}${STRIPE_WEBHOOK_PATH}`,
	enabledEvents: [...HANDLED_STRIPE_EVENTS],
	...over,
});

const connectDestination = (over: Partial<DestinationView> = {}): DestinationView => ({
	...accountDestination(),
	id: "ed_test_61ConnectDestination0002",
	eventsFrom: ["@accounts"],
	enabledEvents: [...CONNECT_STRIPE_EVENTS],
	...over,
});

const thinDestination = (over: Partial<DestinationView> = {}): DestinationView => ({
	id: "ed_test_61ThinDestination00003",
	type: "webhook_endpoint",
	status: "enabled",
	payload: "thin",
	eventsFrom: ["@self"],
	apiVersion: null,
	url: `${APP}${STRIPE_THIN_WEBHOOK_PATH}`,
	enabledEvents: [...HANDLED_STRIPE_THIN_EVENTS],
	...over,
});

interface Fixture {
	destinations: readonly DestinationView[];
	balance: readonly string[];
	payoutInterval: string;
	connectedIntervals: readonly string[];
	failing?: keyof StripePreflightPort;
}

/** A live, fully configured platform: every check passes. */
const GOOD: Fixture = {
	destinations: [accountDestination(), connectDestination(), thinDestination()],
	balance: SETTLEMENT_CURRENCIES.map((c) => c.toLowerCase()),
	payoutInterval: "manual",
	connectedIntervals: ["daily", "weekly"],
};

/** A READ-ONLY port answering from the fixture; `failing` makes one read throw like a refused key. */
function fixturePort(f: Fixture): StripePreflightPort {
	const refuse = (name: keyof StripePreflightPort) => {
		if (f.failing === name) {
			throw Object.assign(
				new Error(
					"The provided key 'rk_live_****************************abcd' does not have the required permissions",
				),
				{ type: "StripePermissionError", statusCode: 403 },
			);
		}
	};
	return {
		listEventDestinations: () => {
			refuse("listEventDestinations");
			return Promise.resolve(f.destinations);
		},
		listWebhookEndpoints: () => {
			refuse("listWebhookEndpoints");
			return Promise.resolve([]);
		},
		retrievePlatformAccount: () => {
			refuse("retrievePlatformAccount");
			return Promise.resolve({
				id: "acct_1PlatformAccount9Z9Z",
				country: "GB",
				defaultCurrency: "gbp",
				detailsSubmitted: true,
				chargesEnabled: true,
				payoutsEnabled: true,
				payoutInterval: f.payoutInterval,
			});
		},
		retrieveBalance: () => {
			refuse("retrieveBalance");
			return Promise.resolve({ currencies: f.balance });
		},
		sampleConnectedAccounts: () => {
			refuse("sampleConnectedAccounts");
			return Promise.resolve({
				accounts: f.connectedIntervals.map((payoutInterval, i) => ({
					id: `acct_1Connected000000${i}`,
					payoutInterval,
				})),
				hasMore: false,
			});
		},
	};
}

const LIVE: PreflightContext = {
	mode: "live",
	appEnv: "production",
	appUrl: APP,
	financeLive: true,
	secrets: { webhook: true, thin: true, connect: true, publishable: true },
};

const run = (f: Partial<Fixture>, ctx: Partial<PreflightContext> = {}) =>
	runStripePreflight(fixturePort({ ...GOOD, ...f }), { ...LIVE, ...ctx });

const failures = (r: PreflightReport) => r.checks.filter((c) => c.status === "fail");
const names = (r: PreflightReport) => failures(r).map((c) => c.name);
// #endregion

Deno.test("a fully configured live platform passes every check", async () => {
	const report = await run({});
	assertEquals(failures(report), []);
	assert(report.ok);
	assertEquals(report.mode, "live");
	assertEquals(report.account, "acct_…9Z9Z");
});

Deno.test("an event missing from the account destination fails, named, with a fix", async () => {
	const report = await run({
		destinations: [
			accountDestination({
				enabledEvents: HANDLED_STRIPE_EVENTS.filter((t) => t !== "charge.refunded"),
			}),
			connectDestination(),
			thinDestination(),
		],
	});
	const [fail] = failures(report);
	assertEquals(failures(report).length, 1);
	assert(fail.name.endsWith("(account): events"), fail.name);
	assertEquals(fail.detail, "missing: charge.refunded · extra: none");
	assert(fail.fix);
	assert(!report.ok);
});

Deno.test("an extra event fails too: the list is diffed both ways", async () => {
	const report = await run({
		destinations: [
			accountDestination({ enabledEvents: [...HANDLED_STRIPE_EVENTS, "charge.succeeded"] }),
			connectDestination(),
			thinDestination(),
		],
	});
	assertEquals(failures(report).map((c) => c.detail), ["missing: none · extra: charge.succeeded"]);
});

Deno.test("a thin destination is diffed against HANDLED_STRIPE_THIN_EVENTS", async () => {
	const report = await run({
		destinations: [
			accountDestination(),
			connectDestination(),
			thinDestination({ enabledEvents: ["v2.core.account.updated", "v2.core.account.created"] }),
		],
	});
	assertEquals(failures(report).map((c) => c.detail), [
		"missing: v2.core.account[configuration.recipient].capability_status_updated · extra: v2.core.account.created",
	]);
});

Deno.test("a snapshot destination on another API version fails; a thin one has none to check", async () => {
	const report = await run({
		destinations: [
			accountDestination({ apiVersion: "2025-09-30.clover" }),
			connectDestination({ apiVersion: null }),
			thinDestination(),
		],
	});
	assertEquals(names(report).length, 2);
	assert(names(report).every((n) => n.endsWith(": API version")));
	assert(failures(report)[1].detail!.startsWith("the account default"));
});

Deno.test("a missing settlement currency fails and names the bank account to add", async () => {
	const report = await run({ balance: ["gbp", "usd", "eur", "cad", "aud", "jpy", "sgd", "chf"] });
	const [fail] = failures(report);
	assertEquals(failures(report).length, 1);
	assertEquals(fail.group, "balance");
	assert(fail.detail!.endsWith("missing ZAR"), fail.detail);
	assert(fail.fix!.includes("bank account"));
});

Deno.test("a missing Connect destination fails, and its secret is then required", async () => {
	const report = await run(
		{ destinations: [accountDestination(), thinDestination()] },
		{ secrets: { webhook: true, thin: true, connect: false, publishable: true } },
	);
	assertEquals(names(report), [
		"STRIPE_CONNECT_WEBHOOK_SECRET is set",
		"one destination carries connected accounts' events (snapshot)",
	]);
	const create = failures(report)[1].fix!;
	assert(create.includes("events from connected accounts"), create);
	assert(create.includes(`${APP}${STRIPE_WEBHOOK_PATH}`), create);
});

Deno.test("one destination for both account and connected-account events passes, with no Connect secret", async () => {
	const report = await run(
		{
			destinations: [
				accountDestination({ eventsFrom: ["@self", "@accounts"] }),
				thinDestination(),
			],
		},
		{ secrets: { webhook: true, thin: true, connect: false, publishable: true } },
	);
	assertEquals(failures(report), []);
});

Deno.test("Connect events alone on a separate destination: payout.* and account.updated, exactly", () => {
	assertEquals(
		[...CONNECT_STRIPE_EVENTS].sort(),
		["account.updated", "payout.canceled", "payout.failed", "payout.paid"],
	);
});

Deno.test("two destinations for one role fail as duplicates", async () => {
	const report = await run({
		destinations: [
			accountDestination(),
			accountDestination({ id: "ed_test_61AccountDestination0009" }),
			connectDestination(),
			thinDestination(),
		],
	});
	assertEquals(names(report), ["one destination carries account events (snapshot)"]);
});

Deno.test("a destination on another host, or disabled, fails", async () => {
	const report = await run({
		destinations: [
			accountDestination({ url: `https://staging.projective.example${STRIPE_WEBHOOK_PATH}` }),
			connectDestination({ status: "disabled" }),
			thinDestination(),
		],
	});
	assertEquals(names(report).map((n) => n.split(": ")[1]), ["URL is on APP_URL's host", "enabled"]);
});

Deno.test("automatic platform payouts fail: they would pay held escrow to the bank", async () => {
	const report = await run({ payoutInterval: "daily" });
	assertEquals(names(report), ["the platform's own payouts are manual"]);
});

Deno.test("a connected account on manual payouts fails, masked", async () => {
	const report = await run({ connectedIntervals: ["daily", "manual"] });
	assertEquals(failures(report).map((c) => c.detail), ["2 read; manual: acct_…0001"]);
});

Deno.test("production on a test key fails; a test key outside production is the developer's run", async () => {
	assertEquals(names(await run({}, { mode: "test" })), ["production runs a live key"]);
	assertEquals(failures(await run({}, { mode: "test", appEnv: "development" })), []);
});

Deno.test("a refused read fails only its own checks, and the key in Stripe's message is redacted", async () => {
	const report = await run({ failing: "retrieveBalance" });
	const [fail] = failures(report);
	assertEquals(failures(report).length, 1);
	assertEquals(fail.name, "the balance is readable");
	assert(fail.detail!.startsWith("StripePermissionError 403: "), fail.detail);
	assert(!fail.detail!.includes("rk_live_"), fail.detail);
});

Deno.test("no secret survives redaction; ids are masked to their last four", () => {
	assertEquals(
		redactSecrets("sk_test_51ABCdef and whsec_abc123+/= and pk_live_9Z"),
		"[redacted] and [redacted] and [redacted]",
	);
	assertEquals(maskId("acct_1PlatformAccount9Z9Z"), "acct_…9Z9Z");
	assertEquals(maskId("ed_test_61RM8ltWcTW4mbsxJJh1"), "ed_test_…JJh1");
	assertEquals(maskId("we_12"), "we_…");
});

Deno.test("the endpoint paths are the two webhook routes that exist", async () => {
	for (const path of [STRIPE_WEBHOOK_PATH, STRIPE_THIN_WEBHOOK_PATH]) {
		const file = new URL(`../../../../apps/web/routes${path}.ts`, import.meta.url);
		assert((await Deno.stat(file)).isFile, path);
	}
});
