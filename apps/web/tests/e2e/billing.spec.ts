/// <reference lib="dom" />
import { assert, assertEquals, assertMatch } from "@std/assert";
import { type Browser, type BrowserContext, chromium, type Page } from "npm:playwright-core@1.56.1";

/**
 * billing.spec — the business Billing module's acceptance journeys (work order BU3, Decision #247),
 * re-runnable: two payable invoices put exactly ONE amber control on the page (the oldest invoice's
 * Pay), every Pay passes through the review (an `alertdialog` that opens on Cancel and moves no money
 * until its commit), a refusal a retry can clear offers "Try again", a refusal it cannot (KYB) leaves
 * Close only and takes the page's Pay away behind a gate, a commit sends exactly one request, and an
 * admin without the billing right is redirected away from the module.
 *
 * It drives a RUNNING dev server on the LIVE local database (`deno task dev`). No seeded business has a
 * payable consolidated invoice (Decision #247 (n)), so the run inserts two for Helia Finance through
 * `docker exec … psql` and deletes them in `finally` (and sweeps any an interrupted run left). Every
 * Pay is answered by a route stub — the real `finance.pay_invoice` is never reached — and every other
 * non-GET API call is aborted, so nothing else is written.
 *
 *   deno test --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys \
 *     apps/web/tests/e2e/billing.spec.ts
 *
 * Environment: `E2E_BASE_URL` (default `http://localhost:13041`), `E2E_PASSWORD` (default the shared
 * dev password documented in Seed.md, read at runtime — never committed), `E2E_CHROMIUM` (a browser
 * executable; else the Playwright-managed Chromium, else installed Chrome), `E2E_DOCKER` (default
 * `docker`; on Windows, where Deno does not resolve a shell's `docker` shim, the full path to
 * `docker.exe`), `E2E_DB_CONTAINER` (default `supabase_db_Projective`).
 */

