import { z } from "zod";
import { FileCategory, fileExtension } from "./categories.ts";
import { FileKind } from "./kinds.ts";
import { AssetOwnerType, AssetVisibility } from "./assets.ts";
import type { FileObjectTier } from "./storage.ts";

/**
 * files.inspect — the contract behind the shell-free file inspector (`/inspect/[fileId]`) and the
 * streaming media proxy (`/api/media/proxy/[fileId]`) that feeds it.
 *
 * The proxy is the inspector's ONLY byte source: every canvas reads through it, so no storage host,
 * bucket or object path reaches the page. {@link resolveViewer} is the single, pure decision of which
 * canvas draws a file — by extension first and the stored MIME type second, because the stored type is
 * whatever the uploading browser declared (`""` for `.glb`/`.md`, `video/mp2t` for `.ts`).
 */

// #region Routes

/** The same-origin route that streams an asset's bytes after the read decision. */
export const MEDIA_PROXY_ROUTE = "/api/media/proxy";

/** The shell-free inspector page. */
export const INSPECT_ROUTE = "/inspect";

/** Options every proxy address can carry. */
export interface MediaProxyOptions {
	/** A WebP rendition instead of the original (the proxy falls back to the original). */
	tier?: FileObjectTier;
	/** Serve as an attachment. */
	download?: boolean;
	/** The share-link slug that authorises an anonymous read. */
	share?: string | null;
}

/** The proxy address for one asset. */
export function mediaProxyHref(assetId: string, opts: MediaProxyOptions = {}): string {
	const q = new URLSearchParams();
	if (opts.tier) q.set("tier", opts.tier);
	if (opts.download) q.set("download", "1");
	if (opts.share) q.set("share", opts.share);
	const qs = q.toString();
	return `${MEDIA_PROXY_ROUTE}/${encodeURIComponent(assetId)}${qs ? `?${qs}` : ""}`;
}

/** The inspector page address for one asset. */
export function fileInspectHref(assetId: string, opts: { share?: string | null } = {}): string {
	const qs = opts.share ? `?${new URLSearchParams({ share: opts.share })}` : "";
	return `${INSPECT_ROUTE}/${encodeURIComponent(assetId)}${qs}`;
}

/** Whether an asset has platform-stored bytes the inspector can open. */
export function inspectable(asset: { source: string; status: string }): boolean {
	return asset.source === "supabase" && asset.status === "uploaded";
}

// #endregion

// #region Viewers

/** The canvas that draws a file. */
export const InspectViewer = z.enum([
	"image",
	"svg",
	"video",
	"audio",
	"pdf",
	"markdown",
	"code",
	"text",
	"table",
	"model",
	"docx",
	"font",
	"unsupported",
]);
export type InspectViewer = z.infer<typeof InspectViewer>;

/** The 3D formats the model canvas can parse from a single file. */
export const ModelFormat = z.enum(["glb", "gltf", "obj", "stl", "ply", "fbx", "3mf", "dae", "usdz"]);
export type ModelFormat = z.infer<typeof ModelFormat>;

/** The outcome of {@link resolveViewer}. */
export interface ViewerChoice {
	viewer: InspectViewer;
	/** highlight.js language id for `code`/`markdown` sources; `null` elsewhere. */
	language: string | null;
	modelFormat: ModelFormat | null;
	/** Cell delimiter for `table`. */
	delimiter: "," | "\t" | null;
	/** The original is not browser-renderable; draw the `lg` WebP rendition instead. */
	rendition: boolean;
}

const BROWSER_IMAGES = new Set(["jpg", "jpeg", "jfif", "pjpeg", "png", "apng", "gif", "webp", "avif", "bmp", "ico", "cur"]);
const RENDITION_IMAGES = new Set(["heic", "heif", "tif", "tiff", "psd"]);
const VIDEO = new Set(["mp4", "m4v", "mov", "webm", "ogv", "mkv"]);
const AUDIO = new Set(["mp3", "wav", "wave", "ogg", "oga", "opus", "m4a", "aac", "flac", "weba"]);
const MARKDOWN = new Set(["md", "markdown", "mdown", "mkd", "mdx"]);
const TEXT = new Set(["txt", "text", "log", "srt", "vtt", "rst", "adoc", "asciidoc", "nfo", "me"]);
const FONTS = new Set(["ttf", "otf", "woff", "woff2"]);
const MODELS: ReadonlySet<string> = new Set(ModelFormat.options);

