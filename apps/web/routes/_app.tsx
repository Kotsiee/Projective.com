import { define } from "@web/utils/state.ts";
import { buildScheme, schemeToCss } from "@projective/ui/system";
import { CurrencyContext } from "@projective/ui/display/money";
import DesignSystemRoot from "@web/features/theme/islands/DesignSystemRoot.island.tsx";
import CurrencyBridge from "@web/features/shell/islands/CurrencyBridge.island.tsx";
import { DevMount } from "@web/features/devtools/components/DevMount.tsx";

// Precompute the default light + dark token rules once (SSR). Injected as a <style> so the very
// first paint is correctly themed for either mode with no flash; the DesignSystemRoot island then
// takes over any runtime change. (DESIGN_SYSTEM.md §A.2/§B.5)
const SEED = "#288690";

/**
 * The four schemes, not two.
 *
 * The high-contrast overlay was previously UNREACHABLE, which is a stronger version of the bug than
 * "it barely changes anything". Only the two normal-contrast schemes were emitted here, so
 * `data-contrast="high"` had no rule to match; the widened tones existed solely if the client re-ran
 * `applyConfig` with `highContrast: true` — and nothing ever set that flag, since `dsConfig` defaults
 * it to `false`, nothing persists it, and no control or media query flips it. §A.5's promise of
 * "≥7:1 (AAA) text" could not fire for any user.
 *
 * Emitting all four as static rules fixes both halves at once: the attribute now has something to
 * match for the in-app toggle, AND the `prefers-contrast: more` block below honours the reader's OS
 * setting with zero JavaScript and no flash — the same first-paint discipline `data-theme` already
 * gets. The attribute is written last, so an explicit in-app choice still overrides the OS.
 */
const TOKENS_CSS = [
	schemeToCss(buildScheme({ seed: SEED, dark: false }), ":root"),
	schemeToCss(buildScheme({ seed: SEED, dark: true }), ':root[data-theme="dark"]'),
	// OS-level preference — applies to anyone who has asked their system for more contrast.
	`@media (prefers-contrast: more){`,
	schemeToCss(
		buildScheme({ seed: SEED, dark: false, highContrast: true }),
		':root:not([data-contrast="normal"])',
	),
	schemeToCss(
		buildScheme({ seed: SEED, dark: true, highContrast: true }),
		':root[data-theme="dark"]:not([data-contrast="normal"])',
	),
	`}`,
	// Explicit in-app choice — last, so it wins over the media query in both directions.
	schemeToCss(
		buildScheme({ seed: SEED, dark: false, highContrast: true }),
		':root[data-contrast="high"]',
	),
	schemeToCss(
		buildScheme({ seed: SEED, dark: true, highContrast: true }),
		':root[data-theme="dark"][data-contrast="high"]',
	),
].join("\n");

/**
 * Serialise a value for embedding inside a `<script>` block.
 *
 * `JSON.stringify` alone is not enough: an HTML parser terminates a script element at the literal
 * `</` sequence regardless of JSON quoting, so a string containing `</script>` would break out of the
 * block. The `provider` field on a rate table comes from the database, which makes this reachable in
 * principle rather than only in theory. Escaping `<` as `<` is JSON-legal and parses back to the
 * identical string.
 */
