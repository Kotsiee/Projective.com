import type { JSX } from "preact";
import { type HrefContext, isModifiedClick, itemHref } from "../core/routing.ts";
import type { ExploreItem } from "../types/explore-types.ts";

/**
 * CardLink — the stretched primary link that makes a whole card one route action. It is a real
 * `<a href>` (so middle-click / ⌘-click / "open in new tab" work natively) rendered as an absolutely
 * positioned overlay via `.ex-card__link`; owner/skill sub-anchors sit ABOVE it and stay independently
 * clickable. When `onSelect` is supplied (Search Results, State B) a PLAIN left-click is intercepted to
 * open the in-place detail drawer instead of navigating; every modified click falls through untouched.
 */
export function CardLink(
	{ item, ctx, onSelect, label }: {
		item: ExploreItem;
		ctx: HrefContext;
		onSelect?: (item: ExploreItem) => void;
		label: string;
	},
): JSX.Element {
	return (
		<a
			class="ex-card__link"
			href={itemHref(item, ctx)}
			aria-label={label}
			onClick={onSelect
				? (e: JSX.TargetedMouseEvent<HTMLAnchorElement>) => {
					if (isModifiedClick(e as unknown as MouseEvent)) return;
					e.preventDefault();
					onSelect(item);
				}
				: undefined}
		/>
	);
}
