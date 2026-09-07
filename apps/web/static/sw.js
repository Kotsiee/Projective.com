/// <reference lib="webworker" />

/*
 * Projective service worker — the shell cache that makes an authored page survive a dropped
 * connection.
 *
 * It exists for ONE user-visible promise: an owner editing a project keeps their editor when the
 * network goes away, and the edits they make in that window are queued by
 * `features/projects/core/offline-queue.ts` and flushed on reconnect. Everything here is in service
 * of that, and nothing here is in service of making the site faster — a cache that also tries to be
 * a performance layer is a cache whose staleness bugs are indistinguishable from its offline ones.
 *
 * ## There is no precache manifest, deliberately
 *
 * The obvious design is a build-time list of shell assets installed up front. It is rejected here
 * because the list would live in a file the build does not generate: every bundle name is content
 * hashed, so a hand-written manifest is wrong the moment anything is edited, and a wrong manifest
 * fails CLOSED — `install` rejects, the worker never activates, and the offline promise silently
 * stops being kept with nothing anywhere reporting it. Runtime caching has no such failure mode: the
 * shell is cached as it is genuinely used, so what is stored is by construction what this deployment
 * actually serves.
 *
 * ## What is never touched
 *
 * - Anything that is not a `GET`. A queued mutation is the offline queue's job; a service worker
 *   replaying a POST it did not understand is how a payment happens twice.
 * - Anything under `/api/`. These responses are per-viewer and RLS-scoped, and a shared
 *   `CacheStorage` bucket is not — serving one account's cached read to the next person to sign in
 *   on this device would be a cross-tenant disclosure the server could not detect, because the
 *   request never reaches it. This is the single most important rule in the file.
 * - Any cross-origin request. Opaque responses cannot be inspected, cost the full body in storage,
 *   and cannot be revalidated.
 * - Any request carrying a `Range` header. A partial response cached whole and replayed as a 200
 *   breaks media seeking.
 */

/// <reference no-default-lib="true"/>

const CACHE = "pj-shell-v1";

/**
 * The offline fallback for a navigation with nothing cached.
 *
 * Inline rather than a cached URL: a fallback that has to be FETCHED to be shown is a fallback that
 * is missing exactly when it is needed. It is deliberately plain — no token stylesheet, because the
 * design system's colours arrive in a bundle this response cannot depend on, and a half-themed page
 * reads as broken where an unstyled one reads as a message.
 */
const OFFLINE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title>
<style>
 body{margin:0;min-height:100vh;display:grid;place-items:center;
  font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;
  background:#fafafa;color:#1a1a1a}
 @media (prefers-color-scheme:dark){body{background:#0b0f0f;color:#e0e3e3}}
 main{max-width:32rem;padding:2rem;text-align:center}
 h1{font-size:1.25rem;font-weight:500;margin:0 0 .5rem}
 p{margin:0 0 1.5rem;opacity:.75}
 button{font:inherit;padding:.5rem 1.25rem;border-radius:999px;
  border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer}
</style></head>
<body><main>
 <h1>You are offline</h1>
 <p>This page has not been opened on this device yet, so there is nothing stored to show you.
    Anything you have already edited is saved here and will sync when you reconnect.</p>
 <button onclick="location.reload()">Try again</button>
</main></body></html>`;

/** Extensions whose responses are safe to serve from cache while a fresh copy is fetched. */
const STATIC_EXTENSIONS = [
	".js",
	".mjs",
	".css",
	".woff",
	".woff2",
	".ttf",
	".otf",
	".svg",
	".png",
	".jpg",
	".jpeg",
	".webp",
	".avif",
	".gif",
	".ico",
];

/** Whether this URL names a static build asset rather than a document or an API read. */
function isStaticAsset(url) {
	if (url.pathname.startsWith("/assets/")) return true;
	return STATIC_EXTENSIONS.some((ext) => url.pathname.endsWith(ext));
}

/**
 * Whether this request may be cached at all.
 *
 * An allow-list on method and origin, and a deny-list on `/api/` — the asymmetry is intentional. An
 * unknown METHOD is something nobody here has reasoned about, so the safe answer is to leave it
 * alone; an unknown PATH under this origin is a document or an asset, which are the two things this
 * worker exists to hold.
 */
function isCacheable(request, url) {
	if (request.method !== "GET") return false;
	if (url.origin !== self.location.origin) return false;
	if (url.pathname.startsWith("/api/")) return false;
	if (request.headers.has("range")) return false;
	return true;
}

self.addEventListener("install", (event) => {
	// Nothing to precache (see the header). Activate immediately rather than waiting for every tab to
	// close: this worker's rules never depend on a stored manifest, so a page loaded under the old
	// worker cannot be served an asset the new one does not understand.
	event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
	event.waitUntil((async () => {
		// Discard every bucket but this version's. The version is in the NAME, so a deploy that changes
		// the caching rules starts from empty rather than inheriting entries written under rules it no
		// longer applies.
		const names = await caches.keys();
		await Promise.all(
			names.filter((name) => name.startsWith("pj-shell-") && name !== CACHE)
				.map((name) => caches.delete(name)),
		);
		await self.clients.claim();
	})());
});

/**
 * Network-first, then cache, then the inline fallback — for documents.
 *
 * Network FIRST because a document is the one response that is never content-addressed: serving a
 * cached one first would show yesterday's page to somebody who is perfectly online, which is the
 * staleness bug that makes people distrust an offline mode entirely. The cache is the fallback, not
 * the default.
 */
async function handleNavigation(request) {
	const cache = await caches.open(CACHE);
	try {
		const fresh = await fetch(request);
		// Only a real, complete 200 is worth storing. A redirect cached as a document replays as a
		// response the browser refuses to use for a navigation.
		if (fresh.ok && fresh.type === "basic" && !fresh.redirected) {
			cache.put(request, fresh.clone());
		}
		return fresh;
	} catch {
		const stored = await cache.match(request) ?? await cache.match(new URL(request.url).pathname);
		if (stored) return stored;
		return new Response(OFFLINE_HTML, {
			status: 503,
			headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
		});
	}
}

/**
 * Cache-first with a background refresh — for build assets.
 *
 * Safe because every bundle name is content hashed: a hit is by definition the right bytes for that
 * name, so there is no staleness to trade against. The revalidation exists for the handful of
 * unhashed static files (`/logo.svg`) where the name can outlive its contents.
 */
async function handleAsset(request) {
	const cache = await caches.open(CACHE);
	const stored = await cache.match(request);

	const refresh = fetch(request)
		.then((fresh) => {
			if (fresh.ok && fresh.type === "basic") cache.put(request, fresh.clone());
			return fresh;
		})
		// A failed background refresh is not an error: the stored copy is being served, and there is
		// nobody to report to. Rethrowing would produce an unhandled rejection per asset per offline
		// load.
		.catch(() => null);

	if (stored) return stored;

	const fresh = await refresh;
	if (fresh) return fresh;
	return new Response("", { status: 504, statusText: "Offline" });
}

self.addEventListener("fetch", (event) => {
	const request = event.request;
	const url = new URL(request.url);

	if (!isCacheable(request, url)) return;

	if (request.mode === "navigate") {
		event.respondWith(handleNavigation(request));
		return;
	}

	if (isStaticAsset(url)) {
		event.respondWith(handleAsset(request));
	}
	// Everything else falls through to the network untouched — no `respondWith`, so the browser's own
	// handling applies exactly as if this worker were not installed.
});
