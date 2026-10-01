import type { LinkAttachment, LinkScanStatus } from "@projective/types/files";
import { isFilesBackendLive } from "../../core/supabase.ts";
import { domainOf, isFetchableUrl, urlSuspicion } from "./link-guards.ts";
import { FETCH_TIMEOUT_MS, guardedFetch, type LinkTransport } from "./link-fetch.ts";
import { extractPageFacts } from "./link-html.ts";
import { rehostFavicon } from "./link-favicon.ts";
import { checkReputation, type Reputation } from "./link-reputation.ts";

export { domainOf, isFetchableUrl, isForbiddenAddress } from "./link-guards.ts";
export { FETCH_TIMEOUT_MS, MAX_REDIRECTS, MAX_RESPONSE_BYTES } from "./link-fetch.ts";
export { MAX_FAVICON_BYTES } from "./link-favicon.ts";

/**
 * files link-scan — the link safety service: what a URL somebody posted IS, before anybody is shown
 * a preview of it or sent to it. One scan answers both the asset hub's link ingest
 * ({@link resolveLinkPreview}) and the chat feed's previews (`services/links`).
 *
 * ## Order of the checks
 *
 * 1. **On its face** (`urlSuspicion`, no I/O): a link into a private or local network, carrying
 *    credentials, at a bare IP, at a look-alike internationalised name or an unusual port is
 *    `suspicious`. A private target is never resolved or sent anywhere — it is the reader's own
 *    network the link is aimed at.
 * 2. **Reputation** (Google Safe Browsing, `link-reputation.ts`): a listed site is `blocked`.
 * 3. **The page** (`link-fetch.ts`, every SSRF rule on every hop): a hop the guards refuse is
 *    `suspicious` — the link leads somewhere the platform will not go; a network that fails is
 *    `unscannable` — "we could not reach it" is not "we found something"; a page that answers is
 *    `safe`, with its title, description and a RE-HOSTED icon (`link-favicon.ts`).
 *
 * Plain `http:` is never fetched (anyone on the path chooses what would be stored), so it is
 * `unscannable` unless its reputation already blocked it.
 *
 * ## The gate
 *
 * Every network step sits behind `FILES_BACKEND_LIVE`, as the asset hub's other outbound work does.
 * With the gate down the scan touches no network: the face-value checks still flag, Google's own
 * Safe Browsing test host is reported `blocked` so the warning path is exercisable, and anything else
 * is `safe` with a title read off its path.
 *
 * ## Caching
 *
 * A verdict is remembered per URL for a while (an hour for safe, a day for flagged, minutes for
 * unscannable) and concurrent scans of one URL share one promise, so a busy conversation scans a
 * link once rather than once per reader.
 */

// #region Result
/** The verdict and facts of one link. A completed scan is never `pending`. */
export interface LinkScan {
	url: string;
	domain: string;
	verdict: Exclude<LinkScanStatus, "pending">;
	title: string | null;
	description: string | null;
	/** Re-hosted in `public_assets`; null when there was no usable icon or the link was not safe. */
	faviconUrl: string | null;
	/** Why the verdict is what it is, in one sentence; null for a plain safe link. */
	reason: string | null;
	scannedAt: string;
}

/** Seams for tests; production passes none. */
export interface ScanDeps {
	live?: boolean;
	transport?: LinkTransport;
	reputation?: (url: string) => Promise<Reputation>;
	rehost?: (iconUrl: string, deadline: number) => Promise<string | null>;
	now?: () => number;
}
// #endregion

// #region Cache
const CACHE_MAX = 1_000;
const TTL_MS: Record<LinkScan["verdict"], number> = {
	safe: 60 * 60_000,
	suspicious: 24 * 60 * 60_000,
	blocked: 24 * 60 * 60_000,
	unscannable: 10 * 60_000,
};
const cache = new Map<string, { scan: LinkScan; expires: number }>();
const inflight = new Map<string, Promise<LinkScan>>();

function remember(scan: LinkScan, now: number): LinkScan {
	cache.delete(scan.url);
	cache.set(scan.url, { scan, expires: now + TTL_MS[scan.verdict] });
	while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
	return scan;
}

/** A remembered verdict that is still fresh, without scanning. */
export function cachedScan(url: string, now: number = Date.now()): LinkScan | null {
	const hit = cache.get(url);
	if (!hit) return null;
	if (hit.expires <= now) {
		cache.delete(url);
		return null;
	}
	return hit.scan;
}

/** Forget every remembered verdict (tests). */
export function clearScanCache(): void {
	cache.clear();
	inflight.clear();
}
// #endregion

// #region Scan
/** A readable title from a URL's last path segment, falling back to the domain. */
export function titleFromUrl(raw: string, domain: string): string {
	try {
		const segments = new URL(raw).pathname.split("/").filter(Boolean);
		const last = segments[segments.length - 1];
		if (!last) return domain;
		const words = decodeURIComponent(last).replace(/[-_]+/g, " ").replace(/\.[a-z0-9]{1,5}$/i, "");
		if (words.length < 3) return domain;
		return words.charAt(0).toUpperCase() + words.slice(1);
	} catch {
		return domain;
	}
}

/** Google's published Safe Browsing test host — flagged even with the gate down. */
const TEST_THREAT_HOST = "testsafebrowsing.appspot.com";

