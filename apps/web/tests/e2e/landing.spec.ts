/// <reference lib="dom" />
import { assert, assertEquals } from "@std/assert";
import { type Browser, type BrowserContext, chromium, type Page } from "npm:playwright-core@1.56.1";

/**
 * landing.spec — the landing pages' launch smoke (work order L6 of
 * `flows/PUBLIC_ROUTES_BUILD_PROMPTS.md`; `flows/LANDING.md` §4.0, §4.1, §4.4, §4.10, §4.12):
 *
 * - **SEO** on `/` and `/features`: the §4.0 / §4.12 `<title>` and meta description ("escrow" in the
 *   landing's), one canonical (the page's path, no query), `index, follow`, the Open Graph block and
 *   the Twitter card `applyPageMeta` writes, exactly one `<h1>`, headings that never skip a level,
 *   and the JSON-LD graph: Organization, WebSite with a `SearchAction` into
 *   `{origin}/explore?q={search_term_string}` and a FAQPage whose every question and answer is the
 *   visible FAQ's text on `/`; WebPage and an ItemList of the printed rows on `/features`. The head
 *   tags must also sit in the document's `<head>`, where crawlers read them. Then `/sitemap.xml`
 *   lists both pages and `robots.txt` lets crawlers in.
 * - **Smoke** at 375 / 768 / 1280 / 1600 px, light and dark, on both pages: no console error or
 *   uncaught throw, no failed or ≥ 400 subresource request (an unresolved `/test_images` path, a
 *   missing chunk or font), every image decodes (lazy ones forced eager), no horizontal scroll, one
 *   `<h1>`, and the colour scheme applied. A full-page screenshot of each is saved.
 * - **The hero search** reaches `/explore` with `q` and `category`, hydrated (type, then Enter; the
 *   category sheet below `--bp-md`) and without JavaScript (the plain form submit), and so does the
 *   final call to action's search.
 * - **Deep links**: `?demo=payments` opens the Payment protection tab with and without JavaScript, and
 *   `?tkv=` answers `303` to the same address without it, every other parameter kept.
 * - **Focus after a refused move** (WCAG 2.4.3): on a phone, where a Work board card cannot be
 *   dragged, choosing a lane the board refuses from the card's "Move to…" leaves focus on that
 *   "Move to…", on `/` and inside `/features`' "Try it" dialog — never on `<body>`.
 *
 * It reads the pages by what they print and name (roles, field names, ids from the copy deck), never
 * the landing's own classes. Every page is visited as a guest; every non-GET `/api/**` call except
 * `/api/auth/*` is answered `204` in the browser, so nothing is written.
 *
 * It drives a RUNNING server (`deno task test:e2e`): `E2E_LANDING_URL`, else `E2E_BASE_URL`, else
 * `http://localhost:13217` (the `web-catalogue-e2e` launch config the catalogue suite uses). For the
 * launch gate, point it at the production build: `deno task build`, then `deno task serve` (or
 * `deno serve -A --port <port> apps/web/_fresh/server.js`).
 *
 * Environment: `E2E_SITE_ORIGIN` (the origin the pages publish in canonical URLs and JSON-LD —
 * `siteOrigin()`: `APP_URL` in production, else the request's; default the base URL's origin),
 * `E2E_CHROMIUM` (a browser executable; else `/opt/pw-browsers/chromium` when present, else the
 * Playwright-managed Chromium, else installed Chrome), `E2E_ARTIFACTS` (the report and failure
 * screenshots), `E2E_SHOTS` (the smoke's screenshots; default `<artifacts>/shots`).
 */

// #region Configuration
const BASE = Deno.env.get("E2E_LANDING_URL") ?? Deno.env.get("E2E_BASE_URL") ??
	"http://localhost:13217";
const ORIGIN = new URL(BASE).origin;
const SITE = (Deno.env.get("E2E_SITE_ORIGIN") ?? ORIGIN).replace(/\/+$/, "");
const ARTIFACTS = Deno.env.get("E2E_ARTIFACTS") ??
	Deno.makeTempDirSync({ prefix: "pj-e2e-landing-" });
const SHOTS = Deno.env.get("E2E_SHOTS") ?? `${ARTIFACTS}/shots`;

/** One landing page's head copy, word for word from the copy deck. */
interface PageHead {
	path: "/" | "/features";
	/** A file-safe name for screenshots. */
	id: string;
	title: string;
	description: string;
	ogTitle: string;
	ogDescription: string;
	h1: string;
}

