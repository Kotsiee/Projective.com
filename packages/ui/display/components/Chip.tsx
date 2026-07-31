import type { JSX, VNode } from "preact";
import "../styles/chip.css";
import { cx } from "../../core/cx.ts";
import { Icon } from "../../icons/mod.ts";

export interface ChipProps {
	/** Visible label text (also used to build the remove button's accessible name). */
	label: string;
	/** Leading image (avatar-style); takes priority over `icon` when both are given. */
	image?: string;
	/** Leading icon node, used when no `image` is given. */
	icon?: VNode;
	/** Show a trailing remove control. */
	removable?: boolean;
	/** Fired on remove-button click or Backspace/Delete/Enter while the chip is focused. */
	onRemove?: () => void;
	class?: string;
	/** Accessible name for the chip root; defaults to `label`. */
	"aria-label"?: string;
}

/**
 * Chip — a metadata pill with an optional leading image/icon and an optional remove control. Kept
 * controlled/stateless (no internal signal): removal is entirely delegated to `onRemove`, so this
 * stays a zero-JS server component and simply forwards native event handlers — they activate once
 * rendered inside a hydrated island ancestor, exactly like `Button`'s `onClick`. When `removable`,
 * the chip itself is focusable and Backspace/Delete/Enter also trigger removal; the remove button
 * carries its own `aria-label`.
 */
export function Chip(props: ChipProps): JSX.Element {
	const { label, image, icon, removable, onRemove, class: className, "aria-label": ariaLabel } =
		props;

	const onRemoveClick = (e: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
		e.stopPropagation();
		onRemove?.();
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLSpanElement>) => {
		if (!removable) return;
		if (e.key === "Backspace" || e.key === "Delete" || e.key === "Enter") {
			e.preventDefault();
			onRemove?.();
		}
	};

	return (
		<span
			class={cx("ui-chip", removable && "ui-chip--removable", className)}
			tabIndex={removable ? 0 : undefined}
			aria-label={ariaLabel ?? label}
			onKeyDown={removable ? onKeyDown : undefined}
		>
			{image && <img class="ui-chip__image" src={image} alt="" aria-hidden="true" />}
			{!image && icon && (
				<span class="ui-chip__icon" aria-hidden="true">
					{icon}
				</span>
			)}
			<span class="ui-chip__label">{label}</span>
			{removable && (
				<button
					type="button"
					class="ui-chip__remove"
					aria-label={`Remove ${label}`}
					onClick={onRemoveClick}
				>
					<Icon name="close" />
				</button>
			)}
		</span>
	);
}