function result(
	url: string,
	verdict: LinkScan["verdict"],
	now: number,
	extra: Partial<Pick<LinkScan, "title" | "description" | "faviconUrl" | "reason">> = {},
): LinkScan {
	return {
		url,
		domain: domainOf(url),
		verdict,
		title: extra.title ?? null,
		description: extra.description ?? null,
		faviconUrl: extra.faviconUrl ?? null,
		reason: extra.reason ?? null,
		scannedAt: new Date(now).toISOString(),
	};
}

async function runScan(url: string, deps: ScanDeps): Promise<LinkScan> {
	const now = deps.now ?? Date.now;
	const started = now();
	const live = deps.live ?? isFilesBackendLive();
	const domain = domainOf(url);
	if (!domain) {
		return result(url, "unscannable", started, {
			reason: "That is not a link the platform can read.",
		});
	}

	const suspicion = urlSuspicion(url);
	if (suspicion && (suspicion.code === "private_target" || suspicion.code === "credentials")) {
		return result(url, "suspicious", started, { reason: suspicion.reason });
	}

	if (!live) {
		if (domain === TEST_THREAT_HOST) {
			return result(url, "blocked", started, {
				reason: "Google Safe Browsing lists this site for malware.",
			});
		}
		if (suspicion) return result(url, "suspicious", started, { reason: suspicion.reason });
		if (!url.startsWith("https:")) {
			return result(url, "unscannable", started, {
				reason: "This link is not secure (http), so it was not opened.",
			});
		}
		return result(url, "safe", started, { title: titleFromUrl(url, domain) });
	}

	const deadline = started + FETCH_TIMEOUT_MS;
	const fetchable = !suspicion && isFetchableUrl(url);
	const [reputation, fetched] = await Promise.all([
		(deps.reputation ?? checkReputation)(url),
		fetchable ? guardedFetch(url, { deadline, transport: deps.transport }) : Promise.resolve(null),
	]);

	if (reputation.status === "listed") {
		return result(url, "blocked", now(), {
			reason: `Google Safe Browsing lists this site for ${reputation.threat}.`,
		});
	}
	if (suspicion) return result(url, "suspicious", now(), { reason: suspicion.reason });
	if (!fetched) {
		return result(url, "unscannable", now(), {
			reason: "This link is not secure (http), so it was not opened.",
		});
	}
	if (!fetched.ok) {
		return result(url, fetched.failure.kind === "refused" ? "suspicious" : "unscannable", now(), {
			reason: fetched.failure.reason,
		});
	}

	const page = fetched.page;
	if (page.status >= 400) {
		return result(url, "unscannable", now(), { reason: `The page answered ${page.status}.` });
	}
	const type = (page.headers.get("content-type") ?? "").toLowerCase();
	const isHtml = type.includes("text/html") || type.includes("application/xhtml+xml");
	const facts = isHtml
		? extractPageFacts(new TextDecoder("utf-8", { fatal: false }).decode(page.body), page.url)
		: {
			title: titleFromUrl(page.url, domain),
			description: null,
			iconUrl: new URL("/favicon.ico", page.url).href,
		};

	let faviconUrl: string | null = null;
	if (facts.iconUrl && deadline - now() > 250) {
		try {
			faviconUrl = await (deps.rehost ?? ((icon, d) => rehostFavicon(icon, d, deps.transport)))(
				facts.iconUrl,
				deadline,
			);
		} catch {
			faviconUrl = null;
		}
	}
	return result(url, "safe", now(), {
		title: facts.title ?? titleFromUrl(url, domain),
		description: facts.description,
		faviconUrl,
	});
}

/**
 * Scan one link — or answer from a fresh cached verdict. Never throws; a scan that fails on the
 * platform's side is `unscannable`, never `safe`.
 */
export async function scanLink(url: string, deps: ScanDeps = {}): Promise<LinkScan> {
	const now = (deps.now ?? Date.now)();
	const hit = cachedScan(url, now);
	if (hit) return hit;
	const pending = inflight.get(url);
	if (pending) return await pending;

	const run = runScan(url, deps)
		.catch(() => result(url, "unscannable", now, { reason: "The link could not be checked." }))
		.then((scan) => remember(scan, now))
		.finally(() => inflight.delete(url));
	inflight.set(url, run);
	return await run;
}
// #endregion

// #region Asset-hub ingest
/** What a link ingest concluded, before it is stored on an asset row. */
export interface LinkPreview extends LinkAttachment {
	/** Why the scan reached its verdict — kept for the audit trail, never rendered to a recipient. */
	reason: string | null;
}

/**
 * Resolve a pasted URL into the attachment facet the hub stores. Refuses (null → 422) before any
 * work when the URL fails the cheap guards; otherwise the stored facet is the scan's, with the
 * favicon withheld unless the link came back safe.
 */
export async function resolveLinkPreview(raw: string): Promise<LinkPreview | null> {
	if (!isFetchableUrl(raw)) return null;
	const domain = domainOf(raw);
	if (!domain) return null;
	const scan = await scanLink(raw);
	return {
		url: raw,
		domain,
		title: scan.title ?? titleFromUrl(raw, domain),
		description: scan.verdict === "safe" ? scan.description : null,
		faviconUrl: scan.verdict === "safe" ? scan.faviconUrl : null,
		scanStatus: scan.verdict,
		scannedAt: scan.scannedAt,
		reason: scan.reason,
	};
}
// #endregion
