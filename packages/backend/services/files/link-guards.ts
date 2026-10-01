/**
 * link-guards — the PURE half of link scanning: which addresses the platform must never connect to,
 * which URLs are worth resolving at all, and which shapes of URL are suspicious before anything is
 * fetched. No I/O, so every range below is pinned by `link-scan.test.ts` without a resolver.
 */

// #region IPv4
type Cidr4 = readonly [base: number, bits: number];

/** Dotted-quad → 32-bit unsigned, or null when it is not one. */
export function parseIPv4(text: string): number | null {
	const parts = text.split(".");
	if (parts.length !== 4) return null;
	let value = 0;
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part)) return null;
		const n = Number(part);
		if (n > 255) return null;
		value = value * 256 + n;
	}
	return value;
}

const v4 = (a: number, b: number, c: number, d: number) => ((a * 256 + b) * 256 + c) * 256 + d;

/** Every IPv4 range a server-side fetch must refuse. */
const FORBIDDEN_V4: readonly Cidr4[] = [
	[v4(0, 0, 0, 0), 8], // "this network"
	[v4(10, 0, 0, 0), 8], // RFC 1918
	[v4(100, 64, 0, 0), 10], // carrier-grade NAT
	[v4(127, 0, 0, 0), 8], // loopback
	[v4(169, 254, 0, 0), 16], // link-local, incl. 169.254.169.254 cloud metadata
	[v4(172, 16, 0, 0), 12], // RFC 1918
	[v4(192, 0, 0, 0), 24], // IETF protocol assignments
	[v4(192, 0, 2, 0), 24], // TEST-NET-1
	[v4(192, 88, 99, 0), 24], // 6to4 relay anycast
	[v4(192, 168, 0, 0), 16], // RFC 1918
	[v4(198, 18, 0, 0), 15], // benchmarking
	[v4(198, 51, 100, 0), 24], // TEST-NET-2
	[v4(203, 0, 113, 0), 24], // TEST-NET-3
	[v4(224, 0, 0, 0), 4], // multicast
	[v4(240, 0, 0, 0), 4], // reserved, incl. broadcast
];

function inCidr4(value: number, [base, bits]: Cidr4): boolean {
	const size = 2 ** (32 - bits);
	return value >= base && value < base + size;
}

function isForbiddenV4(value: number): boolean {
	return FORBIDDEN_V4.some((range) => inCidr4(value, range));
}
// #endregion

// #region IPv6
/** An IPv6 literal → its eight 16-bit groups, or null when it is not one. Handles `::` and a dotted tail. */
export function parseIPv6(text: string): number[] | null {
	let addr = text.toLowerCase().replace(/^\[|\]$/g, "");
	const zone = addr.indexOf("%");
	if (zone >= 0) addr = addr.slice(0, zone);
	if (!addr.includes(":")) return null;

	let tail: number[] = [];
	const lastColon = addr.lastIndexOf(":");
	const maybeV4 = addr.slice(lastColon + 1);
	if (maybeV4.includes(".")) {
		const n = parseIPv4(maybeV4);
		if (n === null) return null;
		tail = [Math.floor(n / 65536), n % 65536];
		addr = addr.slice(0, lastColon + 1);
		if (!addr.endsWith("::")) addr = addr.slice(0, -1);
	}

	const halves = addr.split("::");
	if (halves.length > 2) return null;
	const parse = (s: string) => (s === "" ? [] : s.split(":"));
	const head = parse(halves[0]);
	const rest = halves.length === 2 ? parse(halves[1]) : [];
	const groupsOf = (list: string[]) => {
		const out: number[] = [];
		for (const g of list) {
			if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
			out.push(parseInt(g, 16));
		}
		return out;
	};
	const h = groupsOf(head);
	const r = groupsOf(rest);
	if (!h || !r) return null;
	const explicit = h.length + r.length + tail.length;
	if (halves.length === 1) {
		if (explicit !== 8) return null;
		return [...h, ...r, ...tail];
	}
	if (explicit > 7) return null;
	return [...h, ...new Array(8 - explicit).fill(0), ...r, ...tail];
}

const embeddedV4 = (g: number[], at: number) => g[at] * 65536 + g[at + 1];

