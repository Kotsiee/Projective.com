import { assert, assertEquals } from "@std/assert";
import { refuseCrossSitePageWrite, refuseCrossSiteWrite } from "./csrf.ts";

/**
 * page-write-routes_test — the gate for PRD-C12: every route outside `routes/api` that accepts a
 * write is origin-checked by the root middleware's page write guard. It lists every such route module
 * from the tree (following each route file's `handler` re-export into its feature), and for each one
 * asserts that the guard refuses a cross-site write and passes the page's own form, under the pattern
 * Fresh matches it by. It also pins the wiring: the root middleware runs the guard first, with the
 * matched route, and no page route sits under `/api/`, where the guard stands aside.
 *
 * A new page write handler is already guarded; adding it to {@link PAGE_WRITE_ROUTES} keeps the list
 * of pages a cross-site form could reach reviewed.
 */

// #region Inventory
/** Every page route that accepts a write, by Fresh pattern, with the methods it handles. */
const PAGE_WRITE_ROUTES: Record<string, string[]> = {
	"/rsvp/:token": ["POST"],
};

const WEB = new URL("../", import.meta.url);
const ROUTES = new URL("routes/", WEB);
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];
const METHOD_KEY = /\b(?:async\s+)?(POST|PUT|PATCH|DELETE)\s*(?:\(|:)/g;
const FUNCTION_HANDLER = /export\s+const\s+handler\s*=\s*define\.handlers\s*\(\s*(?:async\s*)?\(/;
const RE_EXPORT = /export\s*\{[^}]*\bhandler\b[^}]*\}\s*from\s*["']([^"']+)["']/;
const BARE_EXPORT = /export\s*\{[^}]*\bhandler\b[^}]*\}\s*;/;
const IMPORTED = /import\s*\{[^}]*\bhandler\b[^}]*\}\s*from\s*["']([^"']+)["']/;

/** Every route file under `routes/`, by its path relative to it, with `api/` kept apart. */
async function routeFiles(dir: URL = ROUTES, rel = ""): Promise<string[]> {
	const files: string[] = [];
	for await (const entry of Deno.readDir(dir)) {
		const path = `${rel}${entry.name}`;
		if (entry.isDirectory) {
			files.push(
				...await routeFiles(new URL(`${encodeURIComponent(entry.name)}/`, dir), `${path}/`),
			);
		} else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
			files.push(path);
		}
	}
	return files;
}

/** The pattern Fresh registers a route file under: groups dropped, `[x]` → `:x`, `index` → its folder. */
function patternOf(rel: string): string {
	const segments = rel.replace(/\.tsx?$/, "").split("/")
		.filter((segment) => !/^\(.*\)$/.test(segment))
		.map((segment) =>
			segment
				.replace(/^\[\.\.\.(.+)\]$/, ":$1*")
				.replace(/^\[\[(.+)\]\]$/, ":$1?")
				.replace(/\[([^\]]+)\]/g, ":$1")
		);
	if (segments.at(-1) === "index") segments.pop();
	return `/${segments.join("/")}`;
}

/** A concrete path for a pattern, each parameter filled in. */
function samplePath(pattern: string): string {
	return pattern.replace(/:([A-Za-z0-9_]+)[*?]?/g, "$1-sample");
}

/** Resolve an import specifier the way this workspace's import map does, for `@features/` and `@web/`. */
function resolve(specifier: string, from: URL): URL {
	if (specifier.startsWith("@features/")) {
		return new URL(`features/${specifier.slice("@features/".length)}`, WEB);
	}
	if (specifier.startsWith("@web/")) return new URL(specifier.slice("@web/".length), WEB);
	return new URL(specifier, from);
}

/** The module that defines a route file's `handler`, following re-exports; `null` when it has none. */
async function handlerModule(file: URL, depth = 0): Promise<{ url: URL; source: string } | null> {
	const source = await Deno.readTextFile(file);
	if (depth > 4) throw new Error(`handler re-export chain too deep at ${file.pathname}`);
	const reExport = source.match(RE_EXPORT);
	if (reExport) return handlerModule(resolve(reExport[1], file), depth + 1);
	if (BARE_EXPORT.test(source)) {
		const imported = source.match(IMPORTED);
		assert(imported, `${file.pathname} exports a handler it never imports`);
		return handlerModule(resolve(imported[1], file), depth + 1);
	}
	return /export\s+const\s+handler\b/.test(source) ? { url: file, source } : null;
}

/** The write methods a handler module answers; every one for a function-form handler. */
function writeMethods(source: string): string[] {
	if (FUNCTION_HANDLER.test(source)) return [...WRITE_METHODS];
	const found = new Set([...source.matchAll(METHOD_KEY)].map((match) => match[1]));
	return WRITE_METHODS.filter((method) => found.has(method));
}

