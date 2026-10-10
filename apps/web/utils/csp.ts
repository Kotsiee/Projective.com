/**
 * csp — the platform's Content-Security-Policy, as a pure builder (root CLAUDE.md §6;
 * SYSTEM_ARCHITECTURE §Runtime & API Security).
 *
 * The third-party origins are exactly the ones a page genuinely talks to:
 *
 * - **Stripe** (Decision #125/#126): Stripe.js is loaded from `js.stripe.com` (versioned `dahlia`
 *   build, `features/payments/core/stripe-js.ts`), talks to `api.stripe.com`, and renders the Payment
 *   Element and 3-D Secure challenges in frames from `js.stripe.com` / `*.js.stripe.com` /
 *   `hooks.stripe.com` — the directives Stripe's integration security guide lists for Stripe.js.
 * - **Supabase** (the storage bucket a signed upload PUTs to, and the origin stored images and media
 *   are served from) — whatever `SUPABASE_PUBLIC_URL` points at, which is `http://127.0.0.1` locally.
 * - **YouTube (no-cookie)** for an article's video embed, loaded only after the reader presses play.
 *
 * `'unsafe-inline'` stays on `script-src` and `style-src`: Fresh 2 renders inline bootstrap scripts
 * and the theme's pre-paint script without nonces, and the design system sets custom properties through
 * `style` attributes. Moving to a nonce-based policy is a separate change (flagged in Decision #126).
 * Images accept any `https:` origin because profile photos and listing covers come from arbitrary hosts.
 *
 * Two profiles exist (Decision #161(D)): `app`, the platform policy every response gets by default,
 * and `inspector`, the same policy plus `'wasm-unsafe-eval'` (pdf.js decoders, Draco/Basis/meshopt)
 * and `blob:` in `connect-src` (GLB embedded textures) — sent only by the `/inspect/*` page.
 */

/** Page-scoped loosenings of the platform policy; each is off unless a profile asks for it. */
export interface CspRelaxations {
	/** Adds `'wasm-unsafe-eval'` to `script-src`: WebAssembly compilation only, never JS `eval`. */
	wasm?: boolean;
	/** Adds `blob:` to `connect-src`, so a page may `fetch` the blob URLs it minted itself. */
	blobConnect?: boolean;
}

/** What the policy depends on. */
export interface CspOptions {
	/** Development relaxes nothing that matters, but lets Vite's HMR socket connect and skips the upgrade. */
	dev: boolean;
	/** The public Supabase origin (`https://xyz.supabase.co`, or `http://127.0.0.1:54321` locally). */
	supabaseOrigin: string | null;
	/** Page-scoped loosenings; omitted for the platform policy. */
	relax?: CspRelaxations;
}

/** A named policy: `app` for every page, `inspector` for the shell-free file inspector. */
export type CspProfile = "app" | "inspector";

/** The origin of a URL, or `null` when it is not an http(s) URL. */
export function originOf(url: string | null | undefined): string | null {
	if (!url) return null;
	try {
		const u = new URL(url);
		return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
	} catch {
		return null;
	}
}

const STRIPE_SCRIPT = ["https://js.stripe.com", "https://*.js.stripe.com"];
const STRIPE_FRAME = ["https://js.stripe.com", "https://*.js.stripe.com", "https://hooks.stripe.com"];
const STRIPE_CONNECT = ["https://api.stripe.com"];

/** Build the `Content-Security-Policy` header value. */
export function contentSecurityPolicy(options: CspOptions): string {
	const supabase = options.supabaseOrigin ? [options.supabaseOrigin] : [];
	const wasm = options.relax?.wasm === true ? ["'wasm-unsafe-eval'"] : [];
	const blobConnect = options.relax?.blobConnect === true ? ["blob:"] : [];
	const directives: [string, string[]][] = [
		["default-src", ["'self'"]],
		["script-src", ["'self'", "'unsafe-inline'", ...wasm, ...STRIPE_SCRIPT]],
		["style-src", ["'self'", "'unsafe-inline'"]],
		["img-src", ["'self'", "data:", "blob:", "https:", ...supabase]],
		["font-src", ["'self'", "data:"]],
		["media-src", ["'self'", "data:", "blob:", "https:", ...supabase]],
		[
			"connect-src",
			[
				"'self'",
				...blobConnect,
				...STRIPE_CONNECT,
				...supabase,
				...(options.dev ? ["ws:", "wss:"] : []),
			],
		],
		["frame-src", ["'self'", ...STRIPE_FRAME, "https://www.youtube-nocookie.com"]],
		["worker-src", ["'self'", "blob:"]],
		["object-src", ["'none'"]],
		["base-uri", ["'self'"]],
		["form-action", ["'self'"]],
		["frame-ancestors", ["'none'"]],
	];
	const policy = directives.map(([name, values]) => `${name} ${[...new Set(values)].join(" ")}`);
	if (!options.dev) policy.push("upgrade-insecure-requests");
	return policy.join("; ");
}

const PROFILE_RELAXATIONS: Readonly<Record<CspProfile, CspRelaxations>> = {
	app: {},
	inspector: { wasm: true, blobConnect: true },
};

const cachedHeaders = new Map<CspProfile, string>();

/**
 * The `Content-Security-Policy` header for a profile, built once per process on first use (it
 * depends only on the environment). Lazily, not at module load: under the dev server this module
 * can be imported before `main.ts` has loaded `.env`, and a policy built then silently omitted the
 * Supabase origin.
 */
export function cspHeaderFor(profile: CspProfile): string {
	const cached = cachedHeaders.get(profile);
	if (cached !== undefined) return cached;
	const header = contentSecurityPolicy({
		dev: (Deno.env.get("DENO_ENV") ?? "development").toLowerCase() !== "production",
		supabaseOrigin: originOf(Deno.env.get("SUPABASE_PUBLIC_URL") ?? Deno.env.get("SUPABASE_URL")),
		relax: PROFILE_RELAXATIONS[profile],
	});
	cachedHeaders.set(profile, header);
	return header;
}
