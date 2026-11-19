/// <reference lib="dom" />
import { assert, assertEquals } from "@std/assert";
import { type Browser, type BrowserContext, chromium, type Page } from "npm:playwright-core@1.56.1";

/**
 * express-return.spec — a redirect-based wallet's return (PayPal, or any method Stripe sends away and
 * back) lands on the order's confirmation exactly once (work order CK6, Decision #153's resume).
 *
 * The return races the signed webhook, which places a checkout's order itself in the same transaction
 * that settles the payment. Three journeys drive the REAL payment page and its island, with Stripe's
 * side answered by route stubs — so they run without a Stripe key and write nothing:
 *
 *   1. The webhook won: the page opens THAT order's confirmation once and sends no second order.
 *   2. The browser won: the page places the order once, under the attempt's own key, then confirms.
 *   3. The wallet came back `failed`: the page says so, asks nothing and orders nothing — and
 *      the sentence survives the page's own session read, which lands just after it.
 *
 * Each checks the return params left the address first, so Back from the confirmation (or a reload)
 * resumes nothing. Every stubbed answer is the payments route's real shape; every other non-GET API
 * call is aborted.
 *
 * A fourth journey, the PayPal round trip itself in Stripe TEST mode, runs only where the method is
 * offered and a webhook can arrive: `E2E_STRIPE_PAYPAL=1`, a server with `FINANCE_BACKEND_LIVE=true`
 * and test keys, PayPal enabled on the test account for the basket's currency, and `stripe listen
 * --forward-to {E2E_BASE_URL}/api/finance/webhooks/stripe` running. It places a real test-mode order.
 * The runbook is EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md §4.3 F.
 *
 *   deno test --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys \
 *     apps/web/tests/e2e/express-return.spec.ts
 *
 * Environment: `E2E_BASE_URL` (default `http://localhost:13041`, the `web-checkout` launch config on
 * the LIVE local database), `E2E_PASSWORD` (default the shared dev password documented in Seed.md,
 * read at runtime — never committed), `E2E_CHROMIUM` (a browser executable; else the
 * Playwright-managed Chromium, else installed Chrome), `E2E_PAYPAL_PATH` (journey 4's page, default
 * `/checkout/payment`), `E2E_PATIENCE_MS` (how long one step may take, default 120000: a cold dev
 * server compiles the page and its island on the first visit).
 */

// #region Configuration
const BASE = Deno.env.get("E2E_BASE_URL") ?? "http://localhost:13041";
const ROOT = new URL("../../../../", import.meta.url);
/** A buyer with complete saved details, so the payment step renders (Seed.md § Checkout states). */
const BUYER = "noor";
const PAY = "3f2a6c1e-8d4b-4f0a-9c2e-5b7d1a0e6f34";
const KEY = "co_mbk2x9_4f7h2k8q";
const ORDER = "9b1d7e2a-6c3f-4e8b-a0d5-2f4c6e8a1b3d";
const INTENT = "pi_3Qx7Lm2eZvKYlo2C1abcDEFg";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How long a step may take: a cold dev server on a busy machine compiles the page and its island first. */
const PATIENCE = Number(Deno.env.get("E2E_PATIENCE_MS") ?? "120000");
const RETURN_PARAMS = [
	"pay",
	"attempt",
	"payment_intent",
	"payment_intent_client_secret",
	"redirect_status",
];
// #endregion

