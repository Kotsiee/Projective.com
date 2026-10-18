/// <reference lib="dom" />
import { assert, assertEquals } from "@std/assert";
import axe from "npm:axe-core@4.10.3";
import {
	type Browser,
	type BrowserContext,
	chromium,
	type Page,
	type Route,
} from "npm:playwright-core@1.56.1";

/**
 * public-routes.spec — the public routes' integration smoke (Decision #279, work order P8 items 4–5):
 * every page P1–P7 built — the legal hub, its six documents, a comparison and a PDF; the help centre's
 * hub, a category, two articles and a search; `/contact` for each intent; `/about`; the changelog, a
 * release and its feed; Projective's articles and two of them; `/feedback` and the `?feedback=open`
 * drawer over another page; the sitemap and robots.txt — at 375, 768 and 1280 px, light and dark,
 * with `prefers-reduced-motion: reduce`.
 *
 * Every page × variant must: answer 200; log no console error and throw nothing; make no subresource
 * request that fails or answers ≥ 400 (an unresolved `/test_images` path, a missing font); carry exactly
 * one `<h1>`; expose one `main`, one `banner`, one `contentinfo` and the `navigation` landmarks its
 * shell promises; parse every JSON-LD block; scroll no wider than the viewport; and pass axe-core's
 * WCAG 2.2 A/AA rules (axe is a test-only import, injected through `page.evaluate`, so it never meets
 * the page's CSP or the app's dependency graph). One axe finding is reported rather than failed: a
 * contrast failure whose colours are exactly the page's own `--on-primary` on `--primary` while that
 * pair itself is under 4.5:1 — the pre-existing brand-token defect `theme-engine.test.ts` already
 * pins (see `auditA11y`). A full-page screenshot of each is saved. Then a layout-shift budget: one
 * `/articles/[slug]` and one help article on a mid-tier phone (375 px, 4× CPU throttle, a slow-4G
 * network) must shift less than 0.05 while loading and after reading to the end, and nothing
 * third-party may block rendering.
 *
 * It drives a RUNNING dev server on the fixture road, so nothing is read from or written to the
 * editorial, community, contact or finance tables: start `web-public-e2e` from `.claude/launch.json`
 * (port 13380, `EDITORIAL_BACKEND_LIVE`, `COMMUNITY_BACKEND_LIVE`, `CONTACT_BACKEND_LIVE`,
 * `FINANCE_BACKEND_LIVE` and `NEWSLETTER_BACKEND_LIVE` off), then `deno task test:e2e:public`. Every
 * non-GET `/api/**` call except `/api/auth/*` is aborted, and every page is visited as a guest.
 *
 * Environment: `E2E_PUBLIC_BASE_URL` (default `http://127.0.0.1:13380`), `E2E_CHROMIUM` (a browser
 * executable; else `/opt/pw-browsers/chromium` when present, else the Playwright-managed Chromium,
 * else installed Chrome), `E2E_ARTIFACTS` (where the report goes), `E2E_SHOTS` (where the screenshots
 * go; default `<artifacts>/shots`), `E2E_PUBLIC_ONLY` (a substring: visit only the routes whose path
 * contains it), `E2E_PUBLIC_VARIANTS` (a comma list such as `375-light,1280-dark`: render only those),
 * `E2E_PUBLIC_BUDGET_BASE_URL` (where the layout-shift budget runs; default the same server — point
 * it at a production build for the Lighthouse-like figure).
 */

// #region Configuration
const BASE = Deno.env.get("E2E_PUBLIC_BASE_URL") ?? "http://127.0.0.1:13380";
const ARTIFACTS = Deno.env.get("E2E_ARTIFACTS") ??
	Deno.makeTempDirSync({ prefix: "pj-e2e-public-" });
const SHOTS = Deno.env.get("E2E_SHOTS") ?? `${ARTIFACTS}/shots`;
const ONLY = Deno.env.get("E2E_PUBLIC_ONLY") ?? "";
/** The axe-core rule tags a public page must pass. */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
/**
 * Where the layout-shift budget is measured: the same server by default. Point it at a production
 * build (`deno task build`, then serve `apps/web/_fresh/server.js` with the same gates) for the
 * Lighthouse-like figure — the dev server inlines each module's CSS and serves modules unbundled.
 */
