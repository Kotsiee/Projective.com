import type { JSX } from "preact";
import "../styles/project-showcase.css";
import "../styles/project-setup.css";
import { ProgressRing, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { outstandingSteps } from "../types/projects-types.ts";
import type { ProjectSetup } from "../types/projects-types.ts";
import { currentSetup, setupDraft } from "../core/setup-state.ts";
import { jumpToStep, nextSetupStep, remainingSteps, stepHref } from "../core/setup-progress.ts";

/**
 * ProjectSetupHeader — the owner's middle-nav header band on `/projects/[projectId]` and its
 * `/preview` sibling: identity on the left, the Details ⇄ Preview tabs centred, and the setup
 * progress ring on the far right.
 *
 * It reads the shared draft, so the ring moves as the owner types in the body island — the two are
 * separate hydration roots and never exchange props. Before the body seeds the store the ring renders
 * the SSR percentage, which is the same number, so the band never paints an empty ring beside a
 * project that is nearly configured.
 *
 * **The ring's arc is set directly from `completeness`, never transitioned into place.** A
 * backgrounded or non-compositing tab freezes the animation clock, and geometry that only arrives via
 * a transition renders at whatever the start value was. Motion on this surface decorates
 * `transform`/`opacity` and nothing that encodes a fact.
 *
 * **The ring is a control.** Hovering or focusing it lists what still stands between the owner and
 * 100%; pressing it scrolls to the first outstanding field (required rows first), rings it briefly and
 * moves focus onto it. On `/preview`, where the form is not rendered, it navigates to the Details
 * surface at the matching section instead. At 100% it has nothing left to do and says so, so it is
 * `aria-disabled` rather than a press that silently does nothing (root CLAUDE.md §3 gate 11).
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

/** The visually-hidden summary the ring's `aria-describedby` points at — present whether or not the tip is open. */
const REMAINING_ID = "psu-progress-remaining";

export default function ProjectSetupHeader(
	{ slug, active, setup }: ProjectSetupHeaderProps,
): JSX.Element {
	// Touch the signal so the band re-renders on every keystroke in the body island.
	const live = setupDraft.value ?? currentSetup(setup);
	const pct = live.completeness;
	const base = `/projects/${slug}`;
	const outstanding = outstandingSteps(live.steps);
	const remaining = remainingSteps(live.steps);
	const next = nextSetupStep(live.steps);
	const complete = next === null;
	const locked = !live.previewReady;
	const lockReason = outstanding.length > 0
		? `Preview opens once you finish: ${outstanding.map((s) => s.label).join(" · ")}`
		: "Preview is not available yet.";

	const remainingText = complete
		? "All setup steps are complete."
		: `Remaining: ${
			remaining.map((s) => (s.required ? `${s.label} (required)` : s.label)).join(", ")
		}. Press to go to ${next.label}.`;

	const onProgressPress = () => {
		if (!next) return;
		if (jumpToStep(next, live)) return;
		globalThis.location.assign(stepHref(base, next, live));
	};

	const tip = (
		<div class="psu-progress-tip">
			{complete ? <p class="psu-progress-tip__head">All setup steps complete</p> : (
				<>
					<p class="psu-progress-tip__head">
						{remaining.length === 1 ? "1 step" : `${remaining.length} steps`} to 100%
					</p>
					<ul class="psu-progress-tip__list">
						{remaining.map((step) => (
							<li class="psu-progress-tip__item" key={step.key}>
								<span>{step.label}</span>
								{step.required && <span class="psu-progress-tip__meta">· Required</span>}
							</li>
						))}
					</ul>
					<p class="psu-progress-tip__foot">Click to go to {next.label}</p>
				</>
			)}
		</div>
	);

	return (
		<header class="proj-pvhead">
			<div class="proj-pvhead__id">
				<span class="proj-pvhead__title">{live.title || "Untitled project"}</span>
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

			<div class="psu-progress">
				<Tooltip content={tip} placement="bottom-end" class="psu-progress-tip__panel">
					<button
						type="button"
						class="psu-progress__button"
						data-complete={complete ? "true" : undefined}
						aria-disabled={complete ? "true" : undefined}
						aria-label={`Project setup ${pct}% complete`}
						aria-describedby={REMAINING_ID}
						onClick={onProgressPress}
					>
						{
							/*
							 * The ring's own `progressbar` role is presentational inside a button, so the
							 * button's label carries the figure and the hidden summary carries the list.
							 */
						}
						<ProgressRing
							class="psu-progress__ring"
							value={pct}
							size={20}
							strokeWidth={3}
							severity={complete ? "success" : "primary"}
							aria-label="Project setup progress"
						/>
						<span class="psu-progress__value" aria-hidden="true">{pct}%</span>
					</button>
				</Tooltip>
				<span id={REMAINING_ID} class="psu-visually-hidden">{remainingText}</span>
			</div>
		</header>
	);
}