// #region Harness
async function password(): Promise<string> {
	const env = Deno.env.get("E2E_PASSWORD");
	if (env) return env;
	const seed = await Deno.readTextFile(new URL("documentation/database/Seed.md", ROOT));
	const match = seed.match(/uses the password \*\*`([^`]+)`\*\*/);
	if (!match) throw new Error("Set E2E_PASSWORD: Seed.md no longer documents the dev password.");
	return match[1];
}

async function launch(): Promise<Browser> {
	const executablePath = Deno.env.get("E2E_CHROMIUM");
	if (executablePath) return await chromium.launch({ executablePath, headless: true });
	try {
		return await chromium.launch({ headless: true });
	} catch {
		return await chromium.launch({ channel: "chrome", headless: true });
	}
}

/** How the stubbed payment read answers: the webhook's verdict and the order it placed, if any. */
interface Settled {
	status: "succeeded" | "requires_payment" | "failed";
	orderId: string | null;
}

/** What one journey saw. */
interface Journey {
	context: BrowserContext;
	page: Page;
	/** Every poll of the payment's state. */
	polls: number;
	/** The body of every order the page sent. */
	creates: Record<string, unknown>[];
	/** Every confirmation the browser navigated to. */
	confirmations: string[];
}

/** A signed-in buyer whose payment read and order door are stubbed and whose other writes abort. */
async function journey(browser: Browser, settled: Settled): Promise<Journey> {
	const context = await browser.newContext({
		baseURL: BASE,
		viewport: { width: 1440, height: 960 },
	});
	const seen: Omit<Journey, "context" | "page"> = { polls: 0, creates: [], confirmations: [] };
	await context.route("**/api/**", async (route) => {
		const req = route.request();
		const path = new URL(req.url()).pathname;
		if (path === `/api/finance/payments/${PAY}` && req.method() === "GET") {
			seen.polls++;
			return await route.fulfill({
				contentType: "application/json",
				body: JSON.stringify({
					ok: true,
					data: { payment: { id: PAY, status: settled.status, orderId: settled.orderId } },
				}),
			});
		}
		if (path === "/api/checkout/create" && req.method() === "POST") {
			seen.creates.push(JSON.parse(req.postData() ?? "{}"));
			// The order door replays under the attempt's key: the order the charge already paid for.
			return await route.fulfill({
				contentType: "application/json",
				body: JSON.stringify({
					ok: true,
					data: {
						result: {
							status: "succeeded",
							orderId: ORDER,
							charged: { minor: 0, currency: "AED", display: "AED 0.00", origin: null },
							nextActionUrl: null,
							message: "Order placed.",
							blockers: [],
							walletDelta: null,
							at: new Date().toISOString(),
						},
					},
				}),
			});
		}
		if (req.method() === "GET" || req.method() === "HEAD" || path.startsWith("/api/auth/")) {
			return await route.continue();
		}
		return await route.abort();
	});
	// The confirmation is a GET over the order; a stub stands in, since the stubbed order is not real.
	await context.route("**/checkout/confirmation**", async (route) => {
		if (route.request().resourceType() !== "document") return await route.continue();
		seen.confirmations.push(route.request().url());
		return await route.fulfill({
			contentType: "text/html",
			body: "<!doctype html><title>Confirmation</title><h1>Order confirmed</h1>",
		});
	});
	const res = await context.request.post("/api/auth/login", {
		timeout: PATIENCE,
		// Cloudflare's Turnstile test token; the local GoTrue runs the always-pass test secret (#447).
		data: {
			identifier: `${BUYER}@projective.dev`,
			password: await password(),
			captchaToken: "XXXX.DUMMY.TOKEN.XXXX",
		},
		headers: { origin: new URL(BASE).origin },
	});
	assertEquals(res.status(), 200, `sign-in as ${BUYER} failed (${res.status()})`);
	const page = await context.newPage();
	return Object.assign(seen, { context, page });
}

/** The address Stripe sends the wallet back to: the payment page, its payment, attempt and verdict. */
function returnPath(status: string): string {
	const qs = new URLSearchParams({
		pay: PAY,
		attempt: KEY,
		payment_intent: INTENT,
		payment_intent_client_secret: `${INTENT}_secret_XXXX`,
		redirect_status: status,
	});
	return `/checkout/payment?${qs}`;
}

/** Wait until `test` holds, polling; false when it never did. */
async function until(test: () => boolean | Promise<boolean>, ms = PATIENCE): Promise<boolean> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await test()) return true;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	return false;
}

/** Back from the confirmation: the payment page, with no return param left to resume. */
async function backResumesNothing(j: Journey): Promise<void> {
	const before = {
		polls: j.polls,
		creates: j.creates.length,
		confirmations: j.confirmations.length,
	};
	await j.page.goBack({ waitUntil: "commit" });
	await j.page.waitForLoadState("domcontentloaded");
	const url = new URL(j.page.url());
	assertEquals(url.pathname, "/checkout/payment");
	for (const name of RETURN_PARAMS) {
		assert(!url.searchParams.has(name), `Back still carries ?${name}`);
	}
	await j.page.waitForTimeout(4_000);
	assertEquals(
		{ polls: j.polls, creates: j.creates.length, confirmations: j.confirmations.length },
		before,
		"Back resumed the payment again",
	);
}
// #endregion

const options = { sanitizeOps: false, sanitizeResources: false };

Deno.test({
	name: "Express return: the webhook won — its order's confirmation opens once, no second order",
	...options,
	async fn() {
		const browser = await launch();
		try {
			const j = await journey(browser, { status: "succeeded", orderId: ORDER });
			await j.page.goto(returnPath("succeeded"), { waitUntil: "commit", timeout: PATIENCE });
			assert(
				await until(() => j.confirmations.length > 0),
				"the return never reached the confirmation",
			);
			await j.page.waitForTimeout(2_000);
			assertEquals(j.confirmations.length, 1, "the confirmation opened more than once");
			assertEquals(new URL(j.confirmations[0]).searchParams.get("order"), ORDER);
			assertEquals(j.creates, [], "the page sent an order the webhook had already placed");
			await backResumesNothing(j);
			await j.context.close();
		} finally {
			await browser.close();
		}
	},
});

Deno.test({
	name:
		"Express return: the browser won — one order under the attempt's own key, then its confirmation",
	...options,
	async fn() {
		const browser = await launch();
		try {
			const j = await journey(browser, { status: "succeeded", orderId: null });
			await j.page.goto(returnPath("succeeded"), { waitUntil: "commit", timeout: PATIENCE });
			assert(
				await until(() => j.confirmations.length > 0),
				"the return never reached the confirmation",
			);
			await j.page.waitForTimeout(2_000);
			assertEquals(j.creates.length, 1, "the page placed the order more than once");
			assertEquals(j.creates[0].provider, "wallet");
			assertEquals(
				j.creates[0].idempotencyKey,
				KEY,
				"the order was not placed under the attempt's key",
			);
			assertEquals(j.confirmations.length, 1);
			assertEquals(new URL(j.confirmations[0]).searchParams.get("order"), ORDER);
			await backResumesNothing(j);
			await j.context.close();
		} finally {
			await browser.close();
		}
	},
});

Deno.test({
	name: "Express return: a failed redirect is said, and nothing is asked or ordered",
	...options,
	async fn() {
		const browser = await launch();
		try {
			const j = await journey(browser, { status: "succeeded", orderId: ORDER });
			await j.page.goto(returnPath("failed"), { waitUntil: "commit", timeout: PATIENCE });
			const said = j.page.getByText("The wallet didn't complete the payment. Nothing was charged.");
			await said.waitFor({ timeout: PATIENCE });
			const url = new URL(j.page.url());
			for (const name of RETURN_PARAMS) {
				assert(!url.searchParams.has(name), `the address kept ?${name}`);
			}
			// The page's own session read lands after the return has spoken; the sentence must survive it.
			await j.page.waitForLoadState("networkidle", { timeout: PATIENCE }).catch(() => {});
			await j.page.waitForTimeout(3_000);
			assert(await said.isVisible(), "the page's own read cleared what the return said");
			assertEquals({
				polls: j.polls,
				creates: j.creates.length,
				confirmations: j.confirmations.length,
			}, {
				polls: 0,
				creates: 0,
				confirmations: 0,
			});
			await j.context.close();
		} finally {
			await browser.close();
		}
	},
});

Deno.test({
	name: "Express return: a PayPal round trip in Stripe test mode lands on its confirmation once",
	ignore: Deno.env.get("E2E_STRIPE_PAYPAL") !== "1",
	...options,
	async fn() {
		const browser = await launch();
		try {
			const context = await browser.newContext({
				baseURL: BASE,
				viewport: { width: 1440, height: 960 },
			});
			const res = await context.request.post("/api/auth/login", {
				timeout: PATIENCE,
				data: {
					identifier: `${BUYER}@projective.dev`,
					password: await password(),
					captchaToken: "XXXX.DUMMY.TOKEN.XXXX",
				},
				headers: { origin: new URL(BASE).origin },
			});
			assertEquals(res.status(), 200, `sign-in as ${BUYER} failed (${res.status()})`);
			const confirmations: string[] = [];
			context.on("request", (req) => {
				if (
					req.resourceType() === "document" &&
					new URL(req.url()).pathname === "/checkout/confirmation"
				) {
					confirmations.push(req.url());
				}
			});
			const page = await context.newPage();
			await page.goto(Deno.env.get("E2E_PAYPAL_PATH") ?? "/checkout/payment", {
				waitUntil: "commit",
			});
			const element = page.locator(".cko-xpay__element");
			await element.waitFor({ timeout: PATIENCE });
			assert(
				await until(async () => (await element.getAttribute("data-state")) !== "loading", PATIENCE),
				"the Express Checkout Element never answered",
			);
			assertEquals(
				await element.getAttribute("data-state"),
				"ready",
				"no express wallet is offered here",
			);
			const paypal = page.frameLocator(".cko-xpay__element iframe").getByRole("button", {
				name: /paypal/i,
			});
			await paypal.first().click({ timeout: 30_000 });
			// Stripe's test-mode PayPal page: authorise, and Stripe sends the browser back.
			await page.waitForURL((url) => url.hostname.endsWith("stripe.com"), {
				timeout: 60_000,
				waitUntil: "commit",
			});
			await page.getByText(/authori[sz]e test payment/i).first().click({ timeout: 30_000 });
			await page.waitForURL((url) => url.pathname === "/checkout/confirmation", {
				timeout: 90_000,
				waitUntil: "commit",
			});
			await page.waitForTimeout(3_000);
			assertEquals(confirmations.length, 1, "the confirmation opened more than once");
			assert(
				UUID.test(new URL(page.url()).searchParams.get("order") ?? ""),
				"the confirmation names no order",
			);
			await context.close();
		} finally {
			await browser.close();
		}
	},
});