const BUDGET_BASE = Deno.env.get("E2E_PUBLIC_BUDGET_BASE_URL") ?? BASE;
/** The layout-shift budget (Lighthouse's "good" is 0.1; the work order asks for half). */
const CLS_BUDGET = 0.05;

/** One page the smoke visits. */
interface PublicPage {
	/** The address, path and query. */
	path: string;
	/** A file-safe name for its screenshots. */
	id: string;
	/** The page publishes structured data, so it must carry at least one JSON-LD block. */
	ld: boolean;
	/** Opens an overlay on load: the dialog's accessible name. */
	dialog?: string;
}

const PAGES: readonly PublicPage[] = [
	{ path: "/legal", id: "legal", ld: true },
	{ path: "/legal/terms", id: "legal-terms", ld: true },
	{ path: "/legal/privacy", id: "legal-privacy", ld: true },
	{ path: "/legal/cookies", id: "legal-cookies", ld: true },
	{ path: "/legal/acceptable-use", id: "legal-acceptable-use", ld: true },
	{ path: "/legal/escrow-terms", id: "legal-escrow-terms", ld: true },
	{ path: "/legal/ip-transfer-deed", id: "legal-ip-transfer-deed", ld: true },
	{ path: "/legal/terms?compare=1.0", id: "legal-terms-compare", ld: true },
	{ path: "/help", id: "help", ld: true },
	{ path: "/help/escrow-and-payments", id: "help-category", ld: true },
	{ path: "/help/escrow-and-payments/fees", id: "help-article-fees", ld: true },
	{
		path: "/help/getting-started/what-is-projective",
		id: "help-article-what-is-projective",
		ld: true,
	},
	{ path: "/help?q=escrow", id: "help-search", ld: true, dialog: "Search the help centre" },
	{ path: "/contact?intent=support", id: "contact-support", ld: true },
	{ path: "/contact?intent=sales", id: "contact-sales", ld: true },
	{ path: "/contact?intent=dispute", id: "contact-dispute", ld: true },
	{ path: "/contact?intent=security", id: "contact-security", ld: true },
	{ path: "/about", id: "about", ld: true },
	{ path: "/changelog", id: "changelog", ld: true },
	{ path: "/changelog/0.17.0", id: "changelog-release", ld: true },
	{ path: "/articles", id: "articles", ld: true },
	{ path: "/articles/no-hold-no-work", id: "article-no-hold-no-work", ld: true },
	{ path: "/articles/agile-delivery-in-stages", id: "article-agile-delivery", ld: true },
	{ path: "/feedback", id: "feedback", ld: true },
	{
		path: "/about?feedback=open",
		id: "about-feedback-drawer",
		ld: true,
		dialog: "Feedback & roadmap",
	},
].filter((p) => p.path.includes(ONLY));

/** One rendering of every page: a width and a colour scheme, always with reduced motion. */
interface Variant {
	width: number;
	height: number;
	scheme: "light" | "dark";
}

const VARIANT_FILTER = (Deno.env.get("E2E_PUBLIC_VARIANTS") ?? "").split(",").filter(Boolean);

const VARIANTS: readonly Variant[] = [375, 768, 1280].flatMap((width) =>
	(["light", "dark"] as const).map((scheme) => ({
		width,
		height: width === 375 ? 812 : width === 768 ? 1024 : 900,
		scheme,
	}))
).filter((v) => VARIANT_FILTER.length === 0 || VARIANT_FILTER.includes(`${v.width}-${v.scheme}`));
// #endregion

// #region Harness
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

/** What one visit observed outside the page: errors, failed and refused requests. */
interface Observed {
	console: string[];
	failed: string[];
	aborted: Set<string>;
}

/**
 * A guest context for one variant that can only write through sign-in: every other non-GET `/api/**`
 * call is aborted (and remembered, so its console echo is not mistaken for a page error).
 */
