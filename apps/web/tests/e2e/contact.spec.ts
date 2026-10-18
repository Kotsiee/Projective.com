/// <reference lib="dom" />
import { Buffer } from "node:buffer";
import { assert, assertEquals, assertMatch } from "@std/assert";
import {
	type Browser,
	type BrowserContext,
	chromium,
	type Page,
	type Route,
} from "npm:playwright-core@1.56.1";

/**
 * contact.spec — `/contact`'s end-to-end state matrix (Decision #276, work order P3): every intent's
 * page, a submission of each intent with the confirmation focused and announced, switching intent
 * in place, client-side errors, the no-JavaScript post and its receipt, a dispute as a guest (the
 * sign-in hand-off and the fallback intake) and as a signed-in persona (the engagement picker), and
 * an attachment walking uploading → checking the file → ready, a refused one, and Remove.
 *
 * It drives a RUNNING dev server with the contact gate OFF, so nothing is stored: start
 * `web-contact-e2e` from `.claude/launch.json` (port 13330, `CONTACT_BACKEND_LIVE=false`), then
 * `deno task test:e2e`. Every non-GET `/api/**` call except `/api/auth/*` and `/api/contact*` is
 * aborted, so a run never writes shared data. The signed-in steps sign in as the seeded `noor`
 * (Seed.md).
 *
 * Environment: `E2E_CONTACT_BASE_URL` (default `http://127.0.0.1:13330`), `E2E_PASSWORD` (default
 * the shared dev password documented in Seed.md), `E2E_CHROMIUM` (a browser executable; else
 * `/opt/pw-browsers/chromium` when present, else the Playwright-managed Chromium, else installed
 * Chrome), `E2E_ARTIFACTS` (where failure screenshots go).
 */

// #region Configuration
const BASE = Deno.env.get("E2E_CONTACT_BASE_URL") ?? "http://127.0.0.1:13330";
const PERSONA = "noor";
const ROOT = new URL("../../../../", import.meta.url);
const ARTIFACTS = Deno.env.get("E2E_ARTIFACTS") ??
	Deno.makeTempDirSync({ prefix: "pj-e2e-contact-" });
const VIEWPORT = { width: 1280, height: 900 };
const REFERENCE = /^CT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const MESSAGE = "My payout has not arrived seven days after the stage was approved.";
/** A 1×1 PNG — real bytes, so the sniff in the complete step has something to read. */
const PNG = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
	),
	(c) => c.charCodeAt(0),
);
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

async function executable(): Promise<string | undefined> {
	const env = Deno.env.get("E2E_CHROMIUM");
	if (env) return env;
	for (const candidate of ["/opt/pw-browsers/chromium", "/opt/pw-browsers/chromium/chrome"]) {
		try {
			const info = await Deno.stat(candidate);
			if (info.isFile) return candidate;
		} catch { /* absent */ }
	}
	return undefined;
}

async function launch(): Promise<Browser> {
	const executablePath = await executable();
	if (executablePath) return await chromium.launch({ executablePath, headless: true });
	try {
		return await chromium.launch({ headless: true });
	} catch {
		return await chromium.launch({ channel: "chrome", headless: true });
	}
}

/** A context that can only write through sign-in and this surface's own endpoints. */
async function guarded(browser: Browser, javaScriptEnabled = true): Promise<BrowserContext> {
	const context = await browser.newContext({
		baseURL: BASE,
		viewport: VIEWPORT,
		javaScriptEnabled,
	});
	await context.route("**/api/**", (route: Route) => {
		const req = route.request();
		const path = new URL(req.url()).pathname;
		if (
			req.method() === "GET" || path.startsWith("/api/auth/") || path.startsWith("/api/contact")
		) {
			return route.continue();
		}
		return route.abort();
	});
	return context;
}

/** Open a page and wait for the intake island to revive (a press before then is a plain post). */
async function open(context: BrowserContext, path: string): Promise<Page> {
	const page = await context.newPage();
	await page.goto(path, { waitUntil: "load", timeout: 180_000 });
	await page.waitForFunction(
		() => document.querySelector("form.ctc-form")?.hasAttribute("novalidate") === true,
		undefined,
		{ timeout: 30_000 },
	);
	return page;
}

/** The page's structure: one h1, the landmarks, the rail, structured data that parses. */
async function assertStructure(page: Page): Promise<void> {
	const facts = await page.evaluate(() => ({
		h1: document.querySelectorAll("h1").length,
		main: document.querySelectorAll('main, [role="main"]').length,
		rail: document.querySelectorAll("aside.ctc-rail[aria-labelledby]").length,
		ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => {
			try {
				JSON.parse(s.textContent ?? "");
				return true;
			} catch {
				return false;
			}
		}),
		hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
	}));
	assertEquals(facts.h1, 1, "exactly one h1");
	assert(facts.main >= 1, "a main landmark");
	assertEquals(facts.rail, 1, "the named rail");
	assert(facts.ld.length > 0 && facts.ld.every(Boolean), `JSON-LD ${JSON.stringify(facts.ld)}`);
	assertEquals(facts.hscroll, false, "no horizontal page scroll");
}

