import { defineConfig, type Plugin } from "npm:vite@7.2.2";
import { fresh } from "@fresh/plugin-vite";
import { walkSync } from "jsr:@std/fs@^1/walk";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

// #region Helper Functions
const ROOT = process.cwd();

/**
 * Every root that may contain an `islands/` directory.
 *
 * `packages/ui` is NOT optional. A component only hydrates if Fresh knows it is an island, and the
 * SSR renderer decides that by looking the component function up in the island registry this list
 * builds. An unregistered island still renders — it just renders as a plain server component and
 * never receives its client bundle, so it is inert with no error anywhere. That is invisible for a
 * package component used INSIDE an app island (it hydrates as part of that island's subtree), and
 * fatal for one a server component or route renders directly, which is why the failure looks
 * page-dependent rather than component-dependent.
 */
const ISLAND_ROOTS = ["apps/web/features", "packages/ui"] as const;

/**
 * Dynamically discovers all Island components across {@link ISLAND_ROOTS}.
 *
 * Formats discovered paths as explicit file:// URLs so the Deno module loader
 * can resolve them correctly without looking for them in the import map.
 *
 * On Windows those URLs resolve to a forward-slashed id while the import-map alias an app module
 * uses for the same file resolves to a backslashed one — which built each island twice and broke
 * hydration in production until `normalizeModuleIds()` below collapsed the two. Keep that plugin
 * ahead of `fresh()` if this discovery ever changes shape.
 *
 * NOTE the coupling this creates: Fresh's server snapshot does `import * as` over EVERY specifier
 * returned here, so a single island module that throws while evaluating — a missing stylesheet, a
 * top-level `document` reference — takes down the whole app rather than one page.
 *
 * @returns {string[]} An array of file:// URL strings for island components.
 */
function discoverFeatureIslands(): string[] {
	const islands: string[] = [];

	for (const root of ISLAND_ROOTS) {
		const rootPath = path.resolve(ROOT, root);

		try {
			for (
				const entry of walkSync(rootPath, {
					exts: [".tsx", ".ts", ".jsx"],
					includeDirs: false,
				})
			) {
				if (
					entry.path.includes("/islands/") ||
					entry.path.includes("\\islands\\")
				) {
					// Convert absolute system path (POSIX or Windows) into a file:/// URL
					const fileUrl = pathToFileURL(entry.path).href;
					islands.push(fileUrl);
				}
			}
		} catch (error) {
			console.warn(
				`⚠️ Could not walk "${root}" for islands:`,
				error,
			);
		}
	}

	return islands;
}

/**
 * True for a developer-tools island path. In a PRODUCTION build these are stripped from the island
 * manifest so the DEV-ONLY Developer Tools (SpeedDial, draggable inspector windows, dev-context
 * switcher, and the logger's dev branches) never enter the shipped client bundle — the core Dev-Tools
 * production guardrail. Matches either path separator; discovered islands are `file://` URLs.
 */
function isDevToolsIsland(url: string): boolean {
	return /[/\\]devtools[/\\]/.test(url);
}

/**
 * Flattens each manifest entry's `css` to the transitive closure of its static imports.
 *
 * Fresh links an island's stylesheets from the client manifest entry's OWN `css` array, and does not
 * walk `imports`. Vite only lists CSS on the chunk that actually contains the importing module, so
 * the moment a component is shared by several islands and Rollup hoists it into its own chunk, its
 * stylesheet moves onto THAT chunk and Fresh stops linking it — the component renders with no rules.
 *
 * This is latent until chunking gets finer. With {@link uiModuleSideEffects} off, every island
 * carried one fat chunk that happened to contain the CSS directly; switching it on split shared
 * components (`Avatar`, `RatingStars`, `Icon`) into their own chunks and `ui-avatar` lost its rules
 * on nearly every page. Precise chunking and non-recursive CSS collection are individually fine and
 * fatal together, so the two must land as a pair.
 *
 * Order is dependencies-first, matching ES module evaluation order — an imported module's CSS side
 * effect runs before its importer's — so the cascade a component relies on is preserved.
 */
