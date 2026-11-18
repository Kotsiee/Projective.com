/**
 * turnstile-js — the one loader for Cloudflare Turnstile in the browser (Decision #447).
 *
 * Loaded on demand by an auth form about to need a token, never in every page's `<head>`, and always
 * from challenges.cloudflare.com (Cloudflare forbids self-hosting `api.js`). Explicit rendering, so the
 * form decides where and when the widget mounts. The CSP (`utils/csp.ts`) allows exactly this origin
 * for script and frame. Only the calls Projective makes are typed here.
 */

// #region Types
/** `turnstile.render` options, by Cloudflare's own (kebab-case) names. */
export interface TurnstileRenderOptions {
	sitekey: string;
	action?: string;
	theme?: "auto" | "light" | "dark";
	size?: "normal" | "flexible" | "compact";
	appearance?: "always" | "execute" | "interaction-only";
	language?: string;
	"response-field"?: boolean;
	"refresh-expired"?: "auto" | "manual" | "never";
	callback?: (token: string) => void;
	/** Returning `true` tells Turnstile the error was handled. */
	"error-callback"?: (code: string) => boolean;
	"expired-callback"?: () => void;
	"timeout-callback"?: () => void;
	"before-interactive-callback"?: () => void;
	"after-interactive-callback"?: () => void;
}

/** The subset of `window.turnstile` Projective uses. */
export interface TurnstileApi {
	render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined;
	reset(widgetId: string): void;
	remove(widgetId: string): void;
}

declare global {
	var turnstile: TurnstileApi | undefined;
}
// #endregion

// #region Loader
const TURNSTILE_JS_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;

/** Inject `api.js` once; resolve with `window.turnstile`. Rejects offline or when blocked. */
export function loadTurnstile(): Promise<TurnstileApi> {
	if (globalThis.turnstile) return Promise.resolve(globalThis.turnstile);
	if (loading) return loading;
	loading = new Promise<TurnstileApi>((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_JS_URL}"]`);
		const script = existing ?? document.createElement("script");
		const done = () =>
			globalThis.turnstile
				? resolve(globalThis.turnstile)
				: reject(new Error("Turnstile did not load"));
		script.addEventListener("load", done, { once: true });
		script.addEventListener("error", () => reject(new Error("Turnstile could not be loaded")), {
			once: true,
		});
		if (!existing) {
			script.src = TURNSTILE_JS_URL;
			script.async = true;
			document.head.appendChild(script);
		}
	}).catch((error) => {
		loading = null;
		throw error;
	});
	return loading;
}

let siteKeyRequest: Promise<string | null> | null = null;

/**
 * The site key for a form whose page handed it none (the in-page sign-in dialog), from
 * `GET /api/auth/captcha`, asked once per page. `null` when the server has none or cannot answer.
 */
export function fetchCaptchaSiteKey(): Promise<string | null> {
	siteKeyRequest ??= fetch("/api/auth/captcha", { headers: { accept: "application/json" } })
		.then((res) => (res.ok ? res.json() : null))
		.then((body: { siteKey?: unknown } | null) =>
			typeof body?.siteKey === "string" && body.siteKey ? body.siteKey : null
		)
		.catch(() => {
			siteKeyRequest = null;
			return null;
		});
	return siteKeyRequest;
}

/** The widget theme matching the app's current mode (Turnstile has no high-contrast theme). */
export function turnstileTheme(): "light" | "dark" {
	return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
// #endregion
