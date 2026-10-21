/// <reference lib="dom" />
import { assert, assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import {
	type Browser,
	type BrowserContext,
	chromium,
	type Locator,
	type Page,
	type Request,
} from "npm:playwright-core@1.56.1";

/**
 * catalogue.spec — the Catalogue rebuild's end-to-end smoke (Decision #217, work order C17): create a
 * Session from the console, put a still in showcase slot 1, fill the offer and publish, preview it as
 * a buyer with no network commit, read the Analytics tab, open a client's drawer, prove `/catalogue/new`
 * is the create modal, and repeat the publish by keyboard alone.
 *
 * It drives a RUNNING dev server against the local Supabase stack as the seeded freelancer
 * `marisdelacroix` (Seed.md): start `web-catalogue-e2e` from `.claude/launch.json` (port 13217,
 * `CATALOGUE_BACKEND_LIVE=false`, so the Analytics and Clients reads answer their fixtures while every
 * listing write stays live), then `deno task test:e2e`. Each run creates two Session listings for the
 * persona; a `deno task db:reset` clears them.
 *
 * Environment: `E2E_BASE_URL` (default `http://localhost:13217`), `E2E_IDENTIFIER` (default the
 * persona's email), `E2E_PASSWORD` (default the shared dev password documented in Seed.md),
 * `E2E_CHROMIUM` (a browser executable; else `/opt/pw-browsers/chromium` when present, else the
 * Playwright-managed Chromium, else installed Chrome), `E2E_ARTIFACTS` (where failure screenshots go).
 */

// #region Configuration
const BASE = Deno.env.get("E2E_BASE_URL") ?? "http://localhost:13217";
const PERSONA = "marisdelacroix";
const IDENTIFIER = Deno.env.get("E2E_IDENTIFIER") ?? `${PERSONA}@projective.dev`;
const ROOT = new URL("../../../../", import.meta.url);
const COVER = new URL(
	"supabase/seed-assets/catalogue/45a4c6ae-d818-45fd-a62b-db44f1f69eab/products/pr-motion-primitives.jpg",
	ROOT,
);
const ARTIFACTS = Deno.env.get("E2E_ARTIFACTS") ?? Deno.makeTempDirSync({ prefix: "pj-e2e-" });
const VIEWPORT = { width: 1440, height: 960 };
/** Every buyer-side commit endpoint the simulation must never call (plan §4.6, flag j). */
const COMMIT_API = /\/api\/(basket|checkout|booking|services)(\/|\?|$)/;
const SLUG_PATH = /^\/catalogue\/svc-[23456789a-hjkm-z]{10}$/;
const PRICE = "120";
const SIMULATION_BANNER =
	"Preview · This is what buyers see. Nothing you do here books or charges.";
const SIMULATED_COMMIT = "Simulated: nothing is booked or charged";
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

/** A signed-in context for the persona, with the dev overrides the steps read preloaded. */
async function signedIn(browser: Browser): Promise<BrowserContext> {
	const context = await browser.newContext({ baseURL: BASE, viewport: VIEWPORT });
	await context.addInitScript(() => {
		try {
			sessionStorage.setItem(
				"pj.session.dev.contextOverrides",
				JSON.stringify({
					enabled: true,
					accountType: "freelancer",
					catalogueAnalytics: "rich",
					clientPipeline: "busy",
				}),
			);
		} catch { /* storage blocked: the fixtures' defaults (rich, busy) answer the same */ }
	});
	const res = await context.request.post("/api/auth/login", {
		data: { identifier: IDENTIFIER, password: await password(), remember: true },
	});
	assertEquals(res.status(), 200, `sign-in as ${IDENTIFIER} failed (${res.status()})`);
	return context;
}

/**
 * Fresh pages revive islands on a later task (island hydration), so wait for the module graph. A
 * long-lived request (a live transport) can hold `networkidle` off, so it is a bounded wait.
 */
async function settle(page: Page): Promise<void> {
	await page.waitForLoadState("domcontentloaded");
	await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
	await page.waitForTimeout(400);
}

/** Wait out the 800 ms autosave; fail with what the footer says if it settles on anything but saved. */
async function saved(page: Page): Promise<void> {
	const indicator = page.locator(".cat-ws-rig .ui-save-status__pip");
	const deadline = Date.now() + 20_000;
	let state: string | null = null;
	while (Date.now() < deadline) {
		state = await indicator.getAttribute("data-state");
		if (state === "saved") return;
		if (state === "error" || state === "conflict" || state === "offline") break;
		await page.waitForTimeout(250);
	}
	const text = await page.locator(".cat-ws-rig .ui-save-status__text").textContent();
	throw new Error(`autosave settled on "${state}": ${text}`);
}

/**
 * `/catalogue` → the lane's New listing menu ▸ Session (or, with `viaMenu` off, the same modal
 * addressed by URL) → Create draft → the new listing's Media section.
 */
async function createSession(page: Page, title: string, viaMenu = true): Promise<string> {
	if (viaMenu) {
		await page.goto("/catalogue");
		await settle(page);
		// The lane's menu button, not the footer rig's button of the same name (which opens the modal).
		await page.locator('button.ui-lane-create[aria-haspopup="menu"]').click();
		await page.getByRole("menuitem", { name: "Session", exact: true }).click();
	} else {
		await page.goto("/catalogue?create=service:session");
		await settle(page);
	}
	const dialog = page.getByRole("dialog", { name: "Create a listing" });
	await dialog.waitFor();
	assertEquals(new URL(page.url()).searchParams.get("create"), "service:session");
	await dialog.getByLabel("Title").fill(title);
	await Promise.all([
		page.waitForURL((url) => SLUG_PATH.test(url.pathname), {
			timeout: 60_000,
			waitUntil: "commit",
		}),
		dialog.getByRole("button", { name: "Create draft" }).click(),
	]);
	await settle(page);
	return new URL(page.url()).pathname.split("/").pop()!;
}

/** Slot 1 → the library picker → this device → crop → Save & apply. */
async function uploadCover(page: Page): Promise<void> {
	const slot = page.getByRole("button", { name: "Add to showcase 1 (your cover)" });
	const picker = page.getByRole("dialog", { name: "Add to your showcase" });
	// A press before the workspace island revives does nothing; retry until the picker opens.
	for (let attempt = 0; attempt < 8 && !(await picker.isVisible()); attempt++) {
		await slot.click();
		await picker.waitFor({ timeout: 2_500 }).catch(() => {});
	}
	await page.locator("input.apk__file").setInputFiles(
		COVER.pathname.replace(/^\/([A-Za-z]:)/, "$1"),
	);
	// Staging finishes with "Continue" (several open slots) or straight in the crop phase.
	const proceed = picker.getByRole("button", { name: "Continue" });
	const save = picker.getByRole("button", { name: "Save & apply" });
	await proceed.or(save).first().waitFor({ timeout: 20_000 });
	if (await proceed.isVisible()) {
		await expectEnabled(proceed);
		await proceed.click();
	}
	await save.waitFor({ timeout: 20_000 });
	await expectEnabled(save);
	const applied = page.waitForResponse(
		(r) => r.url().includes("/api/catalogue/media") && r.request().method() === "POST",
		{ timeout: 60_000 },
	);
	await save.click();
	assertEquals((await applied).status(), 200, "the showcase write was refused");
}

/** Wait until a button is neither `disabled` nor `aria-disabled`. */
async function expectEnabled(button: Locator): Promise<void> {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		const off = await button.evaluate((el) =>
			(el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true"
		);
		if (!off) return;
		await button.page().waitForTimeout(200);
	}
	throw new Error(`${await button.textContent()} stayed disabled`);
}

/** The bound hours: a lone library preset is already the default binding; otherwise pick one. */
async function choosePreset(page: Page): Promise<string> {
	const pick = page.locator("#cat-hours-preset");
	if (await pick.count()) {
		await pick.click();
		await page.getByRole("option").first().click();
	}
	const binding = page.locator(".cat-hours__binding");
	await binding.waitFor();
	const sentence = (await binding.textContent())?.trim() ?? "";
	assertMatch(sentence, /^Uses /, `no preset is bound: "${sentence}"`);
	return sentence;
}

/** Screenshot `target` focused and blurred; a visible focus indicator makes the two differ. */
async function focusPaints(page: Page, focus: Locator, target: Locator): Promise<boolean> {
	const on = await target.screenshot({ animations: "disabled" });
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await page.waitForTimeout(250);
	const off = await target.screenshot({ animations: "disabled" });
	await focus.focus();
	await page.waitForTimeout(250);
	return on.length !== off.length || on.some((b, i) => b !== off[i]);
}

/** Tab forward until the focused element sits at or inside `selector`; fails after `limit` presses. */
async function tabTo(page: Page, selector: string, limit = 80): Promise<void> {
	for (let i = 0; i < limit; i++) {
		await page.keyboard.press("Tab");
		const there = await page.evaluate(
			(sel) => !!document.activeElement?.closest(sel),
			selector,
		);
		if (there) return;
	}
	throw new Error(`Tab never reached ${selector}`);
}

async function shot(page: Page, name: string): Promise<void> {
	await page.screenshot({ path: `${ARTIFACTS}/${name}.png`, fullPage: false }).catch(() => {});
}
// #endregion

Deno.test({
	name:
		"catalogue smoke — create → media → publish → preview → analytics → clients → /new → keyboard",
	sanitizeOps: false,
	sanitizeResources: false,
	async fn(t) {
		const browser = await launch();
		const context = await signedIn(browser);
		const page = await context.newPage();
		const stamp = Date.now().toString(36);
		const title = `E2E session ${stamp}`;
		let slug = "";
		/** A step that leaves a screenshot named after itself when it fails. */
		const step = (name: string, body: () => Promise<void>) =>
			t.step(name, async () => {
				try {
					await body();
				} catch (error) {
					await shot(page, `${stamp}-${name.slice(0, 2).replace(/\W/g, "")}`);
					throw error;
				}
			});

		try {
			await step("1. /catalogue → New listing ▸ Session lands on the Media section", async () => {
				slug = await createSession(page, title);
				const url = new URL(page.url());
				// `edit` is the workspace's default tab, so `workspaceHref` omits it.
				assertEquals(url.searchParams.get("tab") ?? "edit", "edit");
				assertEquals(url.searchParams.get("section"), "media");
				await page.locator('#cat-sec-media[data-section="media"]').waitFor();
			});

			await step("2. a still in slot 1 becomes the live card's cover", async () => {
				await uploadCover(page);
				const cover = page.locator(".cat-ws-card .ex-media img.ui-pimg__img");
				await cover.waitFor({ timeout: 20_000 });
				assert((await cover.getAttribute("src"))?.length, "the live card has no cover");
			});

			await step(
				"3. title, price, duration and preset open the gate; Publish publishes",
				async () => {
					const rig = page.locator(".cat-ws-rig");
					const publish = rig.getByRole("button", { name: "Publish", exact: true });
					await page.getByLabel("Title", { exact: true }).fill(`${title} (published)`);
					await page.getByLabel("Price per session").fill(PRICE);
					await page.getByRole("radiogroup", { name: "Session length" })
						.getByRole("radio", { name: "1 h", exact: true }).click();
					await choosePreset(page);
					await saved(page);
					await page.locator('#cat-ws-gate[data-ready="true"]').waitFor({ timeout: 15_000 });
					assertNotEquals(await publish.getAttribute("aria-disabled"), "true");
					const status = page.waitForResponse((r) => r.url().includes("/api/catalogue/status"));
					await publish.click();
					assertEquals((await status).status(), 200, "publish was refused");
					await page.locator(".cat-ws-head__status", { hasText: "Published" }).waitFor();
					await rig.getByRole("button", { name: "Pause" }).waitFor();
				},
			);

			await step("4. Preview simulates the session booking with no commit request", async () => {
				const commits: string[] = [];
				const watch = (req: Request) => {
					if (COMMIT_API.test(new URL(req.url()).pathname)) commits.push(req.url());
				};
				context.on("request", watch);
				try {
					await page.getByRole("tab", { name: "Preview" }).click();
					await page.waitForURL((url) => url.searchParams.get("tab") === "preview");
					const frame = page.frameLocator(`iframe[title="Buyer preview of ${title} (published)"]`);
					await frame.locator("[data-simulation-banner]").filter({ hasText: SIMULATION_BANNER })
						.waitFor({ timeout: 20_000 });
					await frame.locator('.evp[data-archetype="session"][data-simulation="true"]').waitFor();
					const lane = frame.locator(
						`aside.evp-laneslot[aria-label="Purchase ${title} (published)"] .evp-lane`,
					);
					await lane.waitFor();
					// The rig is `.evp-cta`; its primary is the first button ("Book session"). A click before the
					// frame's islands revive does nothing, so retry until the booking modal opens.
					const primary = lane.locator(".evp-cta button").first();
					const modal = frame.locator(".sbk");
					for (let attempt = 0; attempt < 8 && !(await modal.isVisible()); attempt++) {
						await primary.click();
						await modal.waitFor({ timeout: 2_500 }).catch(() => {});
					}
					await modal.locator('.sbk-slots__grid[role="group"]').waitFor({ timeout: 15_000 });
					const slot = modal.locator('button.sbk-slot:not([aria-disabled="true"])').first();
					await slot.click();
					assertEquals(await slot.getAttribute("aria-pressed"), "true");
					await modal.getByRole("button", { name: SIMULATED_COMMIT }).click();
					const outcome = modal.locator("[data-simulation-outcome]");
					await outcome.waitFor();
					assertMatch((await outcome.textContent())?.trim() ?? "", /^A buyer would now/);
				} finally {
					context.off("request", watch);
				}
				assertEquals(commits, [], `the simulation called a commit API: ${commits.join(", ")}`);
			});

			await step(
				"5. Analytics renders the rich fixture (console view; the tab answers 404 off-fixture)",
				async () => {
					// With CATALOGUE_BACKEND_LIVE off the analytics read answers fixtures, which know only the
					// fixture catalogue: a real listing's tab is a 404 ("No such listing"). The console's
					// Analytics view reads the same canvas over the fixture catalogue, axis `rich`.
					await page.getByRole("tab", { name: "Analytics" }).click();
					await page.waitForURL((url) => url.searchParams.get("tab") === "analytics");
					await page.locator(".cat-an[data-state]").waitFor({ timeout: 20_000 });

					await page.goto("/catalogue?view=analytics&period=90d");
					await settle(page);
					const canvas = page.locator('#cat-canvas .cat-an[data-state="ready"]');
					await canvas.waitFor({ timeout: 20_000 });
					await canvas.getByRole("group", { name: "Key figures" }).waitFor();
					for (const heading of ["Revenue velocity", "From impression to order", "Top listings"]) {
						await canvas.getByRole("heading", { level: 2, name: heading }).waitFor();
					}
					assertMatch(
						(await canvas.locator(".cat-an__asof").textContent())?.trim() ?? "",
						/^Through \d{1,2} [A-Z][a-z]{2} · updated nightly$/,
					);
				},
			);

			await step("6. the Clients view opens a buyer's drawer with the thread", async () => {
				await page.goto("/catalogue?view=clients");
				await settle(page);
				await page.locator('[role="group"][aria-label="Client pipeline"]').waitFor();
				const row = page.locator("#cat-cl-row-ada_lin");
				await row.click();
				await page.waitForURL((url) => url.searchParams.get("client") === "@ada_lin");
				const drawer = page.locator('aside#cat-cdrawer[aria-label="Client"]');
				await drawer.waitFor({ timeout: 15_000 });
				await drawer.getByRole("heading", { level: 2, name: "Ada Lin" }).waitFor();
				await drawer.getByRole("heading", { level: 3, name: "Conversation" }).waitFor();
				await drawer.locator('.cat-cdrawer__thread [data-chat-surface="popout"]').waitFor();
				await drawer.locator(".cat-cdrawer__thread").getByRole("textbox").first().waitFor();
				await drawer.getByRole("button", { name: "Close" }).click();
				await page.waitForURL((url) => !url.searchParams.has("client"), { waitUntil: "commit" });
				// The drawer hands focus back once the DOM settles (a task later), so poll for it.
				await page.waitForFunction(
					() => document.activeElement?.id === "cat-cl-row-ada_lin",
					undefined,
					{ timeout: 5_000 },
				);
			});

			await step(
				"7. /catalogue/new is a 303 to the console with the create modal open",
				async () => {
					const res = await context.request.get("/catalogue/new", { maxRedirects: 0 });
					assertEquals(res.status(), 303);
					assertEquals(res.headers()["location"], "/catalogue?create=1");
					await page.goto("/catalogue/new");
					await settle(page);
					assertEquals(new URL(page.url()).pathname, "/catalogue");
					assertEquals(new URL(page.url()).searchParams.get("create"), "1");
					await page.getByRole("dialog", { name: "Create a listing" }).waitFor();
					await page.keyboard.press("Escape");
				},
			);

			await step("8. step 3 by keyboard alone, every stop visibly focused", async () => {
				const kbTitle = `E2E keyboard ${stamp}`;
				await createSession(page, kbTitle, false);
				await uploadCover(page);
				await page.goto(
					`/catalogue/${new URL(page.url()).pathname.split("/").pop()}?section=basics`,
				);
				await settle(page);

				const titleInput = page.locator("#cat-basics-title");
				await tabTo(page, "#cat-basics-title");
				assert(
					await focusPaints(
						page,
						titleInput,
						titleInput.locator("xpath=ancestor::*[contains(@class,'ui-field')][1]"),
					),
					"the focused title field shows no indicator",
				);
				await page.keyboard.press("Control+A");
				await page.keyboard.type(`${kbTitle} (published)`);

				// Page order: Basics → Offer (session length) → Pricing → the footer rig.
				await tabTo(page, '[role="radiogroup"][aria-label="Session length"]');
				const length = page.getByRole("radiogroup", { name: "Session length" });
				const focusedName = await page.evaluate(() =>
					document.activeElement?.textContent?.trim() ?? ""
				);
				const focusedOption = length.getByRole("radio", { name: focusedName, exact: true });
				assert(
					await focusPaints(page, focusedOption, focusedOption),
					"the focused session-length option shows no indicator",
				);
				const target = length.getByRole("radio", { name: "45 min", exact: true });
				for (let i = 0; i < 6; i++) {
					if (await target.getAttribute("aria-checked") === "true") break;
					await page.keyboard.press("ArrowLeft");
				}
				assertEquals(
					await target.getAttribute("aria-checked"),
					"true",
					"arrows never chose 45 min",
				);

				const price = page.locator("#cat-pricing-price");
				await tabTo(page, "#cat-pricing-price");
				assert(
					await focusPaints(
						page,
						price,
						price.locator("xpath=ancestor::*[contains(@class,'ui-field')][1]"),
					),
					"the focused price field shows no indicator",
				);
				await page.keyboard.type(PRICE);

				await choosePreset(page);
				await saved(page);
				await page.locator('#cat-ws-gate[data-ready="true"]').waitFor({ timeout: 15_000 });

				const publish = page.locator(".cat-ws-rig").getByRole("button", {
					name: "Publish",
					exact: true,
				});
				await tabTo(page, ".cat-ws-rig__actions");
				while (!(await publish.evaluate((el) => el === document.activeElement))) {
					await page.keyboard.press("Tab");
				}
				// The product-wide "no visible focus indicator" directive (global.css, commit 152a27a) paints
				// no ring on a focused button; the field glows above are what survives it. Focus is asserted.
				assertEquals(await publish.evaluate((el) => el === document.activeElement), true);
				const status = page.waitForResponse((r) => r.url().includes("/api/catalogue/status"));
				await page.keyboard.press("Enter");
				assertEquals((await status).status(), 200, "keyboard publish was refused");
				await page.locator(".cat-ws-head__status", { hasText: "Published" }).waitFor();
			});
		} catch (error) {
			await shot(page, `failure-${stamp}`);
			console.error(`[e2e] screenshots in ${ARTIFACTS}; listing ${slug || "(not created)"}`);
			throw error;
		} finally {
			await context.close();
			await browser.close();
		}
	},
});
