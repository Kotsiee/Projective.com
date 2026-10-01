import { z } from "zod";
import { LinkScanStatus } from "../files/assets.ts";
import { isSlug } from "../slugs/slug.ts";
import { CounterpartStandingSchema } from "../messaging/context.ts";

/**
 * links — the SSOT for links inside a message body: where they are (`segmentLinks`), what they point
 * at (`classifyLink`), what the reader is shown about them (`LinkPreview`), and how a click on one
 * leaves the platform (`exitHref`). The server and the bubble that renders the text call the same
 * functions, so "is this a link" and "which card is it" have one answer.
 */

// #region Limits
/** Links previewed per message; further links render as plain anchors. */
export const MESSAGE_LINKS_MAX = 3;

/** Links one preview request may ask about. */
export const LINK_PREVIEW_BATCH_MAX = 20;

/** The longest URL the platform will read, link or preview. */
export const LINK_URL_MAX = 2048;
// #endregion

// #region Segmenting
/** A run of a message body: plain text, or a link with the text it was written as. */
export type LinkSegment =
	| { kind: "text"; text: string }
	| { kind: "link"; text: string; href: string };

const LINK_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/giu;
const TRAILING = /[.,;:!?'"»”’]+$/u;

/** Trim punctuation a sentence put after a link, keeping a `)` the link itself opened. */
function trimTrailing(raw: string): string {
	let text = raw.replace(TRAILING, "");
	while (
		text.endsWith(")") && (text.match(/\(/g)?.length ?? 0) < (text.match(/\)/g)?.length ?? 0)
	) {
		text = text.slice(0, -1).replace(TRAILING, "");
	}
	return text;
}

/** The absolute http(s) URL a written link resolves to, or `null` when it is not one. */
export function normalizeLink(written: string): string | null {
	if (written.length > LINK_URL_MAX) return null;
	const candidate = /^www\./iu.test(written) ? `https://${written}` : written;
	try {
		const url = new URL(candidate);
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		if (!url.hostname || url.username || url.password) return null;
		return url.href;
	} catch {
		return null;
	}
}

/**
 * Split a body into text and links. Only `http(s)://…` and `www.…` are links — a bare `example.com`
 * stays text, because guessing at domains turns file names and sentences ending in a TLD into
 * anchors. A link carrying credentials (`user@host`) stays text: it is a classic disguise.
 */
export function segmentLinks(text: string): LinkSegment[] {
	const out: LinkSegment[] = [];
	let cursor = 0;
	for (const match of text.matchAll(LINK_RE)) {
		const start = match.index ?? 0;
		const written = trimTrailing(match[0]);
		const href = normalizeLink(written);
		if (!href) continue;
		if (start > cursor) out.push({ kind: "text", text: text.slice(cursor, start) });
		out.push({ kind: "link", text: written, href });
		cursor = start + written.length;
	}
	if (cursor < text.length) out.push({ kind: "text", text: text.slice(cursor) });
	return out;
}

/** The distinct links of a body, in order, at most `max`. */
export function extractLinks(text: string, max = MESSAGE_LINKS_MAX): string[] {
	const seen = new Set<string>();
	for (const segment of segmentLinks(text)) {
		if (segment.kind !== "link" || seen.has(segment.href)) continue;
		seen.add(segment.href);
		if (seen.size >= max) break;
	}
	return [...seen];
}
// #endregion

// #region Classifying
/** The product's own hosts besides the serving origin (the brief's canonical domain). */
export const CANONICAL_HOSTS: readonly string[] = ["projective.io", "www.projective.io"];

/** What a link points at. */
export type LinkTarget =
	| { kind: "profile"; url: string; handle: string }
	| { kind: "project"; url: string; slug: string }
	| { kind: "listing"; url: string; id: string }
	| { kind: "internal"; url: string; path: string }
	| { kind: "external"; url: string; host: string };

/**
 * Classify a link against the hosts that ARE this platform (`internalHosts`, e.g. the serving
 * origin's host, plus {@link CANONICAL_HOSTS}). An internal link names a profile (`/@handle`), a
 * project workspace (`/projects/prj-…`) or an entity view (`/view/{id}`, `/@handle/view/{id}`);
 * anything else internal is a plain internal link and gets no card.
 */
export function classifyLink(url: string, internalHosts: readonly string[]): LinkTarget {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { kind: "external", url, host: "" };
	}
	const host = parsed.host.toLowerCase();
	const internal = internalHosts.some((h) => h.toLowerCase() === host) ||
		CANONICAL_HOSTS.includes(parsed.hostname.toLowerCase());
	if (!internal) return { kind: "external", url, host: parsed.hostname.toLowerCase() };

	const segments = parsed.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
	const [first, second, third] = segments;
	if (first?.startsWith("@") && first.length > 1) {
		if (second === "view" && third) return { kind: "listing", url, id: third };
		return { kind: "profile", url, handle: first.slice(1) };
	}
	if (first === "projects" && second && isSlug(second, "project")) {
		return { kind: "project", url, slug: second };
	}
	if (first === "view" && second) return { kind: "listing", url, id: second };
	return { kind: "internal", url, path: parsed.pathname };
}
// #endregion

