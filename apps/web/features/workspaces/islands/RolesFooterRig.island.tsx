import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import "../styles/workspace.css";
import { SaveStatus, Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon, type IconName } from "@projective/ui/icons";
import {
	type RigAction,
	type RolesSaveAction,
	rolesSaveLabel,
	type RolesSaveState,
	rolesTierProps,
} from "../core/roles-model.ts";
import {
	rolesAutoSave,
	rolesCommands,
	rolesNotice,
	rolesRig,
	rolesSavedAt,
	rolesSaveState,
	setRolesAutoSave,
} from "../core/roles-rig.ts";

/**
 * RolesFooterRig — the Roles module's middle-nav FOOTER band (Decision #321), the catalogue listing
 * workspace's rig (`ListingActionRig`, Decision #304) applied to roles. At the start, the shared
 * `SaveStatus`: the Auto-save switch, then a pip and "Saved · 12s ago" · "Saving…" · "Unsaved changes"
 * · "Couldn't save", with Save now / Discard (auto-save off) or Retry / Discard beside it; the last
 * thing that happened ("QA Reviewer created") replaces the sentence for a few seconds. At the end, the
 * selected role's actions as neutral outlined circles, each with a Tooltip: Edit role details,
 * Duplicate role, Archive role — or, on a preset, Clone as custom role alone. A refused action stays
 * focusable and its Tooltip says why; it never fails on press.
 *
 * Dumb: it reads what the body publishes through `core/roles-rig.ts` and calls the commands the body
 * registered. Mounted for `manage_roles` holders only (`workspace-footer-slot.tsx`).
 */

/** How long the last word replaces the save sentence. */
const NOTICE_MS = 6_000;

/** How often "Saved · 12s ago" ticks. */
const TICK_MS = 5_000;

/** What the live region says on a state change (the ticking timestamp is never re-read). */
const ANNOUNCE: Readonly<Record<RolesSaveState, string>> = {
	saved: "Saved",
	dirty: "",
	saving: "Saving",
	error: "Couldn't save",
};

const SAVE_ACTION_LABEL: Readonly<Record<RolesSaveAction, string>> = {
	save: "Save now",
	discard: "Discard",
	retry: "Retry",
};

const ACTION_ICON: Readonly<Record<RigAction["key"], IconName>> = {
	edit: "edit",
	duplicate: "copy",
	archive: "archive-box",
};

export default function RolesFooterRig(): JSX.Element {
	const now = useSignal(Date.now());
	const shown = useSignal<string | null>(null);

	useSignalEffect(() => {
		const tick = setInterval(() => (now.value = Date.now()), TICK_MS);
		return () => clearInterval(tick);
	});

	useSignalEffect(() => {
		const message = rolesNotice.value;
		shown.value = message;
		if (!message) return;
		const timer = setTimeout(() => {
			if (rolesNotice.peek() === message) rolesNotice.value = null;
		}, NOTICE_MS);
		return () => clearTimeout(timer);
	});

	const state = rolesSaveState.value;
	const label = rolesSaveLabel(state, rolesSavedAt.value, now.value, rolesAutoSave.value);
	const commands = rolesCommands.value;
	const view = rolesRig.value;
	const saveActions = shown.value || !commands ? [] : label.actions.map((action) => ({
		label: SAVE_ACTION_LABEL[action],
		onAction: action === "discard" ? commands.discard : commands.saveNow,
	}));

	return (
		<div class="wsp-roles-rig">
			<SaveStatus
				state={state}
				text={shown.value ?? label.text}
				announce={shown.value ?? ANNOUNCE[state]}
				actions={saveActions}
				autoSave={{
					value: rolesAutoSave,
					onChange: setRolesAutoSave,
					hint: rolesAutoSave.value
						? "Auto-save is on — a permission saves as you switch it"
						: "Auto-save is off — save with Save now",
				}}
			/>

			{view && view.actions.length > 0 && (
				<div class="wsp-roles-rig__actions" role="group" aria-label={`${view.name} actions`}>
					{view.actions.map((action) => {
						const refused = action.disabledReason !== null;
						const tip = refused ? `${action.label} — ${action.disabledReason}` : action.label;
						return (
							<Tooltip key={action.key} content={tip} placement="top">
								<Button
									{...rolesTierProps(4)}
									rounded
									iconOnly
									size="sm"
									class="wsp-roles-rig__icon ui-hit"
									aria-label={tip}
									aria-disabled={refused || view.busy || !commands || undefined}
									icon={<Icon name={ACTION_ICON[action.key]} size="sm" />}
									loading={view.busy && action.key === "archive"}
									onClick={() => {
										if (!refused && !view.busy) commands?.act(action.key);
									}}
								/>
							</Tooltip>
						);
					})}
				</div>
			)}
		</div>
	);
}
