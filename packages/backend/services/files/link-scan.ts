import type { LinkAttachment } from "@projective/types/files";

/**
 * files link-scan — resolving a pasted URL into the {@link LinkAttachment} the hub stores: its
 * registrable domain, its page title, a RE-HOSTED favicon, and a safety verdict.
 *
 * **This is the most dangerous code path in the asset hub, and its outbound half is not built.**
 * Ingesting a link means the SERVER fetches a URL a stranger chose. That is a server-side request
 * forgery primitive by construction, and every guard below exists because the naive version of this
 * function is an unauthenticated read of the platform's own private network. The requirements are
 * written out so they are auditable; until the fetch is implemented against them,
 * {@link resolveLinkPreview} makes NO request — it applies the address guards, takes a title from the
 * URL itself, stores no favicon, and records the link as never scanned (`pending`) rather than
 * asserting a verdict nobody computed.
 *
 * ### What the live path MUST do before it fetches anything
 *
 * 1. **`https:` only.** Plaintext lets anyone on the path choose what the platform stores and re-hosts.
 *    The Zod regex on `LinkAttachSchema` is a cheap gate, not the boundary — this is the boundary.
 * 2. **Resolve DNS first and refuse private space.** `https://127.0.0.1/…`,
 *    `https://metadata.internal/…` and `https://169.254.169.254/…` all satisfy an `https:` regex.
 *    Resolve the hostname, then reject loopback, link-local, private, carrier-grade-NAT, unique-local
 *    and unspecified ranges — see {@link isForbiddenAddress}. Refuse on EVERY hop, not just the first:
 *    a public host may 302 straight to `169.254.169.254`, and re-resolving only the original hostname
 *    walks into it.
 * 3. **Pin the resolved address.** Between the DNS check and the connect, a hostile resolver can answer
 *    differently (DNS rebinding). Connect to the address that was CHECKED, carrying the original `Host`
 *    header — never re-resolve the name a second time.
 * 4. **At most {@link MAX_REDIRECTS} redirects,** each re-validated by rules 1–3.
 * 5. **A hard timeout** ({@link FETCH_TIMEOUT_MS}) on the whole operation, via `AbortSignal.timeout`.
 *    A slow-loris origin must not be able to pin a request worker.
 * 6. **A response size cap** ({@link MAX_RESPONSE_BYTES}), enforced by READING THE STREAM and aborting
 *    past the cap. `Content-Length` is attacker-supplied and a chunked response has none at all.
 * 7. **Service-side only, never under the user's JWT.** The fetch carries no Authorization header, no
 *    cookies, and no ambient credential of any kind (`credentials: "omit"`, `redirect: "manual"`).
 * 8. **RE-HOST the favicon into the `public_assets` bucket. Never hotlink it.** A hotlinked
 *    `/favicon.ico` sends every viewer's IP address to a host the link's author chose, which turns
 *    pasting a link into an IP-harvesting primitive. The re-hosted copy is size- and MIME-capped like
 *    any other public object.
 *
 * ### The verdict axis
 *
 * `unscannable` is deliberately distinct from `suspicious`: "we could not reach it" is not "we found
 * something". Collapsing them either cries wolf on every transient timeout or waves through a host that
 * refuses inspection. A `blocked` verdict is the only one that withholds the favicon — a re-hosted image
 * from a known-malicious origin is still an asset we chose to serve.
 */

// #region Hardening constants

/** Maximum redirect hops. Each hop is re-validated from scratch. */
export const MAX_REDIRECTS = 2;

/** Hard ceiling on the whole ingest, in milliseconds. */
export const FETCH_TIMEOUT_MS = 5_000;

/**
 * Maximum bytes read from an origin. Enforced by reading the stream, never by trusting
 * `Content-Length` — that header is attacker-supplied and a chunked response omits it entirely.
 */
export const MAX_RESPONSE_BYTES = 512 * 1024;

/** Maximum bytes accepted for a re-hosted favicon. */
export const MAX_FAVICON_BYTES = 64 * 1024;

/**
 * The reputation feed the live verdict is drawn from.
 *
 * A placeholder per root CLAUDE.md §6 — a real key is never committed, and the provider itself is not
 * yet chosen. Read from the environment at call time, never inlined.
 */
export const LINK_SAFETY_API_KEY_PLACEHOLDER = "XXXX-XXXX";

// #endregion

// #region Address guards

/** Hostnames that never leave the machine, whatever they resolve to. */
const LOCAL_NAMES = new Set([
	"localhost",
	"localhost.localdomain",
	"ip6-localhost",
	"ip6-loopback",
]);