async function guestContext(
	browser: Browser,
	variant: Variant,
	aborted: Set<string>,
): Promise<BrowserContext> {
	const context = await browser.newContext({
		baseURL: BASE,
		viewport: { width: variant.width, height: variant.height },
		colorScheme: variant.scheme,
		reducedMotion: "reduce",
	});
	// The theme CHOICE has its own pre-paint path (`localStorage.theme`, read by `_app.tsx`).
	await context.addInitScript((scheme: string) => {
		try {
			localStorage.setItem("theme", scheme);
		} catch { /* storage blocked: the colour-scheme media query answers the same */ }
	}, variant.scheme);
	await context.route("**/api/**", (route: Route) => {
		const req = route.request();
		const path = new URL(req.url()).pathname;
		if (req.method() === "GET" || path.startsWith("/api/auth/")) return route.continue();
		aborted.add(req.url());
		return route.abort();
	});
	return context;
}

/** Watch a page for console errors, uncaught throws and failed or ≥ 400 subresource requests. */
function observe(page: Page, aborted: Set<string>): Observed {
	const seen: Observed = { console: [], failed: [], aborted };
	page.on("console", (message) => {
		if (message.type() !== "error") return;
		const url = message.location().url;
		if (url && aborted.has(url)) return;
		seen.console.push(`${message.text()}${url ? ` (${url})` : ""}`);
	});
	page.on("pageerror", (error) => seen.console.push(`uncaught: ${error.message}`));
	page.on("response", (response) => {
		const req = response.request();
		if (req.resourceType() === "document" && req.frame() === page.mainFrame()) return;
		if (response.status() >= 400) {
			seen.failed.push(`${response.status()} ${req.resourceType()} ${req.url()}`);
		}
	});
	page.on("requestfailed", (req) => {
		if (aborted.has(req.url())) return;
		// A navigation away cancels in-flight requests; that is not a broken asset.
		const text = req.failure()?.errorText ?? "failed";
		if (text === "net::ERR_ABORTED") return;
		seen.failed.push(`${text} ${req.resourceType()} ${req.url()}`);
	});
	return seen;
}

/** Fresh revives islands on a later task; give them a moment, bounded by a quiet network. */
async function settle(page: Page): Promise<void> {
	await page.waitForLoadState("load");
	await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
	await page.waitForTimeout(1_000);
}

/**
 * Load every image on the page, below the fold included, and return the ones that did not decode. A
 * `loading="lazy"` image the viewport never reaches is never requested, so without this a broken
 * `/test_images` path, a blocked third-party host or a stock picture below the fold would pass the
 * run unseen — and the full-page screenshot would show an empty box where the image goes. Each lazy
 * image is switched to eager, the network settles, then every `<img>` must decode (bounded, so a
 * request that never answers is a finding rather than a hang). A failing request also reaches
 * {@link observe}'s subresource check.
 */
async function loadAllImages(page: Page): Promise<string[]> {
	await page.evaluate(() => {
		for (const img of document.querySelectorAll<HTMLImageElement>('img[loading="lazy"]')) {
			img.loading = "eager";
		}
	});
	await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
	return await page.evaluate(async () => {
		const broken: string[] = [];
		for (const img of document.querySelectorAll("img")) {
			const src = img.currentSrc || img.getAttribute("src") || img.getAttribute("srcset") || "";
			if (!src) {
				broken.push(`an <img> with no source (${img.className || img.alt || "unnamed"})`);
				continue;
			}
			const decoded = await Promise.race([
				img.decode().then(() => true, () => false),
				new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000)),
			]);
			if (!decoded) broken.push(src);
		}
		return broken;
	});
}

/** The page's structure, read in the page. */
interface Structure {
	h1: number;
	ld: boolean[];
	scrollWidth: number;
	clientWidth: number;
	title: string;
	lang: string;
}

function readStructure(page: Page): Promise<Structure> {
	return page.evaluate(() => ({
		h1: document.querySelectorAll("h1").length,
		ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => {
			try {
				JSON.parse(s.textContent ?? "");
				return true;
			} catch {
				return false;
			}
		}),
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
		title: document.title,
		lang: document.documentElement.lang,
	}));
}

