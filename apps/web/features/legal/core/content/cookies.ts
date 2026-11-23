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
 * | `pj.screen_share`                   | `utils/screen-share-context.ts` `screenShareCookie` (1 year, Decision #297) |
 * | `pj_catalogue_lane`                 | `features/catalogue/islands/CatalogueLane.island.tsx` (Path=/catalogue, 180 days) |
 * | `pj_contact_receipt`                | `features/contact/core/contact-form.ts` `receiptCookie` (Path=/contact, HttpOnly, 10 minutes) |
 * | `pj.dev.*`                          | the Dev Context Switcher (`features/devtools/`), development only    |
 *
 * Browser storage (the "Storage in your browser" clause): `utils/storage-keys.ts` `LocalKeys` /
 * `SessionKeys`, and the design system's own layout keys (`packages/ui`: `theme`, splitter, calendar
 * and table state); the IndexedDB database `pj-offline` (`CacheKeys.OFFLINE_DB`, written by
 * `features/projects/core/offline-queue.ts` and flushed to the server on reconnect); the service
 * worker's `pj-shell-v1` bucket (`CacheKeys.SHELL_CACHE`, `static/sw.js`); the `pj-thumbs-v1` bucket
 * of file thumbnails (`features/files/core/thumbs/thumb-cache.ts`, purged at sign-out). The tab's
 * discovery key (`SessionKeys.DISCOVERY_SESSION`, `features/explore/core/discovery-beacon.ts`) is sent
 * with discovery events.
 *
 * Third-party frames, which set their own cookies under their own policies: Stripe.js on the payment
 * steps, Cloudflare Turnstile on the auth forms (Decision #447), the article video embed
 * (`www.youtube-nocookie.com`, loaded on play) and the file preview's provider viewers
 * (`EMBED_FRAME_ORIGINS`, `packages/types/files/embed.ts`, Decision #401) — the `frame-src` list of
 * `utils/csp.ts`.
 *
 * @module
 */
import type { DefinitionItem } from "@projective/types/content";
import { defineLegalVersions, type LegalClause } from "./define.ts";

/**
 * One cookie as a definition — its name, what it does, how long it lasts. A definition list rather
 * than a table: unbreakable cookie names would force a table column wider than a phone's reading
 * column and push "how long it lasts" behind a horizontal scroll; a definition reflows at any width.
 */
function cookie(name: string, purpose: string, lasts: string): DefinitionItem {
	return {
		term: name,
		definition: [`${purpose} `, { type: "strong", text: "Lasts:" }, ` ${lasts}.`],
	};
}

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
				"A cookie is a small piece of text a website asks your browser to keep and send back on later visits. Browsers also offer local storage, which works in a similar way but is never sent to the server. This policy lists every cookie Projective sets, and explains what it keeps in your browser's other storage.",
		},
	],
};

/** `apps/web/utils/auth-cookies.ts` · `routes/api/auth/join.ts` · `features/contact/core/contact-form.ts` (`pj_contact_receipt`) · Decisions #185, #205, #208, #276. */
const ESSENTIAL: LegalClause = {
	id: "essential",
	heading: "Cookies that keep you signed in",
	tldr:
		"These are strictly necessary. Without them you cannot sign in or send the contact form. Page scripts cannot read any of them.",
	body: [
		{
			type: "dl",
			items: [
				cookie(
					"sb-access-token",
					"Proves you are signed in on each request.",
					"about an hour, then renewed",
				),
				cookie(
					"sb-refresh-token",
					"Renews your session when the access token expires.",
					"30 days with “Keep me signed in”; otherwise until you close the browser",
				),
				cookie(
					"pj_session_transient",
					"Remembers that you chose not to stay signed in.",
					"until you close the browser",
				),
				cookie(
					"pj_pending_verification",
					"Lets the email-confirmation screen check your confirmation from the browser you signed up in; sent only to the sign-in service.",
					"until the confirmation window ends",
				),
				cookie(
					"sb-…-code-verifier",
					"Completes a sign-in or account link through Google or single sign-on securely.",
					"10 minutes",
				),
				cookie(
					"pj_join_age_lock",
					"After an under-13 date of birth, stops that browser from trying to sign up again; it holds no personal data.",
					"until you close the browser",
				),
				cookie(
					"pj_contact_receipt",
					"After you send the contact form, carries your request's reference to the page that confirms it; sent only to the contact page, and never holds your email address.",
					"10 minutes, or until the confirmation has been shown",
				),
			],
		},
	],
};

