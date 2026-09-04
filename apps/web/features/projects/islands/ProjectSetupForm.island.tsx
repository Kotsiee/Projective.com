import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/project-setup.css";
// The stage step list is the ticket's own `TaskListEditor`, whose chrome lives in the ticket
// composition sheet. Feature CSS reaches a page only through an island's import graph, so the sheet
// is pulled in here or the reused component arrives unstyled.
import "../styles/ticket-pipeline.css";
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

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
] as const;

/**
 * An ISO instant as a plain calendar date, in UTC.
 *
 * Deliberately not `toLocaleDateString`: this string is rendered during SSR and again on hydration,
 * and the two runtimes resolve a locale independently — a server in one region and a browser in
 * another would produce different text for the same instant, which Preact reconciles as a mismatch.
 * Naming the month avoids the other trap, which is that `02/09` and `09/02` are the same date in two
 * conventions and a reader has no way to tell which one they are looking at.
 */
function archivedOn(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "an earlier date";
	return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
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
				 * The archive is stated BEFORE the fields, not after a refused save.
				 *
				 * Every control below still edits the local draft — reading and comparing a configuration
				 * is a legitimate thing to do with a project that is out of circulation — but nothing here
				 * can be persisted, and finding that out only once Save has been pressed means the owner
				 * has already spent the work. The store refuses the write with the same sentence, so the
				 * banner and the refusal are one statement rather than two that could disagree.
				 */
			}
			{live.archivedAt && (
				<div class="psu__report">
					<Message
						severity="warning"
						text={`Archived on ${
							archivedOn(live.archivedAt)
						}. This configuration can be read, but changes to it can no longer be saved.`}
					/>
				</div>
			)}

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
