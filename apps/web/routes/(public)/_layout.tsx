import { define } from "@web/utils/state.ts";
import SiteHeader from "@features/marketing/islands/SiteHeader.island.tsx";

/** Auth surfaces render their own full-window chrome (AuthShell) — no marketing header. */
const AUTH_PATHS = new Set(["/join", "/login", "/forgot-password", "/verify"]);

/**
 * Public marketing shell — the guest/public surface (DESIGN_SYSTEM.md Part D glass language, guest
 * persona). Unlike the authenticated dashboard shell (which keeps the nested-frame internal scroll),
 * this surface uses **native window scrolling** with a full-width body and a floating glass
 * {@link SiteHeader} that sticks cleanly as you descend. The elastic-magnetism engine
 * (`MagneticField`) mounts inside the page body so its effect hydrates reliably.
 *
 * The `(auth)` group (join/login/forgot-password/verify) is exempted: those pages own a full-window
 * split-screen shell, so the marketing header is suppressed for them.
 */
export default define.page(function PublicLayout(ctx) {
	if (AUTH_PATHS.has(ctx.url.pathname)) {
		return <ctx.Component />;
	}
	return (
		<div class="site">
			<SiteHeader authenticated={ctx.state.isAuthenticated ?? false} />
			<main class="site__main">
				<ctx.Component />
			</main>
		</div>
	);
});
