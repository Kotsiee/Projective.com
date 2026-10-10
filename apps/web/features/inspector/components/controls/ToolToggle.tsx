import type { Signal } from "@preact/signals";
import type { JSX } from "preact";
import { ToggleSwitch } from "@projective/ui/fields";
import { useId } from "@projective/ui/hooks";
import { ToolRow } from "./ToolRow.tsx";

/** Props for {@link ToolToggle}. */
export interface ToolToggleProps {
	label: string;
	value: Signal<boolean>;
	disabled?: boolean;
}

/** A labelled on/off switch row bound to a signal. */
export function ToolToggle({ label, value, disabled }: ToolToggleProps): JSX.Element {
	const id = useId(undefined, "ins-toggle");
	return (
		<ToolRow label={label} for={id}>
			<ToggleSwitch id={id} size="sm" value={value} disabled={disabled} />
		</ToolRow>
	);
}
