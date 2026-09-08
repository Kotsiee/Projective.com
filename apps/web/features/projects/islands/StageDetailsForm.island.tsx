import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/project-setup.css";
// The stage step list is the ticket's own `TaskListEditor`, whose chrome lives in the ticket
// composition sheet. Feature CSS reaches a page only through an island's import graph, so the sheet
// is pulled in here or the reused component arrives unstyled.
import "../styles/ticket-pipeline.css";
import { Message, Toast } from "@projective/ui/feedback";
import { predecessorOptionsFor, Section, StageFields } from "../components/setup/SetupSections.tsx";
import {
	lockedStagePriceIds,
	type ProjectSetup,
	STAGE_ITEM_LABEL,
	type StageSetup,
	stageTimingApplies,
} from "../types/projects-types.ts";
import {
	currentSetup,
	patchSetup,
	resetSetupState,
	seedSetup,
	setupDraft,
	watchOnboardingSim,
} from "../core/setup-state.ts";
import { advanceOnEnter } from "../core/setup-validation.ts";
import { useSetupAutoSave } from "../hooks/useSetupAutoSave.ts";

/**
 * StageDetailsForm — the BODY of the stage Details tab at
 * `/projects/[projectId]/[channelId]/details`.
 *
 * One stage of an engagement, configured on its own page. It exists because a stage's terms are what
 * a freelancer working in that channel actually agreed to, and the only route to them was a
 * disclosure buried in a list on a different surface — so the owner had to leave the channel they
 * were standing in, find the right row among the rest, and open it.
 *
 * **It is the same form, not a version of it.** Every control comes from {@link StageFields}, the
 * component the accordion row on `/projects/[projectId]` also renders, so the two surfaces cannot
 * drift: a field added there appears here, and a rule changed here changes there. The only thing
 * this island adds is the page it sits on.
 *
 * It is likewise the same STORE. Seeding {@link seedSetup} with the whole {@link ProjectSetup} — not
 * just the one stage — is what buys the surface Ctrl+S, the collapsing save serialiser, auto-save on
 * blur, the dirty flag and the footer rig's Save ⁄ Discard for nothing, because those all measure a
 * whole configuration and the write path is the project's own `PATCH`. A stage-shaped store would
 * have needed its own copy of all five, and its own endpoint to send them to.
 *
 * The store is seeded in an effect rather than at render, because seeding is a client-only fact and
 * a render-time write would run on the server too. Until it lands the fields read the SSR prop,
 * which is the identical value — so there is no flash and no hydration mismatch.
 *
 * The island exists to bundle the surface's stylesheets as much as to hydrate it: feature CSS reaches
 * a page only through an island's import graph, so the same fields rendered as a bare server
 * component would arrive unstyled.
 */

// #region Props
/** Props for {@link StageDetailsForm}. */
export interface StageDetailsFormProps {
	/**
	 * The whole server-resolved configuration — the first paint, and the seed for the client store.
	 *
	 * The project rather than the stage, deliberately: the price lock, the legal predecessors and the
	 * item vocabulary are all answers about the stage LIST, and the write path sends the project.
	 */
	setup: ProjectSetup;
	/**
	 * Which stage this page configures — a `projects.project_stages` id, NOT the routed channel id.
	 *
	 * The route resolves it from the stage channel's `stageId`. On the live path the two are different
	 * keys in different schemas and only the fixtures make them equal, which is exactly why a lookup
	 * written against the channel id passes in the stub and finds nothing in production.
	 */
	stageId: string;
}
// #endregion

/** The section heading for one item of this engagement's vocabulary — "Stage details" &c. */
function sectionTitle(itemLabel: string): string {
	return `${itemLabel[0].toUpperCase()}${itemLabel.slice(1)} details`;
}