function flattenManifestCss(): Plugin {
	return {
		name: "projective:flatten-manifest-css",
		enforce: "post",
		applyToEnvironment(env) {
			return env.config.consumer === "client";
		},
		// `writeBundle`, not `generateBundle`: Vite's own manifest plugin emits the asset during
		// `generateBundle`, so an earlier hook may not see it at all. The rewrite must also reach
		// DISK — the SSR build is a separate Rollup run that reads the client manifest as a file.
		writeBundle(options, bundle) {
			const entry = bundle[".vite/manifest.json"];
			if (
				!entry || entry.type !== "asset" || typeof entry.source !== "string"
			) {
				return;
			}

			const manifest = JSON.parse(entry.source) as Record<
				string,
				{ css?: string[]; imports?: string[] }
			>;

			const cssFor = (key: string, seen: Set<string>): string[] => {
				if (seen.has(key)) return [];
				seen.add(key);

				const chunk = manifest[key];
				if (!chunk) return [];

				const collected: string[] = [];
				// Dependencies first: their CSS side effects evaluate before the importer's.
				for (const imported of chunk.imports ?? []) {
					collected.push(...cssFor(imported, seen));
				}
				collected.push(...(chunk.css ?? []));
				return collected;
			};

			let widened = 0;
			for (const [key, chunk] of Object.entries(manifest)) {
				const flattened = [...new Set(cssFor(key, new Set()))];
				if (flattened.length > (chunk.css?.length ?? 0)) widened++;
				if (flattened.length > 0) chunk.css = flattened;
			}

			if (widened === 0) return;

			const serialised = JSON.stringify(manifest);
			entry.source = serialised;
			if (options.dir) {
				fs.writeFileSync(
					path.join(options.dir, ".vite", "manifest.json"),
					serialised,
				);
			}
		},
	};
}

/**
 * Declares `@projective/ui` component modules side-effect free, so a barrel import only drags in
 * the CSS of components a page actually uses.
 *
 * The package's public API is its sub-path barrels (`@projective/ui/display` etc.), and app code
 * imports through them — `ProfileHeader` takes `{ Avatar }` from `@projective/ui/display`. That
 * barrel re-exports ~40 components, and each component module opens with a side-effecting
 * `import "../styles/<name>.css"`. Rollup will not drop a module that has a side effect even when
 * none of its exports are used, so ONE named import pinned every component in the barrel and
 * every stylesheet with it: `/explore` was served `orgchart.css`, `gmap.css`, `galleria.css` and
 * `treetable.css` for components it never renders, and 61 island entries each carried 80+ sheets.
 *
 * Marking these modules side-effect free lets normal tree-shaking remove the unused re-exports, and
 * their CSS imports go with them. Deliberately scoped:
 *  - `.css` ids keep their side effect — the stylesheet IS the effect, and dropping it would strip
 *    the styling of components that ARE used, including `client.ts`'s global token sheet.
 *  - only `packages/ui` is claimed. App and backend modules keep Rollup's default, because a
 *    feature module may legitimately register something on import.
 *  - island modules stay entry points regardless, so a package island still emits its own chunk and
 *    its own CSS; this changes only what a DIFFERENT entry is forced to carry.
 */
function uiModuleSideEffects(id: string): boolean {
	const normalised = id.replaceAll("\\", "/");

	if (!normalised.includes("/packages/ui/")) return true;
	// The stylesheet is the side effect worth keeping.
	if (/\.(css|scss|sass)$/.test(normalised)) return true;

	return false;
}

/**
 * Collects every bare specifier the Deno import maps point at a REGISTRY (`jsr:` / `https:`),
 * across the root `deno.json` and each workspace member's.
 *
 * Derived rather than hard-coded so a version bump in `deno.json` never has to be mirrored here.
 * A specifier mapped to two different targets by two files is skipped — the correct answer then
 * depends on the importer, which is the Deno resolver's job, not ours.
 *
 * `npm:` targets are deliberately excluded: those DO legitimately live in `node_modules`, and
 * Vite's own resolution of them is correct.
 */
function collectDenoRegistrySpecifiers(): Map<string, string> {
	const collected = new Map<string, string>();
	const ambiguous = new Set<string>();

	const rootManifest = JSON.parse(
		fs.readFileSync(path.resolve(ROOT, "deno.json"), "utf8"),
	) as { workspace?: string[]; imports?: Record<string, string> };

	const manifests = [
		"deno.json",
		...(rootManifest.workspace ?? []).map(
			(member) => path.join(member, "deno.json"),
		),
	];

	for (const relative of manifests) {
		let imports: Record<string, string>;
		try {
			const raw = fs.readFileSync(path.resolve(ROOT, relative), "utf8");
			imports = (JSON.parse(raw) as { imports?: Record<string, string> }).imports ?? {};
		} catch {
			continue;
		}

		for (const [specifier, target] of Object.entries(imports)) {
			if (!/^(jsr|https):/.test(target)) continue;

			const existing = collected.get(specifier);
			if (existing !== undefined && existing !== target) {
				ambiguous.add(specifier);
				continue;
			}
			collected.set(specifier, target);
		}
	}

	for (const specifier of ambiguous) collected.delete(specifier);
	return collected;
}