function isForbiddenV6(g: number[]): boolean {
	const zeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);
	if (zeroUpTo(8)) return true; // ::
	if (zeroUpTo(7) && g[7] === 1) return true; // ::1
	if (zeroUpTo(5) && g[5] === 0xffff) return isForbiddenV4(embeddedV4(g, 6)); // ::ffff:a.b.c.d
	if (zeroUpTo(6)) return true; // ::a.b.c.d (deprecated IPv4-compatible)
	if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
		return isForbiddenV4(embeddedV4(g, 6)); // NAT64 64:ff9b::/96
	}
	if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true; // local-use NAT64 64:ff9b:1::/48
	if (g[0] === 0x100 && g.slice(1, 4).every((x) => x === 0)) return true; // discard 100::/64
	if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo 2001::/32
	if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation 2001:db8::/32
	if (g[0] === 0x2002) return isForbiddenV4(embeddedV4(g, 1)); // 6to4 2002::/16
	if ((g[0] & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
	if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
	if ((g[0] & 0xffc0) === 0xfec0) return true; // site-local fec0::/10
	if ((g[0] & 0xff00) === 0xff00) return true; // multicast ff00::/8
	return false;
}
// #endregion

// #region Addresses
/**
 * Whether an IP literal is in a range the platform must never connect to. Unparseable input is
 * refused: an address the guard cannot read is not one it has cleared.
 */
export function isForbiddenAddress(address: string): boolean {
	const text = address.trim();
	const asV4 = parseIPv4(text);
	if (asV4 !== null) return isForbiddenV4(asV4);
	const asV6 = parseIPv6(text);
	if (asV6 !== null) return isForbiddenV6(asV6);
	return true;
}

/** Whether a hostname is itself an IP literal (v4 dotted quad or a bracketed / bare v6). */
export function isIpLiteral(hostname: string): boolean {
	return parseIPv4(hostname) !== null || parseIPv6(hostname) !== null;
}
// #endregion

// #region URLs
/** Hostnames that never leave the machine, whatever they resolve to. */
const LOCAL_NAMES = new Set([
	"localhost",
	"localhost.localdomain",
	"ip6-localhost",
	"ip6-loopback",
]);

/** Suffixes of names that resolve only inside a private network. */
const LOCAL_SUFFIXES = [
	".localhost",
	".local",
	".internal",
	".intranet",
	".lan",
	".home.arpa",
	".corp",
];

/** Whether a hostname is a local-only name (`localhost`, `*.internal`, …). */
export function isLocalName(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/\.$/, "");
	return LOCAL_NAMES.has(host) || LOCAL_SUFFIXES.some((s) => host.endsWith(s));
}

/** The ports a web link may name: the scheme's default, spelled or implied. */
export function isStandardPort(url: URL): boolean {
	if (url.port === "") return true;
	return (url.protocol === "https:" && url.port === "443") ||
		(url.protocol === "http:" && url.port === "80");
}

/**
 * Whether a URL passes the CHEAP, pre-DNS guards for a server-side fetch: `https:`, no credentials,
 * the standard port, not a local-only name, and — for an IP literal — not a forbidden address.
 * Necessary, not sufficient: the resolution guard is what actually stops SSRF.
 */
export function isFetchableUrl(raw: string): boolean {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	if (url.protocol !== "https:") return false;
	if (url.username !== "" || url.password !== "") return false;
	if (!isStandardPort(url)) return false;
	if (isLocalName(url.hostname)) return false;
	if (isIpLiteral(url.hostname)) return !isForbiddenAddress(url.hostname);
	return true;
}

/**
 * The registrable-looking host a card prints. Strips a leading `www.` only — a naive two-label
 * reduction renders `bbc.co.uk` as `co.uk` and lets a phishing subdomain print as its victim's brand.
 */
export function domainOf(raw: string): string {
	try {
		return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return "";
	}
}
// #endregion

// #region Heuristics
/** A reason a URL is suspicious on its face, before anything is resolved or fetched. */
export interface UrlSuspicion {
	code: "private_target" | "ip_literal" | "lookalike" | "port" | "credentials";
	reason: string;
}

/**
 * What is wrong with a URL on its face, or null. These are the reader-facing reasons a link is
 * flagged without a reputation hit: it points into a private network (the reader's own router, a
 * metadata endpoint), at a bare IP address, at an internationalised name that can imitate another
 * site, at an unusual port, or carries credentials.
 */
export function urlSuspicion(raw: string): UrlSuspicion | null {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	const host = url.hostname.toLowerCase();
	if (url.username !== "" || url.password !== "") {
		return { code: "credentials", reason: "The link carries a username or password." };
	}
	if (isLocalName(host) || (isIpLiteral(host) && isForbiddenAddress(host))) {
		return { code: "private_target", reason: "The link points into a private or local network." };
	}
	if (isIpLiteral(host)) {
		return {
			code: "ip_literal",
			reason: "The link points at a bare IP address, not a named site.",
		};
	}
	if (host.split(".").some((label) => label.startsWith("xn--"))) {
		return {
			code: "lookalike",
			reason: "The address uses international characters that can imitate another site.",
		};
	}
	if (!isStandardPort(url)) {
		return { code: "port", reason: `The link uses an unusual port (${url.port}).` };
	}
	return null;
}
// #endregion
