/**
 * Fixed public paths of the inspector's vendored engine assets (pdf.js wasm/cmaps/fonts/ICC
 * profiles, three's Draco and Basis decoders). `vendorAssets()` in `vite.config.ts` serves exactly
 * these trees — streamed from `node_modules` in dev, emitted into `_fresh/client` at build — so the
 * client and the plugin share one source of truth.
 *
 * Each path carries the package version, so the build can serve them `immutable` and an upgrade
 * can never pair a new engine with a cached decoder. The versions must equal the `deno.json` pins;
 * the plugin refuses to build when the installed package disagrees.
 */

// #region Versions
/** Installed `pdfjs-dist` version the pdf.js vendor tree is taken from. */
export const PDFJS_VERSION = "6.3.289";

/** Installed `three` version the Draco and Basis decoders are taken from. */
export const THREE_VERSION = "0.186.0";
// #endregion

// #region Public paths
/** Root of the pdf.js vendor tree (trailing slash). */
export const PDFJS_VENDOR = `/vendor/pdfjs/${PDFJS_VERSION}/`;

/** pdf.js `wasmUrl`: JPEG 2000, JBIG2 and QCMS decoders plus their no-wasm fallbacks. */
export const PDFJS_WASM = `${PDFJS_VENDOR}wasm/`;

/** pdf.js `cMapUrl` (packed `.bcmap`; pass `cMapPacked: true`). */
export const PDFJS_CMAPS = `${PDFJS_VENDOR}cmaps/`;

/** pdf.js `standardFontDataUrl`. */
export const PDFJS_STANDARD_FONTS = `${PDFJS_VENDOR}standard_fonts/`;

/** pdf.js `iccUrl`. */
export const PDFJS_ICCS = `${PDFJS_VENDOR}iccs/`;

/** `DRACOLoader.setDecoderPath` target (the `draco/gltf` decoder build). */
export const DRACO_VENDOR = `/vendor/three/${THREE_VERSION}/draco/`;

/** `KTX2Loader.setTranscoderPath` target. */
export const BASIS_VENDOR = `/vendor/three/${THREE_VERSION}/basis/`;
// #endregion

// #region Trees
/** One `node_modules` directory published, file for file, under a public path. */
export interface VendorTree {
	/** npm package name, resolved from the repo's `node_modules`. */
	readonly packageName: string;
	/** Version the public path is built for; must match the installed package. */
	readonly version: string;
	/** Directory inside the package, POSIX separators, no leading or trailing slash. */
	readonly source: string;
	/** Public path prefix with a trailing slash. */
	readonly publicPath: string;
}

/** Every vendored tree the inspector reads at runtime. */
export const VENDOR_TREES: readonly VendorTree[] = [
	{ packageName: "pdfjs-dist", version: PDFJS_VERSION, source: "wasm", publicPath: PDFJS_WASM },
	{ packageName: "pdfjs-dist", version: PDFJS_VERSION, source: "cmaps", publicPath: PDFJS_CMAPS },
	{
		packageName: "pdfjs-dist",
		version: PDFJS_VERSION,
		source: "standard_fonts",
		publicPath: PDFJS_STANDARD_FONTS,
	},
	{ packageName: "pdfjs-dist", version: PDFJS_VERSION, source: "iccs", publicPath: PDFJS_ICCS },
	{
		packageName: "three",
		version: THREE_VERSION,
		source: "examples/jsm/libs/draco/gltf",
		publicPath: DRACO_VENDOR,
	},
	{
		packageName: "three",
		version: THREE_VERSION,
		source: "examples/jsm/libs/basis",
		publicPath: BASIS_VENDOR,
	},
];
// #endregion