/**
 * Pins the import map's registry-backed bare specifiers to their `jsr:`/`https:` target, so Node
 * resolution can never answer for one.
 *
 * `@fresh/plugin-vite`'s `deno` plugin already tries to be first (`enforce: "pre"`) and to discard
 * anything `vite:resolve` hands back — but its guard is `tmp.resolvedBy !== "vite:resolve"`, and
 * Vite's DEV plugin container returns a resolution with **no `resolvedBy` field at all**. The guard
 * therefore never fires in `vite dev`: the deno plugin adopts Vite's answer as its own input and
 * re-resolves that, so whatever Node resolution found wins.
 *
 * That is harmless for a specifier whose npm copy is the intended one (`preact`, `zod` — the repo's
 * own `node_modules` answers first and answers correctly), and fatal for a JSR-ONLY name that also
 * exists on npm. `fresh` is exactly that: the framework lives only on JSR, while npm's `fresh` is
 * jshttp's CommonJS HTTP-freshness helper. With no copy inside the repo, Node resolution walks the
 * ancestor chain PAST the project root and will happily bind to one in a parent directory or the
 * user's home — `C:\Users\<user>\node_modules\fresh` on the machine this was diagnosed on. The
 * module then loads as CJS interop exporting `{ default, __require }`, and `apps/web/utils/state.ts`
 * dies on `createDefine is not a function` before a single route renders.
 *
 * Rewriting to the explicit registry target closes it by construction: `jsr:@fresh/core@^2.2.2` is
 * not a package name, so Vite's resolver cannot claim it and the deno plugin is the only thing left
 * that can answer.
 *
 * Keep this ahead of `fresh()` in the plugin list — it only works while it runs before the `deno`
 * plugin it is protecting.
 */
function pinDenoRegistrySpecifiers(): Plugin {
	const pinned = collectDenoRegistrySpecifiers();
	// Longest first, so `fresh/` is tested before `fresh` can prefix-match the same specifier.
	const prefixes = [...pinned.entries()]
		.filter(([specifier]) => specifier.endsWith("/"))
		.sort(([a], [b]) => b.length - a.length);

	return {
		name: "projective:pin-deno-registry-specifiers",
		enforce: "pre",
		async resolveId(source, importer, options) {
			let target = pinned.get(source);

			if (target === undefined) {
				const prefix = prefixes.find(([specifier]) => source.startsWith(specifier));
				if (prefix === undefined) return null;
				target = prefix[1] + source.slice(prefix[0].length);
			}

			return await this.resolve(target, importer, {
				...options,
				skipSelf: true,
			});
		},
	};
}

/**
 * Collapses Windows path separators in resolved module ids, so one source file is never built as
 * two modules.
 *
 * Vite's own convention is forward slashes in module ids on every platform (`normalizePath`), but
 * two resolvers disagree here. An app import goes through the Deno import map — `_app.tsx` importing
 * `@web/features/shell/islands/ScrollIdle.island.tsx` resolves to a NATIVE
 * `C:\…\ScrollIdle.island.tsx` — while the island specifiers this config passes to
 * `fresh({ islandSpecifiers })` are `file://` URLs, which Vite's own resolver turns into
 * `C:/…/ScrollIdle.island.tsx`. Rollup keys modules by id string, so the same file is instantiated
 * twice.
 *
 * That is fatal specifically for islands, and silently so. The SSR renderer recognises an island by
 * looking its component FUNCTION up in the snapshot registry; the registry is built from the
 * `file://` (forward-slash) copy while every route renders the import-map (backslash) copy, so the
 * lookup misses on every island of every page. They render as plain server components, and because
 * `FreshRuntimeScript` only emits the bootstrap for islands actually encountered during a render,
 * the page also ships no hydration script at all — with no error at build time or request time.
 *
 * This is why the fault is **Windows-only** and never appears in `deno task dev`: on POSIX the two
 * forms are already byte-identical, and the dev server resolves each id once through a single
 * graph. It also stops the duplication cascading — a duplicated island drags its whole import
 * subtree in a second time.
 */