/** File extension → highlight.js language id. */
export const CODE_LANGUAGES: Readonly<Record<string, string>> = {
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jsx: "javascript",
	ts: "typescript",
	mts: "typescript",
	cts: "typescript",
	tsx: "typescript",
	py: "python",
	pyw: "python",
	rb: "ruby",
	php: "php",
	go: "go",
	rs: "rust",
	java: "java",
	kt: "kotlin",
	kts: "kotlin",
	swift: "swift",
	c: "c",
	h: "c",
	cpp: "cpp",
	cc: "cpp",
	cxx: "cpp",
	hpp: "cpp",
	hh: "cpp",
	cs: "csharp",
	m: "objectivec",
	mm: "objectivec",
	html: "xml",
	htm: "xml",
	xhtml: "xml",
	vue: "xml",
	svelte: "xml",
	xml: "xml",
	xsd: "xml",
	xsl: "xml",
	plist: "xml",
	css: "css",
	scss: "scss",
	sass: "scss",
	less: "less",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	ps1: "powershell",
	psm1: "powershell",
	bat: "dos",
	cmd: "dos",
	json: "json",
	jsonc: "json",
	json5: "json",
	jsonl: "json",
	geojson: "json",
	topojson: "json",
	ipynb: "json",
	webmanifest: "json",
	yaml: "yaml",
	yml: "yaml",
	toml: "ini",
	ini: "ini",
	cfg: "ini",
	conf: "ini",
	properties: "properties",
	env: "bash",
	editorconfig: "ini",
	gitignore: "bash",
	gitattributes: "bash",
	npmrc: "ini",
	sql: "sql",
	graphql: "graphql",
	gql: "graphql",
	dockerfile: "dockerfile",
	makefile: "makefile",
	mk: "makefile",
	lua: "lua",
	r: "r",
	pl: "perl",
	pm: "perl",
	dart: "dart",
	scala: "scala",
	hs: "haskell",
	ex: "elixir",
	exs: "elixir",
	erl: "erlang",
	clj: "clojure",
	fs: "fsharp",
	vb: "vbnet",
	groovy: "groovy",
	gradle: "groovy",
	proto: "protobuf",
	diff: "diff",
	patch: "diff",
	tex: "latex",
	jl: "julia",
	asm: "x86asm",
	nginx: "nginx",
	tf: "ini",
	hcl: "ini",
	prisma: "plaintext",
	lock: "plaintext",
};

/** Bare file names (no extension) that are known text formats. */
const NAMED_SOURCES: Readonly<Record<string, ViewerChoice>> = {
	dockerfile: choice("code", { language: "dockerfile" }),
	makefile: choice("code", { language: "makefile" }),
	readme: choice("text"),
	license: choice("text"),
	licence: choice("text"),
	changelog: choice("text"),
	authors: choice("text"),
	notice: choice("text"),
};

const MIME_MODELS: Readonly<Record<string, ModelFormat>> = {
	"model/gltf-binary": "glb",
	"model/gltf+json": "gltf",
	"model/stl": "stl",
	"model/obj": "obj",
	"model/3mf": "3mf",
	"model/vnd.usdz+zip": "usdz",
};

const TEXT_LIKE_MIME = /^(text\/|application\/(json|ld\+json|xml|x-yaml|yaml|toml|javascript|typescript|x-sh|sql|graphql))/;

function choice(viewer: InspectViewer, extra: Partial<ViewerChoice> = {}): ViewerChoice {
	return { viewer, language: null, modelFormat: null, delimiter: null, rendition: false, ...extra };
}

/**
 * Which canvas draws a file: extension first, then the stored MIME type, else `unsupported`.
 *
 * Pure and total — it never throws and never guesses beyond the two facts it is given.
 */