function jsonForScript(value: unknown): string {
	return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Root document shell. Renders the <html> skeleton, injects the SSR token stylesheet, sets the
 * pre-paint theme (avoids flash), and mounts the DesignSystemProvider (via DesignSystemRoot). The
 * page's group `_layout` provides the navigation shell (AppShell → MiddleNav → PageCanvas).
 */
export default define.page(function App({ Component, state }) {
	// The money-presentation context, resolved site-wide by the global middleware. Written onto the
	// <html> element and into an inert JSON script so `@projective/ui/display`'s currency store can
	// seed itself from the DOM the instant any money-bearing island hydrates — the same pre-paint
	// discipline `data-theme` gets above, for the same reason. `state.currency` is always set in a
	// real request; the fallbacks only cover a render outside the middleware (tests, error pages).
	const currency = state.currency;
	return (
		<html
			lang="en"
			data-currency={currency?.displayCurrency ?? "GBP"}
			data-currency-locale={currency?.locale ?? "en-GB"}
		>
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<title>{state.title ?? "Projective"}</title>
				{
					/* Brand mark. The SVG is self-contained (it carries the brand background and a literal
					   white glyph) because a favicon renders outside the document and can inherit neither
					   `currentColor` nor a token — unlike the inline `@web/components/Logo.tsx` used in the
					   page, which does. `sizes="any"` lets it win over a legacy `/favicon.ico` probe. */
				}
				<link rel="icon" href="/logo.svg" type="image/svg+xml" sizes="any" />
				<link rel="apple-touch-icon" href="/logo.svg" />
				{state.description ? <meta name="description" content={state.description} /> : null}
				<style id="ds-tokens" dangerouslySetInnerHTML={{ __html: TOKENS_CSS }} />
				<script
					// Set data-theme before first paint (DESIGN_SYSTEM.md §A.5/§B.5).
					dangerouslySetInnerHTML={{
						__html:
							`(()=>{try{const t=localStorage.getItem("theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.dataset.theme=t;}catch(_){/* noop */}})();`,
					}}
				/>
				<script
					// Set data-sidebar before first paint so the global rail renders at the cached width with
					// no flash-of-wrong-state (the ShellSidebar island re-syncs after hydration). The default
					// is the slim collapsed rail. Literal key MUST match LocalKeys.SIDEBAR_COLLAPSED in
					// apps/web/utils/storage-keys.ts ("pj.local.shell.sidebarCollapsed").
					dangerouslySetInnerHTML={{
						__html:
							`(()=>{try{const c=localStorage.getItem("pj.local.shell.sidebarCollapsed");document.documentElement.dataset.sidebar=c==="0"?"expanded":"collapsed";}catch(_){/* noop */}})();`,
					}}
				/>
				<script
					dangerouslySetInnerHTML={{
						// Set data-guest-nav before first paint so the GUEST floating side-nav renders at the
						// cached width with no flash-of-wrong-width (GuestAside re-syncs after hydration). The
						// default is expanded. Literal key MUST match LocalKeys.GUEST_NAV_COLLAPSED in
						// apps/web/utils/storage-keys.ts ("pj.local.shell.guestNavCollapsed").
						__html:
							`(()=>{try{const c=localStorage.getItem("pj.local.shell.guestNavCollapsed");document.documentElement.dataset.guestNav=c==="1"?"collapsed":"expanded";}catch(_){/* noop */}})();`,
					}}
				/>
				{currency
					? (
						<script
							id="pj-fx-rates"
							type="application/json"
							// `type="application/json"` is inert — the browser never executes it — so the rate
							// table travels as DATA rather than as a global the page could be tricked into
							// running. It is public reference data (see `/api/finance/fx`), so nothing here is
							// sensitive; the reason it is embedded rather than fetched is latency: a figure
							// must be able to re-project the instant the viewer switches currency, and a
							// round-trip at that moment is exactly when it would be felt.
							dangerouslySetInnerHTML={{ __html: jsonForScript(currency.table) }}
						/>
					)
					: null}
			</head>
			<body>
				{
					/* Money presentation: seeds the shared currency store from SSR and re-projects every
				    server-rendered figure when the viewer switches currency. Renders nothing. Mounted here
				    (not in the authed shell) so guest surfaces with prices on them stay in sync too. */
				}
				<CurrencyBridge
					displayCurrency={currency?.displayCurrency ?? "GBP"}
					locale={currency?.locale ?? "en-GB"}
					table={currency?.table ?? null}
				/>
				{
					/* The per-request currency for SERVER-rendered money. Context, not the module-level
				    signal store: a server process renders many viewers concurrently, and a shared signal
				    would let one request's currency change what another is midway through rendering.
				    Islands read the store instead (context does not cross a hydration root), which is
				    what makes a switch instant — see `@projective/ui/display` `CurrencyContext`. */
				}
				<CurrencyContext.Provider
					value={{
						displayCurrency: currency?.displayCurrency ?? "GBP",
						locale: currency?.locale ?? "en-GB",
						table: currency?.table ?? null,
					}}
				>
					<DesignSystemRoot>
						<Component />
					</DesignSystemRoot>
				</CurrencyContext.Provider>
				{
					/* DEV-ONLY developer tools (speed dial + context switcher + log inspector). Renders null
				    in production and is excluded from the production island manifest — see DevMount. */
				}
				<DevMount context={state.userContext} />
			</body>
		</html>
	);
});