/** Fill the shared sender + message fields of one intent's form. */
async function fillSender(page: Page, intent: string, email: string): Promise<void> {
	const scope = page.locator(`.ctc-fields[data-intent="${intent}"]`);
	await scope.locator('input[name="name"]').fill("Ada Lovelace");
	await scope.locator('input[name="email"]').fill(email);
	await scope.locator('textarea[name="message"]').fill(MESSAGE);
}

/** Send and expect the confirmation: a reference, focus on its heading, the same in the live region. */
async function expectReceipt(page: Page, submit: string): Promise<string> {
	await page.getByRole("button", { name: submit }).click();
	await page.locator(".ctc-receipt").waitFor({ timeout: 20_000 });
	const code = (await page.locator(".ctc-receipt__code").textContent())?.trim() ?? "";
	assertMatch(code, REFERENCE);
	await page.waitForFunction(
		() => document.activeElement?.id === "ctc-receipt-title",
		undefined,
		{ timeout: 5_000 },
	);
	const live = await page.locator('.ctc-intake [role="status"][aria-live="polite"]').first()
		.textContent();
	assert(live?.includes(code), `the live region said "${live}"`);
	return code;
}

/** Distinct reply addresses: the per-address limiter allows three per ten minutes. */
const address = (n: number) => `e2e.${n}.${Date.now().toString(36)}@example.com`;

async function shot(page: Page, name: string): Promise<void> {
	await page.screenshot({ path: `${ARTIFACTS}/${name}.png`, fullPage: true }).catch(() => {});
}
// #endregion