/** Landmark counts as the accessibility tree exposes them (header/footer scoping included). */
async function landmarks(page: Page): Promise<Record<string, number>> {
	const out: Record<string, number> = {};
	for (const role of ["main", "banner", "contentinfo", "navigation"] as const) {
		out[role] = await page.getByRole(role).count();
	}
	return out;
}

/** One element axe-core flagged: where it is, axe's measurement, and for a contrast failure its colours. */
interface AxeNode {
	target: string;
	detail: string;
	fg?: string;
	bg?: string;
}

/** One axe-core violation, trimmed to what the report needs. */
interface AxeViolation {
	id: string;
	impact: string | null;
	help: string;
	nodes: AxeNode[];
}

const AXE_SOURCE = (axe as unknown as { source: string }).source;

/** Run axe-core's WCAG A/AA rules in the page (evaluated over CDP, so the page's CSP never sees it). */
async function runAxe(page: Page): Promise<AxeViolation[]> {
	const loaded = await page.evaluate(() => "axe" in globalThis);
	if (!loaded) await page.evaluate(AXE_SOURCE);
	return await page.evaluate(async (tags: string[]) => {
		// deno-lint-ignore no-explicit-any
		const run = (globalThis as any).axe.run as (
			context: Document,
			options: unknown,
		) => Promise<{
			violations: Array<{
				id: string;
				impact: string | null;
				help: string;
				nodes: Array<{
					target: string[];
					failureSummary?: string;
					any?: Array<{ data?: { fgColor?: string; bgColor?: string } | null }>;
				}>;
			}>;
		}>;
		const result = await run(document, {
			runOnly: { type: "tag", values: tags },
			resultTypes: ["violations"],
		});
		// The first line of axe's own explanation carries the measurement (a contrast ratio, the colours).
		const why = (summary: string | undefined) =>
			(summary ?? "").split("\n").map((s) => s.trim()).filter(Boolean).slice(1, 2).join("");
		return result.violations.map((v) => ({
			id: v.id,
			impact: v.impact,
			help: v.help,
			nodes: v.nodes.map((n) => {
				const data = n.any?.find((c) => c.data?.fgColor)?.data;
				return {
					target: n.target.join(" "),
					detail: why(n.failureSummary),
					fg: data?.fgColor?.toLowerCase(),
					bg: data?.bgColor?.toLowerCase(),
				};
			}),
		}));
	}, AXE_TAGS);
}

/** The page's brand pair as it resolved — `--primary` (the fill) and `--on-primary` (the ink) — in hex. */
function brandPair(page: Page): Promise<{ fill: string; ink: string }> {
	return page.evaluate(() => {
		const probe = document.createElement("span");
		probe.style.setProperty("position", "absolute");
		probe.style.setProperty("visibility", "hidden");
		probe.style.setProperty("color", "var(--on-primary)");
		probe.style.setProperty("background-color", "var(--primary)");
		document.body.append(probe);
		const style = getComputedStyle(probe);
		const hex = (rgb: string) =>
			"#" + (rgb.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3)
				.map((n) => Math.round(Number(n)).toString(16).padStart(2, "0")).join("");
		const pair = { fill: hex(style.backgroundColor), ink: hex(style.color) };
		probe.remove();
		return pair;
	});
}

/** WCAG 2 contrast ratio of two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
	const lum = (hex: string) => {
		const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) =>
			c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
		);
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * Run axe and file what it finds. One defect is filed as KNOWN rather than failed: a contrast failure
 * whose colours are exactly the page's own brand pair while that pair itself is under 4.5:1. That is
 * the token, not the component — the brand tones were re-split per mode at HEAD (`theme-engine.test.ts`'s
 * four pre-existing failures, which the owner holds for a decision) — so it is reported on every
 * page it touches and stops being reported the moment the pair clears AA. Any other colour pair, and
 * every other rule, fails the run.
 */
