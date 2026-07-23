import type { JSX } from "preact";
import { ViewIcon } from "./view-glyphs.tsx";
import { applyToProject, projectApplied } from "../core/view-state.ts";
import type { ExploreItem } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";

/**
 * ProjectActions — the Projects view's **single primary CTA**: Apply to project. Shared by the body
 * header and the migrated sticky header so the two stay in lockstep (both read the module-level
 * `projectApplied` signal — mirrors how `ProfileActions` shares `following`). Rendered inside island
 * trees, so the signal read is reactive. The secondary Save / Message controls were removed so Apply
 * stands as the only call to action in the main area. Apply is an optimistic client stub (guests
 * bounce to sign-in); the real application flow is a Phase-2 route.
 */
export function ProjectActions(
	{ item, authed, ctx }: {
		item: ExploreItem;
		authed: boolean;
		ctx: HrefContext;
	},
): JSX.Element {
	const applied = projectApplied.value;

	return (
		<div class="pf-actions vw-projhead__actions">
			<button
				type="button"
				class="pf-btn pf-btn--primary"
				data-on={applied ? "true" : undefined}
				aria-pressed={applied}
				onClick={() => applyToProject(item, authed, ctx)}
			>
				<ViewIcon name={applied ? "check" : "apply"} size={18} class="pf-btn__icon" />
				<span class="pf-btn__label">{applied ? "Applied" : "Apply to project"}</span>
			</button>
		</div>
	);
}
