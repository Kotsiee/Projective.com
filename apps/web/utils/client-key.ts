/**
 * client-key — the caller's transport address, the one per-IP rate-limit key every guest-facing
 * route uses (`/api/contact`, `/api/help/feedback`, `/api/auth/verification-status`).
 *
 * **The dev server.** Fresh's Vite dev middleware calls the app's `fetch(req)` without connection
 * info, so `ctx.info.remoteAddr` is Fresh's placeholder (`{ hostname: "localhost", port: 1234 }`) for
 * EVERY caller and every per-IP limiter shared one bucket: ten guest submissions closed `/contact`
 * for everyone on that server. The `projective:dev-client-address` plugin (`vite.config.ts`, serve
 * only) therefore overwrites {@link DEV_REMOTE_HEADER} with the TCP peer address on every dev request
 * — a client's own copy never survives it — and this helper reads that header ONLY while the
 * address is the placeholder. `deno serve` passes real connection info, which is never the
 * placeholder, so in production the header is ignored and cannot be forged into a key.
 *
 * **Proxies.** The key is the socket's peer. Behind a reverse proxy every caller is the proxy, and a
 * per-IP limit becomes one bucket per proxy. No forwarded header is trusted here — `X-Forwarded-For`
 * is client-writable — so a deployment behind a proxy must wire that proxy's own client-address
 * header into this one function (SYSTEM_ARCHITECTURE.md, Decision #296 (F)).
 */

/** The header the dev-server plugin writes the peer address into. */
export const DEV_REMOTE_HEADER = "x-projective-dev-remote";

/** Fresh's stand-in `remoteAddr` when a handler is called without connection info. */
const FRESH_PLACEHOLDER = { hostname: "localhost", port: 1234 } as const;

/** Whether `remote` is Fresh's placeholder rather than a real peer. */
export function isPlaceholderAddr(remote: Deno.Addr): boolean {
	return "hostname" in remote && remote.hostname === FRESH_PLACEHOLDER.hostname &&
		remote.port === FRESH_PLACEHOLDER.port;
}

/**
 * The per-IP key for a request: the peer's hostname (a unix socket's transport), or — only for
 * Fresh's placeholder address — the dev-server plugin's peer header when present.
 */
export function clientKey(remote: Deno.Addr, headers?: Headers): string {
	if (!("hostname" in remote)) return remote.transport;
	if (isPlaceholderAddr(remote)) {
		const peer = headers?.get(DEV_REMOTE_HEADER)?.trim();
		if (peer) return peer;
	}
	return remote.hostname;
}