async function auditA11y(
	page: Page,
	file: (kind: Finding["kind"], detail: string) => void,
	note = "",
): Promise<void> {
	const brand = await brandPair(page);
	const brandFails = contrast(brand.fill, brand.ink) < 4.5;
	for (const violation of await runAxe(page)) {
		const isBrand = (n: AxeNode) =>
			violation.id === "color-contrast" && brandFails && n.fg === brand.ink &&
			n.bg === brand.fill;
		const known = violation.nodes.filter(isBrand);
		const rest = violation.nodes.filter((n) => !isBrand(n));
		const line = (nodes: AxeNode[]) =>
			nodes.slice(0, 6).map((n) => `${n.target}${n.detail ? ` (${n.detail})` : ""}`).join(" | ");
		if (known.length > 0) {
			file(
				"known",
				`axe color-contrast${note}: the brand pair ${brand.ink} on ${brand.fill} is ${
					contrast(brand.fill, brand.ink).toFixed(2)
				}:1 — ${known.map((n) => n.target).slice(0, 6).join(" | ")}`,
			);
		}
		if (rest.length > 0) {
			file(
				"a11y",
				`axe ${violation.id} (${violation.impact})${note}: ${violation.help} — ${line(rest)}`,
			);
		}
	}
}

/** A variant's short name: `375-dark`. */
const label = (v: Variant) => `${v.width}-${v.scheme}`;
// #endregion

// #region Report
/** Everything one page × variant got wrong. */
interface Finding {
	page: string;
	variant: string;
	kind:
		| "status"
		| "console"
		| "asset"
		| "structure"
		| "landmark"
		| "scroll"
		| "a11y"
		| "overlay"
		/** Reported, not failed: the pre-existing brand-pair contrast (see {@link auditA11y}). */
		| "known";
	detail: string;
}

/** What the report says about one page across every variant. */
interface PageReport {
	path: string;
	a11y: string[];
	assets: string[];
	other: string[];
	known: string[];
}

function summarise(findings: Finding[], pages: readonly PublicPage[]): PageReport[] {
	return pages.map((p) => {
		const mine = findings.filter((f) => f.page === p.path);
		const unique = (kind: Finding["kind"][]) => [
			...new Set(mine.filter((f) => kind.includes(f.kind)).map((f) => f.detail)),
		];
		return {
			path: p.path,
			a11y: unique(["a11y", "landmark", "structure", "overlay"]),
			assets: unique(["asset"]),
			other: unique(["status", "console", "scroll"]),
			known: unique(["known"]),
		};
	});
}
// #endregion