/**
 * Whether a resolved IP literal is in a range the platform must never fetch from.
 *
 * Covers loopback, link-local (including the `169.254.169.254` cloud metadata endpoint), the three
 * RFC 1918 private ranges, carrier-grade NAT, the unspecified address, and their IPv6 equivalents
 * (unique-local `fc00::/7`, link-local `fe80::/10`, loopback `::1`, and IPv4-mapped forms).
 *
 * Pure and total so it stays testable without a resolver — the live path calls it with EVERY address a
 * hostname resolved to, and refuses if ANY of them is forbidden. Refusing on "any" rather than "all" is
 * deliberate: a hostname that resolves to one public and one private address is a rebinding attempt.
 */
export function isForbiddenAddress(address: string): boolean {
	const addr = address.trim().toLowerCase();
	if (addr === "" || addr === "0.0.0.0" || addr === "::" || addr === "::1") return true;

	// IPv4-mapped IPv6 (`::ffff:127.0.0.1`) — unwrap and re-test, or the guard is trivially bypassed.
	const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped) return isForbiddenAddress(mapped[1]);

	const v4 = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (v4) {
		const [a, b] = [Number(v4[1]), Number(v4[2])];
		if (a === 0 || a === 10 || a === 127) return true; // unspecified, private, loopback
		if (a === 169 && b === 254) return true; // link-local + cloud metadata
		if (a === 172 && b >= 16 && b <= 31) return true; // private
		if (a === 192 && b === 168) return true; // private
		if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
		if (a >= 224) return true; // multicast + reserved
		return false;
	}

	// IPv6: unique-local `fc00::/7` and link-local `fe80::/10`.
	if (/^f[cd][0-9a-f]{2}:/.test(addr)) return true;
	if (/^fe[89ab][0-9a-f]:/.test(addr)) return true;
	return false;
}

/**
 * Whether a URL passes the CHEAP, pre-DNS guards: `https:`, no credentials in the authority, no
 * non-standard port, and not a name that never leaves the machine.
 *
 * Passing this is necessary and NOT sufficient — the DNS resolution guard of rule 2 is what actually
 * stops SSRF, and this only avoids paying for a lookup on a URL that was never going to be fetched.
 */
export function isFetchableUrl(raw: string): boolean {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	if (url.protocol !== "https:") return false;
	// `https://user:pass@host/` would forward a credential the pasting user may not have meant to share.
	if (url.username !== "" || url.password !== "") return false;
	if (url.port !== "" && url.port !== "443") return false;
	const host = url.hostname.toLowerCase();
	if (LOCAL_NAMES.has(host)) return false;
	if (host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
		return false;
	}
	// A bare IP literal skips DNS entirely, so apply the address guard right here.
	if (/^[\d.]+$/.test(host) || host.includes(":")) return isFetchableAddressHost(host);
	return true;
}

/** Apply {@link isForbiddenAddress} to a hostname that is already an IP literal. */
function isFetchableAddressHost(host: string): boolean {
	return !isForbiddenAddress(host.replace(/^\[|\]$/g, ""));
}

/**
 * The registrable domain shown as a link card's subtitle.
 *
 * Strips a leading `www.` only. It does NOT attempt a public-suffix reduction: `bbc.co.uk` and
 * `user.github.io` are both meaningfully "the site" to a reader, and a naive two-label rule renders the
 * first as `co.uk` and the second as `github.io` — both wrong, one dangerously so, because a phishing
 * subdomain would then display as its victim's brand.
 */
export function domainOf(raw: string): string {
	try {
		return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return "";
	}
}

// #endregion

// #region Preview resolution

/** What a link ingest concluded, before it is stored on an asset row. */
export interface LinkPreview extends LinkAttachment {
	/** Why the scan reached its verdict — kept for the audit trail, never rendered to a recipient. */
	reason: string | null;
}

/**
 * Resolve a pasted URL into the attachment facet the hub stores.
 *
 * Refuses before it resolves anything when the URL fails the cheap guards — the caller maps that to a
 * 422, and a refusal is always cheaper than a fetch that should not have happened.
 */
export async function resolveLinkPreview(raw: string): Promise<LinkPreview | null> {
	if (!isFetchableUrl(raw)) return null;
	const domain = domainOf(raw);
	if (!domain) return null;

	// The fetch is not built (see the module note): resolve DNS → refuse any forbidden address → connect
	// to the PINNED address with the original Host header, `credentials: "omit"`, `redirect: "manual"`,
	// `AbortSignal.timeout(FETCH_TIMEOUT_MS)` → read at most MAX_RESPONSE_BYTES → parse `<title>` /
	// OpenGraph → check the reputation feed (key from the environment, never inlined) → re-host the
	// favicon into `public_assets`. Until then the link is stored as never scanned.
	await Promise.resolve();
	return {
		url: raw,
		domain,
		title: titleFromUrl(raw, domain),
		description: null,
		faviconUrl: null,
		scanStatus: "pending",
		scannedAt: null,
		reason: null,
	};
}

/** A readable title from a URL's last path segment, falling back to the domain. */
function titleFromUrl(raw: string, domain: string): string {
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

// #endregion
