/// <reference lib="dom" />
import { assert, assertEquals, assertMatch } from "@std/assert";
import {
	type Browser,
	type BrowserContext,
	chromium,
	type Frame,
	type Page,
} from "npm:playwright-core@1.56.1";

/**
 * ticket-funding.spec — a ticket is bought stage by stage in a real browser, on the live path (work
 * order TK2, Decision #430 (a)): the funding line, the basket paid from the wallet, Buy now's stage
 * picker, and Buy now by card in Stripe TEST mode, with a 3-D Secure challenge and without one.
 *
 *   a. As the client (Hannah Cole, acting as Helia Finance), one stage goes into the basket through the
 *      funding line's picker, the checkout narrowed to the ticket pays it from the business wallet, and
 *      the line reads the money held.
 *   b. On a second ticket, the two later stages are prepaid through Buy now while the stage it sits in
 *      is still unfunded (once that stage is held the line offers nothing more to buy); the client's
 *      line names them, and the seeded freelancer on the project sees them marked, with no amount.
 *   c. Buy now by card. Helia's owner (Priya Raman, the billing right) saves two business cards, one
 *      that asks for 3-D Secure on every use and a plain one; the client pays a stage with each. A card
 *      pays into the wallet first, the signed webhook credits it, and only then is the stage bought
 *      from the wallet. The stage is held, and a reload still says so.
 *   d. Refusals: a short wallet leaves Buy now unpayable and moves nothing; a prepaid stage is marked,
 *      not offered; and the basket door refuses a stage already held.
 *
 * It drives a RUNNING dev server on the LIVE local database (`deno task dev`, FINANCE_BACKEND_LIVE on,
 * Stripe test keys in `.env.local`: the `web-checkout` launch config, port 13041). Each run inserts
 * its own tickets into Helia wallet redesign through `docker exec … psql` (titles start "E2E funding")
 * and leaves them: they hold escrow, and deleting money rows by hand would break the ledger. Run it on
 * a fresh `deno task db:reset`; it re-runs on the same database. Each run takes US$1,500 from Helia
 * Finance's vault (the cards top it up by what they buy) and US$2,500 of Hannah Cole's monthly cap,
 * and leaves two more test cards on Helia's account.
 *
 * The webhook: nothing settles a card on the browser's word. With no `stripe listen` running, the
 * spec is the forwarder: it reads this run's PaymentIntents from `finance.inbound_payments`, fetches
 * their events from Stripe with the test secret key and posts each one to
 * `/api/finance/webhooks/stripe`, signed with `STRIPE_WEBHOOK_SECRET` exactly as the CLI signs a
 * forwarded delivery. A `stripe listen` running beside it is harmless: the endpoint is idempotent on
 * the event id. Only `sk_test_` / `rk_test_` keys are accepted; a live key stops the run.
 *
 *   deno task test:e2e:funding
 *
 * Environment: `E2E_BASE_URL` (default `http://127.0.0.1:13041`), `E2E_PASSWORD` (default the shared
 * dev password documented in Seed.md, read at runtime — never committed), `E2E_CHROMIUM` (a browser
 * executable; else the Playwright-managed Chromium, else installed Chrome), `E2E_DOCKER` (default
 * `docker`), `E2E_DB_CONTAINER` (default `supabase_db_Projective`), `E2E_PATIENCE_MS` (how long one
 * step may take, default 180000: a cold dev server compiles the board and its islands first),
 * `E2E_SHOTS` (a directory: every step is then captured at 1440 and 390 px, light and dark),
 * `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (else read from `.env.local`, never printed).
 */

// #region Configuration
const BASE = Deno.env.get("E2E_BASE_URL") ?? "http://127.0.0.1:13041";
const ROOT = new URL("../../../../", import.meta.url);
const DOCKER = Deno.env.get("E2E_DOCKER") ?? "docker";
const CONTAINER = Deno.env.get("E2E_DB_CONTAINER") ?? "supabase_db_Projective";
const PATIENCE = Number(Deno.env.get("E2E_PATIENCE_MS") ?? "180000");
const SHOTS = Deno.env.get("E2E_SHOTS") ?? null;
const TRACE = Deno.env.get("E2E_TRACE") === "1";
/** Helia wallet redesign: three stages, Helia Finance pays (Seed.md). */
const PROJECT = "prj-6ndtxa9u9x";
/** The client who runs it, and the freelancer on its Discovery stage. */
const CLIENT = "hannahcole";
const FREELANCER = "marisdelacroix";
/** Helia Finance's owner: the billing right that saves a business card (Seed.md). */
const BILLING_OWNER = "priyaraman";
/** Every fixture stage costs US$500.00; the short-wallet ticket costs more than the vault holds. */
const PRICE_CENTS = 50_000;
const SHORT_PRICE_CENTS = 2_000_000;
const RUN = Date.now().toString(36);
/** Stripe test cards: 3-D Secure on every charge, even once saved; and one that just succeeds. */
const CARD_3DS = "4000002760003184";
const CARD_PLAIN = "4242424242424242";
const VARIANTS = [
	{ width: 1440, height: 960, scheme: "light" },
	{ width: 1440, height: 960, scheme: "dark" },
	{ width: 390, height: 844, scheme: "light" },
	{ width: 390, height: 844, scheme: "dark" },
] as const;
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