// #region Leaving the platform
/** The interstitial a flagged external link routes through. */
export const EXIT_PATH = "/exit";

/** `/exit?url=…` for an external URL. */
export function exitHref(url: string): string {
	return `${EXIT_PATH}?url=${encodeURIComponent(url)}`;
}

/**
 * Where a click on an external link goes: straight out when the scan found it safe, through the
 * interstitial otherwise — including while it has not been scanned yet, so the safe default holds
 * before the verdict arrives.
 */
export function externalLinkHref(url: string, verdict: LinkScanStatus | null): string {
	return verdict === "safe" ? url : exitHref(url);
}

/** Whether a verdict earns the warning badge (and suppresses any metadata preview). */
export function isFlaggedVerdict(verdict: LinkScanStatus | null): boolean {
	return verdict === "suspicious" || verdict === "blocked";
}
// #endregion

// #region Previews
/** A mini profile card: `/@handle`. */
export const ProfileLinkPreviewSchema = z.object({
	kind: z.literal("profile"),
	url: z.string().max(LINK_URL_MAX),
	handle: z.string().min(1).max(40),
	name: z.string().min(1).max(120),
	avatar: z.string().max(600).nullable(),
	/** e.g. "4.9"; null when unrated. */
	rating: z.string().max(8).nullable(),
	reviewCount: z.number().int().min(0).nullable(),
	standing: CounterpartStandingSchema.nullable(),
});
export type ProfileLinkPreview = z.infer<typeof ProfileLinkPreviewSchema>;

/** A project summary: `/projects/prj-…` or a project's `/view/…`. */
export const ProjectLinkPreviewSchema = z.object({
	kind: z.literal("project"),
	url: z.string().max(LINK_URL_MAX),
	slug: z.string().min(1).max(80),
	title: z.string().min(1).max(200),
	category: z.string().max(80).nullable(),
	activeStage: z.string().max(160).nullable(),
	/** The escrow position, only for a viewer who is party to the project; null otherwise. */
	escrow: z.string().max(80).nullable(),
});
export type ProjectLinkPreview = z.infer<typeof ProjectLinkPreviewSchema>;

/** A product or service showcase: `/view/{id}`. */
export const ListingLinkPreviewSchema = z.object({
	kind: z.literal("listing"),
	url: z.string().max(LINK_URL_MAX),
	id: z.string().min(1).max(120),
	title: z.string().min(1).max(200),
	cover: z.string().max(600).nullable(),
	price: z.string().max(40).nullable(),
	/** e.g. "Pipeline", "Session", "Digital product". */
	deliverable: z.string().max(60).nullable(),
});
export type ListingLinkPreview = z.infer<typeof ListingLinkPreviewSchema>;

/** An external link with its safety verdict. Metadata is withheld unless the verdict is `safe`. */
export const ExternalLinkPreviewSchema = z.object({
	kind: z.literal("external"),
	url: z.string().max(LINK_URL_MAX),
	host: z.string().max(253),
	verdict: LinkScanStatus,
	title: z.string().max(300).nullable(),
	description: z.string().max(600).nullable(),
	/** A re-hosted copy in `public_assets`, never the origin's own URL. */
	faviconUrl: z.string().max(600).nullable(),
	/** Why the link was flagged, in one sentence; null when it was not. */
	reason: z.string().max(200).nullable(),
});
export type ExternalLinkPreview = z.infer<typeof ExternalLinkPreviewSchema>;

/** Any link preview. */
export const LinkPreviewSchema = z.discriminatedUnion("kind", [
	ProfileLinkPreviewSchema,
	ProjectLinkPreviewSchema,
	ListingLinkPreviewSchema,
	ExternalLinkPreviewSchema,
]);
export type LinkPreview = z.infer<typeof LinkPreviewSchema>;

/** `POST /api/links/preview` — the links a rendered page of messages carries. */
export const LinkPreviewRequestSchema = z.object({
	urls: z.array(z.string().min(1).max(LINK_URL_MAX)).min(1).max(LINK_PREVIEW_BATCH_MAX),
});
export type LinkPreviewRequest = z.infer<typeof LinkPreviewRequestSchema>;

/** The previews resolved, keyed by the URL asked about. A URL with no card is simply absent. */
export interface LinkPreviewResult {
	previews: Record<string, LinkPreview>;
}
// #endregion

// #region Exit
/**
 * What the `/exit` interstitial knows about a link before the reader leaves. A signed-out reader is
 * never the one who triggers a scan, so for them an unscanned link reads `pending`.
 */
export interface ExitCheck {
	url: string;
	host: string;
	verdict: LinkScanStatus;
	/** Why the link was flagged or could not be checked; null for a plain safe link. */
	reason: string | null;
	/** The platform's own page — no interstitial needed; `url` is then its path. */
	internal: boolean;
}
// #endregion
