import { assert, assertEquals, assertFalse } from "@std/assert";
import { isFetchableUrl, isForbiddenAddress, parseIPv6, urlSuspicion } from "./link-guards.ts";
import {
	decodeChunked,
	finishBody,
	guardedFetch,
	type LinkTransport,
	MAX_REDIRECTS,
	parseResponseHead,
	type RawResponse,
} from "./link-fetch.ts";
import { extractPageFacts } from "./link-html.ts";
import { pngFromIco, sniffFavicon } from "./link-favicon.ts";
import { clearScanCache, scanLink } from "./link-scan.ts";

// #region Address ranges (the brief's list, then the forms that bypass a naive guard)
Deno.test("loopback 127.0.0.0/8 is refused", () => {
	for (const ip of ["127.0.0.1", "127.1.2.3", "127.255.255.254"]) {
		assert(isForbiddenAddress(ip), ip);
	}
});

Deno.test("link-local 169.254.0.0/16 — the cloud metadata endpoint included — is refused", () => {
	for (const ip of ["169.254.169.254", "169.254.0.1", "169.254.255.255"]) {
		assert(isForbiddenAddress(ip), ip);
	}
});

Deno.test("the three RFC 1918 ranges are refused, to their exact edges", () => {
	for (
		const ip of [
			"10.0.0.1",
			"10.255.255.255",
			"172.16.0.1",
			"172.31.255.255",
			"192.168.0.1",
			"192.168.255.255",
		]
	) {
		assert(isForbiddenAddress(ip), ip);
	}
	for (const ip of ["172.15.255.255", "172.32.0.1", "192.169.0.1", "11.0.0.1"]) {
		assertFalse(isForbiddenAddress(ip), ip);
	}
});

Deno.test("multicast, broadcast, CGNAT, unspecified and documentation ranges are refused", () => {
	for (
		const ip of [
			"224.0.0.1",
			"239.255.255.250",
			"255.255.255.255",
			"100.64.0.1",
			"0.0.0.0",
			"192.0.2.10",
			"198.18.0.1",
			"203.0.113.9",
		]
	) {
		assert(isForbiddenAddress(ip), ip);
	}
});

Deno.test("public IPv4 addresses are allowed", () => {
	for (const ip of ["93.184.216.34", "8.8.8.8", "1.1.1.1"]) assertFalse(isForbiddenAddress(ip), ip);
});

Deno.test("IPv6 loopback, unspecified, link-local, unique-local and multicast are refused in every spelling", () => {
	for (
		const ip of [
			"::1",
			"0:0:0:0:0:0:0:1",
			"::",
			"fe80::1",
			"fe80::1%eth0",
			"fc00::1",
			"fd12:3456::1",
			"ff02::1",
			"fec0::1",
		]
	) {
		assert(isForbiddenAddress(ip), ip);
	}
});

Deno.test("IPv4 smuggled inside IPv6 is unwrapped and judged as IPv4", () => {
	for (
		const ip of [
			"::ffff:127.0.0.1",
			"::ffff:7f00:1",
			"::ffff:a9fe:a9fe",
			"::127.0.0.1",
			"64:ff9b::a9fe:a9fe",
			"2002:c0a8:0101::1",
			"2001::1",
			"2001:db8::1",
		]
	) {
		assert(isForbiddenAddress(ip), ip);
	}
	assertFalse(isForbiddenAddress("::ffff:93.184.216.34"));
	assertFalse(isForbiddenAddress("2606:4700:4700::1111"));
});

Deno.test("anything that is not an address is refused, never waved through", () => {
	for (const ip of ["", "not-an-ip", "300.1.1.1", "1.2.3", "1::2::3", "12345::"]) {
		assert(isForbiddenAddress(ip), JSON.stringify(ip));
	}
});

