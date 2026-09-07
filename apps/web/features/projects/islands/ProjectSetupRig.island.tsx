import type { JSX, VNode } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/project-setup.css";
import { ConfirmDialog, Popover, Tooltip } from "@projective/ui/feedback";
import { ToggleSwitch } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
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
	setupSaving,
	setupSavedAt,
} from "../core/setup-state.ts";

/**
 * ProjectSetupRig — the owner's middle-nav FOOTER band on `/projects/[projectId]`: Save · Discard ·
 * Publish, and a kebab holding those plus Archive.
 *
 * The band owns every action and the body owns viewing and editing (DESIGN_SYSTEM Part D), so the
 * form carries no commit control of its own. The two are separate hydration roots and share the draft
 * through `core/setup-state.ts`, which is also where the writes live — the rig presses an intent, it
 * does not know what a PATCH is.
 *
 * **The menu holds every action at every tier.** The inline cluster is a shortcut for the leading
 * few, never the only route: hiding actions 3-n behind a width rule with no menu to recover them is
 * how `/wallet` lost three money controls on four pages, and the same rule here would strand an owner
 * on a phone with a project they cannot publish. `container-type: inline-size` on the rig root makes
 * the tier switch a container query rather than a client width observer, and stops the band bidding
 * for the nav lane's width.
 *
 * The two gates behave differently on purpose. **Publish is absent once the project is live** —
 * publishing something already published is not a thing the owner can do, and absence is how a
 * capability that does not apply is expressed. **Publish is locked, not absent, while a required
 * step is outstanding** — the capability is theirs and the tooltip names what is missing, so the
 * control teaches the path instead of hiding it. Save and Discard appear only while there is
 * something to save or discard.
 *
 * **Publish confirms first, and Archive is not the reason.** Publishing is not destructive — the
 * owner can keep editing afterwards — so the dialog is not a "are you sure" speed bump. It exists
 * because publishing is the moment the ONBOARDING LOCKS become reachable: from the first freelancer
 * hired against this project the type freezes and the prices begin to freeze stage by stage, and a
 * term the owner discovers is frozen is a term they were never told they were fixing. The dialog is
 * where that is said, once, while it is still free to change. `acceptSeverity` therefore stays the
 * default `primary`: a red button here would report a consequence the action does not have.
 *
 * The notices are mapped from {@link PUBLISH_LOCK_NOTICES} rather than typed into the JSX, because
 * the same module exports the predicates the write path enforces. Restating them here would let the
 * dialog promise a lock the server does not apply, and the drift would only ever be discovered by an
 * owner who read the promise and then hit the refusal.
 */
export interface ProjectSetupRigProps {
	/** The server-resolved configuration; the live draft supersedes it once the body has hydrated. */
	setup: ProjectSetup;
}

/** One rig control, resolved from the live draft. */
interface RigAction {
	key: string;
	label: string;
	icon: VNode;
	/** Renders but refuses, with `reason` naming what is outstanding. */
	locked: boolean;
	reason: string;
	/** Leading emphasis (at most one) or a destructive tone. */
	tone: "primary" | "tonal" | "danger";
	run: () => void;
}

