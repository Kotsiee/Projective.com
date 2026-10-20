/// <reference lib="dom" />
import { assert, assertEquals } from "@std/assert";
import { type Browser, type BrowserContext, chromium, type Page } from "npm:playwright-core@1.56.1";
import { Buffer } from "node:buffer";

/**
 * landing-hero.spec — the landing hero search in a real browser (work order L2 of
 * `flows/PUBLIC_ROUTES_BUILD_PROMPTS.md`; `flows/LANDING.md` §4.1): without JavaScript the form
 * submits `category` and `q` to `/explore`; hydrated, typing opens the grouped suggestions, the
 * arrow keys drive `aria-activedescendant` and keep the active row in sight, Escape closes the
 * panel, Enter lands on `explorePath(category, q)`, and `/` focuses the field once its hint and
 * `aria-keyshortcuts` show. No sign-in: the landing is the same for a guest.
 *
 * Two ways to run it (`deno task test:e2e`):
 *   - against a RUNNING server: `E2E_LANDING_URL` (else `E2E_BASE_URL`, else
 *     `http://localhost:13217`, the `web-catalogue-e2e` launch config the catalogue suite uses).
 *     A dev server started before the hero's islands existed does not hydrate them; restart it.
 *   - against a PRODUCTION BUILD in-process, no port opened: `deno task build`, then
 *     `E2E_SERVER_ENTRY=apps/web/_fresh/server.js`. Every request the page makes to the base URL is
 *     answered by the build's own `fetch` handler through Playwright routing.
 *
 * Environment: `E2E_CHROMIUM` (a browser executable; else `/opt/pw-browsers/chromium` when present,
 * else the Playwright-managed Chromium, else installed Chrome), `E2E_ARTIFACTS` (failure screenshots).
 */

// #region Configuration
const BASE = Deno.env.get("E2E_LANDING_URL") ?? Deno.env.get("E2E_BASE_URL") ??
	"http://localhost:13217";
const SERVER_ENTRY = Deno.env.get("E2E_SERVER_ENTRY");
const ROOT = new URL("../../../../", import.meta.url);
const ARTIFACTS = Deno.env.get("E2E_ARTIFACTS") ?? Deno.makeTempDirSync({ prefix: "pj-e2e-" });
const DESKTOP = { width: 1280, height: 800 };

/**
 * The hero's controls by what the page names them (the no-JavaScript form's field names, the input's
 * shortcut and the listbox's accessible name), so the suite needs none of the landing's own classes.
 */
const QUERY = 'input[name="q"]';
const CATEGORY = 'select[name="category"]';
const BOUND_QUERY = 'input[name="q"][aria-keyshortcuts="/"]';
const OPTIONS = '[role="listbox"][aria-label="Suggestions"] [role="option"]';
// #endregion

// #region Harness
/** The production build's request handler, when the suite runs in-process. */
type FetchHandler = { fetch: (request: Request) => Promise<Response> };

