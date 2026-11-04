import type { JSX, RefObject } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type {
	SchedulerContextTarget,
	SchedulerRuleDraft,
	SchedulerStore,
} from "@projective/ui/calendar";
import { ActionMenu, type MenuItem } from "@projective/ui/navigation";
import { SCHEDULER_TEMPLATES } from "@features/catalogue/core/scheduler-engine.ts";
import {
	availabilityBusy,
	duplicateWorking,
	isUnsaved,
	newPreset,
	working,
} from "@features/catalogue/core/availability-store.ts";
import { discardDraft, hasPending, saveDraft } from "../core/availability-draft.ts";

/**
 * AvailabilityMenus — the right-click menus of `/calendar?view=availability` (Decision #380). The grid
 * and the panel share one set of rows: over a rule (a band on the grid, a card in the panel) that
 * rule's Edit · Duplicate · Delete; anywhere else Add new rule (on the slot right-clicked, when there
 * is one) · Undo · Redo · Save changes · Discard changes. They are `ActionMenu` surfaces, so every
 * panel portals to the body, takes its depth from the overlay stack, clamps to the viewport and
 * closes on Escape or an outside press, and the keyboard's ContextMenu key and Shift+F10 open them too.
 */

// #region Rows
const SUNDAY_UTC = Date.UTC(2023, 0, 1);

/**
 * Where a slot is, as one Meta line: "Tuesday · 14:30", or "Tuesday" for a whole Month day. In the
 * product's language, as the calendar's other weekday names are.
 */
export function slotHint(slot: NonNullable<SchedulerContextTarget["slot"]>): string {
	const day = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" })
		.format(SUNDAY_UTC + slot.day * 86_400_000);
	if (slot.minute === null) return day;
	const time = new Intl.DateTimeFormat("en-GB", {
		hour: "2-digit",
		minute: "2-digit",
		timeZone: "UTC",
	}).format(SUNDAY_UTC + slot.minute * 60_000);
	return `${day} · ${time}`;
}

/** The open template's workspace rows; `slot` is the empty grid slot right-clicked, if any. */
export function workspaceRows(
	store: SchedulerStore,
	slot: SchedulerContextTarget["slot"],
): MenuItem[] {
	const open = working.value;
	const dirty = open ? isUnsaved(open) : false;
	const busy = availabilityBusy.value;
	return [
		{
			key: "add",
			label: "Add new rule",
			hint: slot ? slotHint(slot) : undefined,
			command: () =>
				store.dispatch(
					slot
						? { type: "addRule", day: slot.day, minute: slot.minute ?? undefined }
						: { type: "addRule" },
				),
		},
		{ separator: true },
		{
			key: "undo",
			label: "Undo",
			shortcut: "Ctrl+Z",
			disabled: !store.canUndo.value,
			disabledReason: "Nothing to undo",
			command: () => store.undo(),
		},
		{
			key: "redo",
			label: "Redo",
			shortcut: "Ctrl+Shift+Z",
			disabled: !store.canRedo.value,
			disabledReason: "Nothing to redo",
			command: () => store.redo(),
		},
		{ separator: true },
		{
			key: "save",
			label: "Save changes",
			disabled: !dirty || busy,
			disabledReason: busy ? "Saving…" : "This template has no unsaved changes",
			command: () => void saveDraft(),
		},
		{
			key: "discard",
			label: "Discard changes",
			disabled: !hasPending() || busy,
			disabledReason: busy ? "Saving…" : "Nothing to discard",
			command: discardDraft,
		},
	];
}

/** One rule's rows. */
export function ruleRows(store: SchedulerStore, rule: SchedulerRuleDraft): MenuItem[] {
	return [
		{
			key: "edit",
			label: "Edit rule",
			command: () => store.dispatch({ type: "edit", ruleId: rule.id }),
		},
		{
			key: "duplicate",
			label: "Duplicate rule",
			command: () => store.dispatch({ type: "duplicateRule", ruleId: rule.id }),
		},
		{ separator: true },
		{
			key: "delete",
			label: "Delete rule",
			danger: true,
			command: () => store.deleteRule(rule.id, rule.label || undefined),
		},
	];
}

/** New template's choices: a copy of the open one, or one of the starting points. */
export function newTemplateItems(zone: string): MenuItem[] {
	const open = working.value;
	return [
		{
			key: "copy",
			label: `Copy of ${open?.name ?? "this template"}`,
			disabled: !open,
			disabledReason: "Open a template first",
			command: duplicateWorking,
		},
		...SCHEDULER_TEMPLATES.map((t): MenuItem => ({
			key: t.key,
			label: t.name,
			command: () => newPreset(t, zone),
		})),
	];
}
// #endregion

// #region Surface
/** Props for {@link SchedulerMenu}. */
export interface SchedulerMenuProps {
	store: SchedulerStore;
	/** The region whose right-click opens the rows. */
	surface: RefObject<HTMLElement>;
	/**
	 * What the grid inside reported (`AvailabilityScheduler.Calendar`'s `onContextTarget`). Cleared
	 * before each right-click reaches the grid, so a stale target never outlives the press.
	 */
	target?: Signal<SchedulerContextTarget | null>;
}

/** The availability rows bound to a region: a rule's over a band or a card, else the workspace's. */
export function SchedulerMenu(props: SchedulerMenuProps): JSX.Element {
	const own = useSignal<SchedulerContextTarget | null>(null);
	const target = props.target ?? own;

	// Capture phase: runs before the grid's own report, so the grid overwrites it where it has one.
	useEffect(() => {
		const el = props.surface.current;
		if (!el) return;
		const resolve = (e: Event) => {
			const card = e.target instanceof Element ? e.target.closest("[data-rule-id]") : null;
			target.value = card ? { ruleId: card.getAttribute("data-rule-id"), slot: null } : null;
		};
		el.addEventListener("contextmenu", resolve, true);
		return () => el.removeEventListener("contextmenu", resolve, true);
	}, [props.surface.current]);

	const t = target.value;
	const rule = t?.ruleId ? props.store.draft.value.rules.find((r) => r.id === t.ruleId) : undefined;
	return (
		<ActionMenu
			model={rule ? ruleRows(props.store, rule) : workspaceRows(props.store, t?.slot ?? null)}
			surface={props.surface}
			aria-label={rule ? "Rule actions" : "Availability actions"}
		/>
	);
}
// #endregion
