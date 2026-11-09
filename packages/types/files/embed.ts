/**
 * files.embed — the providers whose own viewer may draw a file inside the platform, and the one
 * address each is framed at. The second rung of the preview ladder: a canvas of our own first, then a
 * provider's embed, then the standard fallback.
 *
 * Only these providers are framed (owner ruling, Decision #401): a link to any other host is never
 * loaded in a reader's browser, because framing it would report every reader's IP address to a host
 * the link's author chose, the same reason favicons are re-hosted. Every address is rebuilt from an
 * id matched by a tight pattern, never passed through, so a crafted link cannot steer a frame at a
 * page the allowlist does not name. `EMBED_FRAME_ORIGINS` is the CSP's `frame-src` for these frames,
 * so the policy and the resolver cannot drift apart.
 */

// #region Contract
/** The providers a frame may be opened on. */
export type EmbedProvider =
	| "google_drive"
	| "google_docs"
	| "youtube"
	| "vimeo"
	| "loom"
	| "figma";

/** One provider frame: where it loads, and the least the frame needs to run. */
export interface ProviderEmbed {
	provider: EmbedProvider;
	/** The provider's name, for "Open in …" and the frame's title. */
	label: string;
	/** The embed address, rebuilt from the matched id. */
	src: string;
	/** The origin `src` loads from; always one of {@link EMBED_FRAME_ORIGINS}. */
	origin: string;
	/** The iframe `sandbox` tokens. */
	sandbox: string;
	/** The iframe `allow` permissions policy. */
	allow: string;
	/** The iframe `referrerpolicy`: an origin only where the provider refuses an embed without one. */
	referrerPolicy: "no-referrer" | "strict-origin-when-cross-origin";
}

/** The facts of a file row an embed is resolved from. */
export interface EmbedSource {
	source: string;
	/** A stored link: its address, and the scan verdict a flagged one is never framed under. */
	link?: { url: string; scanStatus?: string } | null;
	external?: {
		providerSlug: string;
		externalFileId: string;
		externalWebUrl: string | null;
	} | null;
}

/** Every origin a provider frame loads from — the `frame-src` these frames need. */
export const EMBED_FRAME_ORIGINS: readonly string[] = [
	"https://drive.google.com",
	"https://docs.google.com",
	"https://www.youtube-nocookie.com",
	"https://player.vimeo.com",
	"https://www.loom.com",
	"https://www.figma.com",
];

/** How long a frame may take to report `load` before the standard fallback replaces it, ms. */
export const EMBED_LOAD_TIMEOUT_MS = 10_000;
// #endregion

// #region Patterns
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,12}$/;
const VIMEO_HASH = /^[a-f0-9]{6,20}$/;
const LOOM_ID = /^[a-f0-9]{32}$/;
const FIGMA_KEY = /^[A-Za-z0-9]{10,64}$/;
const FIGMA_NODE = /^[A-Za-z0-9:-]{1,40}$/;
const DOC_TYPES = new Set(["document", "spreadsheets", "presentation"]);
const FIGMA_KINDS = new Set(["file", "design", "proto", "board", "slides"]);

const YOUTUBE_HOSTS = new Set([
	"youtube.com",
	"www.youtube.com",
	"m.youtube.com",
	"youtube-nocookie.com",
	"www.youtube-nocookie.com",
]);

const PLAYER_SANDBOX =
	"allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox";
const PLAYER_ALLOW = "encrypted-media; picture-in-picture; fullscreen";
// #endregion

// #region Parsing
function safeUrl(raw: string | null | undefined): URL | null {
	if (!raw || raw.length > 2048) return null;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
	return url;
}

function segmentsOf(url: URL): string[] {
	return url.pathname.split("/").filter(Boolean);
}

/** A YouTube start offset (`90`, `90s`, `1m30s`, `1h2m3s`) in whole seconds, or `null`. */
export function youtubeStart(raw: string | null): number | null {
	if (!raw) return null;
	if (/^\d{1,6}s?$/.test(raw)) return Number.parseInt(raw, 10) || null;
	const match = /^(?:(\d{1,3})h)?(?:(\d{1,3})m)?(?:(\d{1,3})s)?$/.exec(raw);
	if (!match || !(match[1] || match[2] || match[3])) return null;
	const total = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
	return total > 0 ? total : null;
}
// #endregion

// #region Providers
function drive(id: string): ProviderEmbed | null {
	if (!DRIVE_ID.test(id)) return null;
	return {
		provider: "google_drive",
		label: "Google Drive",
		src: `https://drive.google.com/file/d/${id}/preview`,
		origin: "https://drive.google.com",
		sandbox: PLAYER_SANDBOX,
		allow: "fullscreen",
		referrerPolicy: "no-referrer",
	};
}

function googleDoc(type: string, id: string): ProviderEmbed | null {
	if (!DOC_TYPES.has(type) || !DRIVE_ID.test(id)) return null;
	return {
		provider: "google_docs",
		label: type === "spreadsheets"
			? "Google Sheets"
			: type === "presentation"
			? "Google Slides"
			: "Google Docs",
		src: `https://docs.google.com/${type}/d/${id}/preview`,
		origin: "https://docs.google.com",
		sandbox: PLAYER_SANDBOX,
		allow: "fullscreen",
		referrerPolicy: "no-referrer",
	};
}

