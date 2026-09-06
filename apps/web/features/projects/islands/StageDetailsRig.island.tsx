import type { JSX } from "preact";
import "../styles/stage-details-rig.css";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { ProjectSetup } from "../types/projects-types.ts";
import {
	currentSetup,
	discardSetup,
	requestSave,
	setupDirty,
	setupDraft,
	setupSaving,
} from "../core/setup-state.ts";
import { useSaveShortcut } from "../hooks/useSaveShortcut.ts";

/**
 * StageDetailsRig — the middle-nav FOOTER band on `/projects/[projectId]/[channelId]/details`:
 * Save · Discard, and the one line saying whether there is anything to save.
 *
 * The band owns every action and the body owns viewing and editing (DESIGN_SYSTEM Part D), so the
 * stage form carries no commit control of its own. The two are separate hydration roots and share
 * the draft through `core/setup-state.ts`, which is also where the writes live — the rig presses an
 * intent, it does not know what a `PATCH` is.
 *
 * **Save and Discard, and deliberately nothing else.** Publish and Archive belong to the ENGAGEMENT,
 * not to one stage: publishing from inside a stage would put the whole project in front of
 * freelancers as a side effect of finishing one piece of its configuration, and archiving would
 * retire the project from a page whose entire subject is a part of it. Both stay on
 * `/projects/[projectId]`, where what they act on is what the reader is looking at.
 *
 * The auto-save MODE switch stays there too, for the same reason inverted: it is a device-wide
 * preference about how editing behaves, not an action on this stage. It is still honoured here —
 * `useSetupAutoSave` in the body adopts the stored value — so an owner who turned it on gets it on
 * both surfaces; they simply change it in one place.
 *
 * Save and Discard appear only while there is something to save or discard, which is the same rule
 * the project rig follows. The status line stays either way, so the band is never an empty strip and
 * "nothing to do" is stated rather than left to be inferred from an absence.
 */

// #region Props
/** Props for {@link StageDetailsRig}. */
export interface StageDetailsRigProps {
	/**
	 * The server-resolved configuration; the live draft supersedes it once the body has hydrated.
	 *
	 * The whole project rather than the stage, because the dirty flag is measured over a whole
	 * configuration — the write path is the project's own `PATCH`, so an edit anywhere in it is an
	 * edit this rig has to be able to send.
	 */
	setup: ProjectSetup;
}
// #endregion

/** One rig control, resolved from the live draft. */
interface RigAction {
	key: string;
	label: string;
	icon: JSX.Element;
	/** Renders but refuses, with `reason` naming what is outstanding. */
	locked: boolean;
	reason: string;
	/** Leading emphasis (at most one on the row, §B.8.2). */
	tone: "primary" | "tonal";
	run: () => void;
}

export default function StageDetailsRig({ setup }: StageDetailsRigProps): JSX.Element {
	/** Ctrl+S / Cmd+S, shared with the project rig so the shortcut behaves the same on both. */
	useSaveShortcut();

	const live = setupDraft.value ?? currentSetup(setup);
	const dirty = setupDirty.value;
	const saving = setupSaving.value;

	const actions: RigAction[] = dirty
		? [
			{
				key: "save",
				label: "Save",
				icon: <Icon name="check" />,
				locked: saving,
				reason: "Saving…",
				tone: "primary",
				run: () => void requestSave(),
			},
			{
				key: "discard",
				label: "Discard",
				icon: <Icon name="refresh" />,
				locked: saving,
				reason: "Saving…",
				tone: "tonal",
				run: discardSetup,
			},
		]
		: [];

	/*
	 * The archived case is stated rather than hidden. Every control in the body still edits the local
	 * draft — reading and comparing a configuration is a legitimate thing to do with a project out of
	 * circulation — but the store refuses the write, so a band that silently offered Save would be
	 * offering something that cannot happen.
	 */
	const status = live.archivedAt !== null
		? "Archived — changes can no longer be saved"
		: saving
		? "Saving…"
		: dirty
		? "Unsaved changes"
		: "All changes saved";

	return (
		<div class="proj-sdrig">
			{
				/*
				 * Not a live region: the body already announces every save outcome through the shared toast
				 * stack, and a second region reporting the same event announces it twice.
				 */
			}
			<p class="proj-sdrig__status">{status}</p>

			<div class="proj-sdrig__actions">
				{actions.map((action) => (
					/*
					 * The label is visible at the wide tier and moves to the tooltip at the narrow one, so a
					 * `Tooltip` is wrapped unconditionally rather than only when the glyph stands alone
					 * (§B.6.3). A locked control keeps it too, because the reason is the only place the
					 * refusal is explained.
					 */
					<Tooltip
						key={action.key}
						content={action.locked ? action.reason : action.label}
						placement="top"
					>
						<button
							type="button"
							class="proj-sdrig__action"
							data-tone={action.tone}
							data-locked={action.locked ? "true" : "false"}
							aria-disabled={action.locked ? "true" : undefined}
							aria-label={action.label}
							onClick={() => {
								if (action.locked) return;
								action.run();
							}}
						>
							<span class="proj-sdrig__glyph" aria-hidden="true">{action.icon}</span>
							<span class="proj-sdrig__label">{action.label}</span>
						</button>
					</Tooltip>
				))}
			</div>
		</div>
	);
}
