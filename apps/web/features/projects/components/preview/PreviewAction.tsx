import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon, type IconName } from "@projective/ui/icons";

/** Props for {@link PreviewAction}. */
export interface PreviewActionProps {
	icon: IconName;
	/** Accessible name and tooltip text. */
	label: string;
	onClick: () => void;
	/** Toggle state, exposed as `aria-pressed`; omit for a plain action. */
	pressed?: boolean;
	/** Draw the glyph's solid counterpart (a starred star). */
	filled?: boolean;
	/** The id of the region this control shows or hides. */
	controls?: string;
	/** Disclosure state for a control that opens a region, exposed as `aria-expanded`. */
	expanded?: boolean;
	disabled?: boolean;
	class?: string;
}

/** An icon-only ghost circle of the preview's action rig, named by its tooltip. */
export function PreviewAction(props: PreviewActionProps): JSX.Element {
	const { icon, label, onClick, pressed, filled, controls, expanded, disabled, class: className } =
		props;
	return (
		<Tooltip content={label} placement="bottom">
			<Button
				iconOnly
				rounded
				size="sm"
				variant="text"
				severity="secondary"
				class={`fx-modal__action ui-hit${className ? ` ${className}` : ""}`}
				icon={<Icon name={icon} size="sm" filled={filled} />}
				aria-label={label}
				aria-pressed={pressed}
				aria-controls={controls}
				aria-expanded={expanded}
				data-on={pressed ? "true" : undefined}
				disabled={disabled}
				onClick={onClick}
			/>
		</Tooltip>
	);
}

/** Props for {@link PreviewLinkAction}. */
export interface PreviewLinkActionProps {
	icon: IconName;
	label: string;
	href: string;
	/** Open in a new browsing context, without an opener or referrer. */
	external?: boolean;
	/** Ask the browser to save the target rather than show it. */
	download?: boolean;
	onClick?: (event: JSX.TargetedMouseEvent<HTMLAnchorElement>) => void;
}

/** {@link PreviewAction} as a real link, for a destination the browser should own. */
export function PreviewLinkAction(props: PreviewLinkActionProps): JSX.Element {
	const { icon, label, href, external, download, onClick } = props;
	return (
		<Tooltip content={label} placement="bottom">
			<a
				class="ui-button ui-button--secondary ui-button--text ui-button--size-sm ui-button--rounded ui-button--icon-only fx-modal__action ui-hit"
				href={href}
				target={external ? "_blank" : undefined}
				rel={external ? "noopener noreferrer" : undefined}
				download={download ? "" : undefined}
				aria-label={label}
				onClick={onClick}
			>
				<span class="ui-button__icon">
					<Icon name={icon} size="sm" />
				</span>
			</a>
		</Tooltip>
	);
}
