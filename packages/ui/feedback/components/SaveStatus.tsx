/**
 * SaveStatus — the editor footer's save line: an optional auto-save switch at the start, then a
 * state pip, the status sentence in the meta register, and any underlined text actions beside it
 * ("Save now", "Retry", "Discard"). The switch leads so it never moves as the sentence changes
 * length.
 *
 * The pip is never the only channel (§A.5): the sentence states the fact on its own. Pass
 * `announce` to make the line speak through its own polite live region; the visible sentence is
 * then hidden from assistive tech so a ticking timestamp is not re-read.
 */
import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import "../styles/save-status.css";
import { cx } from "../../core/cx.ts";
import { ToggleSwitch } from "../../fields/islands/ToggleSwitch.tsx";
import { Tooltip } from "../islands/Tooltip.tsx";

// #region Props
/** The pip's state; each maps to one semantic tone. */
export type SaveStatusState =
	| "saved"
	| "saving"
	| "dirty"
	| "offline"
	| "error"
	| "conflict"
	| "archived";

/** One underlined text action beside the sentence. */
export interface SaveStatusAction {
	label: string;
	onAction: () => void;
	disabled?: boolean;
}

/** The auto-save switch drawn at the start of the line. */
export interface SaveStatusAutoSave {
	/** Pass the Signal, not its value: the switch seeds itself once from a raw boolean. */
	value: Signal<boolean>;
	onChange: (enabled: boolean) => void;
	/** Tooltip explaining what the current mode does. */
	hint: string;
}

/** Props for {@link SaveStatus}. */
export interface SaveStatusProps {
	state: SaveStatusState;
	/** The visible sentence: "Saved · 2s ago", "Unsaved changes". */
	text: string;
	actions?: readonly SaveStatusAction[];
	autoSave?: SaveStatusAutoSave;
	/** The live-region sentence; omit when the surface announces saves elsewhere. */
	announce?: string;
	class?: string;
}
// #endregion

/** Renders the save line; the root is a flex row that shrinks, ellipsising the sentence. */
export function SaveStatus(props: SaveStatusProps): JSX.Element {
	const { state, text, actions = [], autoSave, announce, class: className } = props;

	return (
		<div class={cx("ui-save-status", className)}>
			{autoSave && (
				<Tooltip content={autoSave.hint} placement="top">
					<span class="ui-save-status__switch">
						<ToggleSwitch
							size="sm"
							label="Auto-save"
							value={autoSave.value}
							onValueChange={autoSave.onChange}
						/>
					</span>
				</Tooltip>
			)}
			<p class="ui-save-status__line">
				<span class="ui-save-status__pip" data-state={state} aria-hidden="true" />
				<span
					class="ui-save-status__text"
					aria-hidden={announce !== undefined ? "true" : undefined}
				>
					{text}
				</span>
				{actions.map((action) => (
					<button
						key={action.label}
						type="button"
						class="ui-save-status__action"
						disabled={action.disabled}
						onClick={action.onAction}
					>
						{action.label}
					</button>
				))}
			</p>
			{announce !== undefined && <span class="ui-visually-hidden" role="status">{announce}</span>}
		</div>
	);
}
