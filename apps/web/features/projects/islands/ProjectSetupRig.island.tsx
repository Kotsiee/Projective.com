import type { JSX, VNode } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/project-setup.css";
import { ConfirmDialog, Popover, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { ProjectSetup } from "../types/projects-types.ts";
import {
	archiveSetup,
	currentSetup,
	discardSetup,
	publishSetup,
	saveSetup,
	setupDirty,
	setupDraft,
	setupSaving,
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
	const menuRef = useRef<HTMLButtonElement>(null);

	const live = setupDraft.value ?? currentSetup(setup);
	const dirty = setupDirty.value;
	const saving = setupSaving.value;
	const isDraft = live.status === "draft";

	const close = () => {
		menuOpen.value = false;
	};

	const actions: RigAction[] = [];

	if (dirty) {
		actions.push({
			key: "save",
			label: "Save",
			icon: <Icon name="check" />,
			locked: saving,
			reason: "Saving…",
			tone: "primary",
			run: () => {
				close();
				void saveSetup();
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
			tone: dirty ? "tonal" : "primary",
			run: () => {
				close();
				void publishSetup();
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

	const status = saving
		? "Saving…"
		: dirty
		? "Unsaved changes"
		: isDraft
		? "Draft — not visible to freelancers"
		: "All changes saved";

	return (
		<div class="psu-rig">
			{
				/*
				 * Not a live region: the body already announces the outcome of a save through its own
				 * `Message`, and a second region reporting the same event announces it twice.
				 */
			}
			<p class="psu-rig__status">{status}</p>

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