Deno.test("parseIPv6 expands compressed and dotted forms", () => {
	assertEquals(parseIPv6("::ffff:127.0.0.1"), [0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
	assertEquals(parseIPv6("[2001:db8::1]"), [0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
	assertEquals(parseIPv6("1:2:3:4:5:6:7:8"), [1, 2, 3, 4, 5, 6, 7, 8]);
	assertEquals(parseIPv6("127.0.0.1"), null);
});
// #endregion

// #region URL guards
Deno.test("only https on the standard port to a public, non-local name is fetchable", () => {
	assert(isFetchableUrl("https://example.com/a"));
	assert(isFetchableUrl("https://example.com:443/a"));
	assert(isFetchableUrl("https://93.184.216.34/"));
	for (
		const url of [
			"http://example.com/",
			"https://example.com:8443/",
			"https://example.com:22/",
			"https://localhost/",
			"https://printer.local/",
			"https://metadata.internal/",
			"https://user:pw@example.com/",
			"https://127.0.0.1/",
			"https://[::1]/",
			"https://169.254.169.254/latest/meta-data/",
			"not a url",
		]
	) {
		assertFalse(isFetchableUrl(url), url);
	}
});

Deno.test("a link's face can be suspicious before anything is fetched", () => {
	assertEquals(urlSuspicion("http://192.168.1.1/admin")?.code, "private_target");
	assertEquals(urlSuspicion("https://router.lan/")?.code, "private_target");
	assertEquals(urlSuspicion("https://93.184.216.34/login")?.code, "ip_literal");
	assertEquals(urlSuspicion("https://xn--pypal-4ve.com/")?.code, "lookalike");
	assertEquals(urlSuspicion("https://example.com:8080/")?.code, "port");
	assertEquals(urlSuspicion("https://example.com/"), null);
});
// #endregion

// #region The guarded fetch, over a fake network
interface Call {
	url: string;
	address: string;
}

function fakeTransport(
	dns: Record<string, string[]>,
	responses: Record<string, RawResponse | "timeout">,
	calls: Call[] = [],
): LinkTransport {
	return {
		resolve: (host) => Promise.resolve(dns[host] ?? []),
		request: (url, address) => {
			calls.push({ url: url.href, address });
			const response = responses[url.href];
			if (response === "timeout") return Promise.reject(new Error("timed out"));
			if (!response) return Promise.reject(new Error("refused"));
			return Promise.resolve(response);
		},
	};
}

const html = (body: string, status = 200, headers: Record<string, string> = {}): RawResponse => ({
	status,
	headers: new Headers({ "content-type": "text/html; charset=utf-8", ...headers }),
	body: new TextEncoder().encode(body),
	truncated: false,
});

const redirect = (to: string): RawResponse => ({
	status: 302,
	headers: new Headers({ location: to }),
	body: new Uint8Array(),
	truncated: false,
});

Deno.test("DNS rebinding: one private answer among public ones refuses the hop", async () => {
	const calls: Call[] = [];
	const outcome = await guardedFetch("https://rebind.example/", {
		transport: fakeTransport({ "rebind.example": ["93.184.216.34", "10.0.0.7"] }, {}, calls),
	});
	assertEquals(outcome.ok, false);
	if (!outcome.ok) assertEquals(outcome.failure.kind, "refused");
	assertEquals(calls.length, 0, "no connection was opened");
});

Deno.test("the connection goes to the address that was checked", async () => {
	const calls: Call[] = [];
	const outcome = await guardedFetch("https://site.example/page", {
		transport: fakeTransport(
			{ "site.example": ["93.184.216.34"] },
			{ "https://site.example/page": html("<title>Hi</title>") },
			calls,
		),
	});
	assert(outcome.ok);
	assertEquals(calls, [{ url: "https://site.example/page", address: "93.184.216.34" }]);
});

Deno.test("a redirect into the metadata endpoint is refused on the hop that names it", async () => {
	const calls: Call[] = [];
	const outcome = await guardedFetch("https://public.example/", {
		transport: fakeTransport(
			{ "public.example": ["93.184.216.34"] },
			{ "https://public.example/": redirect("http://169.254.169.254/latest/meta-data/") },
			calls,
		),
	});
	assertEquals(outcome.ok, false);
	if (!outcome.ok) assertEquals(outcome.failure.kind, "refused");
	assertEquals(calls.length, 1);
});

Deno.test("a redirect to a name that resolves privately is refused", async () => {
	const outcome = await guardedFetch("https://public.example/", {
		transport: fakeTransport(
			{ "public.example": ["93.184.216.34"], "inner.example": ["192.168.0.5"] },
			{ "https://public.example/": redirect("https://inner.example/secret") },
		),
	});
	assertEquals(outcome.ok, false);
	if (!outcome.ok) assertEquals(outcome.failure.kind, "refused");
});

Deno.test(`more than ${MAX_REDIRECTS} redirects is refused`, async () => {
	const outcome = await guardedFetch("https://a.example/", {
		transport: fakeTransport(
			{ "a.example": ["93.184.216.34"] },
			{
				"https://a.example/": redirect("/1"),
				"https://a.example/1": redirect("/2"),
				"https://a.example/2": redirect("/3"),
				"https://a.example/3": html("never read"),
			},
		),
	});
	assertEquals(outcome.ok, false);
	if (!outcome.ok) assertEquals(outcome.failure.reason, "The link redirects too many times.");
});

Deno.test("a timeout and an unresolvable name are unreachable, not refused", async () => {
	const slow = await guardedFetch("https://slow.example/", {
		transport: fakeTransport({ "slow.example": ["93.184.216.34"] }, {
			"https://slow.example/": "timeout",
		}),
	});
	assertEquals(slow.ok ? null : slow.failure, {
		kind: "unreachable",
		reason: "The site took too long to answer.",
	});
	const gone = await guardedFetch("https://gone.example/", { transport: fakeTransport({}, {}) });
	assertEquals(gone.ok ? null : gone.failure.kind, "unreachable");
});
// #endregion

// #region Verdicts
const PAGE = `<!doctype html><html><head>
<title>Fallback</title>
<meta property="og:title" content="Brand Identity &amp; Strategy">
<meta name="description" content="A six-week sprint.">
<link rel="apple-touch-icon" href="/apple.png">
<link rel="icon" href="/static/icon.png">
</head><body>body text</body></html>`;

Deno.test("a reachable page is safe, with its facts and a re-hosted icon", async () => {
	clearScanCache();
	const scan = await scanLink("https://studio.example/work", {
		live: true,
		transport: fakeTransport({ "studio.example": ["93.184.216.34"] }, {
			"https://studio.example/work": html(PAGE),
		}),
		reputation: () => Promise.resolve({ status: "clean" }),
		rehost: (icon) =>
			Promise.resolve(
				icon === "https://studio.example/static/icon.png" ? "https://cdn/x.png" : null,
			),
	});
	assertEquals(scan.verdict, "safe");
	assertEquals(scan.title, "Brand Identity & Strategy");
	assertEquals(scan.description, "A six-week sprint.");
	assertEquals(scan.faviconUrl, "https://cdn/x.png");
});

Deno.test("a listed site is blocked, whatever the page says", async () => {
	clearScanCache();
	const scan = await scanLink("https://bad.example/", {
		live: true,
		transport: fakeTransport({ "bad.example": ["93.184.216.34"] }, {
			"https://bad.example/": html(PAGE),
		}),
		reputation: () => Promise.resolve({ status: "listed", threat: "phishing" }),
	});
	assertEquals(scan.verdict, "blocked");
	assertEquals(scan.reason, "Google Safe Browsing lists this site for phishing.");
	assertEquals(scan.faviconUrl, null);
});

Deno.test("a link into a private network is suspicious and is never sent to the reputation feed", async () => {
	clearScanCache();
	let asked = false;
	const scan = await scanLink("http://192.168.1.1/admin", {
		live: true,
		reputation: () => {
			asked = true;
			return Promise.resolve({ status: "clean" });
		},
	});
	assertEquals(scan.verdict, "suspicious");
	assertFalse(asked);
});

Deno.test("a page that cannot be reached is unscannable — not suspicious", async () => {
	clearScanCache();
	const scan = await scanLink("https://down.example/", {
		live: true,
		transport: fakeTransport({ "down.example": ["93.184.216.34"] }, {
			"https://down.example/": "timeout",
		}),
		reputation: () => Promise.resolve({ status: "clean" }),
	});
	assertEquals(scan.verdict, "unscannable");
});

Deno.test("plain http is not opened", async () => {
	clearScanCache();
	const scan = await scanLink("http://example.com/", {
		live: true,
		reputation: () => Promise.resolve({ status: "unavailable" }),
	});
	assertEquals(scan.verdict, "unscannable");
});

Deno.test("with the gate down nothing touches the network, and the test threat host still flags", async () => {
	clearScanCache();
	const offline = { live: false, reputation: () => Promise.reject(new Error("network")) };
	assertEquals(
		(await scanLink("https://testsafebrowsing.appspot.com/s/phishing.html", offline)).verdict,
		"blocked",
	);
	const plain = await scanLink("https://example.com/pricing-plans", offline);
	assertEquals([plain.verdict, plain.title], ["safe", "Pricing plans"]);
});

Deno.test("a verdict is remembered; one link is scanned once", async () => {
	clearScanCache();
	let scans = 0;
	const deps = {
		live: true,
		transport: fakeTransport({ "once.example": ["93.184.216.34"] }, {
			"https://once.example/": html(PAGE),
		}),
		reputation: () => {
			scans += 1;
			return Promise.resolve({ status: "clean" as const });
		},
		rehost: () => Promise.resolve(null),
	};
	await Promise.all([
		scanLink("https://once.example/", deps),
		scanLink("https://once.example/", deps),
	]);
	await scanLink("https://once.example/", deps);
	assertEquals(scans, 1);
});
// #endregion

// #region Wire parsing
const bytes = (s: string) => new TextEncoder().encode(s);

Deno.test("a response head parses only once it is complete", () => {
	assertEquals(parseResponseHead(bytes("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n")), null);
	const head = parseResponseHead(bytes("HTTP/1.1 302 Found\r\nLocation: /next\r\n\r\nbody"));
	assertEquals(head?.status, 302);
	assertEquals(head?.headers.get("location"), "/next");
	assertEquals(head?.bodyStart, 39);
});

Deno.test("a chunked body decodes, capped, and knows when it is complete", () => {
	const raw = bytes("5\r\nhello\r\n7;ext=1\r\n, world\r\n0\r\n\r\n");
	const full = decodeChunked(raw, 100);
	assertEquals([new TextDecoder().decode(full.body), full.complete], ["hello, world", true]);
	const capped = decodeChunked(raw, 7);
	assertEquals([new TextDecoder().decode(capped.body), capped.complete], ["hello, ", false]);
});

Deno.test("Content-Length is the origin's claim; the cap is the platform's", () => {
	const headers = new Headers({ "content-length": "999999" });
	const { body, truncated } = finishBody(headers, new Uint8Array(20), 10);
	assertEquals([body.length, truncated], [10, true]);
});
// #endregion

// #region Page facts + icons
Deno.test("OpenGraph wins, entities decode, the real icon beats the touch icon", () => {
	const facts = extractPageFacts(PAGE, "https://studio.example/work");
	assertEquals(facts, {
		title: "Brand Identity & Strategy",
		description: "A six-week sprint.",
		iconUrl: "https://studio.example/static/icon.png",
	});
});

Deno.test("a page with no icon falls back to the origin's /favicon.ico; the body is not the summary", () => {
	const facts = extractPageFacts(
		"<html><head><title> A  &#8212; B </title></head><body><title>x</title>",
		"https://a.example/p/q",
	);
	assertEquals(facts, {
		title: "A — B",
		description: null,
		iconUrl: "https://a.example/favicon.ico",
	});
});

Deno.test("favicons are identified by their bytes; SVG is refused; an ICO gives up its PNG", () => {
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
	assertEquals(sniffFavicon(png)?.mime, "image/png");
	assertEquals(sniffFavicon(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))?.ext, "jpg");
	assertEquals(
		sniffFavicon(bytes("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>")),
		null,
	);

	const ico = new Uint8Array(6 + 16 + png.length);
	const view = new DataView(ico.buffer);
	view.setUint16(2, 1, true);
	view.setUint16(4, 1, true);
	view.setUint32(6 + 8, png.length, true);
	view.setUint32(6 + 12, 22, true);
	ico.set(png, 22);
	assertEquals(pngFromIco(ico), png);
	assertEquals(sniffFavicon(ico)?.mime, "image/png");
});
// #endregion