const HEADS: readonly PageHead[] = [
	{
		// `flows/LANDING.md` §4.0, §4.1 (headline option 1).
		path: "/",
		id: "home",
		title: "Projective — Hire a ready-made team with payment protection",
		description:
			"Hire a ready-made team and pay one stage at a time. Payment protection (escrow) holds your money safely, and the team is paid when you approve.",
		ogTitle: "Hire a ready-made team with payment protection",
		ogDescription:
			"Search freelancers, teams and services. Pay for each stage before it starts. The team is paid when you approve.",
		h1: "Hire a ready-made team. Pay one stage at a time.",
	},
	{
		// `flows/LANDING.md` §4.12: the page's Open Graph pair is its document title and description.
		path: "/features",
		id: "features",
		title: "Projective features — teams, boards and payment protection",
		description:
			"See everything Projective does: ready-made teams, work boards, booking, team pay and payment protection for every stage.",
		ogTitle: "Projective features — teams, boards and payment protection",
		ogDescription:
			"See everything Projective does: ready-made teams, work boards, booking, team pay and payment protection for every stage.",
		h1: "Everything Projective does",
	},
];

/** One rendering: a width, its height and a colour scheme. */
interface Variant {
	width: number;
	height: number;
	scheme: "light" | "dark";
}

const HEIGHTS: Readonly<Record<number, number>> = { 375: 812, 768: 1024, 1280: 800, 1600: 900 };

const VARIANTS: readonly Variant[] = [375, 768, 1280, 1600].flatMap((width) =>
	(["light", "dark"] as const).map((scheme) => ({ width, height: HEIGHTS[width], scheme }))
);

/** The hero's search controls by their field names; the shortcut marks the hydrated hero. */
const HERO_FORM = 'form[role="search"]';
const FINAL_FORM = '#get-started form[role="search"]';
const HYDRATED_QUERY = 'input[name="q"][aria-keyshortcuts="/"]';
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

/**
 * A guest context for one variant: a phone below 768 px (touch, mobile viewport), the theme choice
 * pre-set for the pre-paint script, and every write answered in the browser so nothing is stored.
 */
async function contextFor(
	browser: Browser,
	variant: Variant,
	options: { javaScriptEnabled?: boolean } = {},
): Promise<BrowserContext> {
	const phone = variant.width < 768;
	const javaScriptEnabled = options.javaScriptEnabled ?? true;
	const context = await browser.newContext({
		baseURL: BASE,
		viewport: { width: variant.width, height: variant.height },
		colorScheme: variant.scheme,
		isMobile: phone,
		hasTouch: phone,
		javaScriptEnabled,
	});
	if (javaScriptEnabled) {
		await context.addInitScript((scheme: string) => {
			try {
				localStorage.setItem("theme", scheme);
			} catch { /* storage blocked: the colour-scheme media query answers the same */ }
		}, variant.scheme);
	}
	await context.route(`${ORIGIN}/api/**`, (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (request.method() === "GET" || path.startsWith("/api/auth/")) return route.fallback();
		return route.fulfill({ status: 204, body: "" });
	});
	return context;
}

/** What one visit observed outside the page. */
interface Observed {
	console: string[];
	failed: string[];
}

/**
 * Watch a page for console errors, uncaught throws and failed or ≥ 400 subresource requests. A
 * navigation away cancels in-flight requests (`net::ERR_ABORTED`), and with JavaScript off the
 * browser refuses every script itself; neither is a broken asset.
 */
function observe(page: Page, javaScriptEnabled = true): Observed {
	const seen: Observed = { console: [], failed: [] };
	page.on("console", (message) => {
		if (message.type() !== "error") return;
		const url = message.location().url;
		seen.console.push(`${message.text()}${url ? ` (${url})` : ""}`);
	});
	page.on("pageerror", (error) => seen.console.push(`uncaught: ${error.message}`));
	page.on("response", (response) => {
		const request = response.request();
		if (request.resourceType() === "document" && request.frame() === page.mainFrame()) return;
		if (response.status() >= 400) {
			seen.failed.push(`${response.status()} ${request.resourceType()} ${request.url()}`);
		}
	});
	page.on("requestfailed", (request) => {
		const text = request.failure()?.errorText ?? "failed";
		if (text === "net::ERR_ABORTED") return;
		if (!javaScriptEnabled && request.resourceType() === "script") return;
		seen.failed.push(`${text} ${request.resourceType()} ${request.url()}`);
	});
	return seen;
}

/** Fresh revives islands on a later task; give them a moment, bounded by a quiet network. */
async function settle(page: Page, ms = 1_000): Promise<void> {
	await page.waitForLoadState("load");
	await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
	await page.waitForTimeout(ms);
}