export default function StageDetailsForm({ setup, stageId }: StageDetailsFormProps): JSX.Element {
	// Keyed on the canonical uuid, never the slug: renaming the project regenerates the slug, and a
	// re-seed on a slug change would discard the very edit that caused it.
	useEffect(() => {
		seedSetup(setup);
		return resetSetupState;
	}, [setup.id]);

	/*
	 * The dev seam's onboarding axis, watched for the same reason the whole-project form watches it:
	 * this page renders the price LOCK, and the lock is derived from `onboardedCount`, which the
	 * switcher simulates. Empty deps because the watcher is not about any particular project.
	 */
	useEffect(watchOnboardingSim, []);

	/**
	 * Auto-save on blur, shared with the whole-project form so both surfaces settle identically.
	 *
	 * `autoSaveOnBlur` re-reads the preference and the dirty flag when the timer fires, so a blur is
	 * never a decision taken in advance — turning the toggle off mid-delay correctly cancels it.
	 */
	useSetupAutoSave();

	// Read the signal directly so the fields re-render on every keystroke; before hydration this
	// resolves to the SSR prop.
	const live = setupDraft.value ?? currentSetup(setup);
	const index = live.stages.findIndex((s) => s.id === stageId);
	const stage: StageSetup | undefined = index === -1 ? undefined : live.stages[index];
	const itemLabel = STAGE_ITEM_LABEL[live.format];

	/*
	 * Defensive rather than reachable: the route resolved this stage server-side, and nothing on this
	 * page can remove it. It is still rendered as a sentence instead of being left to crash, because
	 * the draft is shared state and a store seeded by a DIFFERENT engagement — a stale island left
	 * mounted across a navigation, say — would otherwise take the surface down.
	 */
	if (!stage) {
		return (
			<div class="psu">
				<p class="psu-note">
					This {itemLabel} is no longer part of the project. <a href="/projects">All projects</a>
				</p>
			</div>
		);
	}

	/**
	 * Fold one stage's edit back into the whole configuration.
	 *
	 * Mapped by id rather than by the index resolved above: `patchSetup` re-derives the ladder and
	 * hands back a new list on every keystroke, and addressing a stage by position would rewrite the
	 * wrong row the moment a reorder made on the project surface landed underneath this one.
	 */
	const onPatch = (patch: Partial<StageSetup>) => {
		patchSetup({
			stages: live.stages.map((s) => (s.id === stageId ? { ...s, ...patch } : s)),
		});
	};

	return (
		/*
		 * Enter-advances-focus is wired ONCE here, in the capture phase, rather than per field — the
		 * same wiring the whole-project form uses, and for the same reason: the bail-out rules for a
		 * textarea, a rich-text editor, a chip editor and a combobox live in one place instead of once
		 * per call site.
		 */
		<div class="psu" onKeyDownCapture={advanceOnEnter}>
			{
				/*
				 * The only level-1 heading on the surface, visually hidden, carrying the stage's own name.
				 *
				 * Identity belongs to the middle-nav header band (DESIGN_SYSTEM Part D) and the band
				 * renders it as a `<span>`, so it cannot take this duty over. Without the `<h1>` the
				 * section's `<h2>` would hang off no root and the document outline would break for anyone
				 * navigating by heading.
				 */
			}
			<h1 class="psu-visually-hidden">{stage.name || `Untitled ${itemLabel}`}</h1>

			{
				/*
				 * Stated BEFORE the fields, not after a refused save.
				 *
				 * Every control below still edits the local draft — reading and comparing a configuration
				 * is a legitimate thing to do with a project that is out of circulation — but nothing here
				 * can be persisted, and finding that out only once Save has been pressed means the owner
				 * has already spent the work. The store refuses the write with the same sentence, so the
				 * banner and the refusal are one statement rather than two that could disagree.
				 */
			}
			{live.archivedAt && (
				<div class="psu__archived">
					<Message
						severity="warning"
						text="This project is archived. This configuration can be read, but changes to it can no longer be saved."
					/>
				</div>
			)}

			{
				/*
				 * The toast stack for every save outcome, raised from `core/setup-state.ts` so the body and
				 * the footer rig report through one channel. `Toast` is `position: fixed`, so it is
				 * anchored to the viewport rather than here.
				 *
				 * Bottom-CENTRE, for the reason the project surface uses it and read from the same place:
				 * this band's actions sit at its END edge, so a bottom-end stack would cover Save and
				 * Discard — the two controls a refused save asks the owner to use. Matching the project
				 * surface also means one form, edited through one store across two routes, does not report
				 * itself from two different corners depending on which route it is being edited from.
				 */
			}
			<Toast position="bottom-center" />

			<Section sectionKey="stages" title={sectionTitle(itemLabel)}>
				<StageFields
					stage={stage}
					index={index}
					itemLabel={itemLabel}
					session={live.format === "session"}
					oneOff={live.format === "one_off"}
					predecessorOptions={predecessorOptionsFor(live.stages, stageId, itemLabel)}
					currency={live.budget.currency}
					projectRequiresNda={live.rules.ndaRequired}
					priceLocked={lockedStagePriceIds(live, live.stages).has(stageId)}
					timed={stageTimingApplies(live.structure, live.stages)}
					onPatch={onPatch}
				/>
			</Section>
		</div>
	);
}