Deno.test({
	name: "public routes — every page × width × scheme: structure, landmarks, assets, axe",
	sanitizeOps: false,
	sanitizeResources: false,
	async fn(t) {
		await Deno.mkdir(SHOTS, { recursive: true });
		const browser = await launch();
		const findings: Finding[] = [];
		const add = (page: string, variant: string, kind: Finding["kind"], detail: string) =>
			findings.push({ page, variant, kind, detail });

		try {
			for (const variant of VARIANTS) {
				await t.step(`${label(variant)}, reduced motion`, async () => {
					const aborted = new Set<string>();
					const context = await guestContext(browser, variant, aborted);
					try {
						for (const spec of PAGES) {
							const v = label(variant);
							const page = await context.newPage();
							const seen = observe(page, aborted);
							try {
								const response = await page.goto(spec.path, {
									waitUntil: "load",
									timeout: 180_000,
								});
								const status = response?.status() ?? 0;
								if (status !== 200) add(spec.path, v, "status", `answered ${status}`);
								await settle(page);
								for (const src of await loadAllImages(page)) {
									add(spec.path, v, "asset", `image did not load or decode: ${src}`);
								}

								if (spec.dialog) {
									const dialog = page.getByRole("dialog", { name: spec.dialog });
									await dialog.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
									if (!(await dialog.isVisible())) {
										add(spec.path, v, "overlay", `the "${spec.dialog}" dialog did not open`);
									} else if ((await dialog.getAttribute("aria-modal")) !== "true") {
										add(spec.path, v, "overlay", "the dialog is not aria-modal");
									}
									await page.waitForTimeout(500);
								}

								const facts = await readStructure(page);
								if (facts.h1 !== 1) add(spec.path, v, "structure", `${facts.h1} <h1> elements`);
								if (!facts.title.trim()) add(spec.path, v, "structure", "an empty <title>");
								if (!facts.lang) add(spec.path, v, "structure", "<html> has no lang");
								if (spec.ld && facts.ld.length === 0) {
									add(spec.path, v, "structure", "no JSON-LD block");
								}
								facts.ld.forEach((ok, i) => {
									if (!ok) add(spec.path, v, "structure", `JSON-LD block ${i + 1} does not parse`);
								});
								if (facts.scrollWidth > facts.clientWidth) {
									add(
										spec.path,
										v,
										"scroll",
										`horizontal scroll: ${facts.scrollWidth}px wide in a ${facts.clientWidth}px viewport`,
									);
								}

								await auditA11y(page, (kind, detail) => add(spec.path, v, kind, detail));

								await page.screenshot({
									path: `${SHOTS}/${spec.id}__${v}.png`,
									fullPage: true,
								});

								if (spec.dialog && (await page.getByRole("dialog").count()) > 0) {
									// Escape closes the overlay and drops its address; the page beneath is whole again.
									await page.keyboard.press("Escape");
									await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 5_000 })
										.catch(() => {});
									if (await page.getByRole("dialog").isVisible()) {
										add(spec.path, v, "overlay", "Escape did not close the dialog");
									}
									await page.waitForTimeout(300);
									const left = [...new URL(spec.path, BASE).searchParams.keys()]
										.filter((key) => new URL(page.url()).searchParams.has(key));
									if (left.length > 0) {
										add(spec.path, v, "overlay", `closing left ?${left.join("&")} in the address`);
									}
									await auditA11y(
										page,
										(kind, detail) => add(spec.path, v, kind, detail),
										", overlay closed",
									);
								}

								const marks = await landmarks(page);
								if (marks.main !== 1) add(spec.path, v, "landmark", `${marks.main} main landmarks`);
								if (marks.banner !== 1) {
									add(spec.path, v, "landmark", `${marks.banner} banner landmarks`);
								}
								if (marks.contentinfo !== 1) {
									add(spec.path, v, "landmark", `${marks.contentinfo} contentinfo landmarks`);
								}
								if (marks.navigation < 1) add(spec.path, v, "landmark", "no navigation landmark");
							} catch (error) {
								add(spec.path, v, "status", `visit threw: ${(error as Error).message}`);
								await page.screenshot({ path: `${SHOTS}/${spec.id}__${v}.png`, fullPage: true })
									.catch(() => {});
							} finally {
								for (const line of seen.console) add(spec.path, v, "console", line);
								for (const line of seen.failed) add(spec.path, v, "asset", line);
								await page.close();
							}
						}
					} finally {
						await context.close();
					}
				});
			}
		} finally {
			await browser.close();
			const report = summarise(findings, PAGES);
			await Deno.writeTextFile(
				`${ARTIFACTS}/public-routes-report.json`,
				JSON.stringify({ findings, report }, null, "\t"),
			);
		}

		const known = findings.filter((f) => f.kind === "known");
		if (known.length > 0) {
			console.warn(
				`${known.length} known (pre-existing brand-pair contrast) — see public-routes-report.json`,
			);
		}
		const failures = findings.filter((f) => f.kind !== "known");
		if (failures.length > 0) {
			const lines = failures.map((f) => `${f.page} [${f.variant}] ${f.kind}: ${f.detail}`);
			throw new Error(`${failures.length} findings:\n${lines.join("\n")}`);
		}
	},
});

