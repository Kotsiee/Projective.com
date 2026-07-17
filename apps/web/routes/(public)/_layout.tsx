import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import SiteHeader from "@features/marketing/islands/SiteHeader.island.tsx";
import { PublicFooter } from "@features/marketing/components/PublicFooter.tsx";
import { UserShell } from "@web/features/shell/components/UserShell.tsx";

/** Auth surfaces render their own full-window chrome (AuthShell) — no marketing header/footer. */
const AUTH_PATHS = new Set(["/join", "/login", "/forgot-password", "/verify"]);

/**
 * Public surface shell — resolves to one of two navigation profiles by auth state (DESIGN_SYSTEM.md
 * Part D). Guests get the marketing glass {@link SiteHeader} (megamenus) over **native window
 * scrolling**; signed-in users get the unified {@link UserShell} L-shell so Home & Explore match the
 * authenticated app exactly (site-wide auth is resolved in the global middleware). The elastic
 * magnetism engine mounts inside the guest page body so it hydrates reliably.
 *
 * The `(auth)` group (join/login/forgot-password/verify) is exempted: those pages own a full-window
 * split-screen shell, so both shells are suppressed for them.
 */
export default define.page(function PublicLayout(ctx) {
	if (AUTH_PATHS.has(ctx.url.pathname)) {
		return <ctx.Component />;
	}
	if (ctx.state.isAuthenticated) {
		return (
			<UserShell path={ctx.url.pathname} context={asAuthenticatedContext(ctx.state.userContext)}>
				<ctx.Component />
			</UserShell>
		);
	}
	return (
		<div class="site">
			<SiteHeader authenticated={false} />
			<main class="site__main">
				<ctx.Component />
			</main>
			<PublicFooter />
		</div>
	);
});
