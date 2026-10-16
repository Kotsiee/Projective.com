/**
 * redact.ts — strip secrets from values before the dev logger records them.
 *
 * The dev `fetch` interceptor (`Logger.installNetworkCapture`) JSON-parses every request and response
 * body into a console line and a Dev Tools Log & API Inspector entry. Unredacted, `POST
 * /api/auth/login` put the password in plaintext in the console — and from there into screen-shares,
 * console exports and Playwright logs. Every network entry passes through these helpers first.
 *
 * Dependency-free on purpose so it unit-tests without the `import.meta.env` that `dev.ts` reads.
 */

// #region Constants
/** The value that replaces a redacted secret. */
export const REDACTED = "[redacted]";

/**
 * Keys whose values are secrets: anything containing `pass` (password, passcode, passphrase),
 * `secret` (incl. `client_secret`), `token` (access/refresh/id tokens) or `otp`, plus `code` when it
 * IS the key or carries a secret qualifier (`code`, `otpCode`, `verification_code`, `authCode`).
 * A bare trailing `code` is NOT enough — `currencyCode`, `postcode`, `planCode`, `promoCode` and
 * `statusCode` are ordinary data the inspector exists to show.
 */
const SECRET_KEY =
	/pass|secret|token|otp|^(?:auth|access|verification|verify|confirm(?:ation)?|reset|recovery|mfa|totp|security|sms|email|one[_-]?time)?[_-]?code$/i;

/** Nesting beyond this is replaced wholesale — a log line never needs it, and it bounds the walk. */
const MAX_DEPTH = 12;

/** A `key=value(&key=value)*` body with no whitespace — the shape of `application/x-www-form-urlencoded`. */
const FORM_ENCODED = /^[^=&\s]+=[^&\s]*(?:&[^=&\s]+=[^&\s]*)*$/;
// #endregion

// #region Helpers
/** True when `key` names a secret per {@link SECRET_KEY}. */
export function isSecretKey(key: string): boolean {
	return SECRET_KEY.test(key);
}

/** Redact secret-named params of a `URLSearchParams`, in place. Returns whether anything changed. */
function redactParams(params: URLSearchParams): boolean {
	let changed = false;
	for (const key of new Set(params.keys())) {
		if (isSecretKey(key)) {
			params.set(key, REDACTED);
			changed = true;
		}
	}
	return changed;
}
// #endregion

// #region Public API
/**
 * Deep-copy `value`, replacing the value of every secret-named key (at any depth, inside arrays too)
 * with {@link REDACTED}. A form-encoded string body has its secret params redacted the same way.
 * Never mutates the input; cycles and over-deep branches are replaced with a marker string.
 */
export function redactSecrets(value: unknown): unknown {
	const seen = new WeakSet<object>();

	const walk = (v: unknown, depth: number): unknown => {
		if (typeof v === "string") return redactFormString(v);
		if (typeof v !== "object" || v === null) return v;
		if (seen.has(v)) return "[circular]";
		if (depth >= MAX_DEPTH) return "[depth limit]";
		seen.add(v);
		try {
			if (Array.isArray(v)) return v.map((item) => walk(item, depth + 1));
			const out: Record<string, unknown> = {};
			for (const [key, child] of Object.entries(v)) {
				out[key] = isSecretKey(key) ? REDACTED : walk(child, depth + 1);
			}
			return out;
		} finally {
			// Shared (non-cyclic) references are legal JSON-shaped data — only an ancestor is a cycle.
			seen.delete(v);
		}
	};

	return walk(value, 0);
}

/**
 * Redact secret params of a form-encoded string (`email=a%40b.c&password=hunter2`). Any other string
 * is returned untouched.
 */
export function redactFormString(text: string): string {
	if (!FORM_ENCODED.test(text)) return text;
	const params = new URLSearchParams(text);
	return redactParams(params) ? params.toString() : text;
}

/**
 * Redact secret query params of a URL (`/auth/confirm?token=…` → `?token=%5Bredacted%5D`). Relative
 * URLs stay relative; anything unparseable is returned untouched.
 */
export function redactUrl(url: string): string {
	const q = url.indexOf("?");
	if (q === -1) return url;
	const hash = url.indexOf("#", q);
	const end = hash === -1 ? url.length : hash;
	const params = new URLSearchParams(url.slice(q + 1, end));
	if (!redactParams(params)) return url;
	return `${url.slice(0, q)}?${params.toString()}${url.slice(end)}`;
}
// #endregion
