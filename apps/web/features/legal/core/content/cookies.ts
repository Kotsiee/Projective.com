/**
 * Cookie Policy — every version, newest first (Decision #270).
 *
 * DRAFT TEXT pending legal review (owner ruling (e)). Every cookie listed is one the app really sets,
 * traced to the line that sets it:
 *
 * | Cookie                              | Set by                                                              |
 * | :---------------------------------- | :------------------------------------------------------------------ |
 * | `sb-access-token`, `sb-refresh-token` | `apps/web/utils/auth-cookies.ts` `sessionSetCookies` (HttpOnly, Lax) |
 * | `pj_session_transient`              | same — a session started without "Keep me signed in"                |
 * | `pj_pending_verification`           | `auth-cookies.ts` `pendingVerificationSetCookie` (Path=/api/auth, Strict, Decision #185) |
 * | the sign-in code verifier           | `auth-cookies.ts` `oauthStoreCookies` from `CookieStore` (`packages/backend/core/supabase.ts`), 600 s |
 * | `pj_join_age_lock`                  | `routes/api/auth/join.ts` (`JOIN_AGE_LOCK_COOKIE`, Decision #208)    |
 * | `pj.a11y`                           | `utils/a11y-context.ts` `a11ySetCookie` + `features/settings/core/appearance-state.ts` (1 year) |
 * | `pj.currency`                       | `features/shell/core/currency-state.ts` (1 year)                     |
 * | `pj.dev.*`                          | the Dev Context Switcher (`features/devtools/`), development only    |
 *
 * Declared but never set, so not listed: `pj_auth_refresh`, `pj_csrf`, `pj_active_context`
 * (`utils/storage-keys.ts` `CookieKeys`) and `pj.locale` (read by `utils/currency-context.ts`, written
 * nowhere). Stripe's own cookies appear only where Stripe.js loads (the payment steps).
 *
 * @module
 */
import { defineLegalVersions, type LegalClause } from "./define.ts";

// #region Clauses
/** The ePrivacy definition of cookies and similar technologies — scope of the policy. */
const WHAT_COOKIES_ARE: LegalClause = {
	id: "what-cookies-are",
	heading: "What cookies are",
	tldr:
		"Cookies are small files a website keeps in your browser. Projective uses a few to sign you in and remember your choices — none to advertise to you.",
	body: [
		{
			type: "p",
			content:
				"A cookie is a small piece of text a website asks your browser to keep and send back on later visits. Browsers also offer local storage, which works in a similar way but is never sent to the server. This policy lists every cookie Projective sets, and explains what it keeps in local storage.",
		},
	],
};

/** `apps/web/utils/auth-cookies.ts` · `routes/api/auth/join.ts` · Decisions #185, #205, #208. */
const ESSENTIAL: LegalClause = {
	id: "essential",
	heading: "Cookies that keep you signed in",
	tldr:
		"These are strictly necessary. Without them you cannot sign in. Page scripts cannot read any of them.",
	body: [
		{
			type: "table",
			caption: "Strictly necessary cookies",
			head: ["Cookie", "What it does", "How long it lasts"],
			rowHeaders: true,
			rows: [
				[
					[{ type: "code", text: "sb-access-token" }],
					"Proves you are signed in on each request",
					"About an hour, then renewed",
				],
				[
					[{ type: "code", text: "sb-refresh-token" }],
					"Renews your session when the access token expires",
					"30 days with “Keep me signed in”; otherwise until you close the browser",
				],
				[
					[{ type: "code", text: "pj_session_transient" }],
					"Remembers that you chose not to stay signed in",
					"Until you close the browser",
				],
				[
					[{ type: "code", text: "pj_pending_verification" }],
					"Lets the email-confirmation screen check your confirmation from the browser you signed up in; sent only to the sign-in service",
					"Until the confirmation window ends",
				],
				[
					[{ type: "code", text: "sb-…-code-verifier" }],
					"Completes a sign-in or account link through Google or single sign-on securely",
					"10 minutes",
				],
				[
					[{ type: "code", text: "pj_join_age_lock" }],
					"After an under-13 date of birth, stops that browser from trying to sign up again; it holds no personal data",
					"Until you close the browser",
				],
			],
		},
	],
};

