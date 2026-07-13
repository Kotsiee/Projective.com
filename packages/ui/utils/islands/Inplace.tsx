import type { ComponentChildren, JSX, VNode } from "preact";
import { useEffect, useRef } from "preact/hooks";
import "../styles/inplace.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useId } from "../../hooks/useId.ts";
import type { Bindable } from "../../fields/types/mod.ts";

// #region Props
/** Props for {@link Inplace}. */
export interface InplaceProps {
	/** Editing state — raw boolean (uncontrolled) or a `Signal<boolean>` (controlled). */
	active?: Bindable<boolean>;
	/** Show a close (×) button in the editor that returns to the display view. */
	closable?: boolean;
	/** Disable activation entirely. */
	disabled?: boolean;
	/** Accessible label for the display trigger (default `"Edit"`). */
	"aria-label"?: string;
	/** Fired whenever the active state changes. */
	onActiveChange?: (active: boolean) => void;
	/** The read-only display, or a render function receiving an `open()` callback. */
	display?: ComponentChildren | ((open: () => void) => VNode);
	/** The editor, or a render function receiving a `close()` callback. */
	editor?: ComponentChildren | ((close: () => void) => VNode);
	/** Fallback children used as the display view when `display` is omitted. */
	children?: ComponentChildren;
	id?: string;
	class?: string;
}
// #endregion

/**
 * Inplace — a click-to-edit switch. It shows a compact `display` view that swaps to the `editor` on
 * click or Enter/Space; Escape (and the optional `closable` ×) returns to the display view. The
 * display is a `button` that controls the editor `region` (`aria-expanded` + `aria-controls`); focus
 * moves into the editor on open and back to the trigger on close. Signal-first `active` binding lets
 * callers open/close it programmatically.
 */
export function Inplace(props: InplaceProps): JSX.Element {
	const {
		active,
		closable,
		disabled,
		"aria-label": ariaLabel = "Edit",
		onActiveChange,
		display,
		editor,
		children,
		id,
		class: className,
	} = props;

	const ctrl = useControllable<boolean>(active, false, onActiveChange);
	const isActive = ctrl.signal.value;
	const rootId = useId(id, "inplace");
	const regionId = `${rootId}-region`;

	const open = () => {
		if (disabled) return;
		ctrl.set(true);
	};
	const close = () => ctrl.set(false);

	const triggerRef = useRef<HTMLButtonElement>(null);
	const regionRef = useRef<HTMLDivElement>(null);

	// #region Focus handoff
	useEffect(() => {
		if (isActive) {
			const el = regionRef.current;
			const focusable = el?.querySelector<HTMLElement>(
				"input,textarea,select,button,[tabindex]:not([tabindex='-1'])",
			);
			(focusable ?? el)?.focus?.();
		}
	}, [isActive]);
	// #endregion

	const onDisplayKey = (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			open();
		}
	};
	const onRegionKey = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		if (e.key === "Escape") {
			e.preventDefault();
			close();
			triggerRef.current?.focus();
		}
	};

	return (
		<span
			class={cx(
				"ui-inplace",
				isActive && "ui-inplace--active",
				disabled && "ui-inplace--disabled",
				className,
			)}
		>
			{!isActive && (
				<button
					ref={triggerRef}
					type="button"
					class="ui-inplace__display"
					id={rootId}
					aria-label={ariaLabel}
					aria-expanded={false}
					aria-controls={regionId}
					disabled={disabled}
					onClick={open}
					onKeyDown={onDisplayKey}
				>
					{typeof display === "function" ? display(open) : (display ?? children)}
				</button>
			)}
			{isActive && (
				<div
					ref={regionRef}
					class="ui-inplace__editor"
					id={regionId}
					role="region"
					aria-label={ariaLabel}
					onKeyDown={onRegionKey}
				>
					<div class="ui-inplace__editor-content">
						{typeof editor === "function" ? editor(close) : editor}
					</div>
					{closable && (
						<button
							type="button"
							class="ui-inplace__close"
							aria-label="Close editor"
							onClick={close}
						>
							×
						</button>
					)}
				</div>
			)}
		</span>
	);
}