Deno.test({
	name: "public routes — the feeds, the PDF, the sitemap and robots.txt",
	sanitizeOps: false,
	sanitizeResources: false,
	async fn(t) {
		const browser = await launch();
		const context = await browser.newContext({ baseURL: BASE });
		const page = await context.newPage();
		await page.goto("/legal", { waitUntil: "load", timeout: 180_000 });
		/** Parse XML the way a feed reader would: the browser's DOMParser, no parser error. */
		const parses = (text: string, root: string) =>
			page.evaluate(({ text, root }) => {
				const doc = new DOMParser().parseFromString(text, "application/xml");
				return doc.getElementsByTagName("parsererror").length === 0 &&
					doc.documentElement.localName === root;
			}, { text, root });

		try {
			await t.step("the legal PDF is a PDF", async () => {
				const res = await context.request.get("/legal/terms/pdf");
				assertEquals(res.status(), 200);
				assert(res.headers()["content-type"]?.startsWith("application/pdf"));
				const head = new TextDecoder().decode((await res.body()).subarray(0, 5));
				assertEquals(head, "%PDF-");
			});

			await t.step("the changelog feed parses as RSS", async () => {
				const res = await context.request.get("/changelog/rss.xml");
				assertEquals(res.status(), 200);
				assert(/xml/.test(res.headers()["content-type"] ?? ""), res.headers()["content-type"]);
				assert(await parses(await res.text(), "rss"), "the feed is not well-formed RSS");
			});

			await t.step("the sitemap parses and every URL in it answers 200", async () => {
				const res = await context.request.get("/sitemap.xml");
				assertEquals(res.status(), 200);
				assert(/xml/.test(res.headers()["content-type"] ?? ""), res.headers()["content-type"]);
				const text = await res.text();
				assert(await parses(text, "urlset"), "the sitemap is not a well-formed urlset");
				const locs = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
				assert(locs.length > 0, "an empty sitemap");
				const origin = new URL(BASE).origin;
				const broken: string[] = [];
				for (const loc of locs) {
					const url = new URL(loc);
					if (url.origin !== origin) broken.push(`${loc} is off-origin`);
					const hit = await context.request.get(url.pathname + url.search, { maxRedirects: 0 });
					if (hit.status() !== 200) broken.push(`${loc} answered ${hit.status()}`);
				}
				assertEquals(broken, []);
				for (const path of ["/legal/workspace", "/feedback?feedback=open", "/api/"]) {
					assert(!locs.some((l) => new URL(l).pathname + new URL(l).search === path), path);
				}
			});

			await t.step("robots.txt keeps crawlers out of the app and names the sitemap", async () => {
				const res = await context.request.get("/robots.txt");
				assertEquals(res.status(), 200);
				assert(res.headers()["content-type"]?.startsWith("text/plain"));
				const text = await res.text();
				// The rule lines themselves, anchored — a comment that merely mentions a path must not pass.
				for (
					const rule of [
						/^Disallow: \/api\/$/m,
						/^Disallow: \/legal\/workspace\/$/m,
						/^Disallow: \/\*\?feedback=open$/m,
						/^Disallow: \/\*&feedback=open$/m,
					]
				) {
					assert(rule.test(text), `robots.txt lacks the rule ${rule}`);
				}
				assert(
					/^Sitemap: https?:\/\/\S+\/sitemap\.xml$/m.test(text),
					"robots.txt names no sitemap",
				);
			});
		} finally {
			await context.close();
			await browser.close();
		}
	},
});