/** Read the page top to bottom, so lazy sections, posters and images load, then return to the top. */
async function readThrough(page: Page): Promise<void> {
	const height = await page.evaluate(() => document.documentElement.scrollHeight);
	const step = await page.evaluate(() => Math.round(innerHeight * 0.8));
	for (let y = 0; y < height + step; y += step) {
		await page.evaluate((top) => scrollTo(0, top), y);
		await page.waitForTimeout(200);
	}
	await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
	await page.evaluate(() => scrollTo(0, 0));
	await page.waitForTimeout(300);
}

/**
 * Load every image, lazy ones included, and return the ones that did not decode (bounded, so a
 * request that never answers is a finding rather than a hang).
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
			const src = img.currentSrc || img.getAttribute("src") || "";
			if (!src) {
				broken.push(`an <img> with no source (${img.alt || "unnamed"})`);
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

/** The page's head and structure, read in the page. */
interface HeadFacts {
	title: string;
	descriptions: string[];
	canonicals: string[];
	robots: string[];
	og: Record<string, string[]>;
	twitter: Record<string, string[]>;
	h1: string[];
	/** The rendered headings' levels, in document order. */
	levels: Array<{ level: number; text: string }>;
	ld: string[];
}

function headFacts(page: Page): Promise<HeadFacts> {
	return page.evaluate(() => {
		const text = (el: Element | null | undefined) =>
			(el?.textContent ?? "").replace(/\s+/g, " ").trim();
		const contents = (selector: string) =>
			[...document.querySelectorAll<HTMLMetaElement>(selector)].map((m) => m.content);
		const grouped = (selector: string, attribute: string) => {
			const out: Record<string, string[]> = {};
			for (const meta of document.querySelectorAll<HTMLMetaElement>(selector)) {
				(out[meta.getAttribute(attribute) ?? ""] ??= []).push(meta.content);
			}
			return out;
		};
		return {
			title: document.title,
			descriptions: contents('meta[name="description"]'),
			canonicals: [...document.querySelectorAll('link[rel="canonical"]')].map((l) =>
				l.getAttribute("href") ?? ""
			),
			robots: contents('meta[name="robots"]'),
			og: grouped('meta[property^="og:"]', "property"),
			twitter: grouped('meta[name^="twitter:"]', "name"),
			h1: [...document.querySelectorAll("h1")].map(text),
			levels: [...document.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")]
				.filter((h) => h.checkVisibility() && !h.closest("[hidden],[inert]"))
				.map((h) => ({ level: Number(h.tagName[1]), text: text(h).slice(0, 60) })),
			ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) =>
				s.textContent ?? ""
			),
		};
	});
}

/** Every place the heading outline skips a level going down, and whether it opens with the h1. */
function outlineProblems(levels: HeadFacts["levels"]): string[] {
	const problems: string[] = [];
	if (levels[0]?.level !== 1) problems.push(`the first heading is h${levels[0]?.level ?? "?"}`);
	for (let i = 1; i < levels.length; i++) {
		if (levels[i].level > levels[i - 1].level + 1) {
			problems.push(
				`h${levels[i - 1].level} "${levels[i - 1].text}" → h${levels[i].level} "${levels[i].text}"`,
			);
		}
	}
	return problems;
}

/** One schema.org node. */
type LdNode = Record<string, unknown> & { "@type"?: string; "@id"?: string };

/** Every node of every JSON-LD block (a `@graph`, an array or one node); throws if one does not parse. */
function ldNodes(blocks: readonly string[]): LdNode[] {
	return blocks.flatMap((block) => {
		const value = JSON.parse(block) as LdNode | LdNode[];
		if (Array.isArray(value)) return value;
		return Array.isArray(value["@graph"]) ? value["@graph"] as LdNode[] : [value];
	});
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Whether robots.txt lets a crawler fetch `path` under `User-agent: *` (the longest matching rule
 * wins; `Allow` wins a tie), with the rules that matched.
 */
function robotsAllows(txt: string, path: string): { allowed: boolean; matched: string[] } {
	const rules: Array<{ allow: boolean; pattern: string }> = [];
	let inStar = false;
	let lastWasAgent = false;
	for (const raw of txt.split(/\r?\n/)) {
		const line = raw.replace(/#.*/, "").trim();
		if (!line) continue;
		const cut = line.indexOf(":");
		const key = line.slice(0, cut).trim().toLowerCase();
		const value = line.slice(cut + 1).trim();
		if (key === "user-agent") {
			inStar = (lastWasAgent && inStar) || value === "*";
			lastWasAgent = true;
			continue;
		}
		lastWasAgent = false;
		if (inStar && (key === "allow" || key === "disallow") && value) {
			rules.push({ allow: key === "allow", pattern: value });
		}
	}
	const matches = (pattern: string) => {
		const anchored = pattern.endsWith("$");
		const body = (anchored ? pattern.slice(0, -1) : pattern).split("*")
			.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
		return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
	};
	const hits = rules.filter((r) => matches(r.pattern))
		.sort((a, b) => b.pattern.length - a.pattern.length || Number(b.allow) - Number(a.allow));
	return {
		allowed: hits.length === 0 || hits[0].allow,
		matched: hits.map((r) => `${r.allow ? "Allow" : "Disallow"}: ${r.pattern}`),
	};
}

/** Where a navigation landed: its path and the two parameters a search carries. */
function searchOf(url: string): { path: string; category: string | null; q: string | null } {
	const parsed = new URL(url);
	return {
		path: parsed.pathname,
		category: parsed.searchParams.get("category"),
		q: parsed.searchParams.get("q"),
	};
}

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
	await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage }).catch(() => {});
}