export function resolveViewer(name: string, mimeType?: string | null): ViewerChoice {
	const lower = name.trim().toLowerCase();
	const ext = fileExtension(lower);
	const base = lower.split(/[\\/]/).pop() ?? lower;
	const mime = (mimeType ?? "").toLowerCase().split(";")[0].trim();

	if (base.lastIndexOf(".") <= 0) {
		const named = NAMED_SOURCES[ext];
		if (named) return named;
		const language = CODE_LANGUAGES[ext];
		if (language) return choice("code", { language });
	} else {
		if (BROWSER_IMAGES.has(ext)) return choice("image");
		if (RENDITION_IMAGES.has(ext)) return choice("image", { rendition: true });
		if (ext === "svg" || ext === "svgz") return choice("svg");
		if (VIDEO.has(ext)) return choice("video");
		if (AUDIO.has(ext)) return choice("audio");
		if (ext === "pdf") return choice("pdf");
		if (MARKDOWN.has(ext)) return choice("markdown", { language: "markdown" });
		if (ext === "csv") return choice("table", { delimiter: "," });
		if (ext === "tsv" || ext === "tab") return choice("table", { delimiter: "\t" });
		if (MODELS.has(ext)) return choice("model", { modelFormat: ext as ModelFormat });
		if (ext === "docx") return choice("docx");
		if (FONTS.has(ext)) return choice("font");
		if (TEXT.has(ext)) return choice("text");
		const language = CODE_LANGUAGES[ext];
		if (language) return choice("code", { language });
	}

	if (!mime || mime === "application/octet-stream") return choice("unsupported");
	if (mime === "image/svg+xml") return choice("svg");
	if (/^image\/(jpeg|png|apng|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/.test(mime)) return choice("image");
	if (/^image\/(heic|heif|tiff)$/.test(mime)) return choice("image", { rendition: true });
	if (mime.startsWith("video/")) return choice("video");
	if (mime.startsWith("audio/")) return choice("audio");
	if (mime === "application/pdf") return choice("pdf");
	if (mime === "text/markdown") return choice("markdown", { language: "markdown" });
	if (mime === "text/csv") return choice("table", { delimiter: "," });
	if (mime === "text/tab-separated-values") return choice("table", { delimiter: "\t" });
	if (MIME_MODELS[mime]) return choice("model", { modelFormat: MIME_MODELS[mime] });
	if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return choice("docx");
	if (mime.startsWith("font/")) return choice("font");
	if (mime === "application/json" || mime === "application/ld+json") return choice("code", { language: "json" });
	if (mime === "application/xml" || mime === "text/xml") return choice("code", { language: "xml" });
	if (TEXT_LIKE_MIME.test(mime)) return choice("text");
	return choice("unsupported");
}

/** Viewers that read the whole file as text before drawing it. */
export const TEXT_VIEWERS: ReadonlySet<InspectViewer> = new Set(["markdown", "code", "text", "table"]);

/** Size ceilings for text canvases; a larger file falls back to the plain or unsupported state. */
export const INSPECT_TEXT_LIMITS = Object.freeze({
	/** Above this, code is shown as plain text without highlighting. */
	highlightBytes: 1_000_000,
	/** Above this, a text-like file is not read into the page at all. */
	textBytes: 10_000_000,
	/** Rows a table canvas renders before truncating. */
	tableRows: 5_000,
});

// #endregion

// #region Inspector DTO

/** How the viewer reached the file — decides which actions and links the page offers. */
export const InspectAccess = z.enum(["owner", "member", "share", "public"]);
export type InspectAccess = z.infer<typeof InspectAccess>;

/** The person the file belongs to, as far as the viewer may know them. */
export const InspectOwnerSchema = z.object({
	handle: z.string().nullable(),
	name: z.string(),
	/** A proxy address, never a storage URL. */
	avatarSrc: z.string().nullable(),
});
export type InspectOwner = z.infer<typeof InspectOwnerSchema>;

/**
 * Everything the inspector page renders, resolved server-side under the viewer's own read rule.
 *
 * Every address is a same-origin proxy or page route; no bucket, object path or storage host appears.
 */
export const InspectAssetSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	ext: z.string(),
	mimeType: z.string(),
	category: FileCategory,
	categoryLabel: z.string(),
	kind: FileKind,
	viewer: InspectViewer,
	language: z.string().nullable(),
	modelFormat: ModelFormat.nullable(),
	delimiter: z.enum([",", "\t"]).nullable(),
	sizeBytes: z.number().int().nonnegative(),
	sizeLabel: z.string(),
	width: z.number().int().positive().nullable(),
	height: z.number().int().positive().nullable(),
	durationMs: z.number().nonnegative().nullable(),
	durationLabel: z.string().nullable(),
	pageCount: z.number().int().positive().nullable(),
	/** Audio waveform peaks (0..1) extracted at upload. */
	peaks: z.array(z.number()).nullable(),
	blurhash: z.string().nullable(),
	createdAt: z.string(),
	dateLabel: z.string(),
	owner: InspectOwnerSchema.nullable(),
	ownerType: AssetOwnerType,
	visibility: AssetVisibility,
	access: InspectAccess,
	canManage: z.boolean(),
	/** The bytes the canvas draws (the rendition when the original is not browser-renderable). */
	src: z.string(),
	/** The `lg` rendition, when one was written (images only). */
	previewSrc: z.string().nullable(),
	/** The original as an attachment. */
	downloadHref: z.string(),
	/** The share slug the viewer arrived with; carried onto every derived address. */
	share: z.string().nullable(),
	/** The live item share link (`/share/<slug>`), for a viewer who manages the file. */
	shareUrl: z.string().nullable(),
	downloadCount: z.number().int().nonnegative().nullable(),
	contentHash: z.string().nullable(),
});
export type InspectAsset = z.infer<typeof InspectAssetSchema>;

// #endregion
