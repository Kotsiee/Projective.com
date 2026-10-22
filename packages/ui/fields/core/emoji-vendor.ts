/**
 * Fixed public paths of the emoji picker's dataset. The JSON is fetched by URL, never imported, so
 * the host must serve these files: in this repo `vendorAssets()` in `vite.config.ts` publishes
 * {@link EMOJI_VENDOR_TREES} from `node_modules` (dev) and into the client build (production).
 *
 * The version is in the path so the build can serve the files `immutable`; it must equal the
 * `deno.json` pin, and the plugin refuses to build when the installed package disagrees.
 */

/** Installed `emojibase-data` version the dataset is taken from. */
export const EMOJIBASE_VERSION = "17.0.0";

/** Root of the published `emojibase-data` package (trailing slash). */
export const EMOJIBASE_VENDOR = `/vendor/emojibase-data/${EMOJIBASE_VERSION}/`;

/** English emoji records: label, tags, group, order, Unicode version, emoticons. */
export const EMOJIBASE_DATA_URL = `${EMOJIBASE_VENDOR}en/data.json`;

/** GitHub shortcodes keyed by hexcode (`1F602` → `joy`). */
export const EMOJIBASE_SHORTCODES_URL = `${EMOJIBASE_VENDOR}en/shortcodes/github.json`;

/** The `vendorAssets()` entry that publishes exactly the files above, plus the licence. */
export const EMOJI_VENDOR_TREES = [
	{
		packageName: "emojibase-data",
		version: EMOJIBASE_VERSION,
		source: ".",
		publicPath: EMOJIBASE_VENDOR,
		include: ["LICENSE", "en/data.json", "en/shortcodes/github.json"],
	},
] as const;
