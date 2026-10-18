import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

/**
 * The signed-in IP chain-of-title workspace — `/legal/workspace`, `/legal/workspace/audit-packs` and
 * `/legal/workspace/transfers` (owner ruling (a), Decision #270). It moved here from the bare
 * `/legal`, which is now the public document hub; `workspace` is a reserved legal segment that never
 * resolves as a document. The routes live in the `(dashboard)` group, so its guard sends a guest to
 * `/login?redirectTo=…` before any of these runs. Not built yet: each renders the route scaffold.
 */

/** `/legal/workspace` — the workspace's front page. */
export const workspaceHandler = define.handlers({
	GET(ctx) {
		ctx.state.title = "IP workspace · Projective";
		return page({});
	},
});

/** The workspace's front page. */
export const WorkspacePage = define.page<typeof workspaceHandler>(function LegalWorkspacePage() {
	return (
		<PagePlaceholder
			title="IP workspace"
			path="/legal/workspace"
			note="The chain of title for your projects' work: audit packs and IP transfers."
		/>
	);
});

/** `/legal/workspace/audit-packs`. */
export const auditPacksHandler = define.handlers({
	GET(ctx) {
		ctx.state.title = "Audit packs · IP workspace · Projective";
		return page({});
	},
});

/** Audit packs: a project's agreements, invoices and IP deeds in one verified bundle. */
export const AuditPacksPage = define.page<typeof auditPacksHandler>(function LegalAuditPacksPage() {
	return (
		<PagePlaceholder
			title="Audit packs"
			path="/legal/workspace/audit-packs"
			note="A project's agreements, invoices and IP deeds in one verified bundle."
		/>
	);
});

/** `/legal/workspace/transfers`. */
export const transfersHandler = define.handlers({
	GET(ctx) {
		ctx.state.title = "IP transfers · IP workspace · Projective";
		return page({});
	},
});

/** IP transfers: each deed of transfer issued on an escrow release. */
export const TransfersPage = define.page<typeof transfersHandler>(function LegalTransfersPage() {
	return (
		<PagePlaceholder
			title="IP transfers"
			path="/legal/workspace/transfers"
			note="Each deed of transfer issued when a project's escrow is released."
		/>
	);
});
