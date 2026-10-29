/**
 * app-env — the web layer's reading of `DENO_ENV`, matching `serverEnv().appEnv` in the backend.
 *
 * **Unset means production** (IW-M1 / K10). A development-only switch — the Dev Context Switcher's
 * server-side cookies (`pj.dev.age`, `pj.dev.operator-mode`, `pj.dev.operator`, `pj.dev.payout`,
 * `pj.dev.plan-gates`) — is honoured only when `DENO_ENV` says `development` by name, so a deploy
 * that forgets the variable fails closed. The dev tasks (`deno task dev`, `dev:mock`) set it.
 */

/** The environment name: `DENO_ENV` lowercased, `production` when unset or unreadable. */
export function appEnv(): string {
	try {
		return (Deno.env.get("DENO_ENV") || "production").trim().toLowerCase();
	} catch {
		return "production";
	}
}

/** Whether `DENO_ENV` is explicitly `development` — the only environment a dev override counts in. */
export function isDevelopmentEnv(): boolean {
	return appEnv() === "development";
}

/** Whether this server runs as production (`DENO_ENV=production`, or unset). */
export function isProductionEnv(): boolean {
	return appEnv() === "production";
}
