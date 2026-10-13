/**
 * `deno task smoke:stripe` — the Stripe rails smoke test: card escrow round trip (begin → PaymentIntent
 * → signed webhook → settle → locked/held, plus decline, short-payment and stage-gone failures,
 * replays and a top-up), the payout path (release → fn_freelancer_payout_ready gate → Connect
 * account → Transfer → transfer.created) and its lifecycle after the transfer (Decision #202: the
 * minimum, a named destination, transfer.reversed, a connected account's payout.failed / payout.paid
 * and the stale-payout sweep's claim and Stripe lookups), then reconciliation.
 *
 * Needs the local Supabase stack (`deno task db:reset` seed) and stripe-mock:
 *   docker run -d -p 12111:12111 stripe/stripe-mock
 * Stripe calls go through the real request builders (`stripe-rails.ts`) to stripe-mock, so their
 * shapes are validated against Stripe's OpenAPI spec; webhook deliveries are signed locally and go
 * through the real `PaymentBackendService` handlers; the ledger half (`stripe-smoke.sql`) runs in a
 * transaction that is rolled back, so the database is unchanged afterwards. Accounts v2 onboarding is
 * not served by stripe-mock — that half is recorded through its database doors, as the webhook would.
 */
import Stripe from "stripe";
import { load } from "@std/dotenv";
import type { InboundPayment } from "@projective/types/finance";
import {
	bankPayoutContents,
	createPaymentIntent,
	createTransfer,
	findPayoutTransfer,
	payoutTransferGroup,
	transferParams,
} from "@server/services/finance/stripe-rails.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

await load({ envPath: ".env.local", export: true });
await load({ export: true });

const MOCK = Deno.env.get("STRIPE_MOCK_URL") ?? "http://localhost:12111";
const DB_CONTAINER = Deno.env.get("SMOKE_DB_CONTAINER") ?? "supabase_db_Projective";
// Shape-valid fakes for stripe-mock (it accepts any key); never real credentials.
const KEY = "sk_test_smoke" + "0".repeat(20);
const WHSEC = "whsec_smoke" + "0".repeat(24);
const CONNECT_WHSEC = "whsec_smokeconnect" + "0".repeat(20);
Deno.env.set("STRIPE_SECRET_KEY", KEY);
Deno.env.set("STRIPE_WEBHOOK_SECRET", WHSEC);
Deno.env.set("STRIPE_THIN_WEBHOOK_SECRET", WHSEC);
Deno.env.set("STRIPE_CONNECT_WEBHOOK_SECRET", CONNECT_WHSEC);
Deno.env.set("STRIPE_API_BASE", MOCK);
Deno.env.set("FINANCE_BACKEND_LIVE", "true");
Deno.env.delete("USE_MOCKS");

let failures = 0;
function check(cond: boolean, what: string, detail?: unknown): void {
	if (cond) console.log(`ok  ${what}`);
	else {
		failures++;
		console.error(`FAIL ${what}`, detail ?? "");
	}
}

// #region Stripe rails → stripe-mock
const mock = new URL(MOCK);
const stripe = new Stripe(KEY, {
	host: mock.hostname,
	port: mock.port,
	protocol: mock.protocol === "https:" ? "https" : "http",
	httpClient: Stripe.createFetchHttpClient(),
});
const payment = {
	id: crypto.randomUUID(),
	purpose: "escrow_lock",
	walletId: crypto.randomUUID(),
	projectStageId: crypto.randomUUID(),
	amountCents: 240000,
	currency: "USD",
} as InboundPayment;
const intent = await createPaymentIntent(stripe, payment).catch((e) => {
	console.error(
		`stripe-mock unreachable at ${MOCK} — docker run -d -p 12111:12111 stripe/stripe-mock`,
	);
	throw e;
});
check(/^pi_/.test(intent.id) && !!intent.clientSecret, "stripe-mock: escrow PaymentIntent created");
const transfer = await createTransfer(stripe, {
	payoutId: crypto.randomUUID(),
	amountMinor: 1000,
	currency: "USD",
	destination: "acct_smoke",
	walletId: crypto.randomUUID(),
});
check(/^tr_/.test(transfer.id), "stripe-mock: payout Transfer created");

// Decision #202: the transfer carries a group the sweep can list by, and the sweep's lookups and the
// bank-payout resolution are shaped as Stripe's spec expects (stripe-mock answers with fixtures, so
// only the request shapes and the parsing are proven here, not a real match).
const sweptPayout = crypto.randomUUID();
check(
	transferParams({
		payoutId: sweptPayout,
		amountMinor: 1000,
		currency: "USD",
		destination: "acct_smoke",
		walletId: crypto.randomUUID(),
		destinationMethodId: crypto.randomUUID(),
	}).transfer_group === payoutTransferGroup(sweptPayout),
	"transfer: grouped by its payout for the sweep",
);
const regrouped = await createTransfer(stripe, {
	payoutId: sweptPayout,
	amountMinor: 1000,
	currency: "USD",
	destination: "acct_smoke",
	walletId: crypto.randomUUID(),
	destinationMethodId: crypto.randomUUID(),
});
check(
	/^tr_/.test(regrouped.id),
	"stripe-mock: a Transfer with a group and a destination method is accepted",
);
const found = await findPayoutTransfer(stripe, {
	payoutId: sweptPayout,
	destination: "acct_smoke",
	initiatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
}).catch((e) => e);
check(
	found === null,
	"sweep: the transfer lookup (group, then destination scan) matches only its own metadata",
	found,
);
const contents = await bankPayoutContents(stripe, "acct_smoke", "po_smoke").catch((e) => e);
check(
	Array.isArray(contents?.transfers) && Array.isArray(contents?.priorPayouts),
	"bank payout: balance transactions on the connected account resolve to transfers",
	contents,
);
// #endregion

