import { assertEquals } from "@std/assert";
import type { SettledPayment } from "@features/payments/core/PaymentsService.ts";
import {
	type ExpressReturnIo,
	expressReturnOf,
	expressReturnPath,
	finishSettled,
	PAYMENT_FAILED,
	PAYMENT_PENDING,
	resumeExpressReturn,
	WALLET_NOT_COMPLETED,
} from "./express-return.ts";

// #region Fixtures
const ORIGIN = "https://app.test";
const PAY = "3f2a6c1e-8d4b-4f0a-9c2e-5b7d1a0e6f34";
const KEY = "co_mbk2x9_4f7h2k8q";
const ORDER = "9b1d7e2a-6c3f-4e8b-a0d5-2f4c6e8a1b3d";
const PAGE = "/checkout/payment?basket=bk-1&owner=personal&display=GBP";

/** The address Stripe sends a redirect-based wallet back to, for this page's payment. */
function returned(status = "succeeded", path = PAGE): string {
	const back = new URL(
		expressReturnPath(
			{ pathname: path.split("?")[0], search: `?${path.split("?")[1] ?? ""}`, origin: ORIGIN },
			PAY,
			KEY,
		),
		ORIGIN,
	);
	back.searchParams.set("payment_intent", "pi_3Qx7Lm2eZvKYlo2C1abcDEFg");
	back.searchParams.set("payment_intent_client_secret", "pi_3Qx7Lm2eZvKYlo2C1abcDEFg_secret_x");
	back.searchParams.set("redirect_status", status);
	return back.href;
}

/**
 * A browser for one return: an address bar, the webhook's answer, and a count of every confirmation
 * opened and every order placed. `place` behaves like the real page's wallet order: it re-reads the
 * basket, and a basket the webhook already emptied has nothing left to order.
 */
function browser(settled: SettledPayment, opts: { basketLines?: number } = {}) {
	const calls = {
		opened: [] as string[],
		placed: [] as (string | null)[],
		said: [] as string[],
		settles: 0,
	};
	let href = "";
	const io: ExpressReturnIo = {
		replace: (path) => {
			href = new URL(path, ORIGIN).href;
		},
		settle: () => {
			calls.settles++;
			return Promise.resolve(settled);
		},
		open: (orderId) => {
			calls.opened.push(orderId);
		},
		place: (key) => {
			calls.placed.push(key);
			if ((opts.basketLines ?? 1) === 0) {
				calls.said.push("Nothing is selected for this payment.");
				return Promise.resolve();
			}
			// The order door replays under the attempt's key and the page opens the confirmation.
			calls.opened.push(settled.orderId ?? ORDER);
			return Promise.resolve();
		},
		say: (message) => {
			calls.said.push(message);
		},
	};
	return { io, calls, address: () => href };
}
// #endregion

// #region The return address
Deno.test("a return names its payment and attempt; the clean address keeps the page's own query", () => {
	const back = expressReturnOf(returned());
	assertEquals(back?.paymentId, PAY);
	assertEquals(back?.key, KEY);
	assertEquals(back?.status, "succeeded");
	assertEquals(back?.cleanPath, PAGE);
});

Deno.test("an earlier Stripe return is dropped from the address a new return is built on", () => {
	const path = expressReturnPath(
		{
			pathname: "/checkout/payment",
			search: "?basket=bk-1&redirect_status=failed&payment_intent=pi_1",
			origin: ORIGIN,
		},
		PAY,
		KEY,
	);
	assertEquals(path, `/checkout/payment?basket=bk-1&pay=${PAY}&attempt=${KEY}`);
});

Deno.test("a malformed payment id is no return; a foreign attempt key is dropped", () => {
	assertEquals(expressReturnOf(returned().replace(PAY, "not-a-payment")), null);
	assertEquals(expressReturnOf(`${ORIGIN}${PAGE}&pay=${PAY}`), null);
	assertEquals(expressReturnOf(returned().replace(KEY, "co_X'%3B--")), {
		paymentId: PAY,
		key: null,
		status: "succeeded",
		cleanPath: PAGE,
	});
});
// #endregion

// #region Exactly once
Deno.test("the webhook placed the order first: the return opens THAT order once and places nothing", async () => {
	// A PayPal return races the signed webhook. When the webhook wins, it has placed the order and
	// stamped the basket's lines purchased, so the page the buyer returns to reads an empty basket.
	const run = browser({ outcome: "succeeded", orderId: ORDER }, { basketLines: 0 });
	assertEquals(await resumeExpressReturn(returned(), run.io), "opened");
	assertEquals(run.calls.opened, [ORDER]);
	assertEquals(run.calls.placed, []);
	assertEquals(run.calls.said, []);
});

Deno.test("the browser wins the race: the order is placed under the attempt's own key, once", async () => {
	const run = browser({ outcome: "succeeded", orderId: null });
	assertEquals(await resumeExpressReturn(returned(), run.io), "placed");
	assertEquals(run.calls.placed, [KEY]);
	assertEquals(run.calls.opened.length, 1);
});

Deno.test("the return params leave the address first, so a reload or Back resumes nothing", async () => {
	const run = browser({ outcome: "succeeded", orderId: ORDER });
	await resumeExpressReturn(returned(), run.io);
	assertEquals(run.address(), `${ORIGIN}${PAGE}`);
	assertEquals(await resumeExpressReturn(run.address(), run.io), "none");
	assertEquals(run.calls.settles, 1);
	assertEquals(run.calls.opened, [ORDER]);
});

Deno.test("a failed redirect says so, asks nothing of the webhook and places nothing", async () => {
	const run = browser({ outcome: "succeeded", orderId: ORDER });
	assertEquals(await resumeExpressReturn(returned("failed"), run.io), "failed");
	assertEquals(run.calls.said, [WALLET_NOT_COMPLETED]);
	assertEquals(run.calls.settles, 0);
	assertEquals(run.calls.opened, []);
	assertEquals(run.address(), `${ORIGIN}${PAGE}`);
});

Deno.test("a payment the webhook failed, or has not heard of yet, is said and never ordered", async () => {
	const failed = browser({ outcome: "failed", orderId: null });
	assertEquals(await finishSettled(PAY, KEY, failed.io), "failed");
	assertEquals(failed.calls.said, [PAYMENT_FAILED]);
	const late = browser({ outcome: "timeout", orderId: null });
	assertEquals(await resumeExpressReturn(returned("processing"), late.io), "pending");
	assertEquals(late.calls.said, [PAYMENT_PENDING]);
	assertEquals([...failed.calls.placed, ...late.calls.placed, ...late.calls.opened], []);
});
// #endregion
