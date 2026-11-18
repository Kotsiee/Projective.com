/// <reference lib="dom" />
import { assert, assertEquals } from "@std/assert";
import { type Browser, chromium, type Page } from "npm:playwright-core@1.56.1";

/**
 * screen-share.spec — screen sharing mode's merge gate (Decision #297, DESIGN_SYSTEM.md §B.14):
 * with `pj.screen_share=1`, every sensitive surface a seeded persona can open shows no raw money
 * figure, email address, phone number or meeting URL — not in its visible text and not in any
 * `data-*`, `title` or `aria-*` attribute — and no project header names its client's legal name.
 *
 * It drives a RUNNING dev server on the LIVE local database (`deno task dev`), signs in as the
 * seeded personas (Seed.md) and walks their surfaces. Every non-GET API call is aborted, so nothing
 * is written. Message text is exempt (it stays readable by rule); island props serialized into
 * `<script>` are outside the threat model (Decision #297 flag (g)) and are not read.
 *
 *   deno test --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys \
 *     apps/web/tests/e2e/screen-share.spec.ts
 *
 * Environment: `E2E_BASE_URL` (default `http://localhost:13041`), `E2E_PASSWORD` (default the shared
 * dev password documented in Seed.md, read at runtime — never committed), `E2E_CHROMIUM`,
 * `E2E_DOCKER`, `E2E_DB_CONTAINER` (as `billing.spec.ts`), `E2E_AREAS` (a comma list to run a
 * subset), `E2E_SHOTS` (a directory to save a screenshot per page).
 */

// #region Configuration
const BASE = Deno.env.get("E2E_BASE_URL") ?? "http://localhost:13041";
const ROOT = new URL("../../../../", import.meta.url);
const DOCKER = Deno.env.get("E2E_DOCKER") ?? "docker";
const CONTAINER = Deno.env.get("E2E_DB_CONTAINER") ?? "supabase_db_Projective";
const SHOTS = Deno.env.get("E2E_SHOTS");
const ONLY = Deno.env.get("E2E_AREAS")?.split(",").map((a) => a.trim()).filter(Boolean);

interface Area {
	area: string;
	/** The seeded persona whose surfaces these are. */
	who: string;
	/** Static paths, plus `{project}` expanded to each project the persona can open. */
	paths: string[];
}

const AREAS: Area[] = [
	{
		area: "wallet",
		who: "marisdelacroix",
		paths: ["/wallet", "/wallet/transactions", "/wallet/invoices", "/wallet/analytics"],
	},
	{
		area: "settings",
		who: "marisdelacroix",
		paths: [
			"/settings/account",
			"/settings/billing",
			"/settings/verification",
			"/settings/integrations",
		],
	},
	{ area: "projects", who: "noor", paths: ["{project}", "{project}/board"] },
	{ area: "projects-team", who: "hannahcole", paths: ["{project}", "{project}/board"] },
	{ area: "calendar", who: "marisdelacroix", paths: ["/calendar"] },
	{ area: "files", who: "inesduarte", paths: ["/files"] },
	{
		area: "team-payouts",
		who: "kwamemensah",
		paths: ["/teams/northloop", "/teams/northloop/payouts"],
	},
	{ area: "business", who: "priyaraman", paths: ["/businesses/heliafinance"] },
	{
		area: "discovery",
		who: "renkoda",
		paths: ["/explore", "/inesduarte", "/catalogue", "/view/svc-wjohm5fqgo"],
	},
];

/** A currency mark beside a digit, either side: `£1,200`, `US$5`, `1 250,50 kr`, `GBP 950`. */
const MONEY =
	/(?:[£$€¥₹]|\b(?:GBP|USD|EUR|CAD|AUD|JPY|CHF|SEK|NZD)\s?)\d|\d[\d.,  ]*\s?(?:[£€₹]|\b(?:GBP|USD|EUR|SEK)\b)/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/i;
const PHONE = /\+\d[\d\s().-]{7,}\d/;
const MEETING =
	/https?:\/\/(?:meet\.google\.com|[\w-]+\.zoom\.us|zoom\.us|teams\.microsoft\.com|whereby\.com|meet\.jit\.si)\S*/i;
