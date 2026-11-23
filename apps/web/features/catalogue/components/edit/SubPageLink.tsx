import type { JSX } from "preact";
import { Icon, type IconName } from "@projective/ui/icons";

/** Props for {@link SubPageLink}. */
export interface SubPageLinkProps {
	href: string;
	label: string;
	icon: IconName;
	/** The summary the link acts on, for `aria-describedby`. */
	describedBy?: string;
}

/**
 * SubPageLink — the way from an Edit section's summary to the listing's own page for it (`/plan`,
 * `/questions`, Decision #525): a real link, so it opens in a new tab like any other, drawn as the
 * tier-4 neutral outlined button.
 */
export function SubPageLink(props: SubPageLinkProps): JSX.Element {
	return (
		<a
			class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm cat-sec__link"
			href={props.href}
			aria-describedby={props.describedBy}
		>
			<span class="ui-button__icon">
				<Icon name={props.icon} size="xs" />
			</span>
			<span class="ui-button__label">{props.label}</span>
		</a>
	);
}
