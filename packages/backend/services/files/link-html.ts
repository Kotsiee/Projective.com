/**
 * link-html — the page facts a link card shows (title, description, icon), read from at most the
 * first `MAX_RESPONSE_BYTES` of an HTML document with tolerant pattern matching. There is no DOM on
 * the server and a scanner must not execute anything it fetched, so this reads attributes as text.
 */

/** What a page says about itself. */
export interface PageFacts {
	title: string | null;
	description: string | null;
	/** Absolute URL of the page's declared icon, or `/favicon.ico` on its origin. */
	iconUrl: string | null;
}

const TITLE_MAX = 300;
const DESCRIPTION_MAX = 600;

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	ndash: "–",
	mdash: "—",
	hellip: "…",
	rsquo: "’",
	lsquo: "‘",
	rdquo: "”",
	ldquo: "“",
	middot: "·",
	copy: "©",
	reg: "®",
	trade: "™",
};

/** Decode the HTML character references a title or description is likely to carry. */
export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
		if (ref[0] === "#") {
			const code = ref[1] === "x" || ref[1] === "X"
				? parseInt(ref.slice(2), 16)
				: parseInt(ref.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: whole;
		}
		return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
	});
}

function withoutControls(text: string): string {
	let out = "";
	for (const ch of text) {
		const code = ch.charCodeAt(0);
		out += code < 0x20 || code === 0x7f ? " " : ch;
	}
	return out;
}

/** Collapse whitespace, decode references, strip control characters and clamp. */
function clean(text: string | null | undefined, max: number): string | null {
	if (!text) return null;
	const out = withoutControls(decodeEntities(text)).replace(/\s+/g, " ").trim();
	if (!out) return null;
	return out.length <= max ? out : `${out.slice(0, max - 1).trimEnd()}…`;
}

/** The attributes of one start tag, lowercased names. */
export function attributesOf(tag: string): Record<string, string> {
	const out: Record<string, string> = {};
	const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
	for (const m of tag.matchAll(re)) {
		const name = m[1].toLowerCase();
		if (!(name in out)) out[name] = m[2] ?? m[3] ?? m[4] ?? "";
	}
	return out;
}

/** Resolve an href against the page URL, keeping only http(s). */
function absolute(href: string, base: string): string | null {
	try {
		const url = new URL(decodeEntities(href.trim()), base);
		return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
	} catch {
		return null;
	}
}

/** Rank an icon `rel` so a real favicon beats an apple-touch fallback. */
function iconRank(rel: string): number {
	const tokens = rel.toLowerCase().split(/\s+/);
	if (tokens.includes("icon") && !tokens.includes("mask-icon")) return 2;
	if (tokens.includes("apple-touch-icon") || tokens.includes("apple-touch-icon-precomposed")) {
		return 1;
	}
	return 0;
}

/**
 * Read a page's title, description and icon. OpenGraph wins over the plain tags because it is what
 * the site wrote FOR a share card; the head is all that is read — a page's body is not its summary.
 */
export function extractPageFacts(html: string, pageUrl: string): PageFacts {
	const headEnd = html.search(/<\/head\s*>|<body[\s>]/i);
	const head = headEnd >= 0 ? html.slice(0, headEnd) : html;

	const meta: Record<string, string> = {};
	for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
		const attrs = attributesOf(m[0]);
		const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
		if (key && attrs.content !== undefined && !(key in meta)) meta[key] = attrs.content;
	}

	const titleTag = head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1];

	let icon: { href: string; rank: number } | null = null;
	for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
		const attrs = attributesOf(m[0]);
		const rank = iconRank(attrs.rel ?? "");
		if (rank === 0 || !attrs.href) continue;
		if (!icon || rank > icon.rank) icon = { href: attrs.href, rank };
	}

	let fallbackIcon: string | null = null;
	try {
		fallbackIcon = new URL("/favicon.ico", pageUrl).href;
	} catch {
		fallbackIcon = null;
	}

	return {
		title: clean(meta["og:title"] ?? meta["twitter:title"] ?? titleTag, TITLE_MAX),
		description: clean(
			meta["og:description"] ?? meta["twitter:description"] ?? meta.description,
			DESCRIPTION_MAX,
		),
		iconUrl: (icon ? absolute(icon.href, pageUrl) : null) ?? fallbackIcon,
	};
}