// #region Webhook contract (signature, unknown events, mode) — answers before any ledger write
async function deliver(
	body: unknown,
	opts: { thin?: boolean; secret?: string; sign?: boolean } = {},
) {
	const payload = JSON.stringify(body);
	const header = opts.sign === false ? null : await Stripe.webhooks.generateTestHeaderStringAsync({
		payload,
		secret: opts.secret ?? WHSEC,
		cryptoProvider: Stripe.createSubtleCryptoProvider(),
	});
	return opts.thin
		? PaymentBackendService.handleStripeThinWebhook(payload, header)
		: PaymentBackendService.handleStripeWebhook(payload, header);
}
const snapshot = (type: string, livemode = false) => ({
	id: `evt_smoke_${crypto.randomUUID().replaceAll("-", "")}`,
	object: "event",
	type,
	livemode,
	created: Math.floor(Date.now() / 1000),
	api_version: "2026-08-26.dahlia",
	data: {
		object: { id: intent.id, object: "payment_intent", amount_received: 240000, currency: "usd" },
	},
});
const thin = (type: string) => ({
	id: `evt_smoke_${crypto.randomUUID().replaceAll("-", "")}`,
	object: "v2.core.event",
	type,
	livemode: false,
	created: new Date().toISOString(),
	related_object: {
		id: "acct_smoke",
		type: "v2.core.account",
		url: "/v2/core/accounts/acct_smoke",
	},
});

let r = await deliver(snapshot("payment_intent.succeeded"), { sign: false });
check(r.status === 400, "webhook: a missing signature is 400", r);
r = await deliver(snapshot("payment_intent.succeeded"), { secret: "whsec_other" + "1".repeat(24) });
check(r.status === 400, "webhook: a forged signature is 400", r);
r = await deliver(snapshot("customer.created"));
check(
	r.status === 200 && r.data?.outcome === "ignored",
	"webhook: an unknown event is 2xx and ignored",
	r,
);
r = await deliver(snapshot("payment_intent.succeeded", true));
check(
	r.status === 200 && r.data?.outcome === "ignored",
	"webhook: a live event on a test deployment is ignored",
	r,
);
r = await deliver(thin("v2.core.account.updated"), {
	thin: true,
	secret: "whsec_other" + "1".repeat(24),
});
check(r.status === 400, "webhook v2: a forged thin signature is 400", r);
r = await deliver(thin("v2.core.event_destination.ping"), { thin: true });
check(
	r.status === 200 && r.data?.outcome === "ignored",
	"webhook v2: an unknown thin event is 2xx and ignored",
	r,
);
const payoutEvent = (type: string, account: string | null, object: Record<string, unknown>) => ({
	...snapshot(type),
	...(account ? { account } : {}),
	data: { object },
});
r = await deliver(
	payoutEvent("payout.failed", null, {
		id: "po_smoke",
		object: "payout",
		amount: 1000,
		currency: "usd",
	}),
	{
		secret: CONNECT_WHSEC,
	},
);
check(
	r.status === 200 && r.data?.outcome === "ignored",
	"webhook: a delivery signed by the Connect destination verifies, and the platform's own payout is ignored",
	r,
);
r = await deliver(
	payoutEvent("transfer.reversed", null, { id: transfer.id, object: "transfer", currency: "usd" }),
);
check(
	r.status === 200 && r.data?.outcome === "ignored",
	"webhook: a transfer.reversed without its amounts is ignored, never half-applied",
	r,
);
// #endregion

// #region The ledger half, rolled back
const sql = (await Deno.readTextFile(new URL("./stripe-smoke.sql", import.meta.url))).replaceAll(
	"\r",
	"",
);
const psql = new Deno.Command("docker", {
	args: [
		"exec",
		"-i",
		DB_CONTAINER,
		"psql",
		"-U",
		"postgres",
		"-d",
		"postgres",
		"-X",
		"-q",
		"-o",
		"/dev/null",
		"-v",
		`pi=${intent.id}`,
		"-v",
		`tr=${transfer.id}`,
		"-v",
		`tr2=${regrouped.id}`,
	],
	stdin: "piped",
	stdout: "piped",
	stderr: "piped",
}).spawn();
const writer = psql.stdin.getWriter();
await writer.write(new TextEncoder().encode(sql));
await writer.close();
const out = await psql.output();
const log = new TextDecoder().decode(out.stderr).replaceAll("NOTICE:  ", "").trim();
if (log) console.log(log);
check(out.code === 0, "ledger: every database check passed (and was rolled back)");
// #endregion

if (failures > 0) {
	console.error(`\n${failures} check(s) failed.`);
	Deno.exit(1);
}
console.log("\nStripe smoke: all green.");