/** `utils/a11y-context.ts` (Decision #150/#151) · `features/shell/core/currency-state.ts` · `utils/screen-share-context.ts` (Decision #297) · `features/catalogue/islands/CatalogueLane.island.tsx` · PRODUCT_SPEC.md §Settings (Accessibility follows the person). */
const PREFERENCES: LegalClause = {
	id: "preferences",
	heading: "Cookies that remember your choices",
	tldr:
		"A few cookies remember choices you make — your accessibility settings, display currency, screen sharing mode and catalogue view — so the very first screen of your next visit is right.",
	body: [
		{
			type: "dl",
			items: [
				cookie(
					"pj.a11y",
					"Your high contrast, dyslexia-friendly font, colour-vision, reduced motion and text direction settings.",
					"1 year",
				),
				cookie("pj.currency", "The currency prices are displayed in.", "1 year"),
				cookie(
					"pj.screen_share",
					"Whether screen sharing mode is on on this device, so sensitive details stay hidden from the first moment a page loads.",
					"1 year",
				),
				cookie(
					"pj_catalogue_lane",
					"Your seller catalogue list's filter, team choice and open sections; sent only to catalogue pages.",
					"180 days",
				),
			],
		},
		{
			type: "p",
			content:
				"None holds anything that identifies you. If you block them, Projective uses its defaults and your device's own settings until you choose again.",
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

/** `apps/web/utils/csp.ts` (`frame-src`) · Cloudflare Turnstile on the auth forms (Decision #447) · the article video embed (`features/view/islands/ArticleContent.island.tsx`) · the file preview's provider viewers (`packages/types/files/embed.ts`, Decision #401). */
const OTHER_SERVICES: LegalClause = {
	id: "other-services",
	heading: "Frames from other services",
	tldr:
		"A few pages show a frame from another service, which may set its own cookies under that service's policy.",
	body: [
		{
			type: "list",
			items: [
				"The sign-up, sign-in and account-recovery forms run Cloudflare Turnstile, a check that you are not a bot, in a frame from Cloudflare.",
				"A video in an article loads from YouTube's privacy-enhanced address (youtube-nocookie.com) only once you press play.",
				"A linked Google Drive or Google Docs file, or a YouTube, Vimeo, Loom or Figma link, can be shown in that provider's own viewer when you open its preview.",
			],
		},
		{
			type: "p",
			content:
				"Projective does not read those services' cookies, and it frames no other site apart from Stripe's payment form.",
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

/**
 * `apps/web/utils/storage-keys.ts` (`pj.local.*` localStorage and `pj.session.*` sessionStorage keys,
 * the basket, checkout draft, recent searches and views among them; `CacheKeys.OFFLINE_DB` `pj-offline`
 * and `CacheKeys.SHELL_CACHE` `pj-shell-v1`) · `features/explore/core/discovery-beacon.ts` (the tab's
 * discovery key) · `features/files/core/thumbs/thumb-cache.ts` (`pj-thumbs-v1`, purged at sign-out) ·
 * `features/projects/core/offline-queue.ts` (offline setup writes, flushed on reconnect) ·
 * `static/sw.js` (registered by `features/shell/islands/ServiceWorkerBridge.island.tsx`, production only).
 */
const LOCAL_STORAGE: LegalClause = {
	id: "local-storage",
	heading: "Storage in your browser",
	tldr:
		"Some settings, drafts, your basket and an offline copy of pages are kept in your browser's own storage. Only offline changes and a tab's anonymous discovery key are ever sent to Projective.",
	body: [
		{
			type: "list",
			items: [
				"Local storage remembers layout and display choices on this device — your theme, the sidebar and panel sizes, zoom levels, filters — and a copy of your accessibility settings and screen sharing mode.",
				"It also keeps your basket and the choices of a checkout you have not finished (never an amount or card details), drafts you have not saved yet, your recent searches and the items you recently opened on this device.",
				"Session storage keeps work in progress for one browser tab — a form you have not sent yet, where you were in a list — and is cleared when the tab closes.",
				"Session storage also holds a random key for the tab. It is sent with the record of which search results and listings were shown and opened in that tab, so we can measure and improve search and recommendations; on its own it identifies no one.",
				"An offline database (IndexedDB) holds changes you make to a project while you are offline. They wait there and are sent to Projective automatically when you reconnect, then removed.",
				"On the live site, an offline cache keeps a copy of the pages you open and the files they load — scripts, styles and images — so a page you were working on still opens if your connection drops. Responses from Projective's API are never stored in it.",
				"A thumbnail cache keeps the small previews of files you have looked at in Files, so they appear at once next time. It is emptied when you sign out.",
			],
		},
		{
			type: "p",
			content:
				"Apart from the offline changes and the tab's key, which are sent as described above, these entries are read only by the page in your browser and are not sent to Projective with your requests. Clearing your browser's site data removes all of them, including any offline changes not yet sent.",
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
				"Projective sets no advertising or cross-site tracking cookies and uses no third-party analytics service. It measures errors and page speed with its own first-party reports, and how search and recommendations perform with its own first-party events, and sets no cookie to do either.",
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
		updatedAt: "2026-11-23",
		effectiveDate: "2026-10-17",
		reviewedAt: null,
		changeSummary: "First published.",
		sections: [
			WHAT_COOKIES_ARE,
			ESSENTIAL,
			PREFERENCES,
			PAYMENTS,
			OTHER_SERVICES,
			DEVELOPMENT,
			LOCAL_STORAGE,
			NO_TRACKING,
			CONTROL,
		],
	},
]);
