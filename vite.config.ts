import { defineConfig } from "npm:vite@7.2.2";
import { fresh } from "@fresh/plugin-vite";
import { walkSync } from "jsr:@std/fs/walk";
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
// #endregion

// #region Vite Configuration
export default defineConfig({
	root: "apps/web",

	plugins: [
		fresh({
			islandSpecifiers: [
				...discoverFeatureIslands(),
			],
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
});
// #endregion
