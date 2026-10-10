import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon, type IconName } from "@projective/ui/icons";

/** Props for {@link ToolButton}. */
export interface ToolButtonProps {
	icon: IconName;
	/** Accessible name and tooltip text. */
	label: string;
	onClick: () => void;
	/** Toggle state, exposed as `aria-pressed`; omit for a plain action. */
	pressed?: boolean;
	disabled?: boolean;
	/** Shortcut shown in the tooltip, e.g. `"R"` or `"Shift+R"`. */
	shortcut?: string;
}

/** An icon-only ghost button with a tooltip naming it (and its shortcut). */
export function ToolButton(props: ToolButtonProps): JSX.Element {
	const { icon, label, onClick, pressed, disabled, shortcut } = props;
	return (
		<Tooltip content={shortcut ? `${label} (${shortcut})` : label}>
			<Button
				iconOnly
				rounded
				size="sm"
				variant="text"
				severity="secondary"
				class="ins-tool-button ui-hit"
				icon={<Icon name={icon} size="sm" />}
				aria-label={label}
				aria-pressed={pressed}
				aria-keyshortcuts={shortcut}
				data-pressed={pressed ? "true" : undefined}
				disabled={disabled}
				onClick={onClick}
			/>
		</Tooltip>
	);
}