// #region Configuration
const BASE = Deno.env.get("E2E_BASE_URL") ?? "http://localhost:13041";
const ROOT = new URL("../../../../", import.meta.url);
const DOCKER = Deno.env.get("E2E_DOCKER") ?? "docker";
const CONTAINER = Deno.env.get("E2E_DB_CONTAINER") ?? "supabase_db_Projective";
const BILLING = "/businesses/heliafinance/billing";
/** Helia Finance's owner (the billing right) and an admin without it (Seed.md). */
const OWNER = "priyaraman";
const ADMIN = "hannahcole";
/** The fixture periods: far in the past, so they collide with nothing real and sweep exactly. */
const PERIODS = ["2019-01-28", "2019-02-28"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

/** Run SQL as postgres in the local Supabase container; the tuples-only output lines. */
async function sql(text: string): Promise<string[]> {
	const child = new Deno.Command(DOCKER, {
		args: [
			"exec",
			"-i",
			CONTAINER,
			"psql",
			"-U",
			"postgres",
			"-d",
			"postgres",
			"-v",
			"ON_ERROR_STOP=1",
			"-qAt",
		],
		stdin: "piped",
		stdout: "piped",
		stderr: "piped",
	}).spawn();
	const writer = child.stdin.getWriter();
	await writer.write(new TextEncoder().encode(text));
	await writer.close();
	const out = await child.output();
	if (!out.success) throw new Error(`psql failed: ${new TextDecoder().decode(out.stderr)}`);
	return new TextDecoder().decode(out.stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

const HELIA = "(select id from org.business_profiles where slug = 'heliafinance')";

/** Delete every fixture invoice (this run's or an interrupted one's); how many went. */
async function sweep(): Promise<number> {
	const gone = await sql(
		`delete from finance.invoices where issue_to_business_id = ${HELIA}
			and invoice_type = 'consolidated_monthly'
			and billing_period_start::date in ('${PERIODS[0]}', '${PERIODS[1]}') returning id;`,
	);
	return gone.filter((l) => UUID.test(l)).length;
}

/** Two payable consolidated USD invoices for Helia: US$1,200.00 overdue (older), US$640.00 issued. */
async function insertFixtures(): Promise<string[]> {
	const lines = await sql(`
		insert into finance.invoices (issue_to_business_id, invoice_type, billing_period_start,
			billing_period_end, amount_cents, subtotal_cents, total_cents, amount_due_cents, currency,
			status, due_date, created_at)
		select ${HELIA}, 'consolidated_monthly', p.s::timestamptz, p.e::timestamptz, p.c, p.c, p.c, p.c,
			'USD', p.st, p.d::timestamptz, p.s::timestamptz
		from (values ('${PERIODS[0]}', '${PERIODS[1]}', 120000, 'overdue', '2019-03-14'),
			('${PERIODS[1]}', '2019-03-28', 64000, 'issued', '2019-04-11')) as p(s, e, c, st, d)
		returning id;`);
	return lines.filter((l) => UUID.test(l));
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

/** How the stubbed pay door answers the next commit. */
type PayAnswer = { status: number; body: Record<string, unknown> };

interface Session {
	context: BrowserContext;
	page: Page;
	/** Every invoice id a commit POSTed for, in order. */
	payPosts: string[];
	answer: (next: PayAnswer) => void;
}

/** A signed-in context whose Pay requests are stubbed and whose other API writes are aborted. */
async function signIn(browser: Browser, who: string): Promise<Session> {
	const context = await browser.newContext({
		baseURL: BASE,
		viewport: { width: 1440, height: 960 },
	});
	const payPosts: string[] = [];
	let next: PayAnswer = { status: 503, body: { ok: false, message: "No answer set." } };
	await context.route("**/api/**", async (route) => {
		const req = route.request();
		const path = new URL(req.url()).pathname;
		if (req.method() === "GET" || req.method() === "HEAD" || path.startsWith("/api/auth/")) {
			return await route.continue();
		}
		const pay = /^\/api\/finance\/invoices\/([^/]+)\/pay$/.exec(path);
		if (!pay) return await route.abort();
		payPosts.push(pay[1]);
		return await route.fulfill({
			status: next.status,
			contentType: "application/json",
			body: JSON.stringify(next.body),
		});
	});
	const res = await context.request.post("/api/auth/login", {
		data: { identifier: `${who}@projective.dev`, password: await password() },
	});
	assertEquals(res.status(), 200, `sign-in as ${who} failed (${res.status()})`);
	const page = await context.newPage();
	return { context, page, payPosts, answer: (a) => (next = a) };
}

async function open(page: Page, path: string): Promise<void> {
	await page.goto(path, { waitUntil: "commit" });
	await page.waitForLoadState("domcontentloaded");
	await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

const review = (page: Page) => page.locator("[role=alertdialog]");

async function reviewOpen(page: Page): Promise<boolean> {
	return (await review(page).count()) > 0 && await review(page).first().isVisible();
}

/** Click until the review opens: a click before the island revives does nothing. */
async function openReview(page: Page, selector: string): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await page.locator(selector).first().click({ timeout: 10_000 }).catch(() => {});
		await page.waitForTimeout(600);
		if (await reviewOpen(page)) return;
	}
	throw new Error(`${selector} never opened the review`);
}

async function closed(page: Page): Promise<boolean> {
	for (let i = 0; i < 20; i++) {
		if (!(await reviewOpen(page))) return true;
		await page.waitForTimeout(150);
	}
	return false;
}

/** The text of every VISIBLE amber control under `scope` (the page by default). */
async function ambers(page: Page, scope = "body"): Promise<string[]> {
	return await page.evaluate((root) => {
		const out: string[] = [];
		for (
			const el of Array.from(document.querySelectorAll<HTMLElement>(`${root} .ui-button--accent`))
		) {
			const box = el.getBoundingClientRect();
			if (box.width === 0 || box.height === 0 || el.closest("[hidden],[inert]")) continue;
			out.push((el.textContent ?? "").replace(/\s+/g, " ").trim());
		}
		return out;
	}, scope);
}

const BAND_PAY = ".wsp-billing__next button.ui-button--accent";
const ROW_PAY = "button[aria-label^='Pay US$640.00']";
// #endregion

Deno.test({
	name: "Billing: one amber control, every Pay through the review, final refusals end the Pay",
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		await sweep();
		const browser = await launch();
		let ids: string[] = [];
		try {
			ids = await insertFixtures();
			assertEquals(ids.length, 2, "two fixture invoices");
			const owner = await signIn(browser, OWNER);
			const page = owner.page;
			await open(page, BILLING);

			// #region J1 — two payable invoices: exactly one amber control, on the OLDEST invoice
			await page.locator(BAND_PAY).waitFor({ timeout: 30_000 });
			assertEquals(await ambers(page), ["Pay US$1,200.00"]);
			const rowPay = page.locator(ROW_PAY);
			assertEquals(await rowPay.count(), 1, "one row Pay for the other payable invoice");
			assertMatch(String(await rowPay.getAttribute("class")), /ui-button--text/);
			// #endregion

			// #region J2 — every Pay passes through the review, and nothing moves before its commit
			await openReview(page, BAND_PAY);
			assertEquals(owner.payPosts, [], "opening the review sends nothing");
			const facts = (await review(page).textContent()) ?? "";
			for (
				const fact of ["US$1,200.00", "Helia Finance's wallet", "Balance now", "Balance after"]
			) {
				assert(facts.includes(fact), `the review names ${fact}`);
			}
			assertEquals(await ambers(page, "[role=alertdialog]"), ["Pay US$1,200.00"]);
			await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Cancel");
			await review(page).getByRole("button", { name: "Cancel", exact: true }).click();
			assert(await closed(page), "Cancel closes the review");
			await openReview(page, ROW_PAY);
			assert(((await review(page).textContent()) ?? "").includes("US$640.00"), "the row's review");
			await page.keyboard.press("Escape");
			assert(await closed(page), "Escape closes an idle review");
			assertEquals(owner.payPosts, [], "Cancel and Escape send nothing");
			// #endregion

			// #region A refusal a retry can clear: the review stays, the commit reads Try again
			owner.answer({ status: 503, body: { ok: false, message: "We couldn't reach billing." } });
			await openReview(page, BAND_PAY);
			await review(page).locator(".ui-button--accent").click();
			await review(page).getByText("We couldn't reach billing.").waitFor();
			assertEquals(await ambers(page, "[role=alertdialog]"), ["Try again"]);
			// The commit was disabled in flight (focus fell to the document); the refusal hands it back.
			await page.waitForFunction(
				() =>
					document.activeElement?.closest(".ui-commit-review__actions") != null &&
					document.activeElement.textContent?.trim() === "Try again",
				undefined,
				{ timeout: 5_000 },
			);
			assertEquals(owner.payPosts, [ids[0]], "one request, for the oldest invoice");
			await review(page).getByRole("button", { name: "Cancel", exact: true }).click();
			assert(await closed(page));
			// #endregion

			// #region A refusal it cannot: Close only, and the page's Pay goes behind a gate
			owner.answer({
				status: 403,
				body: { ok: false, message: "kyb_required", details: { reason: "kyb_required" } },
			});
			await openReview(page, BAND_PAY);
			await review(page).locator(".ui-button--accent").click();
			await review(page).getByText("Nothing was paid.").waitFor();
			assertEquals(await ambers(page, "[role=alertdialog]"), [], "no Try again");
			// The commit left with the refusal; focus lands on what replaced it.
			await page.waitForFunction(
				() =>
					document.activeElement?.closest(".ui-commit-review__actions") != null &&
					document.activeElement.textContent?.trim() === "Close",
				undefined,
				{ timeout: 5_000 },
			);
			// The action group's Close — the header's × carries the same name.
			await review(page).locator(".ui-commit-review__actions")
				.getByRole("button", { name: "Close", exact: true }).click();
			assert(await closed(page));
			// (A balance under its floor would now promote Top up to the one amber — not a Pay.)
			assertEquals(
				(await ambers(page)).filter((text) => text.startsWith("Pay")),
				[],
				"the page's Pay went with it",
			);
			assertEquals(await page.locator(ROW_PAY).count(), 0);
			assertEquals(
				await page.locator(".wsp-billing__gate[data-gate=kyb] a").getAttribute("href"),
				"/businesses/heliafinance/verification",
			);
			assertEquals(owner.payPosts.length, 2);
			// #endregion

			// #region The commit: exactly one request, the review closes, the page says so
			await open(page, BILLING);
			owner.answer({ status: 200, body: { ok: true, message: "Invoice paid." } });
			await openReview(page, BAND_PAY);
			await review(page).locator(".ui-button--accent").click();
			assert(await closed(page), "a payment closes the review");
			assertEquals(owner.payPosts, [ids[0], ids[0], ids[0]]);
			await page.getByText("Paid US$1,200.00 from the wallet.", { exact: false }).waitFor();
			await owner.context.close();
			// #endregion

			// #region J4 — an admin without the billing right never reaches the module
			const admin = await signIn(browser, ADMIN);
			const res = await admin.context.request.get(BILLING, { maxRedirects: 0 });
			assertEquals(res.status(), 303);
			assertEquals(
				new URL(res.headers()["location"] ?? "", BASE).pathname,
				"/businesses/heliafinance",
			);
			await admin.context.close();
			// #endregion
		} finally {
			await browser.close();
			// Never assert here: a throw from `finally` would hide the journey's own failure.
			const gone = await sweep();
			if (gone !== ids.length) {
				console.warn(`billing.spec: ${gone} fixture invoices deleted, ${ids.length} inserted`);
			}
		}
	},
});