function youtube(id: string, start: number | null): ProviderEmbed | null {
	if (!YOUTUBE_ID.test(id)) return null;
	const query = new URLSearchParams({ rel: "0" });
	if (start) query.set("start", String(start));
	return {
		provider: "youtube",
		label: "YouTube",
		src: `https://www.youtube-nocookie.com/embed/${id}?${query}`,
		origin: "https://www.youtube-nocookie.com",
		sandbox: PLAYER_SANDBOX,
		allow: PLAYER_ALLOW,
		referrerPolicy: "strict-origin-when-cross-origin",
	};
}

function vimeo(id: string, hash: string | null): ProviderEmbed | null {
	if (!VIMEO_ID.test(id)) return null;
	const query = hash && VIMEO_HASH.test(hash) ? `?h=${hash}` : "";
	return {
		provider: "vimeo",
		label: "Vimeo",
		src: `https://player.vimeo.com/video/${id}${query}`,
		origin: "https://player.vimeo.com",
		sandbox: PLAYER_SANDBOX,
		allow: PLAYER_ALLOW,
		referrerPolicy: "strict-origin-when-cross-origin",
	};
}

function loom(id: string): ProviderEmbed | null {
	if (!LOOM_ID.test(id)) return null;
	return {
		provider: "loom",
		label: "Loom",
		src: `https://www.loom.com/embed/${id}`,
		origin: "https://www.loom.com",
		sandbox: PLAYER_SANDBOX,
		allow: "fullscreen",
		referrerPolicy: "strict-origin-when-cross-origin",
	};
}

function figma(kind: string, key: string, node: string | null): ProviderEmbed | null {
	if (!FIGMA_KINDS.has(kind) || !FIGMA_KEY.test(key)) return null;
	const target = new URL(`https://www.figma.com/${kind}/${key}`);
	if (node && FIGMA_NODE.test(node)) target.searchParams.set("node-id", node);
	const query = new URLSearchParams({ embed_host: "projective", url: target.href });
	return {
		provider: "figma",
		label: "Figma",
		src: `https://www.figma.com/embed?${query}`,
		origin: "https://www.figma.com",
		sandbox: PLAYER_SANDBOX,
		allow: "fullscreen; clipboard-write",
		referrerPolicy: "strict-origin-when-cross-origin",
	};
}
// #endregion

// #region Resolver
/** The provider frame a web address can be drawn in, or `null` when no allowlisted provider owns it. */
export function embedForUrl(raw: string | null | undefined): ProviderEmbed | null {
	const url = safeUrl(raw);
	if (!url) return null;
	const host = url.hostname.toLowerCase();
	const [first, second, third] = segmentsOf(url);

	if (host === "drive.google.com") {
		if (first === "file" && second === "d" && third) return drive(third);
		if (first === "open") return drive(url.searchParams.get("id") ?? "");
		return null;
	}
	if (host === "docs.google.com") {
		return first && second === "d" && third ? googleDoc(first, third) : null;
	}
	if (YOUTUBE_HOSTS.has(host)) {
		const start = youtubeStart(url.searchParams.get("t") ?? url.searchParams.get("start"));
		if (first === "watch") return youtube(url.searchParams.get("v") ?? "", start);
		if ((first === "shorts" || first === "embed" || first === "live") && second) {
			return youtube(second, start);
		}
		return null;
	}
	if (host === "youtu.be") {
		return first ? youtube(first, youtubeStart(url.searchParams.get("t"))) : null;
	}
	if (host === "vimeo.com" || host === "www.vimeo.com") {
		return first ? vimeo(first, second ?? url.searchParams.get("h")) : null;
	}
	if (host === "player.vimeo.com") {
		return first === "video" && second ? vimeo(second, url.searchParams.get("h")) : null;
	}
	if (host === "www.loom.com" || host === "loom.com") {
		return (first === "share" || first === "embed") && second ? loom(second) : null;
	}
	if (host === "www.figma.com" || host === "figma.com") {
		return first && second ? figma(first, second, url.searchParams.get("node-id")) : null;
	}
	return null;
}

/**
 * The provider frame a file row can be drawn in: a stored link by its address (never one whose scan
 * came back suspicious or blocked), a connected Google Drive file by the page Drive gave it (a Google
 * document opens in its own editor's preview) or else its file id. Stored bytes never resolve here:
 * the inspector's own canvases draw those.
 */
export function embedFor(file: EmbedSource): ProviderEmbed | null {
	if (file.source === "link") {
		const verdict = file.link?.scanStatus;
		return verdict === "suspicious" || verdict === "blocked" ? null : embedForUrl(file.link?.url);
	}
	if (file.source !== "google_drive") return null;
	const external = file.external;
	if (!external || external.providerSlug !== "google_drive") return null;
	return embedForUrl(external.externalWebUrl) ?? drive(external.externalFileId);
}
// #endregion
