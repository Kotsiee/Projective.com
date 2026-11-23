import { HttpError } from "fresh";
import { define } from "@web/utils/state.ts";

/**
 * The signed-in IP chain-of-title workspace — `/legal/workspace`, `/legal/workspace/audit-packs` and
 * `/legal/workspace/transfers` (Decision #270, ruling (a)) — is not built, so each address answers
 * 404 and no placeholder is reachable (LG0). `workspace` stays a reserved legal segment, a restricted
 * surface and a robots `Disallow`, and the routes stay in `(dashboard)`, so its guard still meets a
 * guest first. LG4 (`documentation/readiness/LEGAL_COMPLIANCE_BUILD_PROMPTS.md`) opens the index and
 * transfers; LG5 opens audit packs.
 */
export const unbuiltWorkspaceHandler = define.handlers({
	GET() {
		throw new HttpError(404);
	},
});