/** Every page route (outside `routes/api`, no `_` file) that answers a write, by pattern. */
async function pageWriteRoutes(): Promise<Record<string, string[]>> {
	const routes: Record<string, string[]> = {};
	for (const rel of await routeFiles()) {
		if (rel.startsWith("api/") || rel.split("/").at(-1)!.startsWith("_")) continue;
		const module = await handlerModule(
			new URL(rel.split("/").map(encodeURIComponent).join("/"), ROUTES),
		);
		if (!module) continue;
		const methods = writeMethods(module.source);
		if (methods.length > 0) routes[patternOf(rel)] = methods;
	}
	return routes;
}
// #endregion

// #region Gate
const BASE = "https://app.example.test";
const EVIL = "https://evil.example";

function write(path: string, method: string, headers: Record<string, string>): Request {
	return new Request(`${BASE}${path}`, {
		method,
		headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
		body: "a=1",
	});
}

Deno.test("the route patterns are derived the way Fresh registers them", () => {
	assertEquals(patternOf("(standalone)/rsvp/[token].tsx"), "/rsvp/:token");
	assertEquals(patternOf("[handle]/index.tsx"), "/:handle");
	assertEquals(patternOf("(public)/(auth)/verify/confirm.tsx"), "/verify/confirm");
	assertEquals(patternOf("(public)/docs/[...slug].tsx"), "/docs/:slug*");
	assertEquals(samplePath("/rsvp/:token"), "/rsvp/token-sample");
});

Deno.test("the walk follows every page route's handler into its feature, so the list is not vacuous", async () => {
	let handlers = 0;
	for (const rel of await routeFiles()) {
		if (rel.startsWith("api/") || rel.split("/").at(-1)!.startsWith("_")) continue;
		if (await handlerModule(new URL(rel.split("/").map(encodeURIComponent).join("/"), ROUTES))) {
			handlers += 1;
		}
	}
	assert(handlers >= 50, `only ${handlers} page handlers were resolved`);
	const rsvp = await handlerModule(new URL("(standalone)/rsvp/%5Btoken%5D.tsx", ROUTES));
	assert(
		rsvp?.url.pathname.endsWith("/features/calendar/routes/rsvp-handler.ts"),
		rsvp?.url.pathname,
	);
});

Deno.test("every page route that answers a write is listed, and today that is /rsvp/:token", async () => {
	const found = await pageWriteRoutes();
	assertEquals(
		found,
		PAGE_WRITE_ROUTES,
		"A page route answers a write that is not listed (or a listed one stopped). It is guarded " +
			"already; list it in PAGE_WRITE_ROUTES once its form is reviewed.",
	);
});

Deno.test("the page write guard refuses a cross-site write to every listed page and passes its own form", async () => {
	for (const [pattern, methods] of Object.entries(await pageWriteRoutes())) {
		const path = samplePath(pattern);
		for (const method of methods) {
			const label = `${method} ${pattern}`;
			const foreign: Record<string, string>[] = [
				{ origin: EVIL },
				{ origin: "null", "sec-fetch-site": "cross-site" },
				{},
			];
			for (const headers of foreign) {
				assertEquals(
					refuseCrossSitePageWrite(write(path, method, headers), pattern)?.status,
					403,
					label,
				);
			}
			const own = { origin: "null", "sec-fetch-site": "same-origin" };
			assertEquals(refuseCrossSitePageWrite(write(path, method, own), pattern), null, label);
			assertEquals(
				refuseCrossSitePageWrite(write(path, method, { origin: BASE }), pattern),
				null,
				label,
			);
			assertEquals(
				refuseCrossSiteWrite(write(path, method, { origin: EVIL })),
				null,
				`${label}: not /api`,
			);
		}
	}
});

Deno.test("no page route is registered under /api/, where the page guard stands aside", async () => {
	for (const rel of await routeFiles()) {
		if (rel.startsWith("api/")) continue;
		const pattern = patternOf(rel);
		assert(pattern !== "/api" && !pattern.startsWith("/api/"), `${rel} → ${pattern}`);
	}
});

Deno.test("the root middleware runs the page guard first, with the matched route; /api keeps its own", async () => {
	const root = await Deno.readTextFile(new URL("_middleware.ts", ROUTES));
	const guard = root.indexOf(
		'refuseCrossSitePageWrite(ctx.req, ctx.route, Deno.env.get("APP_URL"))',
	);
	assert(guard > 0, "the root middleware must call the page guard with ctx.route");
	assert(root.includes("const res = refused ?? await resolveAndRender(ctx);"));
	const body = root.slice(root.indexOf("export default define.middleware"));
	assert(body.indexOf("refuseCrossSitePageWrite(") < body.indexOf("resolveRequestViewer("));
	assert(body.indexOf("refuseCrossSitePageWrite(") < body.indexOf("ctx.next()"));
	const api = await Deno.readTextFile(new URL("api/_middleware.ts", ROUTES));
	assert(api.includes('refuseCrossSiteWrite(ctx.req, Deno.env.get("APP_URL"))'));
});
// #endregion
