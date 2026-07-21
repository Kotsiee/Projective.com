import { define } from "@web/utils/state.ts";
import { buildScheme, schemeToCss } from "@projective/ui/system";
import DesignSystemRoot from "@web/features/theme/islands/DesignSystemRoot.island.tsx";
import ScrollIdle from "@web/features/shell/islands/ScrollIdle.island.tsx";

// Precompute the default light + dark token rules once (SSR). Injected as a <style> so the very
// first paint is correctly themed for either mode with no flash; the DesignSystemRoot island then
// takes over any runtime change. (DESIGN_SYSTEM.md §A.2/§B.5)
const SEED = "#288690";
const TOKENS_CSS = [
	schemeToCss(buildScheme({ seed: SEED, dark: false }), ":root"),
	schemeToCss(buildScheme({ seed: SEED, dark: true }), ':root[data-theme="dark"]'),
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
			</body>
		</html>
	);
});
