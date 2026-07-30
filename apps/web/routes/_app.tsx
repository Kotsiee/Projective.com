import { define } from "@web/utils/state.ts";
import { buildScheme, schemeToCss } from "@projective/ui/system";
import DesignSystemRoot from "@web/features/theme/islands/DesignSystemRoot.island.tsx";
import ScrollIdle from "@web/features/shell/islands/ScrollIdle.island.tsx";
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
 * Root document shell. Renders the <html> skeleton, injects the SSR token stylesheet, sets the
 * pre-paint theme (avoids flash), and mounts the DesignSystemProvider (via DesignSystemRoot). The
 * page's group `_layout` provides the navigation shell (AppShell → MiddleNav → PageCanvas).
 */
export default define.page(function App({ Component, state }) {
	return (
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<title>{state.title ?? "Projective"}</title>
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
			</head>
			<body>
				{
					/* Global scroll-activated scrollbar reveal (behaviour-only; renders nothing). Pairs with the
				    self-hiding custom scrollbar in @projective/ui/styles (DESIGN_SYSTEM.md Part D scroll model). */
				}
				<ScrollIdle />
				<DesignSystemRoot>
					<Component />
				</DesignSystemRoot>
				{
					/* DEV-ONLY developer tools (speed dial + context switcher + log inspector). Renders null
				    in production and is excluded from the production island manifest — see DevMount. */
				}
				<DevMount context={state.userContext} />
			</body>
		</html>
	);
});
