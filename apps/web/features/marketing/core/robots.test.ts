import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	APP_PATHS,
	buildRobotsTxt,
	disallowRules,
	isCrawlDisallowed,
	ruleMatches,
	SITEMAP_PATH,
} from "./robots.ts";

// #region Route tree
const ROUTES = new URL("../../../routes/", import.meta.url);
const NOT_A_ROUTE = /\.(test|spec|d)\.(tsx|ts)$/;

/**
 * Every route module under `dir` as a sample URL path: groups are URL-transparent, `index` claims no
 * segment, and a `[param]` / `[...rest]` segment is filled with `sample`.
 */
function samplePaths(dir: URL, prefix: string[] = []): string[] {
	const out: string[] = [];
	for (const entry of Deno.readDirSync(dir)) {
		if (entry.name.startsWith("_") || entry.name === "api") continue;
		const segment = entry.name.startsWith("[") ? "sample" : entry.name;
		if (entry.isDirectory) {
			const group = /^\(.+\)$/.test(entry.name);
			out.push(
				...samplePaths(new URL(`${entry.name}/`, dir), group ? prefix : [...prefix, segment]),
			);
			continue;
		}
		if (NOT_A_ROUTE.test(entry.name)) continue;
		const stem = /^(.+)\.(tsx|ts)$/.exec(entry.name)?.[1];
		if (!stem) continue;
		const last = stem.startsWith("[") ? "sample" : stem;
		out.push(`/${(stem === "index" ? prefix : [...prefix, last]).join("/")}`);
	}
	return out;
}

const DASHBOARD = samplePaths(new URL("(dashboard)/", ROUTES));
const PUBLIC = [
	...samplePaths(new URL("(public)/", ROUTES)),
	...samplePaths(new URL("(standalone)/", ROUTES)),
	// The profile namespace, minus the owner-only editor.
	...samplePaths(new URL("[handle]/", ROUTES), ["sample"]).filter((p) =>
		!/^\/sample\/edit(\/|$)/.test(p)
	),
];
// #endregion

Deno.test("the route reader sees both groups", () => {
	assert(DASHBOARD.includes("/projects") && DASHBOARD.includes("/legal/workspace/transfers"));
	assert(PUBLIC.includes("/about") && PUBLIC.includes("/legal/sample") && PUBLIC.includes("/"));
});

Deno.test("every signed-in page is disallowed, at its address, below it and with a query", () => {
	const open = DASHBOARD.filter((path) => !isCrawlDisallowed(path));
	assertEquals(open, [], "a (dashboard) route escaped robots.txt — add its segment to APP_PATHS");
	for (const path of DASHBOARD) assert(isCrawlDisallowed(`${path}?tab=x`), path);
	assert(isCrawlDisallowed("/alice/edit"));
	assert(isCrawlDisallowed("/alice/edit/availability"));
});

Deno.test("every public page stays crawlable — including a profile whose handle starts like an app path", () => {
	const blocked = PUBLIC.filter((path) => isCrawlDisallowed(path));
	assertEquals(blocked, []);
	for (
		const path of ["/homer", "/settings-guru", "/wallet.eth", "/legal/terms", "/legal", "/help"]
	) {
		assertFalse(isCrawlDisallowed(path), path);
	}
	assertFalse(isCrawlDisallowed("/help?q=escrow"));
	assertFalse(isCrawlDisallowed("/changelog?category=payments&page=2"));
});

Deno.test("the feedback drawer's address is disallowed wherever its parameter sits", () => {
	assert(isCrawlDisallowed("/about?feedback=open"));
	assert(isCrawlDisallowed("/help/escrow-and-payments/fees?q=x&feedback=open&idea=fbk-abc"));
	assertFalse(isCrawlDisallowed("/feedback"));
	assertFalse(isCrawlDisallowed("/feedback?status=planned"));
});

Deno.test("APP_PATHS names each dashboard segment once, and nothing that is not one", () => {
	const segments = new Set(
		DASHBOARD.map((path) =>
			path.startsWith("/legal/workspace") ? "/legal/workspace" : `/${path.split("/")[1]}`
		),
	);
	assertEquals([...APP_PATHS].sort(), [...segments].sort());
});

Deno.test("rule matching follows RFC 9309: prefix, * and a trailing $", () => {
	assert(ruleMatches("/home$", "/home"));
	assertFalse(ruleMatches("/home$", "/homer"));
	assertFalse(ruleMatches("/home$", "/home?x=1"));
	assert(ruleMatches("/home?", "/home?x=1"));
	assert(ruleMatches("/*/edit$", "/alice/edit"));
	assert(ruleMatches("/*&feedback=open", "/a?b=1&feedback=open"));
});

Deno.test("the file: one group for every crawler, each rule once, and the sitemap's absolute address", () => {
	const txt = buildRobotsTxt("https://projective.example/");
	const lines = txt.trimEnd().split("\n");
	assert(lines.includes("User-agent: *"));
	assertEquals(lines.filter((l) => l.startsWith("User-agent:")).length, 1);
	const rules = lines.filter((l) => l.startsWith("Disallow: ")).map((l) => l.slice(10));
	assertEquals(rules, disallowRules());
	assertEquals(new Set(rules).size, rules.length);
	assertEquals(lines.at(-1), `Sitemap: https://projective.example${SITEMAP_PATH}`);
	assert(txt.endsWith("\n"));
	assertFalse(rules.includes("/"), "the site is never disallowed wholesale");
});

Deno.test("no static robots.txt shadows the route (static files are served before routes)", () => {
	const statics = new URL("../../../static/", import.meta.url);
	const names = [...Deno.readDirSync(statics)].map((entry) => entry.name);
	assert(names.length > 0, "the static directory was not read");
	assertFalse(names.includes("robots.txt"));
	assertFalse(names.includes("sitemap.xml"));
});
