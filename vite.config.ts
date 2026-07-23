import { defineConfig } from "npm:vite@7.2.2";
import { fresh } from "@fresh/plugin-vite";
import { walkSync } from "jsr:@std/fs@^1/walk";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

// #region Helper Functions
const ROOT = process.cwd();

/**
 * Dynamically discovers all Island components within the features directory.
 * Formats discovered paths as explicit file:// URLs so the Deno module loader
 * can resolve them correctly without looking for them in the import map.
 *
 * @returns {string[]} An array of file:// URL strings for island components.
 */
function discoverFeatureIslands(): string[] {
	const islands: string[] = [];
	const featuresPath = path.resolve(ROOT, "apps/web/features");

	try {
		for (
			const entry of walkSync(featuresPath, {
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
			"⚠️ Could not walk features directory for islands:",
			error,
		);
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
			},
		},
	};
});
// #endregion
