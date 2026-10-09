import type { JSX } from "preact";
import { Button, useHoldRepeat } from "@projective/ui/fields";
import { Icon, type IconName } from "@projective/ui/icons";

/**
 * HoldStepButton — a ghost, icon-only stepper: a press steps once, a hold ramps after ~380ms
 * (`useHoldRepeat`) and stops the moment the value stops moving, at a bound or on release. A keyboard
 * activation (Enter / Space) steps once.
 */
export interface HoldStepButtonProps {
	icon: IconName;
	label: string;
	disabled?: boolean;
	/** Take one step; `fine` while Ctrl / Cmd was held at press. Answers whether the value moved. */
	onStep: (fine: boolean) => boolean;
}

export function HoldStepButton(props: HoldStepButtonProps): JSX.Element {
	const hold = useHoldRepeat({
		disabled: props.disabled,
		onTick: (initiator) => props.onStep(initiator.ctrlKey || initiator.metaKey),
	});

	return (
		<Button
			iconOnly
			rounded
			size="sm"
			variant="text"
			severity="secondary"
			class="pf-media__iconbtn ui-hit"
			icon={<Icon name={props.icon} size="sm" />}
			aria-label={props.label}
			disabled={props.disabled}
			data-holding={hold.holding.value ? "true" : undefined}
			{...hold.handlers}
			onClick={(e: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
				if (e.detail === 0) props.onStep(e.ctrlKey || e.metaKey);
			}}
		/>
	);
}
