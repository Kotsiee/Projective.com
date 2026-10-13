import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";

/**
 * DetailActions — the Search Results drawer's pinned footer: the one conversion action, "Open full
 * page", as a neutral outlined pill (§B.8.1 tier 4) so it leads without outweighing the preview. A
 * real anchor carrying the Button classes, so a middle-click still opens a tab.
 */
export function DetailActions({ href }: { href: string }): JSX.Element {
	return (
		<a
			class="ui-button ui-button--neutral ui-button--outlined ui-button--size-md ui-button--rounded ui-button--fluid ex-detail-actions__open"
			href={href}
			data-icon-pos="right"
			aria-keyshortcuts="Enter"
		>
			<span class="ui-button__label">Open full page</span>
			<span class="ui-button__icon">
				<Icon name="arrow-right" size="sm" />
			</span>
		</a>
	);
}
