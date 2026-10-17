import { workspaceBase, workspaceHref, type WorkspaceKind } from "@projective/types/workspace";
import { isModuleKey, type ModuleKey } from "./module-registry.tsx";

/**
 * console-route — where a `/teams/:teamHandle[/:module]` or `/businesses/:businessHandle[/:module]`
 * request goes, decided from the resolved console alone (Decision #228 (B)).
 *
 * Pure: the caller hands in a resolver for the entity, so the decision is a total function of the URL
 * and that one read, and both kinds' four route handlers answer through {@link consoleResponse} with no
 * second copy of the status table.
 *
 *   - **canonical · 308** — the entity was addressed by its row id or a differently-cased handle, or the
 *     URL spelled out `/overview`, the root's duplicate address. The mapping is permanent (a slug is
 *     immutable after insert, and Overview IS the root), so it may be cached; the query survives. Only a
 *     member ever receives it — a non-member's read is `forbidden`, so it discloses nothing.
 *   - **redirect · 303** — a real module this viewer may not open. Viewer-dependent, so never cached;
 *     `?view=` belonged to the withheld module and is dropped.
 *   - Both at once answer ONE 308 straight to the module the viewer may open, never a 308 → 303 chain.
 *   - **missing · 303** — an unregistered module segment; it falls back to the CANONICAL console root,
 *     because a bad link should look broken rather than resolve somewhere plausible.
 *   - **unavailable · 303** — no entity, or the viewer is not a member. ONE hop to the roster with
 *     `?notice=unavailable`, which says only that it is not available — never whether it exists.
 *
 * Every request is answered in ONE hop: the entity is read before any redirect is chosen, so neither a
 * bad module segment nor `/overview` ever bounces through `/<kind>/<ref>` on its way to the roster or
 * to the canonical handle.
 */

// #region Types
/** The slice of the console bootstrap the decision reads (`WorkspaceConsoleBootstrap` satisfies it). */
export interface ConsoleResolution {
	workspace: { handle: string };
	/** The module that will render, after the permission correction. */
	activeModule: ModuleKey;
	/** The module the URL asked for when it was corrected away, else `null`. */
	redirectedFrom: string | null;
}

/** Every outcome that is answered with a redirect rather than a page. */
export type ConsoleRedirect =
	| { kind: "canonical"; to: string }
	| { kind: "redirect"; to: string }
	| { kind: "missing"; to: string }
	| { kind: "unavailable"; to: string };

/** The roster's one-line notice vocabulary (`?notice=`). */
export type RosterNotice = "unavailable";
// #endregion

// #region Decision
/** `?…` without `view`, or `""` when nothing else was carried. */
function searchWithoutView(url: URL): string {
	const params = new URLSearchParams(url.search);
	params.delete("view");
	const rest = params.toString();
	return rest ? `?${rest}` : "";
}

/** The roster address a missing or forbidden console sends the viewer back to. */
export function unavailableHref(kind: WorkspaceKind): string {
	return `${workspaceBase(kind)}?notice=unavailable`;
}

/**
 * Decide a console request. `rawModule` is the URL's module segment, or `null` for the bare console
 * root (`/<kind>/:handle`). `resolve` is called exactly once — an unregistered segment is resolved as
 * Overview, so even a bad link learns whether the entity is available before it redirects. Returns
 * `render` with the resolution when the URL is already the canonical address of a module the viewer
 * may open.
 */
export async function routeConsole<R extends ConsoleResolution>(
	kind: WorkspaceKind,
	ref: string,
	rawModule: string | null,
	url: URL,
	resolve: (module: ModuleKey) => Promise<R | null>,
): Promise<ConsoleRedirect | { kind: "render"; resolved: R }> {
	const requested = rawModule ?? "overview";
	const registered = isModuleKey(requested);

	const resolved = await resolve(registered ? requested : "overview");
	if (!resolved) return { kind: "unavailable", to: unavailableHref(kind) };

	const { handle } = resolved.workspace;
	if (!registered) return { kind: "missing", to: workspaceHref(kind, handle) };

	const href = workspaceHref(kind, handle, resolved.activeModule);
	const withheld = resolved.redirectedFrom !== null;
	// `/overview` spelled out is the root under a second name — folded like a non-canonical handle.
	if (ref !== handle || rawModule === "overview") {
		return { kind: "canonical", to: `${href}${withheld ? searchWithoutView(url) : url.search}` };
	}
	if (withheld) return { kind: "redirect", to: `${href}${searchWithoutView(url)}` };
	return { kind: "render", resolved };
}

/** The HTTP answer for a redirect outcome: 308 for the permanent canonical address, 303 otherwise. */
export function consoleResponse(outcome: ConsoleRedirect): Response {
	const status = outcome.kind === "canonical" ? 308 : 303;
	return new Response(null, { status, headers: { location: outcome.to } });
}

/** Coerce a raw `?notice=` value to the roster's vocabulary, else `null`. */
export function toRosterNotice(raw: string | null): RosterNotice | null {
	return raw === "unavailable" ? raw : null;
}
// #endregion
