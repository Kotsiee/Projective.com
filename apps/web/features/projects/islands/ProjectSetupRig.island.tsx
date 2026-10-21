import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/project-setup.css";
import { ConfirmDialog, SaveStatus, type SaveStatusAction, Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon, type IconName } from "@projective/ui/icons";
import { type ProjectSetup, PUBLISH_LOCK_NOTICES } from "../types/projects-types.ts";
import { useSaveShortcut } from "../hooks/useSaveShortcut.ts";
import { useRelativeClock } from "../hooks/useRelativeClock.ts";
import { resolveSaveStatus } from "../core/save-status.ts";
import {
	archiveSetup,
	autoSaveEnabled,
	currentSetup,
	discardSetup,
	hydrateAutoSave,
	isOnline,
	publishSetup,
	requestSave,
	setAutoSave,
	setupDirty,
	setupDraft,
	setupQueued,
	setupSavedAt,
	setupSaving,
} from "../core/setup-state.ts";

/**
 * ProjectSetupRig — the owner's middle-nav FOOTER band on `/projects/[slug]/details`, drawn like the
 * catalogue workspace's (`ListingActionRig`, Decision #304): at the start the shared
 * {@link SaveStatus} — the Auto-save switch, the pip and sentence, and Save now (plus Discard while
 * auto-save is off) as text actions beside an unsaved edit; at the end Archive as a neutral outlined
 * circle named by a Tooltip, and Publish, the one filled commit, icon and text (Decision #310).
 *
 * The band owns every action and the body owns viewing and editing (DESIGN_SYSTEM Part D), so the
 * form carries no commit control of its own. The two are separate hydration roots and share the draft
 * through `core/setup-state.ts`, which is also where the writes live — the rig presses an intent, it
 * does not know what a PATCH is. Every control is inline at every width: the secondaries are already
 * glyphs, so nothing needs a menu to stay reachable on a phone.
 *
 * **Publish is absent once the project is live**, and for a personal project, which is never listed.
 * **Publish is locked, not absent, while a required step is outstanding** — it keeps its lock glyph,
 * stays focusable, refuses on press and names what is missing in its Tooltip, so the control teaches
 * the path instead of hiding it.
 *
 * **Publish confirms first.** Publishing is the moment the ONBOARDING LOCKS become reachable: from the
 * first freelancer hired the type freezes and the prices begin to freeze stage by stage. The dialog
 * says so once, from {@link PUBLISH_LOCK_NOTICES} — the same module whose predicates the write path
 * enforces — while it is still free to change.
 */
export interface ProjectSetupRigProps {
	/** The server-resolved configuration; the live draft supersedes it once the body has hydrated. */
	setup: ProjectSetup;
}

function RigIcon(props: {
	label: string;
	icon: IconName;
	loading?: boolean;
	disabled?: boolean;
	onClick: () => void;
}): JSX.Element {
	return (
		<Tooltip content={props.label} placement="top">
			<Button
				rounded
				iconOnly
				size="sm"
				severity="neutral"
				variant="outlined"
				class="psu-rig__icon ui-hit"
				aria-label={props.label}
				icon={<Icon name={props.icon} size="sm" />}
				loading={props.loading}
				disabled={props.disabled}
				onClick={props.onClick}
			/>
		</Tooltip>
	);
}

export default function ProjectSetupRig({ setup }: ProjectSetupRigProps): JSX.Element {
	const confirmArchive = useSignal(false);
	const confirmPublish = useSignal(false);

	/** Adopt the device's auto-save preference after mount; `localStorage` does not exist on the server. */
	useEffect(hydrateAutoSave, []);

	/** Ctrl+S / Cmd+S, shared with the single-stage rig so the shortcut behaves the same on both. */
	useSaveShortcut();

	/** Ticks as often as the catalogue's line, which counts seconds. */
	const now = useRelativeClock(5_000);

	const live = setupDraft.value ?? currentSetup(setup);
	const dirty = setupDirty.value;
	const saving = setupSaving.value;
	const autoSave = autoSaveEnabled.value;
	const archived = live.archivedAt !== null;
	const canPublish = live.status === "draft" && !live.personal;
	const publishLocked = !live.previewReady || saving;
	const publishReason = live.previewReady
		? "Saving…"
		: `Finish ${
			live.steps.filter((s) => s.required && !s.done).map((s) => s.label).join(" · ")
		} to publish.`;

	const status = resolveSaveStatus({
		saving,
		dirty,
		queued: setupQueued.value,
		online: isOnline.value,
		archived,
		savedAt: setupSavedAt.value,
		now: now.value,
	});

	const saveActions: SaveStatusAction[] = [];
	if (dirty && !saving && !archived && isOnline.value) {
		saveActions.push({ label: "Save now", onAction: () => void requestSave() });
	}
	if (dirty && !saving && !autoSave) {
		saveActions.push({ label: "Discard", onAction: discardSetup });
	}

	const publishButton = (
		<Button
			size="sm"
			label="Publish"
			icon={<Icon name={live.previewReady ? "upload" : "lock"} size="sm" />}
			loading={saving && live.previewReady}
			aria-disabled={publishLocked}
			class="psu-rig__commit"
			data-locked={publishLocked ? "true" : undefined}
			onClick={() => {
				if (publishLocked) return;
				confirmPublish.value = true;
			}}
		/>
	);

	return (
		<div class="psu-rig">
			{/* No `announce`: the body already reports a save's outcome through the toast stack. */}
			<SaveStatus
				state={status.pip}
				text={status.label}
				actions={saveActions}
				autoSave={{
					value: autoSaveEnabled,
					onChange: setAutoSave,
					hint: autoSave
						? "Auto-save is on — edits save when a field loses focus"
						: "Auto-save is off — save with Save now or Ctrl+S",
				}}
			/>

			<div class="psu-rig__actions">
				{!archived && (
					<RigIcon
						label="Archive project"
						icon="archive-box"
						disabled={saving}
						onClick={() => (confirmArchive.value = true)}
					/>
				)}
				{canPublish && (publishLocked
					? (
						<Tooltip content={publishReason} placement="top">
							{publishButton}
						</Tooltip>
					)
					: publishButton)}
			</div>

			<ConfirmDialog
				visible={confirmPublish}
				header="Publish Project"
				message={
					<div class="psu-rig__publish">
						<p class="psu-rig__publish-lead">
							Publishing "{live.title || "this project"}" opens it to freelancers. Some of its terms
							are frozen from the moment the first one joins:
						</p>
						<ul class="psu-rig__publish-notices">
							{PUBLISH_LOCK_NOTICES.map((notice) => <li key={notice}>{notice}</li>)}
						</ul>
					</div>
				}
				acceptLabel="Publish Project"
				rejectLabel="Cancel"
				onAccept={() => {
					void publishSetup();
				}}
			/>

			<ConfirmDialog
				visible={confirmArchive}
				header="Archive this project?"
				message={`"${
					live.title || "This project"
				}" leaves circulation and stops accepting applications. Its history, tickets and files are kept.`}
				acceptLabel="Archive project"
				rejectLabel="Keep it"
				acceptSeverity="danger"
				onAccept={() => {
					void archiveSetup();
				}}
			/>
		</div>
	);
}