/** A variant's short name: `375-dark`. */
const label = (v: Variant) => `${v.width}-${v.scheme}`;
// #endregion

Deno.test({
	name: "landing SEO — head, one h1, heading order and JSON-LD on / and /features",
	sanitizeOps: false,
	sanitizeResources: false,
	async fn(t) {
		await Deno.mkdir(SHOTS, { recursive: true });
		const browser = await launch();
		try {
			for (const head of HEADS) {
				await t.step(head.path, async () => {
					const context = await contextFor(browser, VARIANTS[4], { javaScriptEnabled: false });
					const page = await context.newPage();
					try {
						// What a crawler without JavaScript is sent.
						const raw = await context.request.get(head.path);
						assertEquals(raw.status(), 200);
						const html = await raw.text();
						assertEquals((html.match(/<h1[\s>]/g) ?? []).length, 1, "one <h1> in the HTML sent");
						assert(
							/<script[^>]*type="application\/ld\+json"/.test(html),
							"JSON-LD in the HTML sent",
						);

						await page.goto(head.path, { waitUntil: "load", timeout: 120_000 });
						const facts = await headFacts(page);
						const canonical = `${SITE}${head.path}`;
						assertEquals(facts.title, head.title);
						assertEquals(facts.descriptions, [head.description]);
						if (head.path === "/") {
							assert(/escrow/i.test(facts.descriptions[0]), "the meta description says escrow");
						}
						assertEquals(facts.canonicals, [canonical]);
						assertEquals(facts.robots, ["index, follow"]);
						assertEquals(facts.og["og:type"], ["website"]);
						assertEquals(facts.og["og:site_name"], ["Projective"]);
						assertEquals(facts.og["og:title"], [head.ogTitle]);
						assertEquals(facts.og["og:description"], [head.ogDescription]);
						assertEquals(facts.og["og:url"], [canonical]);
						const card = facts.twitter["twitter:card"] ?? [];
						assertEquals(card.length, 1, "one twitter:card");
						assertEquals(card[0], facts.og["og:image"] ? "summary_large_image" : "summary");
						assertEquals(facts.h1, [head.h1]);
						assertEquals(outlineProblems(facts.levels), [], "the heading outline skips no level");

						const nodes = ldNodes(facts.ld);
						const ofType = (type: string) => nodes.filter((n) => n["@type"] === type);
						assertEquals(ofType("Organization").length, 1, "one Organization");
						assertEquals(ofType("WebSite").length, 1, "one WebSite");
						if (head.path === "/") {
							const action = ofType("WebSite")[0].potentialAction as LdNode | undefined;
							assertEquals(action?.["@type"], "SearchAction");
							const target = action?.target as string | LdNode | undefined;
							assertEquals(
								typeof target === "string" ? target : target?.urlTemplate,
								`${SITE}/explore?q={search_term_string}`,
							);
							assertEquals(action?.["query-input"], "required name=search_term_string");
							const faq = ofType("FAQPage");
							assertEquals(faq.length, 1, "one FAQPage");
							const listed = (faq[0].mainEntity as LdNode[]).map((q) => ({
								question: String(q.name),
								answer: String((q.acceptedAnswer as LdNode).text),
							}));
							const visible = await page.evaluate(() =>
								[...document.querySelectorAll("#faq details")].map((d) => ({
									question: d.querySelector("summary > span")?.textContent ?? "",
									answer: d.querySelector(":scope > p")?.textContent ?? "",
								}))
							);
							assert(visible.length > 0, "the FAQ prints its questions");
							assertEquals(listed, visible, "the FAQPage is the visible FAQ, word for word");
							assert(
								/escrow/i.test(JSON.stringify(faq[0])),
								"the FAQPage keeps escrow (Decision #283 (C))",
							);
						} else {
							const pages = ofType("WebPage");
							const lists = ofType("ItemList");
							assertEquals(pages.length, 1, "one WebPage");
							assertEquals(lists.length, 1, "one ItemList");
							assertEquals((pages[0].mainEntity as LdNode)?.["@id"], lists[0]["@id"]);
							const items = (lists[0].itemListElement as LdNode[]).map((item) => ({
								name: String(item.name),
								description: String(item.description),
								id: String(item.url ?? "").split("#")[1] ?? "",
							}));
							assert(items.length > 0, "the ItemList lists the rows");
							const printed = await page.evaluate(
								(ids) =>
									ids.map((id) => {
										const row = document.getElementById(id);
										return {
											h3: row?.querySelector("h3")?.textContent ?? null,
											text: row?.textContent ?? "",
										};
									}),
								items.map((i) => i.id),
							);
							items.forEach((item, i) => {
								assertEquals(squash(printed[i].h3 ?? ""), squash(item.name), `row ${item.id}`);
								assert(
									squash(printed[i].text).includes(squash(item.description)),
									`row ${item.id} prints its description`,
								);
							});
							const order = await page.evaluate(() =>
								[...document.querySelectorAll("main li[id] > h3")].map((h) => h.parentElement!.id)
							);
							assertEquals(items.map((i) => i.id), order, "the ItemList is in page order");
						}
					} catch (error) {
						await shot(page, `seo-${head.id}`);
						throw error;
					} finally {
						await context.close();
					}

					// Hydrated: still one h1, and the graph neither doubles nor drops a node.
					const live = await contextFor(browser, VARIANTS[4]);
					const hydrated = await live.newPage();
					try {
						await hydrated.goto(head.path, { waitUntil: "load", timeout: 120_000 });
						await settle(hydrated, 1_500);
						const facts = await headFacts(hydrated);
						assertEquals(facts.h1, [head.h1]);
						const types = ldNodes(facts.ld).map((n) => n["@type"]).sort();
						assertEquals(
							types,
							head.path === "/"
								? ["FAQPage", "Organization", "WebSite"]
								: ["ItemList", "Organization", "WebPage", "WebSite"],
						);
					} finally {
						await live.close();
					}
				});
			}
		} finally {
			await browser.close();
		}
	},
});