const DETECTORS: Array<[string, RegExp]> = [
	["money", MONEY],
	["email", EMAIL],
	["phone", PHONE],
	["meeting", MEETING],
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

async function sql(text: string): Promise<string[]> {
	const child = new Deno.Command(DOCKER, {
		args: ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-qAt"],
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

async function launch(): Promise<Browser> {
	const executablePath = Deno.env.get("E2E_CHROMIUM");
	if (executablePath) return await chromium.launch({ executablePath, headless: true });
	try {
		return await chromium.launch({ headless: true });
	} catch {
		return await chromium.launch({ channel: "chrome", headless: true });
	}
}

/** The projects a persona takes part in, by routed slug, with the client's legal name if any. */
async function projectsOf(who: string): Promise<Array<{ slug: string; legal: string | null }>> {
	const rows = await sql(`
		with me as (select id from auth.users where email = '${who}@projective.dev')
		select p.slug || '|' || coalesce(b.legal_name, '')
		from projects.projects p
		left join org.business_profiles b on b.id = p.client_business_id
		where p.slug is not null and (
			p.owner_user_id = (select id from me) or p.client_user_id = (select id from me)
			or exists (select 1 from projects.project_participants pp
				where pp.project_id = p.id and pp.profile_id = (select id from me)))
		order by p.created_at limit 2;`);
	return rows.map((r) => {
		const [slug, legal] = r.split("|");
		return { slug, legal: legal || null };
	});
}

async function signIn(browser: Browser, who: string): Promise<Page> {
	const context = await browser.newContext({
		baseURL: BASE,
		viewport: { width: 1440, height: 960 },
	});
	await context.addCookies([{ name: "pj.screen_share", value: "1", url: BASE }]);
	await context.route("**/api/**", async (route) => {
		const req = route.request();
		const path = new URL(req.url()).pathname;
		const read = req.method() === "GET" || req.method() === "HEAD";
		return read || path.startsWith("/api/auth/") ? await route.continue() : await route.abort();
	});
	const res = await context.request.post("/api/auth/login", {
		data: {
			identifier: `${who}@projective.dev`,
			password: await password(),
			captchaToken: "XXXX.DUMMY.TOKEN.XXXX",
		},
		headers: { origin: new URL(BASE).origin },
	});
	assertEquals(res.status(), 200, `sign-in as ${who} failed (${res.status()})`);
	return await context.newPage();
}

/**
 * Every text node in the document (messages exempt; screen-reader-only text counts, because it is
 * in the DOM and in the accessible name) and every `data-*`, `title` and `aria-*` value.
 */
function harvest(): { text: string; attributes: string[]; active: string | null } {
	const exempt =
		"script, style, template, .msg-bubble__body, .msg-conv__body, .msg-ctx__body, [data-dev-overlay]";
	const parts: string[] = [];
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (!node.parentElement?.closest(exempt)) parts.push(node.textContent ?? "");
	}
	const attributes: string[] = [];
	for (const el of document.body.querySelectorAll("*")) {
		if (el.closest(exempt)) continue;
		for (const attr of Array.from(el.attributes)) {
			const n = attr.name;
			if (n === "title" || n.startsWith("aria-") || n.startsWith("data-")) {
				attributes.push(`${n}="${attr.value}"`);
			}
		}
	}
	return {
		text: parts.join(" "),
		attributes,
		active: document.documentElement.getAttribute("data-screen-share"),
	};
}

function headerText(): string {
	const header = document.querySelector(
		".ui-middle-nav__header, [data-band='header'], .prj-header, header[role='banner']",
	);
	return header?.textContent ?? "";
}
// #endregion

// #region The gate
Deno.test({
	name: "screen sharing mode — no sensitive value reaches the frame on any walked surface",
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		const browser = await launch();
		const findings: string[] = [];
		try {
			for (const { area, who, paths } of AREAS) {
				if (ONLY && !ONLY.includes(area)) continue;
				const page = await signIn(browser, who);
				const projects = paths.some((p) => p.includes("{project}")) ? await projectsOf(who) : [];
				const routes = paths.flatMap((p) =>
					p.includes("{project}")
						? projects.map((pr) => ({
							path: p.replace("{project}", `/projects/${pr.slug}`),
							legal: pr.legal,
						}))
						: [{ path: p, legal: null as string | null }]
				);
				for (const { path, legal } of routes) {
					const res = await page.goto(path, { waitUntil: "load", timeout: 120_000 });
					await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
					await page.waitForTimeout(600);
					const status = res?.status() ?? 0;
					const seen = await page.evaluate(harvest);
					if (SHOTS) {
						await page.screenshot({ path: `${SHOTS}/${area}-${path.replace(/\W+/g, "_")}.png` });
					}
					if (seen.active !== "active") {
						findings.push(`${area} ${path}: the mode is not on (${status})`);
					}
					for (const [kind, re] of DETECTORS) {
						const inText = seen.text.match(re);
						if (inText) findings.push(`${area} ${path}: ${kind} in text "${inText[0]}"`);
						const inAttr = seen.attributes.find((a) => re.test(a));
						if (inAttr) findings.push(`${area} ${path}: ${kind} in ${inAttr.slice(0, 120)}`);
					}
					if (legal) {
						const header = await page.evaluate(headerText);
						if (header.includes(legal)) {
							findings.push(`${area} ${path}: client legal name "${legal}" in header`);
						}
					}
				}
				await page.context().close();
			}
		} finally {
			await browser.close();
		}
		assert(findings.length === 0, `screen sharing leaks:\n${findings.join("\n")}`);
	},
});
// #endregion
