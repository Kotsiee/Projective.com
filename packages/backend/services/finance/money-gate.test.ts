import { assert, assertEquals } from "@std/assert";
import {
	type CheckoutApprovalRequest,
	type CreateCheckout,
	type DisputeResolveInput,
	type DisputeRespondInput,
	type FundPaidRevision,
	type SaveBuyerDetails,
	type UpdateBillingInput,
	type WalletActionRequest,
	WalletActionRequestSchema,
	type WalletQuery,
} from "@projective/types/finance";
import type { BasketQuery } from "./basket-query.ts";
import type { ReadActor } from "../read-actor.ts";
import { MONEY_WRITES_OFF, MONEY_WRITES_OFF_CODE } from "./money-gate.ts";
import { BillingBackendService } from "./BillingBackendService.ts";
import { CheckoutBackendService } from "./CheckoutBackendService.ts";
import { DisputeBackendService } from "./DisputeBackendService.ts";
import { OrderBackendService } from "./OrderBackendService.ts";
import { PaymentBackendService } from "./PaymentBackendService.ts";
import { RevisionPurchaseBackendService } from "./revision-purchase.ts";
import { StageFundingBackendService } from "./stage-funding.ts";
import { WalletBackendService } from "./WalletBackendService.ts";
import type { ResolvedOwner } from "./commerce-owner.ts";
import { saveBuyerDetails } from "./live-buyer.ts";
import { fileSpendRequest } from "./wallet-actions.ts";

/**
 * PRD-B3 (LD2): with `FINANCE_BACKEND_LIVE` off, every user-initiated money write a finance service
 * makes answers the money switch's 503 BEFORE it sends a single request — no read, no door, no
 * Stripe call — and a caller with no session is still told to sign in first. Reads stay live.
 *
 * The database is never reached: Supabase is configured (so the switch, not a missing URL, is what
 * refuses), and `fetch` is replaced by a recorder that answers every request with a 500.
 */

// #region Harness
/** Run `fn` with `vars` applied and every outbound request recorded, restoring both afterwards. */
async function offline(
	vars: Record<string, string | undefined>,
	fn: (requests: string[]) => Promise<void>,
): Promise<void> {
	const env: Record<string, string | undefined> = {
		USE_MOCKS: "false",
		VITE_USE_MOCKS: undefined,
		SUPABASE_URL: "http://127.0.0.1:59999",
		SUPABASE_ANON_KEY: "anon-key",
		STRIPE_SECRET_KEY: undefined,
		...vars,
	};
	const prior = new Map<string, string | undefined>();
	for (const key of Object.keys(env)) prior.set(key, Deno.env.get(key));
	const realFetch = globalThis.fetch;
	const requests: string[] = [];
	globalThis.fetch = (input: string | URL | Request) => {
		requests.push(input instanceof Request ? input.url : String(input));
		return Promise.resolve(
			new Response(JSON.stringify({ message: "offline" }), {
				status: 500,
				headers: { "content-type": "application/json" },
			}),
		);
	};
	try {
		for (const [key, value] of Object.entries(env)) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
		await fn(requests);
	} finally {
		globalThis.fetch = realFetch;
		for (const [key, value] of prior) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
	}
}

const ACTOR = {
	userId: "0b6f3c2a-1d4e-4f5a-8b9c-0d1e2f3a4b5c",
	accessToken: "token",
	contextId: "",
	contextType: "personal",
} as ReadActor;
const SIGNED_OUT = { ...ACTOR, userId: "", accessToken: undefined } as unknown as ReadActor;

const QUERY: WalletQuery = { wallet: null, display: null };
const BASKET: BasketQuery = {} as BasketQuery;

const TEAM = "7c2d9e8f-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const BUSINESS = "1e2d3c4b-5a69-4788-9a0b-1c2d3e4f5a6b";
const ID = "3b1d6e0c-1f2a-4c3b-9d4e-5f6a7b8c9d0e";
const KEY = "attempt-0001";

