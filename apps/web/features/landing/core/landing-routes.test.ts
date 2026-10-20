/**
 * landing-routes.test — every landing path answers a `?tkv=` ticket deep link on the server.
 *
 * The public layout mounts no `TicketDeepLinkHost` on its `LANDING_PATHS` (Decision #286 (A)), so the
 * only thing that keeps a pasted `?tkv=` out of the address bar there is each route's own `GET`
 * calling `tkvRedirect` before anything else. This walks the layout's `LANDING_PATHS`, finds each
 * path's route file under `routes/(public)/`, and fails when a route that exists does not import
 * `tkvRedirect` from `strip-tkv.ts` or does not return its response first. A path whose page has
 * not shipped yet (`/features` until L5) has no route file and nothing to check.
 */
import { assert, assertEquals } from "@std/assert";
import { blankComments } from "./island-graph.ts";
import { ISLAND_SOURCES } from "./js-budget.ts";

// #region Source
/** The repository root, from `apps/web/features/landing/core/`. */
const ROOT = new URL("../../../../../", import.meta.url);

/** The public route group the landing paths live in. */
const PUBLIC_ROUTES = "apps/web/routes/(public)/";

function read(path: string): string | null {
	try {
		return blankComments(Deno.readTextFileSync(new URL(path, ROOT))).replace(/\r\n/g, "\n");
	} catch {
		return null;
	}
}

/** The paths of the layout's `LANDING_PATHS` set literal. */
function landingPaths(): string[] {
	const layout = read(ISLAND_SOURCES.layout) ?? "";
	const literal = layout.match(/const LANDING_PATHS = new Set\(\[([^\]]*)\]\)/);
	assert(literal, `${ISLAND_SOURCES.layout} declares no LANDING_PATHS set literal`);
	return [...literal[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/** The route files a path may be served from, in Fresh's order. */
function routeFilesFor(path: string): string[] {
	if (path === "/") return [`${PUBLIC_ROUTES}index.tsx`];
	const segment = path.replace(/^\/+|\/+$/g, "");
	return [`${PUBLIC_ROUTES}${segment}.tsx`, `${PUBLIC_ROUTES}${segment}/index.tsx`];
}
// #endregion

// #region Rules
/** `tkvRedirect` imported from the landing's strip module. */
const IMPORTS_STRIP =
	/import\s*\{[^}]*\btkvRedirect\b[^}]*\}\s*from\s*["']@features\/landing\/core\/strip-tkv\.ts["']/;

/** The handler's `GET` opens with the redirect: computed from `ctx.url`, returned when present. */
const GET_STARTS_WITH_REDIRECT =
	/\bGET\s*\(\s*(\w+)\s*\)\s*\{\s*const\s+(\w+)\s*=\s*tkvRedirect\(\s*\1\.url\s*\)\s*;\s*if\s*\(\s*\2\s*\)\s*return\s+\2\s*;/;

Deno.test("the layout's landing paths are / and /features", () => {
	assertEquals(landingPaths().sort(), ["/", "/features"]);
});

Deno.test("every landing route answers ?tkv= with tkvRedirect before anything else", () => {
	let checked = 0;
	for (const path of landingPaths()) {
		for (const file of routeFilesFor(path)) {
			const src = read(file);
			if (src === null) continue;
			assert(
				IMPORTS_STRIP.test(src),
				`${file} (${path}) does not import tkvRedirect from strip-tkv.ts`,
			);
			assert(
				GET_STARTS_WITH_REDIRECT.test(src),
				`${file} (${path}): GET must open with \`const redirect = tkvRedirect(ctx.url); if (redirect) return redirect;\``,
			);
			checked += 1;
		}
	}
	assert(checked >= 1, "no landing route file was found to check");
});

Deno.test("the rules read a route that strips first, and refuse one that does not", () => {
	const good = [
		'import { tkvRedirect } from "@features/landing/core/strip-tkv.ts";',
		"export const handler = define.handlers({",
		"\tasync GET(ctx) {",
		"\t\tconst redirect = tkvRedirect(ctx.url);",
		"\t\tif (redirect) return redirect;",
		"\t\treturn page({});",
		"\t},",
		"});",
	].join("\n");
	assert(IMPORTS_STRIP.test(good) && GET_STARTS_WITH_REDIRECT.test(good));
	const late = good.replace(
		"\t\tconst redirect = tkvRedirect(ctx.url);",
		"\t\tapplyPageMeta(ctx.state, meta);\n\t\tconst redirect = tkvRedirect(ctx.url);",
	);
	assert(!GET_STARTS_WITH_REDIRECT.test(late), "a GET that renders state first is refused");
	assert(
		!IMPORTS_STRIP.test("export const handler = {};"),
		"a route without the import is refused",
	);
});
// #endregion
