import { hrefPath } from "./restricted-surfaces.ts";

/**
 * route-tree — test support for the chrome's link contracts (UI gate 11: a control that renders must
 * do something). The Create menu and the BottomNav each promise that every entry leads to a page that
 * exists; both tests answer "does a page serve this link?" through {@link staticRouteServes}, so the
 * two cannot walk the route tree differently.
 *
 * Reads the file system (`Deno.readDirSync`), so it is imported by tests only — never by an island or
 * a server module.
 */

// #region Route tree
/** The Fresh route root, `apps/web/routes/`. */
export const ROUTES_ROOT: URL = new URL("../../../routes/", import.meta.url);

/**
 * Whether a route FILE serves the in-app link `href` exactly — a static page, never a `[param]`
 * segment that would swallow the address and answer it with a not-found page.
 *
 * The query and fragment are ignored ({@link hrefPath}): `/projects?create=1` is served by the
 * `/projects` page. Every route group (`(dashboard)`, `(public)`, `(public)/(auth)`, …) is descended
 * at every depth, since a group adds no URL segment. A segment matches a directory of that name or,
 * as the last segment, a `<segment>.tsx` / `<segment>.ts` file; a directory matches as the last
 * segment only through its `index.tsx` / `index.ts`.
 */
export function staticRouteServes(href: string, root: URL = ROUTES_ROOT): boolean {
	const segments = hrefPath(href).split("/").filter(Boolean);
	const search = (dir: URL, rest: string[]): boolean => {
		for (const entry of Deno.readDirSync(dir)) {
			if (entry.isDirectory && /^\(.+\)$/.test(entry.name)) {
				if (search(new URL(`${entry.name}/`, dir), rest)) return true;
			} else if (rest.length === 0) {
				if (entry.isFile && /^index\.tsx?$/.test(entry.name)) return true;
			} else if (entry.isDirectory && entry.name === rest[0]) {
				if (search(new URL(`${entry.name}/`, dir), rest.slice(1))) return true;
			} else if (
				rest.length === 1 && entry.isFile &&
				(entry.name === `${rest[0]}.tsx` || entry.name === `${rest[0]}.ts`)
			) {
				return true;
			}
		}
		return false;
	};
	return search(root, segments);
}
// #endregion
