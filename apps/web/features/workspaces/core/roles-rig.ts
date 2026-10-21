import { signal } from "@preact/signals";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import type { RigAction, RolesSaveState } from "./roles-model.ts";

/**
 * roles-rig — the seam between the Roles body (`WorkspaceRoles.island.tsx`) and its middle-nav footer
 * band (`RolesFooterRig.island.tsx`), which are separate hydration roots (Decision #321). The body
 * PUBLISHES what the footer draws — the selected role's actions, where its edits stand, the last
 * word — and REGISTERS the commands the footer's controls run; the footer only reads and calls.
 *
 * Module-level signals, the same seam `workspace-state.ts` gives the header band's commit: both
 * islands import this one module, so they share its instances.
 */

// #region What the body publishes
/** The selected role, as the footer needs it. */
export interface RolesRigView {
	/** The selected role's name — the subject of the archive confirmation. */
	name: string;
	/** `rigActions` for it. */
	actions: RigAction[];
	/** An archive is in flight: every action waits. */
	busy: boolean;
}

/** The selected role's footer view, or `null` before the body hydrates or with nothing selected. */
export const rolesRig = signal<RolesRigView | null>(null);

/** Where the permission edits stand. */
export const rolesSaveState = signal<RolesSaveState>("saved");

/** When the last save landed (epoch ms), or `null` — none this visit. */
export const rolesSavedAt = signal<number | null>(null);

/** The last thing that happened ("QA Reviewer created", a refusal); the footer shows it for a while. */
export const rolesNotice = signal<string | null>(null);
// #endregion

// #region What the footer runs
/** The commands the body registers for the footer's controls. */
export interface RolesRigCommands {
	act: (action: RigAction["key"]) => void;
	saveNow: () => void;
	discard: () => void;
}

/** The registered commands, or `null` before the body hydrates (the footer's controls wait). */
export const rolesCommands = signal<RolesRigCommands | null>(null);
// #endregion

// #region Auto-save
/** Whether a permission switch saves itself — ON unless this device turned it off. */
export const rolesAutoSave = signal(true);

/** Read the device preference — called once the body hydrates, never during SSR. */
export function loadRolesAutoSave(): void {
	rolesAutoSave.value = readStored("local", LocalKeys.WORKSPACE_ROLES_AUTOSAVE) !== "0";
}

/** The footer's Auto-save switch: remember it on this device. */
export function setRolesAutoSave(enabled: boolean): void {
	rolesAutoSave.value = enabled;
	writeStored("local", LocalKeys.WORKSPACE_ROLES_AUTOSAVE, enabled ? "1" : "0");
}
// #endregion
