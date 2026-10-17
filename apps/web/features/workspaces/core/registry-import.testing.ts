import type { WorkspaceCapability, WorkspaceKind } from "@projective/types/workspace";

/**
 * registry-import.testing — loads a workspace `core/` module for `deno test` with its glyph import
 * swapped for an inert stub.
 *
 * The module registry carries each module's glyph VNode, and `workspace-glyphs.tsx` renders through
 * `@projective/ui/icons`' `IconShell`, which imports a stylesheet; Deno refuses CSS modules, so ANY
 * reference to the registry — a static import, an `import type`, even `typeof import(…)` — puts the
 * stylesheet in the checked module graph and fails before a test runs. The registry's predicates never
 * touch a glyph, so each module on the path is loaded from its own source through a `data:` URL, with
 * `./workspace-glyphs.tsx` replaced by a module whose exports are all `null`.
 *
 * Because the real types cannot be named, the surfaces a test calls are restated below as plain
 * interfaces; a drifted signature fails the test that calls it at run time.
 *
 * Test-only: no route, slot or island imports this file.
 */

// #region Surfaces under test
/** The registry slice the tests read — a module's key, and the predicates over a viewer. */
export interface RegistryApi {
	firstModuleFor(kind: WorkspaceKind, capabilities: readonly WorkspaceCapability[]): string;
	mayViewModule(
		key: string,
		kind: WorkspaceKind,
		capabilities: readonly WorkspaceCapability[],
	): boolean;
	primaryModules(
		kind: WorkspaceKind,
		capabilities: readonly WorkspaceCapability[],
	): { key: string }[];
	secondaryModules(
		kind: WorkspaceKind,
		capabilities: readonly WorkspaceCapability[],
	): { key: string }[];
	modulesForViewer(
		kind: WorkspaceKind,
		capabilities: readonly WorkspaceCapability[],
	): { key: string }[];
}

/** What `console-route.ts`'s resolver hands back (its `ConsoleResolution`). */
export interface ConsoleResolutionShape {
	workspace: { handle: string };
	activeModule: string;
	redirectedFrom: string | null;
}

/** A console redirect outcome (its `ConsoleRedirect`). */
export interface ConsoleRedirectShape {
	kind: "canonical" | "redirect" | "missing" | "unavailable";
	to: string;
}

/** The `console-route.ts` slice the tests call. */
export interface ConsoleRouteApi {
	routeConsole(
		kind: WorkspaceKind,
		ref: string,
		rawModule: string,
		url: URL,
		resolve: (module: string) => Promise<ConsoleResolutionShape | null>,
	): Promise<ConsoleRedirectShape | { kind: "render"; resolved: ConsoleResolutionShape }>;
	consoleResponse(outcome: ConsoleRedirectShape): Response;
}
// #endregion

// #region Loader
const GLYPHS = new URL("./workspace-glyphs.tsx", import.meta.url);

function dataUrl(source: string, type: "typescript" | "javascript"): string {
	return `data:application/${type},${encodeURIComponent(source)}`;
}

/** The stub: every name the glyph module exports, as `null` (`cloneGlyph` as the identity). */
async function glyphStub(): Promise<string> {
	const source = await Deno.readTextFile(GLYPHS);
	const names = [...source.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
	const lines = names.map((name) =>
		name === "cloneGlyph" ? "export const cloneGlyph = (g) => g;" : `export const ${name} = null;`
	);
	return dataUrl(lines.join("\n"), "javascript");
}

/** Whether a module reaches the glyph module through its own relative imports. */
async function reachesGlyphs(file: URL): Promise<boolean> {
	if (file.href === GLYPHS.href) return true;
	const source = await Deno.readTextFile(file);
	for (const [, spec] of source.matchAll(/\bfrom\s+"(\.[^"]+)"/g)) {
		if (await reachesGlyphs(new URL(spec, file))) return true;
	}
	return false;
}

/** A `data:` URL for `file`'s source with every (transitive) glyph import replaced by the stub. */
async function glyphFreeUrl(file: URL): Promise<string> {
	let source = await Deno.readTextFile(file);
	const specs = new Set([...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1]));
	for (const spec of specs) {
		let target: string;
		if (spec.startsWith(".")) {
			const dep = new URL(spec, file);
			if (dep.href === GLYPHS.href) target = await glyphStub();
			else target = await reachesGlyphs(dep) ? await glyphFreeUrl(dep) : dep.href;
		} else target = import.meta.resolve(spec);
		source = source.replaceAll(`"${spec}"`, `"${target}"`);
	}
	return dataUrl(source, "typescript");
}

/**
 * Import a `core/` module (`"./module-registry.tsx"`) without its glyphs. Modules loaded this way are
 * cached by their rewritten source, so two calls for the same file share one module instance.
 */
export async function importWithoutGlyphs<T>(relative: string): Promise<T> {
	return await import(await glyphFreeUrl(new URL(relative, import.meta.url))) as T;
}
// #endregion