/** `utils/a11y-context.ts` (Decision #150/#151) · `features/shell/core/currency-state.ts` · PRODUCT_SPEC.md §Settings (Accessibility follows the person). */
const PREFERENCES: LegalClause = {
	id: "preferences",
	heading: "Cookies that remember your choices",
	tldr:
		"Two cookies remember your accessibility settings and display currency, so the very first screen of your next visit is right.",
	body: [
		{
			type: "table",
			caption: "Preference cookies",
			head: ["Cookie", "What it does", "How long it lasts"],
			rowHeaders: true,
			rows: [
				[
					[{ type: "code", text: "pj.a11y" }],
					"Your high contrast, dyslexia-friendly font, colour-vision, reduced motion and text direction settings",
					"1 year",
				],
				[
					[{ type: "code", text: "pj.currency" }],
					"The currency prices are displayed in",
					"1 year",
				],
			],
		},
		{
			type: "p",
			content:
				"Neither holds anything that identifies you. If you block them, Projective uses its defaults and your device's own settings until you choose again.",
		},
	],
};

/** PRODUCT_SPEC.md §Escrow, Wallets & Finance #5 (card payments through Stripe) · `features/payments/core/stripe-js.ts` (loaded on payment steps only). */
const PAYMENTS: LegalClause = {
	id: "payment-security",
	heading: "Payment security cookies",
	tldr: "On the payment steps only, Stripe sets its own cookies to help prevent fraud.",
	body: [
		{
			type: "p",
			content: [
				"When a payment form loads — at checkout, or when you top up a wallet or fund escrow — Stripe's script runs and may set its own cookies (such as ",
				{ type: "code", text: "__stripe_mid" },
				" and ",
				{ type: "code", text: "__stripe_sid" },
				") to detect fraud. They are strictly necessary for a card payment, and Stripe's own privacy policy governs them.",
			],
		},
	],
};

/** `features/devtools/core/dev-context.ts` (the `pj.dev.*` override cookies), honoured in development only. */
const DEVELOPMENT: LegalClause = {
	id: "development",
	heading: "Development builds only",
	tldr:
		"A set of developer cookies exists only in development builds. The live site never sets or reads them.",
	body: [
		{
			type: "p",
			content: [
				"Projective's developer tools set cookies whose names start with ",
				{ type: "code", text: "pj.dev." },
				" to simulate situations while the product is being built. They are never set or read on the live site.",
			],
		},
	],
};

/** `apps/web/utils/storage-keys.ts` (`pj.local.*` localStorage and `pj.session.*` sessionStorage keys). */
const LOCAL_STORAGE: LegalClause = {
	id: "local-storage",
	heading: "Storage in your browser",
	tldr:
		"Some settings and drafts are kept in your browser's own storage. They never leave your device by themselves.",
	body: [
		{
			type: "list",
			items: [
				"Local storage remembers layout and display choices on this device — your theme, the sidebar and panel sizes, zoom levels, filters — and a copy of your accessibility settings.",
				"Session storage keeps work in progress for one browser tab — a form you have not sent yet, where you were in a list — and is cleared when the tab closes.",
			],
		},
		{
			type: "p",
			content:
				"These entries are read by the page in your browser and are not sent to Projective with your requests. Clearing your browser's site data removes them.",
		},
	],
};

/** SYSTEM_ARCHITECTURE.md §Discovery telemetry (first-party beacons) — no third-party analytics or advertising tags. */
const NO_TRACKING: LegalClause = {
	id: "no-tracking",
	heading: "What we do not use",
	tldr: "No advertising cookies, no cross-site tracking and no third-party analytics cookies.",
	body: [
		{
			type: "p",
			content:
				"Projective sets no advertising or cross-site tracking cookies and uses no third-party analytics service. It measures errors and page speed with its own first-party reports, and sets no cookie to do so.",
		},
	],
};

/** Browser cookie controls — consequences of blocking each group above. */
const CONTROL: LegalClause = {
	id: "managing-cookies",
	heading: "Managing cookies",
	tldr:
		"You can block or delete cookies in your browser. Blocking the sign-in cookies signs you out.",
	body: [
		{
			type: "p",
			content:
				"You can block or delete cookies in your browser's settings. If you block the strictly necessary cookies you will not be able to sign in or pay; if you block the preference cookies, the defaults apply.",
		},
	],
};
// #endregion

/** The Cookie Policy, newest version first. */
export const COOKIES_VERSIONS = defineLegalVersions([
	{
		id: "cookie-policy",
		slug: "cookies",
		title: "Cookie Policy",
		summary:
			"Every cookie Projective sets, what it is for and how long it lasts — and what the site keeps in your browser's own storage.",
		version: "1.0",
		updatedAt: "2026-10-17",
		effectiveDate: "2026-10-17",
		reviewedAt: null,
		changeSummary: "First published.",
		sections: [
			WHAT_COOKIES_ARE,
			ESSENTIAL,
			PREFERENCES,
			PAYMENTS,
			DEVELOPMENT,
			LOCAL_STORAGE,
			NO_TRACKING,
			CONTROL,
		],
	},
]);
