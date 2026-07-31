import type { JSX } from "preact";
import { ViewIcon } from "./view-glyphs.tsx";
import { applyToProject, projectApplied } from "../core/view-state.ts";
import type { ExploreItem } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";

/**
 * ProjectActions — the Projects view's **single primary CTA**: Apply to project. All three mounts read
 * the module-level `projectApplied` signal (mirroring how `ProfileActions` shares `following`), so they
 * stay in lockstep; rendered inside island trees, so the read is reactive.
 *
 * **Exactly one mount is ever visible, and which one depends on width.** Above 767px the lane owns the
 * CTA and both `pf-header__actions` and `pf-stickyhead__actions` are `display:none` (profile.css) —
 * §B.8.2 counts per decision region and the shell chrome is one region. Below 767px there is no lane, so
 * the body header carries it until it scrolls away and the condensed band takes over. Do not read the
 * duplicate mounts as three competing primaries: they are one button in three mutually exclusive states.
 *
 * Apply is an optimistic client stub (guests bounce to sign-in); the real application flow is Phase 2.
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
