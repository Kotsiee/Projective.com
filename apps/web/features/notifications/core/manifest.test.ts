import { assert, assertEquals } from "@std/assert";
import { buildScheme } from "@ui/system/core/theme-engine.ts";
import { DEFAULT_CONFIG } from "@ui/system/core/context.ts";

/**
 * `apps/web/static/manifest.webmanifest` (COMMS NT4). A manifest is JSON and cannot read a CSS
 * variable, so its two colours are copies of the default theme's light-mode tokens: `theme_color` =
 * `--primary`, `background_color` = `--bg` (the splash matches the first paint). This pins the copy
 * to the engine, so a token change cannot leave the manifest behind.
 */

const manifest = JSON.parse(
	await Deno.readTextFile(new URL("../../../static/manifest.webmanifest", import.meta.url)),
) as Record<string, unknown> & { icons: { src: string; sizes: string }[] };

Deno.test("manifest — its colours are the default theme's light-mode --primary and --bg", () => {
	const light = buildScheme({ seed: DEFAULT_CONFIG.seed, dark: false });
	assertEquals(
		[String(manifest.theme_color).toLowerCase(), String(manifest.background_color).toLowerCase()],
		[light["--primary"].toLowerCase(), light["--bg"].toLowerCase()],
	);
});

Deno.test("manifest — an installable standalone app at the root, with the 192 and 512 icons that exist", async () => {
	assertEquals([manifest.start_url, manifest.scope, manifest.display], ["/", "/", "standalone"]);
	assert(typeof manifest.name === "string" && typeof manifest.short_name === "string");
	assertEquals(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
	for (const icon of manifest.icons) {
		const stat = await Deno.stat(new URL(`../../../static${icon.src}`, import.meta.url));
		assert(stat.isFile, icon.src);
	}
});