/** One of every `/wallet` action, as `POST /api/wallet/action` parses it. */
const WALLET_ACTIONS: WalletActionRequest[] = [
	{
		action: "top_up",
		scope: "personal",
		contextId: "",
		amountMinor: 5_000,
		currency: "USD",
		methodId: null,
		idempotencyKey: KEY,
	},
	{
		action: "withdraw",
		scope: "personal",
		contextId: "",
		amountMinor: 5_000,
		currency: "USD",
		destinationId: null,
		instant: false,
		idempotencyKey: KEY,
	},
	{
		action: "transfer",
		fromScope: "personal",
		fromId: "",
		toScope: "team",
		toId: TEAM,
		amountMinor: 5_000,
		currency: "USD",
		note: null,
		idempotencyKey: KEY,
	},
	{
		action: "distribute",
		scope: "team",
		contextId: TEAM,
		amountMinor: 5_000,
		currency: "USD",
		idempotencyKey: KEY,
	},
	{
		action: "fund_escrow",
		scope: "business",
		contextId: BUSINESS,
		stageId: ID,
		amountMinor: 5_000,
		currency: "USD",
		fxQuoteId: null,
	},
	{
		action: "new_recurring",
		scope: "personal",
		contextId: "",
		amountMinor: 5_000,
		currency: "USD",
		interval: "monthly",
		sourceMethodId: "pm_1",
	},
	{ action: "add_method", scope: "personal", contextId: "", methodRole: "funding" },
	{
		action: "set_payout",
		scope: "personal",
		contextId: "",
		mode: "scheduled_weekly",
		thresholdMinor: null,
		destinationId: null,
		instant: false,
	},
	{
		action: "request_spend",
		scope: "business",
		contextId: BUSINESS,
		refTable: "project_stages",
		refId: ID,
		amountMinor: 5_000,
		currency: "USD",
		reason: "Stage two",
	},
	{
		action: "spend_decision",
		scope: "business",
		contextId: BUSINESS,
		approvalId: ID,
		decision: "approve",
	},
	{ action: "enrol_smoother", targetMonthlyMinor: 300_000, currency: "USD", enrol: false },
	{ action: "pause_recurring", scope: "personal", contextId: "", ruleId: ID },
	{ action: "resume_recurring", scope: "personal", contextId: "", ruleId: ID },
	{
		action: "edit_recurring",
		scope: "personal",
		contextId: "",
		ruleId: ID,
		amountMinor: 9_000,
		currency: "USD",
	},
	{ action: "archive_recurring", scope: "personal", contextId: "", ruleId: ID },
	{
		action: "save_pot",
		scope: "personal",
		contextId: "",
		currency: "USD",
		potId: null,
		purpose: "tax",
		name: "Tax",
		autoAllocateBp: 2_000,
		goalMinor: null,
	},
	{
		action: "move_pot",
		scope: "personal",
		contextId: "",
		potId: ID,
		direction: "in",
		amountMinor: 5_000,
		currency: "USD",
	},
].map((action) => WalletActionRequestSchema.parse(action));

/** Every other finance write a person can start, each with input that would reach its door. */
const OTHER_WRITES: [
	label: string,
	run: (actor: ReadActor) => Promise<{ status: number; message?: string; details?: unknown }>,
][] = [
	["file a spend request (checkout's door)", () =>
		fileSpendRequest(ACTOR.accessToken!, {
			walletId: ID,
			amountMinor: 5_000,
			reason: "Basket",
			refTable: "baskets",
			refId: ID,
		})],
	["billing settings", (actor) =>
		BillingBackendService.update(
			{
				businessId: BUSINESS,
				autoFundMode: "from_wallet",
				lowBalanceFloorMinor: 10_000,
			} as UpdateBillingInput,
			actor,
		)],
	["pay an invoice", (actor) => BillingBackendService.payInvoice(ID, actor)],
	["place a checkout order", (actor) =>
		CheckoutBackendService.create(
			{ basketId: ID, idempotencyKey: KEY, method: "wallet" } as unknown as CreateCheckout,
			BASKET,
			actor,
		)],
	["ask for a checkout approval", (actor) =>
		CheckoutBackendService.requestApproval(
			{ basketId: ID, reason: "Over the limit" } as unknown as CheckoutApprovalRequest,
			BASKET,
			actor,
		)],
	[
		"respond to a dispute",
		(actor) =>
			DisputeBackendService.respond(
				ID,
				{ statement: "Delivered.", fileIds: [] } as DisputeRespondInput,
				actor,
			),
	],
	["escalate a dispute", (actor) => DisputeBackendService.escalate(ID, actor)],
	[
		"cancel a purchase while it clears",
		(actor) => OrderBackendService.cancelLine("ent-2345678abc", actor),
	],
	["give a session forfeit back", (actor) => OrderBackendService.refundForfeit(ID, actor)],
	[
		"report a problem with a purchase",
		(actor) =>
			DisputeBackendService.reportOrderProblem(
				"ent-2345678abc",
				{ reason: "defective", statement: "It won't open.", fileIds: [] },
				actor,
			),
	],
	["resolve a dispute", (actor) =>
		DisputeBackendService.resolve(
			ID,
			{ outcome: "release", payeeShareBp: null, notes: "Delivered." } as DisputeResolveInput,
			actor,
		)],
	["pay for a revision from the wallet", (actor) =>
		RevisionPurchaseBackendService.fundPaidRevision(
			{ revisionId: ID, method: "wallet", idempotencyKey: KEY } as unknown as FundPaidRevision,
			actor,
		)],
	["fund a stage by card", (actor) =>
		PaymentBackendService.createEscrowLockIntent(
			{ projectId: ID, stageId: ID, idempotencyKey: KEY } as unknown as Parameters<
				typeof PaymentBackendService.createEscrowLockIntent
			>[0],
			actor,
		)],
	["take a prepaid stage back", (actor) =>
		StageFundingBackendService.refundReservation(
			{ project: "prj-2345678abc", ticket: "tkt-2345678abc", stageId: ID },
			actor,
		)],
	["top up by card", (actor) =>
		PaymentBackendService.createTopUpIntent(
			{ walletId: ID, amountMinor: 5_000, currency: "USD", idempotencyKey: KEY },
			actor,
		)],
	["withdraw", (actor) =>
		PaymentBackendService.withdraw({
			walletId: ID,
			amountMinor: 5_000,
			currency: "USD",
			instant: false,
			idempotencyKey: KEY,
			destinationMethodId: null,
		}, actor)],
];