Deno.test({
	name: "landing SEO — every head tag sits in the document's <head>",
	sanitizeOps: false,
	sanitizeResources: false,
	async fn(t) {
		const browser = await launch();
		try {
			for (const head of HEADS) {
				await t.step(head.path, async () => {
					const context = await contextFor(browser, VARIANTS[4], { javaScriptEnabled: false });
					try {
						const html = await (await context.request.get(head.path)).text();
						const page = await context.newPage();
						await page.goto(head.path, { waitUntil: "load", timeout: 120_000 });
						// A crawler reads the canonical, robots, description and social tags only from <head>.
						// Fresh writes the document's own <head> only when it sees `head` and `body` as
						// elements; precompiled into a JSX template they are invisible to it, and it wraps the
						// page in a second document whose body swallows every tag below (`apps/web/deno.json`
						// `jsxPrecompileSkipElements` keeps them elements).
						const outside = await page.evaluate(() =>
							[
								"title",
								'meta[name="description"]',
								'link[rel="canonical"]',
								'meta[name="robots"]',
								'meta[property^="og:"]',
								'meta[name^="twitter:"]',
							].flatMap((selector) =>
								[...document.querySelectorAll(selector)]
									.filter((el) => !el.closest("svg") && !document.head.contains(el))
									.map((el) => el.outerHTML.slice(0, 90))
							)
						);
						assertEquals(
							{ heads: (html.match(/<head[\s>]/g) ?? []).length, outsideHead: outside },
							{ heads: 1, outsideHead: [] },
							"one <head>, holding every head tag",
						);
					} finally {
						await context.close();
					}
				});
			}
		} finally {
			await browser.close();
		}
	},
});

