import type { JSX, RefObject } from "preact";
import { ConfirmPopup } from "../../../feedback/islands/ConfirmPopup.tsx";
import { HintPopover } from "../../../feedback/islands/HintPopover.tsx";
import { Tooltip } from "../../../feedback/islands/Tooltip.tsx";
import { InputText } from "../../../fields/islands/InputText.tsx";
import { ToggleSwitch } from "../../../fields/islands/ToggleSwitch.tsx";
import { Icon } from "../../../icons/components/Icon.tsx";
import { useBound, useScheduler } from "./context.ts";
import { BindingLine } from "./PresetBar.tsx";
import type { PresetBinding } from "./types.ts";

// #region Props
/** Props for `AvailabilityScheduler.Details`. */
export interface DetailsProps {
	/** The service binding line; omit outside a service. */
	binding?: PresetBinding;
	/** Archive the open template; the action renders only when supplied. */
	onArchive?: () => void;
	/** The template is the saved default: it stays one until another template is made the default. */
	lockDefault?: boolean;
}
// #endregion

// #region Details
/**
 * The open template's settings: its name, whether it is the default, and the zone its times are in,
 * with the service binding line and Archive when the host supplies them. A saved default cannot be
 * switched off (`lockDefault`): another template is made the default instead, so a schedule never
 * has none.
 */
export function Details(props: DetailsProps): JSX.Element {
	const { binding, onArchive, lockDefault = false } = props;
	const { store, timezone, idBase } = useScheduler();
	const name = useBound(store.draft, (d) => d.name);
	const isDefault = useBound(store.draft, (d) => d.isDefault);
	const hintId = `${idBase}-default-hint`;
	const hint =
		"Services without their own template book against the default, and your profile shows its weekly hours.";

	return (
		<section class="ui-avsched__section" aria-label="Template settings">
			<div class="ui-avsched__section-head">
				<h3 class="ui-avsched__heading">Settings</h3>
				{onArchive && (
					<ConfirmPopup
						message="Archive this template? Services using it move to your default."
						label="Archive template"
						acceptLabel="Archive"
						rejectLabel="Keep"
						acceptSeverity="danger"
						placement="bottom-end"
						onAccept={onArchive}
						trigger={(api) => (
							<Tooltip content="Archive template">
								<button
									ref={api.ref as RefObject<HTMLButtonElement>}
									type="button"
									class="ui-button ui-button--danger ui-button--text ui-button--size-sm ui-button--icon-only ui-hit"
									aria-label="Archive template"
									aria-haspopup="dialog"
									aria-expanded={api.expanded}
									aria-controls={api.panelId}
									onClick={api.toggle}
								>
									<span class="ui-button__icon">
										<Icon name="archive-box" />
									</span>
								</button>
							</Tooltip>
						)}
					/>
				)}
			</div>
			<InputText
				aria-label="Template name"
				size="sm"
				block
				maxLength={60}
				value={name}
				placeholder="Template name"
				onValueChange={(next) => store.dispatch({ type: "setDetails", name: next })}
			/>
			<div class="ui-avsched__setting">
				<ToggleSwitch
					value={isDefault}
					label="Default"
					aria-describedby={hintId}
					disabled={lockDefault}
					onValueChange={(on) => store.dispatch({ type: "setDetails", isDefault: on })}
				/>
				<HintPopover label="About the default template">{hint}</HintPopover>
				<span id={hintId} class="ui-visually-hidden">{hint}</span>
			</div>
			<p class="ui-avsched__meta">Times in {timezone.replace(/_/g, " ")}</p>
			{binding && <BindingLine binding={binding} />}
		</section>
	);
}
// #endregion