function label(action: WalletActionRequest): string {
	return `wallet ${action.action}`;
}
// #endregion

// #region Off: every write refuses 503 before any request
Deno.test("money switch off: every /wallet action answers 503 before a single request", () =>
	offline({ FINANCE_BACKEND_LIVE: "false" }, async (requests) => {
		for (const action of WALLET_ACTIONS) {
			requests.length = 0;
			const out = await WalletBackendService.perform(action, QUERY, ACTOR);
			assertEquals(
				[out.ok, out.status, out.message],
				[false, 503, MONEY_WRITES_OFF],
				label(action),
			);
			assertEquals(out.details, { code: MONEY_WRITES_OFF_CODE }, label(action));
			assertEquals(requests, [], `${label(action)} sent a request`);
		}
	}));

Deno.test("money switch off: every other finance write answers 503 before a single request", () =>
	offline({ FINANCE_BACKEND_LIVE: "false" }, async (requests) => {
		for (const [what, run] of OTHER_WRITES) {
			requests.length = 0;
			const out = await run(ACTOR);
			assertEquals([out.status, out.message], [503, MONEY_WRITES_OFF], what);
			assertEquals(out.details, { code: MONEY_WRITES_OFF_CODE }, what);
			assertEquals(requests, [], `${what} sent a request`);
		}
	}));

Deno.test("money switch off: an invoicing-terms change at checkout is refused before its door", () =>
	offline({ FINANCE_BACKEND_LIVE: "false" }, async (requests) => {
		const owner = {
			key: `business:${BUSINESS}`,
			ownerType: "business",
			ownerId: BUSINESS,
			isEntity: true,
			actingIsMember: true,
			kybStatus: "verified",
			verificationTier: 3,
			invoicingMode: "per_transaction",
			billingDay: 1,
		} as unknown as ResolvedOwner;
		const out = await saveBuyerDetails(
			owner,
			{ invoicingMode: "intervaled_monthly", billingDay: 1 } as unknown as SaveBuyerDetails,
			ACTOR,
		);
		assertEquals(out, { ok: false, status: 503, message: MONEY_WRITES_OFF });
		assertEquals(requests, []);
	}));
// #endregion

// #region Order: signed in (401) comes before the switch (503)
Deno.test("money switch off: a caller with no session is told to sign in, not that payments are off", () =>
	offline({ FINANCE_BACKEND_LIVE: "false" }, async (requests) => {
		for (const action of WALLET_ACTIONS) {
			const out = await WalletBackendService.perform(action, QUERY, SIGNED_OUT);
			assertEquals([out.ok, out.status], [false, 401], label(action));
		}
		for (const [what, run] of OTHER_WRITES.slice(1)) {
			assertEquals((await run(SIGNED_OUT)).status, 401, what);
		}
		assertEquals(requests, []);
	}));
// #endregion

// #region Reads stay live; on, a write reaches its door
Deno.test("money switch off: the wallet still reads the database (no sample wallet, no refusal)", () =>
	offline({ FINANCE_BACKEND_LIVE: "false" }, async (requests) => {
		const out = await WalletBackendService.overview(QUERY, ACTOR);
		assert(requests.length > 0, "the overview read went to the database");
		assert(out.message !== MONEY_WRITES_OFF, "a read is never refused by the money switch");
	}));

Deno.test("money switch on: each internal move goes on to the database", () =>
	offline({ FINANCE_BACKEND_LIVE: "true" }, async (requests) => {
		const moves = WALLET_ACTIONS.filter((a) =>
			!["top_up", "withdraw", "add_method", "new_recurring"].includes(a.action)
		);
		for (const action of moves) {
			requests.length = 0;
			const out = await WalletBackendService.perform(action, QUERY, ACTOR);
			assert(
				out.message !== MONEY_WRITES_OFF,
				`${label(action)} was refused by the switch while it is on`,
			);
			assert(requests.length > 0, `${label(action)} never reached the database`);
		}
	}));
// #endregion
