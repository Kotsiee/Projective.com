import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/project-setup.css";
// The stage step list is the ticket's own `TaskListEditor`, whose chrome lives in the ticket
// composition sheet. Feature CSS reaches a page only through an island's import graph, so the sheet
// is pulled in here or the reused component arrives unstyled.
import "../styles/ticket-pipeline.css";
import { Toast } from "@projective/ui/feedback";
import { SetupSection } from "../components/setup/SetupSections.tsx";
import { setupSections } from "../core/setup-sections.ts";
import type { ProjectSetup } from "../types/projects-types.ts";
import {
	currentSetup,
	resetSetupState,
	seedSetup,
	setupDraft,
	watchOfflineFlush,
	watchOnboardingSim,
} from "../core/setup-state.ts";
import { advanceOnEnter } from "../core/setup-validation.ts";
import { watchFileDrag } from "../core/file-drag.ts";
import { useSetupAutoSave } from "../hooks/useSetupAutoSave.ts";

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

	/**
	 * Track the Dev Context Switcher's onboarding axis and refetch when it moves.
	 *
	 * A refetch rather than a local overlay, because the onboarding counts decide what the write path
	 * will still accept — so a simulation applied only here would draw controls the save then refuses.
	 * The parameter goes to the server, which discards it outside development.
	 *
	 * Its own effect with empty deps: the subscription is to the DOCUMENT's attributes, not to this
	 * project, so re-establishing it whenever the setup prop changed would tear down and rebuild a
	 * listener for no reason.
	 */
	useEffect(watchOnboardingSim, []);

	/**
	 * Track the connection, and send whatever this device is holding the moment there is one.
	 *
	 * Started from the BODY rather than the footer rig, because the body is the one region present on
	 * every owner render — the rig is absent on an archived project, and a queue whose drain depends
	 * on a control that is not rendered is a queue that never drains.
	 *
	 * Empty deps: the subscription is to the browser's connection, not to this project, so
	 * re-establishing it whenever the setup prop changed would tear down and rebuild a listener for
	 * no reason.
	 */
	useEffect(watchOfflineFlush, []);

	/**
	 * Watch the window for file drags, so both drop zones can announce themselves at once.
	 *
	 * Bound here rather than inside a zone, because the point of the signal is that a zone can light
	 * up before the pointer has reached it — a listener owned by a zone could only ever report on
	 * itself, and could never show the reader that there is a second place the file could go.
	 */
	useEffect(watchFileDrag, []);

	/**
	 * Auto-save on blur, shared with the single-stage form so both surfaces settle identically.
	 *
	 * `autoSaveOnBlur` re-reads the preference and the dirty flag when the timer fires, so a blur is
	 * never a decision taken in advance — turning the toggle off mid-delay correctly cancels it.
	 */
	useSetupAutoSave();

	// Read the signal directly so the sections re-render on every keystroke; before hydration this
	// resolves to the SSR prop.
	const live = setupDraft.value ?? currentSetup(setup);

	return (
		/*
		 * Enter-advances-focus is wired ONCE here, in the capture phase, rather than per field. A stage
		 * added mid-session is covered by construction, and the bail-out rules — a textarea, a rich-text
		 * editor, a chip editor, a combobox all own Enter for themselves — exist in one place instead of
		 * once per call site.
		 */
		<div class="psu" onKeyDownCapture={advanceOnEnter}>
			{
				/*
				 * The visible "Project setup" eyebrow and the explanatory lede are gone — identity belongs
				 * to the middle-nav header band (Part D), and a lede that describes the form to somebody
				 * already looking at it is scaffolding.
				 *
				 * The `<h1>` STAYS, visually hidden. It is the only level-1 heading on the surface and it
				 * carries the project's own title rather than boilerplate, so deleting it would leave the
				 * six `<h2>` section headings hanging off no root and break the document outline for anyone
				 * navigating by heading. The header band renders identity as a `<span>`, so it cannot take
				 * the duty over.
				 */
			}
			<h1 class="psu-visually-hidden">{live.title || "Untitled project"}</h1>

			{
				/*
				 * The toast stack for every save · publish · archive outcome, raised from
				 * `core/setup-state.ts` so all three hydration roots report through one channel.
				 *
				 * It is mounted HERE, in the body, because the body is the one region present on every
				 * owner render — the footer rig is the usual raiser but it is absent on an archived
				 * project, and a report with no host is a report nobody sees. That matters more now
				 * that the archive is announced ONLY on refusal: this stack is the whole channel.
				 * `Toast` is `position: fixed`, so it anchors to the viewport, not to this container.
				 *
				 * Bottom-CENTRE, and both halves of that are load-bearing. Bottom, because the top-right
				 * corner is where the progress ladder sits and an outcome landing on the gauge it just
				 * moved covers the very thing the owner looks at to confirm it. Centre, because the
				 * footer rig's status line is `flex: 1 1 auto` and pushes Save · Discard · Publish hard
				 * against the band's END edge — which is exactly where a bottom-end stack lands, over the
				 * controls the owner is most likely to reach for next. A refusal that hides the button
				 * you have to press to answer it is worse than no refusal at all.
				 *
				 * Centre needs no logical spelling: it has no start/end component, so it is already the
				 * same point in both reading directions.
				 */
			}
			<Toast position="bottom-center" />

			{setupSections(live).map((section) => (
				<SetupSection key={section.key} setup={live} section={section.key} />
			))}
		</div>
	);
}