Deno.test({
	name: "contact — intents, switching, errors, no-JS, disputes, attachments",
	sanitizeOps: false,
	sanitizeResources: false,
	async fn(t) {
		const browser = await launch();
		const stamp = Date.now().toString(36);
		let page: Page | null = null;
		const step = (name: string, body: () => Promise<void>) =>
			t.step(name, async () => {
				try {
					await body();
				} catch (error) {
					if (page) await shot(page, `${stamp}-${name.slice(0, 2).replace(/\W/g, "")}`);
					throw error;
				}
			});

		try {
			await step("1. each intent's page renders with its structure, guest", async () => {
				const context = await guarded(browser);
				for (const intent of ["support", "sales", "dispute", "security"]) {
					page = await open(context, `/contact?intent=${intent}`);
					await assertStructure(page);
					assertEquals(
						await page.locator('.ctc-fields[data-active="true"]').getAttribute("data-intent"),
						intent,
					);
					await page.close();
				}
				await context.close();
			});

			await step("2. switching intent in place keeps the address bar in step", async () => {
				const context = await guarded(browser);
				page = await open(context, "/contact");
				await page.getByRole("radio", { name: /Security/ }).click();
				await page.waitForURL((url) => url.searchParams.get("intent") === "security");
				assertEquals(
					await page.locator('.ctc-fields[data-active="true"]').getAttribute("data-intent"),
					"security",
				);
				await context.close();
			});

			await step("3. a refused form focuses its first invalid field", async () => {
				const context = await guarded(browser);
				page = await open(context, "/contact?intent=support");
				await page.getByRole("button", { name: "Send to support" }).click();
				await page.waitForFunction(
					() => (document.activeElement as HTMLInputElement | null)?.name === "name",
					undefined,
					{ timeout: 5_000 },
				);
				const invalid = await page
					.locator('.ctc-fields[data-intent="support"] [aria-invalid="true"]').count();
				assert(invalid >= 2, `${invalid} invalid controls`);
				await context.close();
			});

			await step("4. every intent submits to a focused, announced receipt", async () => {
				const runs: Array<
					{ intent: string; submit: string; fill: (p: Page) => Promise<void> }
				> = [
					{
						intent: "sales",
						submit: "Send to sales",
						fill: (p) =>
							p.locator('.ctc-fields[data-intent="sales"] input[name="company"]').fill(
								"Compiler Co",
							),
					},
					{ intent: "support", submit: "Send to support", fill: () => Promise.resolve() },
					{
						intent: "dispute",
						submit: "Send to our disputes team",
						fill: (p) =>
							p.locator('.ctc-fields[data-intent="dispute"] input[name="referenceId"]').fill(
								"INV-2026-0042",
							),
					},
					{
						intent: "security",
						submit: "Send report",
						fill: (p) =>
							p.locator('.ctc-fields[data-intent="security"] .ui-radio', {
								hasText: "A security vulnerability",
							}).click(),
					},
				];
				for (const [n, run] of runs.entries()) {
					const context = await guarded(browser);
					page = await open(context, `/contact?intent=${run.intent}`);
					await fillSender(page, run.intent, address(n));
					await run.fill(page);
					await expectReceipt(page, run.submit);
					await context.close();
				}
			});

			await step(
				"5. without JavaScript the form posts and the receipt comes home once",
				async () => {
					const context = await guarded(browser, false);
					page = await context.newPage();
					await page.goto("/contact?intent=sales", { waitUntil: "load" });
					const scope = page.locator('.ctc-fields[data-intent="sales"]');
					await scope.locator('input[name="name"]').fill("Grace Hopper");
					await scope.locator('input[name="email"]').fill(address(9));
					await scope.locator('input[name="company"]').fill("Compiler Co");
					await scope.locator('textarea[name="message"]').fill(
						"We would like to bring a team of twelve onto Projective.",
					);
					await page.getByRole("button", { name: "Send to sales" }).click();
					await page.waitForURL("**/contact?intent=sales&sent=1", { timeout: 30_000 });
					assertMatch(
						(await page.locator(".ctc-receipt__code").textContent())?.trim() ?? "",
						REFERENCE,
					);
					await page.reload({ waitUntil: "load" });
					assertEquals(
						await page.locator(".ctc-receipt").count(),
						0,
						"the receipt cookie is cleared",
					);
					await context.close();
				},
			);

			await step(
				"6. a guest's dispute: the sign-in hand-off, and the fallback intake",
				async () => {
					const context = await guarded(browser);
					page = await open(context, "/contact?intent=dispute");
					const signIn = page.locator('.ctc-fields[data-intent="dispute"] .ctc-route a', {
						hasText: "Sign in to continue",
					});
					const href = await signIn.getAttribute("href");
					assert(href && href.includes("contact"), `the sign-in link returns to /contact: ${href}`);
					await fillSender(page, "dispute", address(10));
					await page.locator('.ctc-fields[data-intent="dispute"] input[name="referenceId"]').fill(
						"https://projective.app/projects/prj-7k4q2m9x",
					);
					await expectReceipt(page, "Send to our disputes team");
					await context.close();
				},
			);

			await step(
				"7. signed in: the engagement picker, an attachment's states, Remove, send",
				async () => {
					const context = await guarded(browser);
					const login = await context.request.post("/api/auth/login", {
						data: { identifier: `${PERSONA}@projective.dev`, password: await password() },
					});
					assertEquals(login.status(), 200, `sign-in as ${PERSONA} failed (${login.status()})`);

					page = await open(context, "/contact?intent=dispute");
					const options = page.locator(
						'.ctc-fields[data-intent="dispute"] input[name="engagementSlug"]',
					);
					if (await options.count() > 0) {
						const group = page.locator('.ctc-fields[data-intent="dispute"] [role="radiogroup"]');
						assert(await group.getAttribute("aria-labelledby"), "the picker is named by its label");
						await page.locator('.ctc-fields[data-intent="dispute"] .ui-radio').first().click();
						await page.locator(
							'.ctc-fields[data-intent="dispute"] .ctc-route, .ctc-fields[data-intent="dispute"] .ctc-group .ctc-note',
						)
							.first().waitFor();
					} else {
						await page.getByText("You have no active engagements.").waitFor();
					}

					await page.goto("/contact?intent=support", { waitUntil: "load" });
					await page.waitForFunction(
						() => document.querySelector("form.ctc-form")?.hasAttribute("novalidate") === true,
					);
					// Hold the check so its state can be seen.
					await page.route("**/api/contact/attachments/complete", async (route) => {
						await new Promise((r) => setTimeout(r, 1500));
						await route.continue();
					});
					const discards: string[] = [];
					page.on("request", (req) => {
						if (req.url().includes("/api/contact/attachments/discard")) discards.push(req.url());
					});
					const input = page.locator('.ctc-fields[data-intent="support"] input[type="file"]');
					await input.setInputFiles([{
						name: "screen.png",
						mimeType: "image/png",
						buffer: Buffer.from(PNG),
					}]);
					await page.locator('.ctc-drop__state[data-phase="scanning"]').waitFor({
						timeout: 20_000,
					});
					await page.locator('.ctc-drop__state[data-phase="ready"]').waitFor({ timeout: 20_000 });
					await input.setInputFiles([{
						name: "tool.exe",
						mimeType: "application/x-msdownload",
						buffer: Buffer.from([0x4d, 0x5a, 0x90, 0]),
					}]);
					await page.locator('.ctc-drop__state[data-phase="refused"]').waitFor({ timeout: 20_000 });

					// A second picture, removed once ready: it leaves the list and the server is told.
					await input.setInputFiles([{
						name: "wrong.png",
						mimeType: "image/png",
						buffer: Buffer.from(PNG),
					}]);
					const wrong = page.locator(".ctc-drop__item", { hasText: "wrong.png" });
					await wrong.locator('.ctc-drop__state[data-phase="ready"]').waitFor({ timeout: 20_000 });
					await page.getByRole("button", { name: "Remove wrong.png" }).click();
					await wrong.waitFor({ state: "detached", timeout: 5_000 });
					await page.waitForTimeout(300);
					assertEquals(discards.length, 1, "Remove takes the file back on the server");

					const scope = page.locator('.ctc-fields[data-intent="support"]');
					await scope.locator('input[name="email"]').fill(address(11));
					await scope.locator('textarea[name="message"]').fill(
						"Attaching the screen I see when my invoice download fails.",
					);
					await expectReceipt(page, "Send to support");
					await context.close();
				},
			);
		} finally {
			await browser.close();
		}
	},
});