export default function ProjectSetupRig({ setup }: ProjectSetupRigProps): JSX.Element {
	const menuOpen = useSignal(false);
	const confirmArchive = useSignal(false);
	const confirmPublish = useSignal(false);
	const menuRef = useRef<HTMLButtonElement>(null);

	/**
	 * Adopt the device's auto-save preference.
	 *
	 * In an effect, not at render: `localStorage` does not exist on the server, and a device with it
	 * disabled would otherwise paint one state and hydrate to another.
	 */
	useEffect(hydrateAutoSave, []);

	/** Ctrl+S / Cmd+S, shared with the single-stage rig so the shortcut behaves the same on both. */
	useSaveShortcut();

	/** Advances on its own so the auto-save line ages rather than freezing at "just now". */
	const now = useRelativeClock();

	const live = setupDraft.value ?? currentSetup(setup);
	const dirty = setupDirty.value;
	const saving = setupSaving.value;
	const isDraft = live.status === "draft";
	const autoSave = autoSaveEnabled.value;
	const online = isOnline.value;
	const queued = setupQueued.value;

	/*
	 * Under auto-save there is no Save and no Discard.
	 *
	 * Not "disabled", and not "hidden but still in the menu": a control whose entire job has been
	 * taken over by a mode is a control that no longer exists, and the honest expression of a
	 * capability that does not apply is ABSENCE — the same rule Publish already follows once a project
	 * is live. Discard goes with Save deliberately, even though it would still technically do
	 * something. Its meaning is "do not send this", and under auto-save the edit has already gone, so
	 * a button offering to withdraw it would be describing a state the surface is no longer in.
	 *
	 * What replaces them is the status line, which is why that line grows a timestamp in this mode
	 * rather than staying a bare "All changes saved" — with no control to press, the only useful thing
	 * the band can say is when the last edit actually landed.
	 */
	const showSaveControls = dirty && !autoSave;

	const close = () => {
		menuOpen.value = false;
	};

	const actions: RigAction[] = [];

	if (showSaveControls) {
		actions.push({
			key: "save",
			label: "Save",
			icon: <Icon name="check" />,
			locked: saving,
			reason: "Saving…",
			tone: "primary",
			run: () => {
				close();
				void requestSave();
			},
		});
		actions.push({
			key: "discard",
			label: "Discard",
			icon: <Icon name="refresh" />,
			locked: saving,
			reason: "Saving…",
			tone: "tonal",
			run: () => {
				close();
				discardSetup();
			},
		});
	}

	if (isDraft) {
		actions.push({
			key: "publish",
			label: "Publish",
			icon: <Icon name={live.previewReady ? "upload" : "lock"} />,
			locked: !live.previewReady || saving,
			reason: live.previewReady
				? "Saving…"
				: `Finish ${
					live.steps.filter((s) => s.required && !s.done).map((s) => s.label).join(" · ")
				} to publish.`,
			// Leading emphasis goes to Save while Save is on screen. Under auto-save it is not, so
			// Publish is the band's one primary rather than deferring to a control that is absent.
			tone: showSaveControls ? "tonal" : "primary",
			// Opens the confirmation; the write is behind `onAccept`. The `locked` test in `control`
			// runs BEFORE this, so a Publish that is still waiting on a required step refuses on press
			// and never reaches the dialog — the reason stays in the tooltip, where the outstanding
			// steps are named, rather than being restated by a modal the owner cannot act on.
			run: () => {
				close();
				confirmPublish.value = true;
			},
		});
	}

	actions.push({
		key: "archive",
		label: "Archive project",
		icon: <Icon name="archive-box" />,
		locked: saving,
		reason: "Saving…",
		tone: "danger",
		run: () => {
			close();
			confirmArchive.value = true;
		},
	});

	/** The inline cluster shows everything except the destructive row, which lives in the menu only. */
	const inline = actions.filter((a) => a.tone !== "danger");

	const control = (action: RigAction, inMenu: boolean) => {
		const button = (
			<button
				type="button"
				class="psu-rig__action"
				data-tone={action.tone}
				data-locked={action.locked ? "true" : "false"}
				aria-disabled={action.locked ? "true" : undefined}
				aria-label={action.label}
				role={inMenu ? "menuitem" : undefined}
				onClick={() => {
					if (action.locked) return;
					action.run();
				}}
			>
				<span class="psu-rig__glyph" aria-hidden="true">{action.icon}</span>
				<span class="psu-rig__label">{action.label}</span>
			</button>
		);
		// In the menu the name is always visible, so a tooltip would only repeat it.
		return inMenu ? <span key={action.key}>{button}</span> : (
			<Tooltip
				key={action.key}
				content={action.locked ? action.reason : action.label}
				placement="top"
			>
				{button}
			</Tooltip>
		);
	};

	/*
	 * Resolved by the shared rule, so this band and the single-stage band cannot tell an owner two
	 * different things about the same unsaved edit.
	 *
	 * The draft-status sentence this replaces ("Draft — not visible to freelancers") is dropped rather
	 * than folded in: it describes the PROJECT's lifecycle, not whether the owner's typing has been
	 * persisted, and the header band's ladder plus the Publish control already carry it. One line
	 * answering two unrelated questions is a line that can only ever answer one of them at a time.
	 */
	const status = resolveSaveStatus({
		saving,
		dirty,
		queued,
		online,
		archived: live.archivedAt !== null,
		autoSave,
		savedAt: setupSavedAt.value,
		now: now.value,
	});

	return (
		<div class="psu-rig">
			{
				/*
				 * Not a live region: the body already announces the outcome of a save through the shared
				 * toast stack, and a second region reporting the same event announces it twice.
				 *
				 * `data-tone` selects a MARK, never a colour on its own (§A.5) — and the sentence carries
				 * the whole fact regardless, so a reader who sees neither the mark nor the tint loses
				 * nothing.
				 */
			}
			<p class="psu-rig__status" data-tone={status.tone}>
				{(status.tone === "offline" || status.tone === "archived") && (
					<span class="psu-rig__statusmark" aria-hidden="true">
						<Icon name={status.tone === "offline" ? "cloud-off" : "archive-box"} size="xs" />
					</span>
				)}
				{status.label}
			</p>

			{
				/*
				 * A MODE, not an action, so it sits with the status rather than in the action cluster and
				 * stays out of the kebab — a menu of things to do is the wrong home for a preference about
				 * how the surface behaves. Its name is visually hidden below the glyph tier alongside every
				 * other label here; the `<label for>` association survives that, so the switch keeps its
				 * accessible name, and the tooltip restates it for sighted readers (§B.6.3).
				 */
			}
			<Tooltip
				content={autoSaveEnabled.value
					? "Auto-save is on — edits save when a field loses focus"
					: "Auto-save is off — save with the button or Ctrl+S"}
				placement="top"
			>
				<span class="psu-rig__autosave">
					{
						/*
						 * The SIGNAL, not `autoSaveEnabled.value`. `useControllable` reads a raw value as
						 * UNCONTROLLED and seeds its own internal signal once on mount with empty deps, so a
						 * later prop change is ignored by construction — the switch would keep whatever it
						 * mounted with. Measured: the stored preference was `1`, `hydrateAutoSave` set the
						 * store to `true`, and the switch still rendered `aria-checked="false"` on every
						 * reload, so a device that had turned auto-save on came back with it apparently off
						 * while the store believed it was on.
						 */
					}
					<ToggleSwitch
						size="sm"
						label="Auto-save"
						value={autoSaveEnabled}
						onValueChange={setAutoSave}
					/>
				</span>
			</Tooltip>

			<div class="psu-rig__actions">
				{inline.map((action) => control(action, false))}
			</div>

			{
				/*
				 * No `onClick`, and no `aria-haspopup`/`aria-expanded` of its own.
				 *
				 * `Popover` binds its OWN `click → toggle()` to whatever it is given as `targetRef`, and
				 * writes both attributes itself. A handler here as well fires on the same press, so the
				 * two toggles cancelled and the menu could never open — which mattered more than it
				 * sounds, because Archive is a menu-only action, so the only destructive control on this
				 * surface had no reachable route to it at all.
				 */
			}
			<Tooltip content="All project actions" placement="top">
				<button
					type="button"
					class="psu-rig__more"
					ref={menuRef}
					aria-label="All project actions"
				>
					<span class="psu-rig__glyph" aria-hidden="true">
						<Icon name="kebab" />
					</span>
					<span class="psu-rig__more-label">Actions</span>
				</button>
			</Tooltip>

			<Popover open={menuOpen} targetRef={menuRef} placement="top-end">
				<div class="psu-rig__menu" role="menu">
					{actions.map((action) => control(action, true))}
				</div>
			</Popover>

			{
				/*
				 * No `onReject`. `ConfirmDialog` routes Escape, the backdrop and the × through
				 * `onVisibleChange` to `onReject`, so dismissal is already rejection — and rejection here
				 * has nothing to undo, because nothing was written on the way in. Passing a handler would
				 * only be a place for a future edit to grow a side effect on the cancel path.
				 */
			}
			<ConfirmDialog
				visible={confirmPublish}
				header="Publish Project"
				message={
					<div class="psu-rig__publish">
						<p class="psu-rig__publish-lead">
							Publishing "{live.title || "this project"}" opens it to freelancers. Some of its terms
							are frozen from the moment the first one joins:
						</p>
						{
							/*
							 * Keyed on the sentence rather than the index: the list is a frozen constant, so the
							 * text IS the stable identity, and an index key would silently reuse a row if the
							 * order of the notices ever changed.
							 */
						}
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
