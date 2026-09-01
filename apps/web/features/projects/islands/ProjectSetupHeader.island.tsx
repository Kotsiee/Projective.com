import type { JSX } from "preact";
import "../styles/project-showcase.css";
import "../styles/project-setup.css";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { styleVars } from "@ui/core/style.ts";
import { outstandingSteps } from "../types/projects-types.ts";
import type { ProjectSetup } from "../types/projects-types.ts";
import { currentSetup, setupDraft } from "../core/setup-state.ts";

/**
 * ProjectSetupHeader — the owner's middle-nav header band on `/projects/[projectId]` and its
 * `/preview` sibling: identity, the setup progress bar, and the Details ⇄ Preview toggle.
 *
 * It reads the shared draft, so the bar moves as the owner types in the body island — the two are
 * separate hydration roots and never exchange props. Before the body seeds the store the bar renders
 * the SSR percentage, which is the same number, so the band never paints a 0% bar beside a project
 * that is nearly configured.
 *
 * **The bar's geometry is set directly from `completeness`, never transitioned into place.** A
 * backgrounded or non-compositing tab freezes the animation clock, and a width that only arrives via
 * a transition renders at whatever the start value was — which for a fill is zero. Motion on this
 * surface decorates `transform`/`opacity` and nothing that encodes a fact.
 *
 * **Preview is rendered and LOCKED, not hidden, while the required steps are outstanding.** Removing
 * it would hide the path to publishing; locking it and naming what is missing teaches that path. The
 * lock is `aria-disabled` rather than the native `disabled` attribute deliberately: a natively
 * disabled control is unfocusable and, in most engines, suppresses the pointer events its own tooltip
 * needs — so the one explanation of why it cannot be used would be unreachable by exactly the people
 * who need it most. Activation is refused in the handler instead.
 */
export interface ProjectSetupHeaderProps {
	/** The engagement slug — both toggle hrefs hang off `/projects/[slug]`. */
	slug: string;
	/** Which surface is showing, driving the URL-matched underline. */
	active: "details" | "preview";
	/** The server-resolved configuration; the live draft supersedes it once the body has hydrated. */
	setup: ProjectSetup;
}

export default function ProjectSetupHeader(
	{ slug, active, setup }: ProjectSetupHeaderProps,
): JSX.Element {
	// Touch the signal so the band re-renders on every keystroke in the body island.
	const live = setupDraft.value ?? currentSetup(setup);
	const pct = live.completeness;
	const base = `/projects/${slug}`;
	const outstanding = outstandingSteps(live.steps);
	const locked = !live.previewReady;
	const lockReason = outstanding.length > 0
		? `Preview opens once you finish: ${outstanding.map((s) => s.label).join(" · ")}`
		: "Preview is not available yet.";

	return (
		<header class="proj-pvhead">
			<div class="proj-pvhead__id">
				<span class="proj-pvhead__eyebrow">Managing</span>
				<span class="proj-pvhead__title">{live.title || "Untitled project"}</span>
			</div>

			<div class="psu-bar">
				<div
					class="psu-bar__track"
					role="progressbar"
					aria-label="Project setup progress"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={pct}
					aria-valuetext={`${pct}% of setup complete`}
				>
					<span
						class="psu-bar__fill"
						style={styleVars({ "--psu-bar-pct": `${pct}%` })}
						aria-hidden="true"
					/>
				</div>
				<span class="psu-bar__value">{pct}%</span>
			</div>

			<nav class="proj-pvhead__tabs" aria-label="Project view">
				<a
					class="proj-pvtab"
					href={base}
					data-active={active === "details" ? "true" : undefined}
					aria-current={active === "details" ? "page" : undefined}
				>
					<span class="proj-pvtab__icon" aria-hidden="true">
						<Icon name="edit" />
					</span>
					<span class="proj-pvtab__label">Details</span>
				</a>

				{locked
					? (
						<Tooltip content={lockReason} placement="bottom">
							<button
								type="button"
								class="proj-pvtab psu-tab--locked"
								aria-disabled="true"
								onClick={(e) => e.preventDefault()}
							>
								<span class="proj-pvtab__icon" aria-hidden="true">
									<Icon name="lock" />
								</span>
								<span class="proj-pvtab__label">Preview</span>
							</button>
						</Tooltip>
					)
					: (
						<a
							class="proj-pvtab"
							href={`${base}/preview`}
							data-active={active === "preview" ? "true" : undefined}
							aria-current={active === "preview" ? "page" : undefined}
						>
							<span class="proj-pvtab__icon" aria-hidden="true">
								<Icon name="eye" />
							</span>
							<span class="proj-pvtab__label">Preview</span>
						</a>
					)}
			</nav>
		</header>
	);
}
