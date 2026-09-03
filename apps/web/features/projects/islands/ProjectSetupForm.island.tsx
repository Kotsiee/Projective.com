import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/project-setup.css";
import { Message } from "@projective/ui/feedback";
import { SetupSection } from "../components/setup/SetupSections.tsx";
import { setupSections } from "../core/setup-sections.ts";
import type { ProjectSetup } from "../types/projects-types.ts";
import {
	currentSetup,
	resetSetupState,
	seedSetup,
	setupDraft,
	setupError,
	setupNotice,
} from "../core/setup-state.ts";
import { advanceOnEnter } from "../core/setup-validation.ts";

/**
 * ProjectSetupForm — the BODY of the owner's Stage-2 workspace on `/projects/[projectId]`.
 *
 * A dumb view over {@link setupDraft}: it renders the sections this engagement's shape calls for and
 * forwards every edit to the shared store, which owns the fold, the ladder re-derivation and the
 * PATCH. The Save · Discard · Publish controls are deliberately NOT here — they live in the
 * middle-nav footer band, where the region contract puts every action (DESIGN_SYSTEM Part D), and
 * they reach the same store from their own hydration root.
 *
 * The flow is ONE continuous scroll. There is no stepper and no tab strip: the sections are not
 * sequential — a client who knows the budget before the brief has no reason to be held at step two —
 * and hiding the rest of the form behind a step would conceal how much is being asked, which is the
 * one thing somebody deciding whether to finish now needs to see.
 *
 * The store is seeded in an effect rather than at render, because seeding is a client-only fact and a
 * render-time write would run on the server too. Until it lands the sections read the SSR prop, which
 * is the identical value — so there is no flash and no hydration mismatch.
 *
 * The island exists to bundle the surface's stylesheet as much as to hydrate it: feature CSS reaches
 * a page only through an island's import graph, so a section rendered as a bare server component
 * would arrive unstyled.
 */
export interface ProjectSetupFormProps {
	/** The server-resolved configuration — the first paint, and the seed for the client store. */
	setup: ProjectSetup;
}

export default function ProjectSetupForm({ setup }: ProjectSetupFormProps): JSX.Element {
	// Keyed on the canonical uuid, never the slug: renaming the project regenerates the slug, and a
	// re-seed on a slug change would discard the very edit that caused it.
	useEffect(() => {
		seedSetup(setup);
		return resetSetupState;
	}, [setup.id]);

	// Read the signal directly so the sections re-render on every keystroke; before hydration this
	// resolves to the SSR prop.
	const live = setupDraft.value ?? currentSetup(setup);
	const error = setupError.value;
	const notice = setupNotice.value;

	return (
		/*
		 * Enter-advances-focus is wired ONCE here, in the capture phase, rather than per field. A stage
		 * added mid-session is covered by construction, and the bail-out rules — a textarea, a rich-text
		 * editor, a chip editor, a combobox all own Enter for themselves — exist in one place instead of
		 * once per call site.
		 */
		<div class="psu" onKeyDownCapture={advanceOnEnter}>
			<header class="psu__head">
				<p class="psu__eyebrow">Project setup</p>
				<h1 class="psu__title">{live.title || "Untitled project"}</h1>
				<p class="psu__lede">
					Everything here shapes how freelancers see and apply to this engagement. Work through it
					in any order — the progress bar above tracks what is still outstanding.
				</p>
			</header>

			{
				/*
				 * The wrapper carries no live-region role of its own: `Message` already announces itself
				 * (assertive for `danger`, polite otherwise), and nesting a second region inside it makes
				 * one save outcome announce twice.
				 */
			}
			{(error || notice) && (
				<div class="psu__report">
					{error
						? <Message severity="danger" text={error} />
						: <Message severity="success" text={notice ?? ""} />}
				</div>
			)}

			{setupSections(live).map((section) => (
				<SetupSection key={section.key} setup={live} section={section.key} />
			))}
		</div>
	);
}