Deno.test({
	name: "landing SEO — the sitemap lists / and /features; robots.txt lets crawlers in",
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		const browser = await launch();
		const context = await browser.newContext({ baseURL: BASE });
		try {
			const sitemap = await context.request.get("/sitemap.xml");
			assertEquals(sitemap.status(), 200);
			assert(/xml/.test(sitemap.headers()["content-type"] ?? ""), "the sitemap is XML");
			const locs = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
			for (const head of HEADS) {
				assert(locs.includes(`${SITE}${head.path}`), `the sitemap lists ${SITE}${head.path}`);
			}

			const robots = await context.request.get("/robots.txt");
			assertEquals(robots.status(), 200);
			const txt = await robots.text();
			for (const path of ["/", "/features", "/?demo=payments", "/features?section=money"]) {
				const verdict = robotsAllows(txt, path);
				assert(verdict.allowed, `robots.txt disallows ${path}: ${verdict.matched.join(", ")}`);
			}
			assert(/^Sitemap: https?:\/\/\S+\/sitemap\.xml$/m.test(txt), "robots.txt names the sitemap");
		} finally {
			await context.close();
			await browser.close();
		}
	},
});

Deno.test({
	name: "landing smoke — / and /features at 375/768/1280/1600, light and dark",
	sanitizeOps: false,
	sanitizeResources: false,
	async fn(t) {
		await Deno.mkdir(SHOTS, { recursive: true });
		const browser = await launch();
		const findings: string[] = [];
		const report: Array<Record<string, unknown>> = [];
		try {
			for (const variant of VARIANTS) {
				await t.step(label(variant), async () => {
					const context = await contextFor(browser, variant);
					try {
						for (const head of HEADS) {
							const page = await context.newPage();
							const seen = observe(page);
							const where = `${head.path} [${label(variant)}]`;
							try {
								const response = await page.goto(head.path, {
									waitUntil: "load",
									timeout: 120_000,
								});
								if (response?.status() !== 200) {
									findings.push(`${where} answered ${response?.status()}`);
								}
								await settle(page);
								const theme = await page.evaluate(() => document.documentElement.dataset.theme);
								if (theme !== variant.scheme) findings.push(`${where} data-theme is ${theme}`);
								await readThrough(page);
								for (const src of await loadAllImages(page)) {
									findings.push(`${where} image did not load or decode: ${src}`);
								}
								const facts = await page.evaluate(() => ({
									h1: document.querySelectorAll("h1").length,
									scrollWidth: document.documentElement.scrollWidth,
									clientWidth: document.documentElement.clientWidth,
								}));
								if (facts.h1 !== 1) findings.push(`${where} ${facts.h1} <h1> elements`);
								if (facts.scrollWidth > facts.clientWidth) {
									findings.push(
										`${where} horizontal scroll: ${facts.scrollWidth}px in a ${facts.clientWidth}px viewport`,
									);
								}
								report.push({ page: head.path, variant: label(variant), theme, ...facts });
								await shot(page, `${head.id}__${label(variant)}`, true);
							} catch (error) {
								findings.push(`${where} visit threw: ${(error as Error).message}`);
								await shot(page, `${head.id}__${label(variant)}`);
							} finally {
								for (const line of seen.console) findings.push(`${where} console: ${line}`);
								for (const line of seen.failed) findings.push(`${where} request: ${line}`);
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
			await Deno.writeTextFile(
				`${ARTIFACTS}/landing-smoke-report.json`,
				JSON.stringify({ findings, report }, null, "\t"),
			);
		}
		assertEquals(findings, [], `${findings.length} findings`);
	},
});

Deno.test({
	name: "landing hero search reaches /explore with q and category — with JavaScript and without",
	sanitizeOps: false,
	sanitizeResources: false,
	async fn(t) {
		await Deno.mkdir(SHOTS, { recursive: true });
		const browser = await launch();
		/**
		 * Search from one form: pick the category (the native select where it shows, else the
		 * hydrated category sheet), type or fill the query, submit, and return where it landed.
		 */
		const search = async (
			variant: Variant,
			javaScriptEnabled: boolean,
			form: string,
			query: { category: string; label: string; q: string },
			submit: "enter" | "button",
		) => {
			const context = await contextFor(browser, variant, { javaScriptEnabled });
			const page = await context.newPage();
			const seen = observe(page, javaScriptEnabled);
			try {
				await page.goto("/", { waitUntil: "load", timeout: 120_000 });
				if (javaScriptEnabled) await page.waitForSelector(HYDRATED_QUERY, { timeout: 30_000 });
				const scope = page.locator(form).first();
				const select = scope.locator('select[name="category"]');
				if (await select.isVisible()) {
					await select.selectOption(query.category);
				} else {
					const opener = scope.locator('button[aria-haspopup="dialog"]');
					await opener.click();
					const sheet = page.getByRole("dialog", { name: "Search in" });
					await sheet.waitFor({ state: "visible", timeout: 10_000 });
					await sheet.getByText(query.label, { exact: true }).click();
					await sheet.waitFor({ state: "hidden", timeout: 10_000 });
					assertEquals(
						await opener.getAttribute("aria-label"),
						`Choose what to search (now: ${query.label})`,
					);
				}
				const input = scope.locator('input[name="q"]');
				await input.click();
				if (javaScriptEnabled) await page.keyboard.type(query.q, { delay: 25 });
				else await input.fill(query.q);
				await Promise.all([
					page.waitForURL(/\/explore/, { timeout: 30_000, waitUntil: "commit" }),
					submit === "enter"
						? input.press("Enter")
						: scope.getByRole("button", { name: "Search", exact: true }).click(),
				]);
				assertEquals(searchOf(page.url()), {
					path: "/explore",
					category: query.category,
					q: query.q,
				});
				await page.waitForLoadState("load");
				assert(
					await page.evaluate(
						(q) =>
							[...document.querySelectorAll<HTMLInputElement>('input[name="q"]')].some((i) =>
								i.value === q
							),
						query.q,
					),
					"Explore shows the query",
				);
				assertEquals(seen.console, [], "no console error");
				assertEquals(seen.failed, [], "no failed request");
			} catch (error) {
				await shot(page, `search-${javaScriptEnabled ? "js" : "nojs"}-${label(variant)}`);
				throw error;
			} finally {
				await context.close();
			}
		};
		const hero = { category: "freelancers", label: "Freelancers & teams", q: "landing page" };
		const final = { category: "services", label: "Services", q: "design system" };
		try {
			for (const variant of [VARIANTS[0], VARIANTS[4]]) {
				await t.step(`hydrated, type + Enter, ${label(variant)}`, async () => {
					await search(variant, true, HERO_FORM, hero, "enter");
				});
				await t.step(`no JavaScript, form submit, ${label(variant)}`, async () => {
					await search(variant, false, HERO_FORM, hero, "enter");
				});
			}
			await t.step("the final call to action's search, no JavaScript, Search pressed", async () => {
				await search(VARIANTS[5], false, FINAL_FORM, final, "button");
			});
		} finally {
			await browser.close();
		}
	},
});

Deno.test({
	name: "landing deep links — ?demo=payments opens its tab; ?tkv= answers 303 and keeps the rest",
	sanitizeOps: false,
	sanitizeResources: false,
	async fn(t) {
		const browser = await launch();
		/** The demo stage's tabs as the page marks them: label, selection and whether its panel shows. */
		const tabs = (page: Page) =>
			page.evaluate(() =>
				[...document.querySelectorAll('[role="tablist"] [role="tab"]')].map((tab) => ({
					label: (tab.textContent ?? "").trim(),
					selected: tab.getAttribute("aria-selected") === "true",
					shown: !document.getElementById(tab.getAttribute("aria-controls") ?? "")?.hidden,
				}))
			);
		const paymentsOpen = (
			list: Array<{ label: string; selected: boolean; shown: boolean }>,
		) =>
			list.length === 4 &&
			list.every((tab) =>
				tab.selected === (tab.label === "Payment protection") &&
				tab.shown === tab.selected
			);
		try {
			for (const javaScriptEnabled of [false, true]) {
				await t.step(
					`?demo=payments ${javaScriptEnabled ? "hydrated" : "without JavaScript"}`,
					async () => {
						const context = await contextFor(browser, VARIANTS[5], { javaScriptEnabled });
						const page = await context.newPage();
						try {
							await page.goto("/?demo=payments", { waitUntil: "load", timeout: 120_000 });
							if (javaScriptEnabled) await settle(page, 1_500);
							const list = await tabs(page);
							assert(paymentsOpen(list), JSON.stringify(list));
						} finally {
							await context.close();
						}
					},
				);
			}

			await t.step("?tkv= answers 303 to the same address without it", async () => {
				const context = await browser.newContext({ baseURL: BASE });
				try {
					for (
						const [path, location] of [
							["/?tkv=x", "/"],
							["/?tkv=x&demo=payments&q=a", "/?demo=payments&q=a"],
							["/?utm_source=news&tkv=&tkv=y&demo=board", "/?utm_source=news&demo=board"],
							["/features?tkv=x", "/features"],
							["/features?section=money&tkv=x", "/features?section=money"],
						] as const
					) {
						const res = await context.request.get(path, { maxRedirects: 0 });
						assertEquals(
							{ status: res.status(), location: res.headers()["location"] ?? null },
							{ status: 303, location },
							path,
						);
					}
					const plain = await context.request.get("/?demo=payments", { maxRedirects: 0 });
					assertEquals(plain.status(), 200, "no ticket link, no redirect");
				} finally {
					await context.close();
				}
			});

			await t.step("a browser following /?tkv=x&demo=payments lands on the open tab", async () => {
				const context = await contextFor(browser, VARIANTS[5]);
				const page = await context.newPage();
				try {
					await page.goto("/?tkv=x&demo=payments", { waitUntil: "load", timeout: 120_000 });
					await settle(page, 1_500);
					const url = new URL(page.url());
					assertEquals(`${url.pathname}${url.search}`, "/?demo=payments");
					const list = await tabs(page);
					assert(paymentsOpen(list), JSON.stringify(list));
				} finally {
					await context.close();
				}
			});
		} finally {
			await browser.close();
		}
	},
});

Deno.test({
	name:
		"landing Work board — a refused \"Move to…\" choice keeps focus on the card's menu, on / and in /features' dialog",
	sanitizeOps: false,
	sanitizeResources: false,
	async fn(t) {
		await Deno.mkdir(SHOTS, { recursive: true });
		const browser = await launch();
		/** `flows/LANDING.md` §4.4 Work board: the card waiting for its money, and what the board says. */
		const MENU = "Move to… “Homepage design”";
		const REFUSAL = "Needs funding. Pay for this stage before work starts.";
		/** Where focus sits, read by its name and what holds it. */
		const focusOf = (page: Page) =>
			page.evaluate(() => {
				const el = document.activeElement as HTMLElement | null;
				if (!el || el === document.body) {
					return { name: "<body>", expanded: null, inDemo: false, inDialog: false };
				}
				return {
					name: el.getAttribute("aria-label") ?? (el.textContent ?? "").trim(),
					expanded: el.getAttribute("aria-expanded"),
					inDemo: el.closest("#demo") !== null,
					inDialog: el.closest('[role="dialog"]') !== null,
				};
			});
		/**
		 * By keyboard alone where a card cannot be dragged (a phone): open the card's "Move to…", choose
		 * In Progress — which the board refuses before the stage is paid for — and return where focus is.
		 */
		const refusedMove = async (page: Page, scope: ReturnType<Page["locator"]>) => {
			const toggle = scope.getByRole("button", { name: MENU, exact: true });
			await toggle.waitFor({ state: "visible", timeout: 30_000 });
			await toggle.focus();
			await page.keyboard.press("Enter");
			const lane = scope.getByRole("list", { name: MENU, exact: true })
				.getByRole("button", { name: "In Progress", exact: true });
			await lane.waitFor({ state: "visible", timeout: 10_000 });
			await lane.focus();
			await page.keyboard.press("Enter");
			await page.waitForTimeout(500);
			assert(
				(await scope.getByText(REFUSAL, { exact: true }).count()) > 0,
				"the board says why it refused",
			);
			return await focusOf(page);
		};
		try {
			await t.step("/ at 375, light", async () => {
				const context = await contextFor(browser, VARIANTS[0]);
				const page = await context.newPage();
				try {
					await page.goto("/?demo=board", { waitUntil: "load", timeout: 120_000 });
					await settle(page, 1_500);
					await page.getByRole("tab", { name: "Work board", exact: true }).click();
					const focus = await refusedMove(page, page.locator("#demo"));
					assertEquals(focus, { name: MENU, expanded: "false", inDemo: true, inDialog: false });
				} catch (error) {
					await shot(page, "board-refused-move-home-375");
					throw error;
				} finally {
					await context.close();
				}
			});
			await t.step("/features' Try it dialog at 375, light", async () => {
				const context = await contextFor(browser, VARIANTS[0]);
				const page = await context.newPage();
				try {
					await page.goto("/features", { waitUntil: "load", timeout: 120_000 });
					await settle(page, 1_500);
					// "Try it" with the feature's title visually hidden after it (#302 (A)); hydrated, the link
					// to the demo stage is the dialog's button. The accessible-name algorithm may put a space
					// at the hidden span's edge, so the name is matched around the colon.
					await page.getByRole("button", { name: /^Try it\s*:\s*Work board$/ }).click();
					const dialog = page.getByRole("dialog");
					await dialog.waitFor({ state: "visible", timeout: 15_000 });
					const focus = await refusedMove(page, dialog);
					assertEquals(focus, { name: MENU, expanded: "false", inDemo: false, inDialog: true });
				} catch (error) {
					await shot(page, "board-refused-move-features-375");
					throw error;
				} finally {
					await context.close();
				}
			});
		} finally {
			await browser.close();
		}
	},
});