Deno.test({
	name: "public routes — layout-shift budget on a mid-tier phone",
	sanitizeOps: false,
	sanitizeResources: false,
	async fn(t) {
		await Deno.mkdir(SHOTS, { recursive: true });
		const browser = await launch();
		const results: Array<{
			path: string;
			cls: number;
			scrolledCls: number;
			shifts: string[];
			blocking: string[];
			thirdParty: string[];
		}> = [];
		try {
			for (const path of ["/articles/no-hold-no-work", "/help/escrow-and-payments/fees"]) {
				await t.step(path, async () => {
					const context = await browser.newContext({
						baseURL: BUDGET_BASE,
						viewport: { width: 375, height: 812 },
						deviceScaleFactor: 2,
						isMobile: true,
						hasTouch: true,
						reducedMotion: "no-preference",
					});
					await context.addInitScript(() => {
						const store = {
							value: 0,
							shifts: [] as string[],
							supported: PerformanceObserver.supportedEntryTypes.includes("layout-shift"),
						};
						(globalThis as unknown as { __pjCls: typeof store }).__pjCls = store;
						new PerformanceObserver((list) => {
							for (
								const entry of list.getEntries() as Array<
									PerformanceEntry & {
										value: number;
										hadRecentInput: boolean;
										sources?: Array<{ node?: Node | null }>;
									}
								>
							) {
								if (entry.hadRecentInput) continue;
								store.value += entry.value;
								const nodes = (entry.sources ?? []).map((s) => {
									const el = s.node as Element | null | undefined;
									return el?.nodeName
										? `${el.nodeName.toLowerCase()}${
											el.className && typeof el.className === "string"
												? `.${el.className.trim().split(/\s+/).join(".")}`
												: ""
										}`
										: "?";
								});
								store.shifts.push(`${entry.value.toFixed(4)} ${nodes.join(", ")}`);
							}
						}).observe({ type: "layout-shift", buffered: true });
					});
					const page = await context.newPage();
					try {
						const cdp = await context.newCDPSession(page);
						await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
						await cdp.send("Network.enable");
						// Lighthouse's mobile profile: 150 ms RTT, 1.6 Mbps down, 750 kbps up.
						await cdp.send("Network.emulateNetworkConditions", {
							offline: false,
							latency: 150,
							downloadThroughput: (1.6 * 1024 * 1024) / 8,
							uploadThroughput: (750 * 1024) / 8,
						});
						const response = await page.goto(path, { waitUntil: "load", timeout: 300_000 });
						assertEquals(response?.status(), 200);
						await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
						await page.waitForTimeout(3_000);
						const measured = await page.evaluate(() => {
							const store = (globalThis as unknown as {
								__pjCls: { value: number; shifts: string[]; supported: boolean };
							}).__pjCls;
							const own = location.origin;
							const resources = performance.getEntriesByType("resource") as Array<
								PerformanceResourceTiming & { renderBlockingStatus?: string }
							>;
							const blocking = resources
								.filter((r) => r.renderBlockingStatus === "blocking")
								.map((r) => r.name)
								.filter((name) => new URL(name).origin !== own);
							// The markup's own word, for engines without renderBlockingStatus.
							for (
								const el of document.head.querySelectorAll("link[rel~=stylesheet], script[src]")
							) {
								const href = el.getAttribute("href") ?? el.getAttribute("src") ?? "";
								const url = new URL(href, location.href);
								if (url.origin === own) continue;
								const script = el as HTMLScriptElement;
								const deferred = el.localName === "script" &&
									(script.async || script.defer || script.type === "module");
								const media = el.getAttribute("media");
								if (!deferred && (!media || media === "all")) blocking.push(url.href);
							}
							const thirdParty = [
								...new Set(resources.map((r) => new URL(r.name).origin).filter((o) => o !== own)),
							];
							return {
								cls: store.value,
								supported: store.supported,
								shifts: [...store.shifts],
								blocking: [...new Set(blocking)],
								thirdParty,
							};
						});
						assert(measured.supported, "this browser does not report layout-shift entries");
						await page.screenshot({
							path: `${SHOTS}/cls-${path.split("/").pop()}__375-mobile.png`,
						});
						// Then read to the end, as a reader would: lazy images and late islands must not shift it either.
						const height = await page.evaluate(() => document.documentElement.scrollHeight);
						for (let y = 0; y < height; y += 600) {
							await page.mouse.wheel(0, 600);
							await page.waitForTimeout(250);
						}
						await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
						await page.waitForTimeout(1_500);
						const after = await page.evaluate(() =>
							(globalThis as unknown as { __pjCls: { value: number; shifts: string[] } }).__pjCls
						);
						results.push({
							path,
							cls: measured.cls,
							scrolledCls: after.value,
							shifts: after.shifts,
							blocking: measured.blocking,
							thirdParty: measured.thirdParty,
						});
					} finally {
						await page.close();
						await context.close();
					}
				});
			}
		} finally {
			await browser.close();
			await Deno.writeTextFile(
				`${ARTIFACTS}/public-routes-cls.json`,
				JSON.stringify(results, null, "\t"),
			);
		}
		for (const r of results) {
			assert(
				r.cls < CLS_BUDGET,
				`${r.path}: CLS ${r.cls.toFixed(4)} ≥ ${CLS_BUDGET} while loading\n${r.shifts.join("\n")}`,
			);
			assert(
				r.scrolledCls < CLS_BUDGET,
				`${r.path}: CLS ${r.scrolledCls.toFixed(4)} ≥ ${CLS_BUDGET} after reading to the end\n${
					r.shifts.join("\n")
				}`,
			);
			assertEquals(r.blocking, [], `${r.path}: render-blocking third-party resources`);
		}
	},
});
