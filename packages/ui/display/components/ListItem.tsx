import type { ComponentChildren, JSX } from "preact";
import "../styles/list.css";
import { cx } from "../../core/cx.ts";

export interface ListItemProps extends Omit<JSX.HTMLAttributes<HTMLElement>, "children" | "icon"> {
	/** Leading slot (icon/avatar/checkbox). */
	leading?: ComponentChildren;
	/** Trailing slot (badge/chevron/action). */
	trailing?: ComponentChildren;
	/**
	 * Renders the row's content as a `button`/`a` (full border/focus ring allowed — interactive
	 * content is exempt from §B.4's no-border rule) instead of a plain `div`.
	 */
	interactive?: boolean;
	/** Navigation target — renders an `<a>` instead of a `<button>` when `interactive`. */
	href?: string;
	disabled?: boolean;
	class?: string;
	children?: ComponentChildren;
}

/**
 * ListItem — a single row of {@link List}, with optional `leading`/`trailing` slots. Non-interactive
 * by default (plain row); `interactive` renders the content as a native `button`/`a` so it gets a
 * real focus ring and full keyboard activation. Zero client JS — event handlers (`onClick`, etc.)
 * pass through and activate once hydrated by an island ancestor.
 */
export function ListItem(props: ListItemProps): JSX.Element {
	const {
		leading,
		trailing,
		interactive,
		href,
		disabled,
		class: className,
		children,
		...rest
	} = props;

	const body = (
		<>
			{leading !== undefined && <span class="ui-list__leading">{leading}</span>}
			<span class="ui-list__content">{children}</span>
			{trailing !== undefined && <span class="ui-list__trailing">{trailing}</span>}
		</>
	);

	if (interactive) {
		const controlClass = cx("ui-list__control", className);
		return (
			<li
				class={cx(
					"ui-list__item",
					"ui-list__item--interactive",
					disabled && "ui-list__item--disabled",
				)}
			>
				{href
					? (
						<a
							class={controlClass}
							href={href}
							aria-disabled={disabled || undefined}
							{...(rest as JSX.AnchorHTMLAttributes<HTMLAnchorElement>)}
						>
							{body}
						</a>
					)
					: (
						<button
							type="button"
							class={controlClass}
							disabled={disabled}
							{...(rest as JSX.ButtonHTMLAttributes<HTMLButtonElement>)}
						>
							{body}
						</button>
					)}
			</li>
		);
	}

	return (
		<li
			class={cx("ui-list__item", disabled && "ui-list__item--disabled", className)}
			{...(rest as JSX.HTMLAttributes<HTMLLIElement>)}
		>
			{body}
		</li>
	);
}