async function inProcess(): Promise<FetchHandler | null> {
	if (!SERVER_ENTRY) return null;
	Deno.chdir(ROOT);
	const entry = new URL(SERVER_ENTRY, ROOT);
	return (await import(entry.href)).default as FetchHandler;
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

/** A fresh context on the base URL, its requests answered by the build when running in-process. */
async function contextFor(
	browser: Browser,
	app: FetchHandler | null,
	options: { javaScriptEnabled?: boolean } = {},
): Promise<BrowserContext> {
	const context = await browser.newContext({ baseURL: BASE, viewport: DESKTOP, ...options });
	if (app) {
		await context.route(`${new URL(BASE).origin}/**`, async (route) => {
			const request = route.request();
			const body = request.postDataBuffer();
			const response = await app.fetch(
				new Request(request.url(), {
					method: request.method(),
					headers: await request.allHeaders(),
					body: body && request.method() !== "GET" ? new Uint8Array(body) : undefined,
					redirect: "manual",
				}),
			);
			const headers: Record<string, string> = {};
			response.headers.forEach((value, key) => (headers[key] = value));
			await route.fulfill({
				status: response.status,
				headers,
				body: Buffer.from(new Uint8Array(await response.arrayBuffer())),
			});
		});
	}
	return context;
}

/** The hero search once its island has hydrated: the input declares `/` only from then on. */
async function hydratedHero(page: Page): Promise<void> {
	await page.goto("/", { waitUntil: "load", timeout: 60_000 });
	await page.waitForSelector(BOUND_QUERY, { timeout: 30_000 });
}

/** Where a navigation landed: its path and the two parameters a search carries. */
function landing(url: string): { path: string; category: string | null; q: string | null } {
	const parsed = new URL(url);
	return {
		path: parsed.pathname,
		category: parsed.searchParams.get("category"),
		q: parsed.searchParams.get("q"),
	};
}

async function shot(page: Page, name: string): Promise<void> {
	await page.screenshot({ path: `${ARTIFACTS}/${name}.png` }).catch(() => {});
}
// #endregion

Deno.test({
	name: "landing hero — no-JS submit → suggestions → keys → Enter → / focuses",
	sanitizeOps: false,
	sanitizeResources: false,
	async fn(t) {
		const app = await inProcess();
		const browser = await launch();
		try {
			await t.step("without JavaScript the form submits category and q to /explore", async () => {
				const context = await contextFor(browser, app, { javaScriptEnabled: false });
				const page = await context.newPage();
				try {
					await page.goto("/", { waitUntil: "load", timeout: 60_000 });
					await page.selectOption(CATEGORY, "freelancers");
					await page.fill(QUERY, "landing page");
					await Promise.all([
						page.waitForURL(/\/explore/, { timeout: 30_000, waitUntil: "commit" }),
						page.press(QUERY, "Enter"),
					]);
					assertEquals(landing(page.url()), {
						path: "/explore",
						category: "freelancers",
						q: "landing page",
					});
				} catch (error) {
					await shot(page, "no-js");
					throw error;
				} finally {
					await context.close();
				}
			});

			await t.step(
				"typing opens the suggestions; the keys drive them; Enter searches",
				async () => {
					const context = await contextFor(browser, app);
					const page = await context.newPage();
					try {
						await hydratedHero(page);
						await page.selectOption(CATEGORY, "services");
						await page.click(QUERY);
						await page.keyboard.type("brand", { delay: 30 });
						await page.waitForSelector(OPTIONS, { timeout: 15_000 });
						assertEquals(await page.getAttribute(QUERY, "aria-expanded"), "true");
						const controls = await page.getAttribute(QUERY, "aria-controls");
						assertEquals(
							await page.evaluate(
								(id) => document.getElementById(id ?? "")?.getAttribute("role"),
								controls,
							),
							"listbox",
							"aria-controls names the suggestions listbox",
						);

						await page.keyboard.press("ArrowDown");
						const first = await page.getAttribute(QUERY, "aria-activedescendant");
						assert(first, "ArrowDown names an active option");
						assertEquals(await page.getAttribute(`#${first}`, "aria-selected"), "true");

						await page.keyboard.press("Escape");
						assertEquals(await page.getAttribute(QUERY, "aria-expanded"), "false");
						assertEquals(await page.getAttribute(QUERY, "aria-activedescendant"), null);

						// ArrowUp from no active row is the trailing "Search Explore for “brand”" row.
						await page.keyboard.press("ArrowDown");
						await page.waitForSelector(OPTIONS, { timeout: 15_000 });
						await page.keyboard.press("ArrowUp");
						const last = await page.getAttribute(QUERY, "aria-activedescendant");
						assert(last, "ArrowUp names the last option");
						const inSight = await page.evaluate((id) => {
							const option = document.getElementById(id)?.getBoundingClientRect();
							const list = document.querySelector('[role="listbox"][aria-label="Suggestions"]');
							const panel = list?.parentElement?.getBoundingClientRect();
							return !!option && !!panel && option.top >= panel.top - 1 &&
								option.bottom <= panel.bottom + 1;
						}, last);
						assert(inSight, "the active option is scrolled into the panel's view");

						await Promise.all([
							page.waitForURL(/\/explore/, { timeout: 30_000, waitUntil: "commit" }),
							page.keyboard.press("Enter"),
						]);
						assertEquals(landing(page.url()), {
							path: "/explore",
							category: "services",
							q: "brand",
						});
					} catch (error) {
						await shot(page, "suggest");
						throw error;
					} finally {
						await context.close();
					}
				},
			);

			await t.step(
				"/ focuses the hero search once its hint and aria-keyshortcuts show",
				async () => {
					const context = await contextFor(browser, app);
					const page = await context.newPage();
					try {
						await hydratedHero(page);
						assertEquals(await page.getAttribute(QUERY, "aria-keyshortcuts"), "/");
						assert(
							await page.getByText("to search").first().isVisible(),
							"the hint shows",
						);
						await page.locator("body").click({ position: { x: 4, y: 400 } });
						await page.keyboard.press("/");
						assert(
							await page.evaluate(() =>
								document.activeElement === document.querySelector('input[name="q"]')
							),
							"/ focuses the hero search",
						);
					} catch (error) {
						await shot(page, "slash");
						throw error;
					} finally {
						await context.close();
					}
				},
			);
		} finally {
			await browser.close();
		}
	},
});
