import { teamOfCataloguePath, teamScopedApiPath } from "@projective/types/catalogue";

/**
 * api-scope — which seller a catalogue API call speaks for (Decision #312). A page under
 * `/teams/:handle/catalogue` reads and writes as that team, so every `/api/catalogue/*` call it makes
 * carries `?team=<handle>`, which the route verifies before acting. The team is read from the tab's
 * address at call time, so the scope can never drift from the page making the call. Client-only:
 * without a `location` (the server, a test) nothing is scoped.
 */

const CATALOGUE_API = "/api/catalogue/";

/** The team the page in this tab speaks for, or `undefined` for the acting seller. */
export function pageCatalogueTeam(): string | undefined {
	const pathname = (globalThis as { location?: { pathname?: string } }).location?.pathname;
	return pathname ? teamOfCataloguePath(pathname) : undefined;
}

/** `path` scoped to the page's team when it is a catalogue API path; any other path is unchanged. */
export function catalogueApiPath(path: string): string {
	return path.startsWith(CATALOGUE_API) ? teamScopedApiPath(path, pageCatalogueTeam()) : path;
}