/** A Stripe secret from the environment, else `.env.local`; a live key refuses the run. */
async function stripeSecret(name: "STRIPE_SECRET_KEY" | "STRIPE_WEBHOOK_SECRET"): Promise<string> {
	let value = Deno.env.get(name) ?? "";
	if (!value) {
		const local = await Deno.readTextFile(new URL(".env.local", ROOT)).catch(() => "");
		const line = local.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
		value = (line?.slice(name.length + 1) ?? "").trim().replace(/^["']|["']$/g, "");
	}
	if (!value) throw new Error(`Set ${name} (Stripe test mode) to run this spec.`);
	if (name === "STRIPE_SECRET_KEY" && !/^(sk|rk)_test_/.test(value)) {
		throw new Error(
			"STRIPE_SECRET_KEY is not a test key: this spec runs in Stripe test mode only.",
		);
	}
	return value;
}

/**
 * Run SQL as postgres in the local Supabase container; the tuples-only output lines. A Docker client
 * that cannot even start (a machine short of memory for a moment) is retried; a failing statement is
 * not.
 */
async function sql(text: string): Promise<string[]> {
	for (let attempt = 1;; attempt++) {
		let failure: string;
		try {
			const child = spawnPsql();
			const writer = child.stdin.getWriter();
			await writer.write(new TextEncoder().encode(text));
			await writer.close();
			const out = await child.output();
			const stdout = new TextDecoder().decode(out.stdout);
			if (out.success) return stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
			failure = new TextDecoder().decode(out.stderr);
			if (!/cannot allocate memory|paging file/i.test(failure)) {
				throw new Error(`psql failed: ${failure}`);
			}
		} catch (error) {
			if (String(error).startsWith("Error: psql failed")) throw error;
			failure = String(error);
		}
		if (attempt >= 5) throw new Error(`psql could not run: ${failure}`);
		await new Promise((r) => setTimeout(r, 3000 * attempt));
	}
}

function spawnPsql(): Deno.ChildProcess {
	return new Deno.Command(DOCKER, {
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
}

/**
 * A payable ticket on all three of the project's stages, sitting in the first, unclaimed: what a client
 * writes on the board. Its slug.
 */
async function insertTicket(label: string, unitPriceCents: number): Promise<string> {
	const [slug] = await sql(`
		with p as (select id, owner_user_id from projects.projects where slug = '${PROJECT}'),
		s as (
			select jsonb_agg(jsonb_build_object('order', sort_order - 1, 'stage_id', id) order by sort_order) as stages,
				(array_agg(id order by sort_order))[1] as first
			from projects.project_stages where project_id = (select id from p)
		)
		insert into projects.tickets (project_id, owner_user_id, title, description, text_description,
			status, required_stages, unit_price_cents, current_stage_id)
		select p.id, p.owner_user_id, 'E2E funding ${RUN} · ${label}',
			jsonb_build_object('text', 'A three-stage ticket the funding e2e buys stage by stage.'),
			'A three-stage ticket the funding e2e buys stage by stage.', 'todo', s.stages, ${unitPriceCents},
			s.first
		from p, s
		returning slug;`);
	assertMatch(slug ?? "", /^tkt-[a-z0-9]{10}$/, `fixture ticket ${label}`);
	return slug;
}

/** Each of the ticket's escrows as `status:stage slug`, in stage order. */
async function escrowsOf(slug: string): Promise<string[]> {
	return await sql(`
		select e.status || ':' || s.slug from finance.escrows e
		join projects.tickets t on t.id = e.ticket_id
		join projects.project_stages s on s.id = e.project_stage_id
		where t.slug = '${slug}' order by s.sort_order, e.created_at;`);
}

/** Helia Finance's vault balance, in cents. */
async function vaultCents(): Promise<number> {
	const [cents] = await sql(`
		select w.balance_cents from finance.wallets w
		join org.business_profiles b on b.id = w.owner_id
		where b.slug = 'heliafinance' and w.owner_type = 'business' and w.currency = 'USD';`);
	return Number(cents);
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

/**
 * A signed-in context and its page. With `business`, the person acts as that business (the account
 * popover's context switch): a business project's basket and wallet are the business's, so in the
 * personal context Add to basket answers "This project belongs to another account."
 */
async function signIn(
	browser: Browser,
	who: string,
	business?: string,
): Promise<{ context: BrowserContext; page: Page }> {
	const context = await browser.newContext({
		baseURL: BASE,
		viewport: { width: 1440, height: 960 },
		colorScheme: "light",
	});
	const res = await context.request.post("/api/auth/login", {
		// Cloudflare's Turnstile test token; the local GoTrue runs the always-pass test secret (#447).
		data: {
			identifier: `${who}@projective.dev`,
			password: await password(),
			captchaToken: "XXXX.DUMMY.TOKEN.XXXX",
		},
		// The `/api` write guard wants this site's Origin, which a browser would send.
		headers: { origin: new URL(BASE).origin },
	});
	assertEquals(res.status(), 200, `sign-in as ${who} failed (${res.status()})`);
	if (business) {
		const [id] = await sql(`select id from org.business_profiles where slug = '${business}';`);
		const acting = await context.request.post("/api/context/switch", {
			data: { contextType: "business", contextId: id },
			headers: { origin: new URL(BASE).origin },
		});
		assertEquals(acting.status(), 200, `${who} could not act as ${business} (${acting.status()})`);
	}
	const page = await context.newPage();
	page.setDefaultTimeout(PATIENCE);
	return { context, page };
}

/** With `E2E_TRACE=1`, say where the run is: a slow server can hold one step for minutes. */
function trace(what: string): void {
	if (TRACE) console.log(`[${new Date().toISOString().slice(11, 19)}] ${what}`);
}

async function open(page: Page, path: string): Promise<void> {
	trace(`open ${path}`);
	await page.goto(path, { waitUntil: "commit", timeout: PATIENCE });
	await page.waitForLoadState("domcontentloaded", { timeout: PATIENCE });
	await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
}

/** The ticket's own address: its modal over the project board (ROUTING `?tkv=`). */
const ticketPath = (slug: string) => `/projects/${PROJECT}/board?tkv=${slug}`;

/** The open ticket modal's funding line. */
const fundingLine = (page: Page) => page.locator(".tkv .fst").first();

/** Open the ticket and wait for its funding line to say `expected`. */
async function openTicket(page: Page, slug: string, expected: RegExp): Promise<string> {
	await open(page, ticketPath(slug));
	return await lineSays(page, expected);
}

/** Wait until the funding line's sentence matches; the sentence. */
async function lineSays(page: Page, expected: RegExp): Promise<string> {
	trace(`the funding line should say ${expected}`);
	const line = fundingLine(page).locator(".fst__line");
	await line.waitFor({ timeout: PATIENCE });
	let text = "";
	const until = Date.now() + PATIENCE;
	while (Date.now() < until) {
		text = ((await line.textContent()) ?? "").replace(/\s+/g, " ").trim();
		if (expected.test(text)) return text;
		await page.waitForTimeout(500);
	}
	throw new Error(`the funding line read "${text}", not ${expected}`);
}

/** Click until `ready` holds: a click before the island revives does nothing. */
async function clickUntil(
	page: Page,
	selector: string,
	ready: () => Promise<boolean>,
): Promise<void> {
	trace(`click ${selector}`);
	const until = Date.now() + PATIENCE;
	while (Date.now() < until) {
		await page.locator(selector).first().click({ timeout: 10_000 }).catch(() => {});
		for (let i = 0; i < 8; i++) {
			await page.waitForTimeout(250);
			if (await ready()) return;
		}
	}
	throw new Error(`${selector} never did what it should`);
}

const buyNow = (page: Page) => page.locator(".bnow-split");
const commit = (page: Page) => buyNow(page).locator(".bnow__commit");

/** Open Buy now from the funding line and wait for it to price the default selection. */
async function openBuyNow(page: Page): Promise<void> {
	await clickUntil(
		page,
		".tkv .fst button:has-text('Buy now')",
		async () => (await buyNow(page).count()) > 0 && await buyNow(page).isVisible(),
	);
	await page.waitForFunction(
		() => /^Buy now · /.test(document.querySelector(".bnow__commit")?.textContent?.trim() ?? ""),
		undefined,
		{ timeout: PATIENCE },
	);
}

/** Tick exactly `names` in a stage picker (`scope` holds it). */
async function chooseStages(page: Page, scope: string, names: readonly string[]): Promise<void> {
	const rows = page.locator(`${scope} .stp__row[data-fundable=true]`);
	for (let i = 0; i < await rows.count(); i++) {
		const row = rows.nth(i);
		const name = ((await row.locator(".stp__name").textContent()) ?? "").trim();
		const box = row.locator("input[type=checkbox]");
		if ((await box.isChecked()) !== names.includes(name)) await row.locator(".stp__name").click();
	}
	for (const name of names) {
		assert(
			await page.locator(`${scope} .stp__row:has(.stp__name:text-is("${name}")) input:checked`)
				.count() === 1,
			`${name} is ticked`,
		);
	}
}

/** Choose a payment route in Buy now ("Projective Wallet" or "Credit / Debit Card"). */
async function chooseRoute(page: Page, name: string): Promise<void> {
	const radio = buyNow(page).getByRole("radio", { name: new RegExp(`^${name}`) }).first();
	await radio.click();
	await page.waitForFunction(
		(label) =>
			Array.from(document.querySelectorAll(".bnow-split [role=radio][aria-checked=true]"))
				.some((el) => (el.textContent ?? "").includes(label)),
		name,
		{ timeout: PATIENCE },
	);
}

/** Wait until Buy now has priced the selection and its commit can be pressed. */
async function payable(page: Page): Promise<void> {
	await page.waitForFunction(
		() => {
			const button = document.querySelector<HTMLButtonElement>(".bnow__commit");
			return !!button && !button.disabled && /^Buy now · /.test(button.textContent?.trim() ?? "");
		},
		undefined,
		{ timeout: PATIENCE },
	);
}

/** Wait for Buy now to settle and close, the way a ticket's purchase ends. */
async function buyNowClosed(page: Page): Promise<void> {
	await buyNow(page).waitFor({ state: "detached", timeout: PATIENCE });
}

/**
 * Run one journey as a test step. On failure the page is captured (`E2E_SHOTS`) and the funding line
 * and any dialog are printed, so a failure on a slow server says where it stopped. Whether it passed.
 */
async function journey(
	t: Deno.TestContext,
	name: string,
	page: Page,
	fn: () => Promise<void>,
): Promise<boolean> {
	return await t.step(name, async () => {
		try {
			await fn();
		} catch (error) {
			const at = await page.evaluate(() => ({
				url: location.pathname + location.search,
				line: document.querySelector(".fst__line")?.textContent ?? null,
				dialog: (document.querySelector("[role=dialog], [role=alertdialog]") as HTMLElement | null)
					?.innerText.slice(0, 600) ?? null,
			})).catch(() => null);
			console.error(`${name} stopped at ${JSON.stringify(at)}`);
			if (SHOTS) {
				await Deno.mkdir(SHOTS, { recursive: true });
				await page.screenshot({ path: `${SHOTS}/failure-${name.slice(0, 1)}.png` }).catch(() => {});
			}
			await page.setViewportSize({ width: VARIANTS[0].width, height: VARIANTS[0].height });
			await page.emulateMedia({ colorScheme: VARIANTS[0].scheme });
			throw error;
		}
	});
}

/**
 * Capture the page at every variant, then put the first one back. A resize closes a popover, so a
 * step that shoots one passes `restore`, which reopens it after every change.
 */
async function shoot(page: Page, step: string, restore?: () => Promise<void>): Promise<void> {
	trace(`shoot ${step}`);
	if (!SHOTS) return;
	await Deno.mkdir(SHOTS, { recursive: true });
	for (const [i, v] of [...VARIANTS, VARIANTS[0]].entries()) {
		await page.setViewportSize({ width: v.width, height: v.height });
		await page.emulateMedia({ colorScheme: v.scheme });
		await page.waitForFunction(
			(mode) => document.documentElement.dataset.theme === mode,
			v.scheme,
			{
				timeout: 10_000,
			},
		).catch(() => {});
		if (restore) await restore();
		await settled(page);
		if (i < VARIANTS.length) {
			await page.screenshot({ path: `${SHOTS}/${step}__${v.width}-${v.scheme}.png` });
		}
	}
}

/** Wait for the theme's colour transition to finish: the page's colours stop moving. */
async function settled(page: Page): Promise<void> {
	let last = "";
	for (let i = 0; i < 20; i++) {
		const now = await page.evaluate(() =>
			Array.from(document.querySelectorAll("body, .tkv, .bnow-split, .cko, .fst__line"))
				.map((el) => getComputedStyle(el).backgroundColor + getComputedStyle(el).color).join("|")
		).catch(async () => {
			await page.waitForLoadState("domcontentloaded");
			return "";
		});
		if (now === last) return;
		last = now;
		await page.waitForTimeout(300);
	}
}
// #endregion

// #region Stripe (test mode)
/**
 * Save a card through the page's Add a payment method: Stripe's Payment Element, then, for a card
 * that asks, its 3-D Secure challenge. A business card needs the billing right (Decision #153), so
 * the business's owner saves it; anyone who may spend from the business then pays with it.
 */
async function saveCard(page: Page, number: string): Promise<void> {
	await page.getByRole("button", { name: "Add a payment method" }).first().click();
	const frame = await cardFrame(page);
	await frame.locator("input[name=number]").fill(number);
	await frame.locator("input[name=expiry]").fill("12 / 34");
	await frame.locator("input[name=cvc]").fill("123");
	const postal = frame.locator("input[name=postalCode]");
	if (await postal.count()) await postal.fill("10001");
	await page.getByRole("button", { name: "Save card", exact: true }).click();
	const until = Date.now() + PATIENCE;
	while (Date.now() < until) {
		await approveChallengeIfAsked(page, 2_500);
		const open = await page.locator("[role=dialog]", { hasText: "Add a payment method" }).count();
		if (open === 0) return;
	}
	throw new Error(`the card ending ${number.slice(-4)} was never saved`);
}

/** The frame Stripe's Payment Element draws its card fields in. */
async function cardFrame(page: Page): Promise<Frame> {
	const until = Date.now() + PATIENCE;
	while (Date.now() < until) {
		for (const frame of page.frames()) {
			if (await frame.locator("input[name=number]").count().catch(() => 0)) return frame;
		}
		await page.waitForTimeout(500);
	}
	throw new Error("Stripe's card fields never loaded");
}

/** In Buy now, pay with the saved card ending `last4`. */
async function chooseCard(page: Page, last4: string): Promise<void> {
	const card = buyNow(page).locator(".cko-cardlist [role=radio]", { hasText: last4 }).first();
	await card.click();
	await page.waitForFunction(
		(digits) =>
			Array.from(document.querySelectorAll(".bnow-split .cko-cardlist [role=radio]"))
				.some((el) =>
					el.getAttribute("aria-checked") === "true" && (el.textContent ?? "").includes(digits)
				),
		last4,
		{ timeout: PATIENCE },
	);
}

/**
 * Approve Stripe's test 3-D Secure challenge if one shows within `within` ms, and any that follows it
 * (Stripe can draw a second frame), until none has shown for three seconds; whether one did.
 */
async function approveChallengeIfAsked(page: Page, within: number): Promise<boolean> {
	let approved = false;
	let quietSince = Date.now();
	const until = Date.now() + within;
	while (Date.now() < until && !(approved && Date.now() - quietSince > 3_000)) {
		for (const frame of page.frames()) {
			const approve = frame.locator("#test-source-authorize-3ds");
			if (await approve.count().catch(() => 0)) {
				if (SHOTS && !approved) {
					await page.screenshot({ path: `${SHOTS}/challenge-${Date.now()}.png` }).catch(() => {});
				}
				await approve.click().catch(() => {});
				approved = true;
				quietSince = Date.now();
			}
		}
		await page.waitForTimeout(500);
	}
	return approved;
}

/**
 * Forward this run's PaymentIntent events from Stripe to the local webhook, signed as the CLI signs a
 * forwarded delivery, until `stop` is called. Each event is posted once. A failed round (Docker or
 * Stripe briefly unreachable) is retried on the next; `stop` reports how many were posted.
 */
function forwardWebhooks(since: number): { stop: () => Promise<number> } {
	let running = true;
	const posted = new Set<string>();
	const loop = (async () => {
		const key = await stripeSecret("STRIPE_SECRET_KEY");
		const secret = await stripeSecret("STRIPE_WEBHOOK_SECRET");
		const hmac = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		const round = async () => {
			const refs = new Set(
				await sql(`
					select provider_ref from finance.inbound_payments
					where provider_ref like 'pi\\_%' and created_at >= to_timestamp(${since});`),
			);
			if (refs.size > 0) {
				const res = await fetch(
					`https://api.stripe.com/v1/events?limit=100&created[gte]=${since}` +
						"&types[]=payment_intent.succeeded&types[]=payment_intent.payment_failed",
					{ headers: { authorization: `Bearer ${key}` } },
				);
				const list = await res.json() as {
					data?: { id: string; data: { object: { id: string } } }[];
				};
				for (const event of list.data ?? []) {
					if (posted.has(event.id) || !refs.has(event.data.object.id)) continue;
					const payload = JSON.stringify(event);
					const t = Math.floor(Date.now() / 1000);
					const mac = new Uint8Array(
						await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(`${t}.${payload}`)),
					);
					const v1 = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
					const sent = await fetch(`${BASE}/api/finance/webhooks/stripe`, {
						method: "POST",
						headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${v1}` },
						body: payload,
					});
					await sent.body?.cancel();
					if (sent.ok) posted.add(event.id);
				}
			}
		};
		while (running) {
			await round().catch((error) => console.warn(`webhook forwarder: ${error}`));
			await new Promise((r) => setTimeout(r, 2000));
		}
	})();
	return {
		stop: async () => {
			running = false;
			await loop;
			return posted.size;
		},
	};
}
// #endregion

Deno.test({
	name: "Ticket funding: the basket by wallet, prepaid stages, Buy now by card, and the refusals",
	sanitizeOps: false,
	sanitizeResources: false,
	async fn(t) {
		const since = Math.floor(Date.now() / 1000) - 5;
		const browser = await launch();
		let forwarded = 0;
		try {
			const [stages, slugA, slugB, slugCard3ds, slugCardPlain, slugShort, slugE] = await Promise
				.all([
					sql(
						`select name from projects.project_stages s join projects.projects p on p.id = s.project_id
					where p.slug = '${PROJECT}' order by s.sort_order;`,
					),
					insertTicket("A", PRICE_CENTS),
					insertTicket("B", PRICE_CENTS),
					insertTicket("card 3DS", PRICE_CENTS),
					insertTicket("card", PRICE_CENTS),
					insertTicket("short", SHORT_PRICE_CENTS),
					insertTicket("prepaid only", PRICE_CENTS),
				]);
			assertEquals(stages.length, 3, "Helia wallet redesign runs through three stages");
			const [first, second, third] = stages;
			const [helia] = await sql(
				`select id from org.business_profiles where slug = 'heliafinance';`,
			);
			trace("fixtures inserted; signing in");
			const client = await signIn(browser, CLIENT, "heliafinance");
			const page = client.page;

			const a = await journey(
				t,
				"a. one stage goes into the basket and the wallet pays it: held",
				page,
				async () => {
					await openTicket(page, slugA, /^Fund US\$500\.00 /);
					await shoot(page, "a1-needs-funding");
					const before = await vaultCents();

					const openPicker = async () => {
						await clickUntil(
							page,
							".tkv .fst button:has-text('Add to basket')",
							async () => (await page.locator(".stbp .stp__row").count()) === 3,
						);
						await chooseStages(page, ".stbp", [first]);
					};
					await openPicker();
					// A resize closes the popover: the shot reopens it.
					await shoot(page, "a2-basket-picker", async () => {
						if (!(await page.locator(".stbp").isVisible().catch(() => false))) await openPicker();
					});
					const [added] = await Promise.all([
						page.waitForResponse((r) =>
							new URL(r.url()).pathname === "/api/basket/item" && r.request().method() === "POST"
						),
						page.locator(".stbp__foot button:has-text('Add to basket')").click(),
					]);
					const body = await added.json() as { ok: boolean; data?: { basket?: { id: string } } };
					assert(body.ok, "the line landed");

					// The checkout narrowed to this ticket's lines (`checkoutHref`), paid from the wallet.
					const basket = body.data?.basket?.id;
					assert(basket, "the add names its basket");
					await open(
						page,
						`/checkout/payment?basket=${basket}&owner=business:${helia}&ticket_id=${slugA}`,
					);
					const buy = page.locator(".cko-rail__buy");
					const payFromWallet = async () => {
						await buy.waitFor({ timeout: PATIENCE });
						await page.getByRole("radio", { name: /^Projective Wallet/ }).first().click();
						// Only this ticket's stage is in the charge: the rest of the basket stays out.
						await page.waitForFunction(
							() =>
								/^Buy Now · US\$500\.00$/.test(
									document.querySelector(".cko-rail__buy")?.textContent?.trim() ?? "",
								),
							undefined,
							{ timeout: PATIENCE },
						);
					};
					await payFromWallet();
					await shoot(page, "a3-checkout-payment", payFromWallet);
					await clickUntil(
						page,
						".cko-rail__buy",
						async () =>
							(await page.locator(".cko-confirm").count()) > 0 &&
							await page.locator(".cko-confirm").isVisible(),
					);
					await page.locator(".cko-confirm").getByRole("button", { name: "Pay US$500.00" }).click();
					await page.waitForURL(/\/checkout\/confirmation/, { timeout: PATIENCE });

					assertEquals(await escrowsOf(slugA), [`held:${await stageSlug(0)}`]);
					assertEquals(before - await vaultCents(), PRICE_CENTS, "the wallet paid the stage");
					await openTicket(page, slugA, /held in escrow/);
					await shoot(page, "a4-held");
				},
			);

			const b = await journey(
				t,
				"b. a stage is held and two later ones prepaid in one Buy now; the freelancer sees the marks",
				page,
				async () => {
					const before = await vaultCents();
					await openTicket(page, slugB, /^Fund US\$500\.00 /);
					const prepay = async () => {
						if (await buyNow(page).isVisible().catch(() => false)) return;
						await openBuyNow(page);
						await chooseStages(page, ".bnow-split", [first, second, third]);
						await chooseRoute(page, "Projective Wallet");
						await page.locator(".bnow-split .stp__terms").waitFor({ timeout: PATIENCE });
						await payable(page);
					};
					await prepay();
					await shoot(page, "b1-prepay-buy-now", prepay);
					await commit(page).click();
					await buyNowClosed(page);

					const prepaid = new RegExp(`${second} and ${third} are prepaid\\.`);
					const line = await lineSays(page, prepaid);
					assertMatch(line, /held in escrow/, "the stage it sits in is held");
					assertEquals(await escrowsOf(slugB), [
						`held:${await stageSlug(0)}`,
						`reserved:${await stageSlug(1)}`,
						`reserved:${await stageSlug(2)}`,
					]);
					assertEquals(before - await vaultCents(), 3 * PRICE_CENTS, "the wallet paid all three");
					// The payer may take each prepaid stage back while the ticket has not reached it (#556).
					for (const name of [second, third]) {
						await fundingLine(page).getByRole("button", { name: `Refund ${name}` }).waitFor();
					}
					await shoot(page, "b2-client-prepaid");

					const freelancer = await signIn(browser, FREELANCER);
					try {
						const seen = await openTicket(freelancer.page, slugB, prepaid);
						assert(!/US\$1,000/.test(seen), "the payee is told which stages, never how much");
						assertEquals(
							await fundingLine(freelancer.page).getByRole("button", { name: /^Refund / }).count(),
							0,
							"only the payer can take a prepaid stage back",
						);
						await shoot(freelancer.page, "b3-freelancer-prepaid");
					} catch (error) {
						if (SHOTS) {
							await freelancer.page.screenshot({ path: `${SHOTS}/failure-b-freelancer.png` })
								.catch(() => {});
						}
						throw error;
					} finally {
						await freelancer.context.close();
					}
				},
			);

			const c = await journey(
				t,
				"c. Buy now by card: 3-D Secure, then a plain card; held after the webhook",
				page,
				async () => {
					const webhooks = forwardWebhooks(since);
					try {
						// The business's owner keeps its cards (the billing right); the 3-D Secure card is
						// challenged when it is saved and again when it is charged.
						const billing = await signIn(browser, BILLING_OWNER, "heliafinance");
						try {
							await open(billing.page, `/checkout/payment?owner=business:${helia}`);
							await billing.page.getByRole("radio", { name: /^Credit \/ Debit Card/ }).first()
								.click();
							await saveCard(billing.page, CARD_3DS);
							await saveCard(billing.page, CARD_PLAIN);
						} finally {
							await billing.context.close();
						}

						for (
							const [slug, number, label] of [
								[slugCard3ds, CARD_3DS, "c1-card-3ds"],
								[slugCardPlain, CARD_PLAIN, "c2-card-plain"],
							] as const
						) {
							const before = await vaultCents();
							await openTicket(page, slug, /^Fund US\$500\.00 /);
							const choose = async () => {
								if (await buyNow(page).isVisible().catch(() => false)) return;
								await openBuyNow(page);
								await chooseRoute(page, "Credit / Debit Card");
								await chooseCard(page, number.slice(-4));
								await payable(page);
							};
							await choose();
							await shoot(page, `${label}-chosen`, choose);
							await commit(page).click();
							const challenged = await approveChallengeIfAsked(
								page,
								number === CARD_3DS ? PATIENCE : 10_000,
							);
							assertEquals(challenged, number === CARD_3DS, `${label}: challenged only if it asks`);
							// The modal closes once the webhook credited the wallet and the order placed.
							await buyNowClosed(page);
							await lineSays(page, /held in escrow/);
							assertEquals(await escrowsOf(slug), [`held:${await stageSlug(0)}`]);
							assertEquals(await vaultCents(), before, `${label}: the card paid, not the wallet`);
							await shoot(page, `${label}-held`);

							await page.reload({ waitUntil: "commit" });
							await lineSays(page, /held in escrow/);
						}
						await shoot(page, "c3-reloaded");
					} finally {
						forwarded = await webhooks.stop();
					}
				},
			);

			const d = await journey(
				t,
				"d. a short wallet and a paid-for stage are refused, and nothing moves",
				page,
				async () => {
					const before = await vaultCents();
					await openTicket(page, slugShort, /^Fund US\$20,000\.00 /);
					const short = async () => {
						if (await buyNow(page).isVisible().catch(() => false)) return;
						await openBuyNow(page);
						// The wallet may refuse to be chosen at all; its reason is what the buyer reads.
						await buyNow(page).getByRole("radio", { name: /^Projective Wallet/ }).first().click();
						await buyNow(page).getByText(/short\. Top up to pay from the wallet\./).first()
							.waitFor({ timeout: PATIENCE });
					};
					await short();
					assert(await commit(page).isDisabled(), "Buy now cannot be pressed");
					await shoot(page, "d1-wallet-short", short);
					await buyNow(page).getByRole("button", { name: "Cancel", exact: true }).click();
					await buyNowClosed(page);

					// One later stage prepaid alone: Buy now then marks it and offers only the other two.
					await openTicket(page, slugE, /^Fund US\$500\.00 /);
					await openBuyNow(page);
					await chooseStages(page, ".bnow-split", [third]);
					await chooseRoute(page, "Projective Wallet");
					await payable(page);
					await commit(page).click();
					await buyNowClosed(page);
					await lineSays(page, new RegExp(`${third} is prepaid\\.`));
					const picker = async () => {
						if (await buyNow(page).isVisible().catch(() => false)) return;
						await openBuyNow(page);
					};
					await picker();
					assertEquals(await buyNow(page).locator(".stp__row[data-fundable=true]").count(), 2);
					assertEquals(
						await buyNow(page).locator(".stp__row[data-phase=prepaid][data-fundable=false]")
							.count(),
						1,
						"the prepaid stage is marked, with nothing to tick",
					);
					await shoot(page, "d2-not-fundable", picker);
					await buyNow(page).getByRole("button", { name: "Cancel", exact: true }).click();
					await buyNowClosed(page);

					// The basket door refuses a stage already paid for, whatever a page offers.
					const [ticketA] = await sql(`select id from projects.tickets where slug = '${slugA}';`);
					const refused = await client.context.request.post("/api/basket/item", {
						data: {
							basketId: null,
							itemType: "project_ticket",
							itemId: PROJECT,
							ticketId: ticketA,
							stageIds: [await stageId(0)],
							replaceStages: true,
						},
						headers: { origin: new URL(BASE).origin },
					});
					const answer = await refused.json() as { ok?: boolean; message?: string };
					assert(answer.ok === false, `the held stage is refused (${refused.status()})`);
					assertEquals(await escrowsOf(slugShort), [], "the short ticket holds nothing");
					assertEquals(
						before - await vaultCents(),
						PRICE_CENTS,
						"only the one prepaid stage was paid",
					);
				},
			);
			assert(a && b && c && d, "every journey passed");
			await client.context.close();
		} finally {
			await browser.close();
			console.log(`ticket-funding.spec: ${forwarded} Stripe events forwarded`);
		}
	},
});

/** The project's `n`-th stage's `stg-…` slug. */
async function stageSlug(n: number): Promise<string> {
	return (await stageRefs(n)).slug;
}

/** The project's `n`-th stage's row id. */
async function stageId(n: number): Promise<string> {
	return (await stageRefs(n)).id;
}

async function stageRefs(n: number): Promise<{ id: string; slug: string }> {
	const rows = await sql(`
		select s.id || ' ' || s.slug from projects.project_stages s
		join projects.projects p on p.id = s.project_id
		where p.slug = '${PROJECT}' order by s.sort_order;`);
	const [id, slug] = rows[n].split(" ");
	return { id, slug };
}