function normalizeModuleIds(): Plugin {
	return {
		name: "projective:normalize-module-ids",
		enforce: "pre",
		async resolveId(source, importer, options) {
			const resolved = await this.resolve(source, importer, {
				...options,
				skipSelf: true,
			});

			// Leave unresolved ids, externals, and virtual modules (`\0…`) exactly as they are —
			// a virtual id is an opaque key, not a path, and may legitimately contain a backslash.
			if (
				resolved === null || resolved.external ||
				resolved.id.startsWith("\0") || !resolved.id.includes("\\")
			) {
				return resolved;
			}

			return { ...resolved, id: resolved.id.replaceAll("\\", "/") };
		},
	};
}

/**
 * Works around a duplicate-rename crash in `@fresh/plugin-vite` (1.1.2,
 * `src/plugins/server_entry.ts` → `writeBundle`).
 *
 * That hook walks the SSR build's `.vite/manifest.json`, collects **every** `item.css[]` /
 * `item.assets[]` reference, and `Deno.rename`s each one from `_fresh/server/` into
 * `_fresh/client/` under a `Promise.all`. It never dedupes. A stylesheet imported by more than one
 * SSR entry is listed once per entry, so the first rename moves the file and the rest reject with
 * `NotFound`, failing the whole build after ~40s of work. Here `explore-results.css` is shared by
 * `/explore`, `/view/[entity]`, `/[handle]/view/[item]` and the `EntityViewScreen` chunk — 4
 * references, 1 file, 3 guaranteed failures.
 *
 * The fix is to hand that hook a manifest in which each physical asset appears exactly once.
 * Dropping the surplus references cannot lose a stylesheet: Vite bakes the href into the route
 * chunk itself (`const routeCss = ["/assets/…css"]`), and the built server never reads the manifest
 * at runtime — it is consumed only to move and register the files.
 *
 * Deliberately **synchronous** and `enforce: "pre"`: Rollup invokes `writeBundle` hooks in plugin
 * order but awaits them together, so the rewrite must complete during the call rather than after an
 * `await`. Scoped to the server environment so the client manifest — which *does* drive asset
 * injection — is left untouched.
 */
function dedupeFreshStaticAssets(): Plugin {
	interface ManifestChunk {
		css?: string[];
		assets?: string[];
	}

	return {
		name: "projective:dedupe-fresh-static-assets",
		enforce: "pre",
		applyToEnvironment(env) {
			return env.config.consumer === "server";
		},
		writeBundle(_options, bundle) {
			const entry = bundle[".vite/manifest.json"];
			if (
				!entry || entry.type !== "asset" || typeof entry.source !== "string"
			) {
				return;
			}

			const manifest = JSON.parse(entry.source) as Record<
				string,
				ManifestChunk
			>;
			const seen = new Set<string>();
			let dropped = 0;

			for (const chunk of Object.values(manifest)) {
				for (const key of ["assets", "css"] as const) {
					const ids = chunk[key];
					if (!Array.isArray(ids)) continue;

					const unique = ids.filter((id) => {
						if (seen.has(id)) {
							dropped++;
							return false;
						}
						seen.add(id);
						return true;
					});

					if (unique.length > 0) chunk[key] = unique;
					else delete chunk[key];
				}
			}

			if (dropped > 0) entry.source = JSON.stringify(manifest);
		},
	};
}
// #endregion

// #region Vite Configuration
export default defineConfig(({ mode }) => {
	const isProduction = mode === "production";
	// Drop the developer-tools islands from production builds entirely (see isDevToolsIsland).
	const islandSpecifiers = discoverFeatureIslands().filter(
		(url) => !isProduction || !isDevToolsIsland(url),
	);

	return {
		root: "apps/web",

		plugins: [
			pinDenoRegistrySpecifiers(),
			normalizeModuleIds(),
			dedupeFreshStaticAssets(),
			flattenManifestCss(),
			fresh({
				islandSpecifiers,
			}),
		],

		server: {
			fs: {
				allow: [ROOT],
			},
			watch: {
				ignored: [
					"**/coverage/**",
					"**/dist/**",
					"**/.git/**",
				],
			},
		},

		ssr: {
			noExternal: true,
		},

		build: {
			sourcemap: false,
			commonjsOptions: {
				include: [/packages\//, /node_modules/],
			},
			rollupOptions: {
				external: [/node:/, "node:process"],
				treeshake: {
					preset: "recommended",
					moduleSideEffects: uiModuleSideEffects,
				},
			},
		},
	};
});
// #endregion
