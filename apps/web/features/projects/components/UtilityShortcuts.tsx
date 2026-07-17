import type { JSX, VNode } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { HourglassIcon, MailIcon, RevisionIcon, StarIcon, TicketIcon } from "./glyphs.tsx";
import type { ProjectQuickFilter } from "../types/projects-types.ts";

/**
 * UtilityShortcuts — the permanent quick-filter row that sits right above the content list. The
 * high-frequency involvement modifiers (Starred · Unread · New tickets · Revision requested · Pending
 * review) are icon-only toggles for instantaneous feedback, each described by a floating
 * `@projective/ui` {@link Tooltip}. At the far end, the "All my involvement" plain-text button is the
 * Sovereign global-scope escape hatch — one tap to sweep every engagement across all active tenants,
 * one tap back. No pills, no borders; the row stays quiet until engaged.
 */

/** The permanent quick-filter toggles, in display order (icon + tooltip/aria label). */
const QUICK_TOGGLES: readonly { key: ProjectQuickFilter; tip: string; icon: VNode }[] = [
	{ key: "starred", tip: "Starred", icon: StarIcon },
	{ key: "unread", tip: "Unread", icon: MailIcon },
	{ key: "new_ticket", tip: "New tickets", icon: TicketIcon },
	{ key: "revision_requested", tip: "Revision requested", icon: RevisionIcon },
	{ key: "pending_review", tip: "Pending review", icon: HourglassIcon },
];

export interface UtilityShortcutsProps {
	quick: readonly ProjectQuickFilter[];
	onToggleQuick: (key: ProjectQuickFilter) => void;
	/** Whether the Sovereign global scope is active. */
	global: boolean;
	onToggleGlobal: () => void;
}

function IconToggle(
	{ tip, on, icon, label, onClick }: {
		tip: string;
		on: boolean;
		icon: VNode;
		label: string;
		onClick: () => void;
	},
): JSX.Element {
	return (
		<Tooltip content={tip} placement="bottom">
			<button
				type="button"
				class="proj-shortcut"
				data-on={on ? "true" : undefined}
				aria-pressed={on}
				aria-label={label}
				onClick={onClick}
			>
				{icon}
			</button>
		</Tooltip>
	);
}

export function UtilityShortcuts(props: UtilityShortcutsProps): JSX.Element {
	const set = new Set(props.quick);
	return (
		<div class="proj-shortcuts">
			<div class="proj-shortcuts__group">
				{QUICK_TOGGLES.map((t) => (
					<IconToggle
						key={t.key}
						tip={t.tip}
						label={`Show ${t.tip.toLowerCase()} only`}
						icon={t.icon}
						on={set.has(t.key)}
						onClick={() => props.onToggleQuick(t.key)}
					/>
				))}
			</div>
			<button
				type="button"
				class="proj-shortcuts__all"
				data-on={props.global ? "true" : undefined}
				aria-pressed={props.global}
				onClick={props.onToggleGlobal}
			>
				All my involvement
			</button>
		</div>
	);
}
