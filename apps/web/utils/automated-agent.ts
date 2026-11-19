/**
 * automated-agent — whether a request's `User-Agent` names a crawler, a link unfurler, a headless
 * browser or a scripted HTTP client rather than a person's browser.
 *
 * Telemetry routes (`POST /api/explore/events`) answer such a request as accepted and store nothing,
 * so a crawler that renders the page and runs its scripts never becomes an impression or a listing
 * view. A request with no `User-Agent` at all is treated as automated: every browser sends one, a
 * beacon included. This is a filter for honest automation; it is not abuse protection.
 */

// #region Patterns
/**
 * Substrings that mark automation, matched case-insensitively against the whole header. `bot`,
 * `crawl`, `spider` and `slurp` cover the search engines and most named crawlers; the rest are the
 * unfurlers, auditors, headless browsers and HTTP libraries that do not say so.
 */
const AUTOMATED = new RegExp(
	[
		"bot\\b",
		"bot/",
		"crawl",
		"spider",
		"slurp",
		"headless",
		"lighthouse",
		"pagespeed",
		"gtmetrix",
		"pingdom",
		"facebookexternalhit",
		"embedly",
		"whatsapp",
		"skypeuripreview",
		"bitlybot",
		"vkshare",
		"phantomjs",
		"puppeteer",
		"playwright",
		"selenium",
		"curl/",
		"wget/",
		"python-requests",
		"python-urllib",
		"aiohttp",
		"httpx",
		"go-http-client",
		"okhttp",
		"axios/",
		"node-fetch",
		"undici",
		"java/",
		"libwww",
		"deno/",
	].join("|"),
	"i",
);
// #endregion

/** True when `userAgent` is missing or names automation (see {@link AUTOMATED}). */
export function isAutomatedAgent(userAgent: string | null | undefined): boolean {
	const ua = userAgent?.trim();
	if (!ua) return true;
	return AUTOMATED.test(ua);
}
