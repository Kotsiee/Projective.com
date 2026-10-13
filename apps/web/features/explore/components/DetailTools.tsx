import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { isSaveableEntity } from "@projective/types/explore";
import { requestShare } from "@web/features/share/core/share-request.ts";
import { hydrateSaved, savedIds, setSaved } from "../core/bookmark-state.ts";
import { type HrefContext, itemHref } from "../core/routing.ts";
import type { ExploreItem } from "../types/explore-types.ts";

/**
 * DetailTools — the Search Results drawer's header tools beside Close: Save and Share as muted,
 * icon-only ghost buttons (Decision #182). Save shares the cards' page-wide bookmark store, so
 * starring here stars the card behind the drawer too; a signed-out reader gets the same control as a
 * sign-in link, and a type `org.user_bookmarks` cannot name gets no Save at all.
 */
export function DetailTools(
	{ item, ctx, authed }: { item: ExploreItem; ctx: HrefContext; authed: boolean },
): JSX.Element {
	const href = itemHref(item, ctx);
	const saveable = isSaveableEntity(item.type);
	const saved = savedIds.value.has(item.id);
	const status = useSignal("");

	useEffect(() => {
		if (authed && saveable) void hydrateSaved();
	}, [authed, saveable]);

	useEffect(() => {
		status.value = "";
	}, [item.id]);

	async function toggleSave(): Promise<void> {
		const res = await setSaved(item.id, !saved);
		status.value = res.message;
	}

	return (
		<>
			{saveable && (authed
				? (
					<Tooltip content={saved ? "Remove from saved" : "Save"} placement="bottom">
						<Button
							iconOnly
							rounded
							size="sm"
							variant="text"
							severity="secondary"
							class="ui-hit"
							icon={<Icon name="star" size="sm" filled={saved} />}
							aria-label="Save"
							aria-pressed={saved}
							onClick={toggleSave}
						/>
					</Tooltip>
				)
				: (
					<Tooltip content="Sign in to save" placement="bottom">
						<a
							class="ui-button ui-button--secondary ui-button--text ui-button--size-sm ui-button--rounded ui-button--icon-only ui-hit"
							href={`/login?redirectTo=${encodeURIComponent(href)}`}
							aria-label="Sign in to save"
						>
							<span class="ui-button__icon">
								<Icon name="star" size="sm" />
							</span>
						</a>
					</Tooltip>
				))}
			<Tooltip content="Share" placement="bottom">
				<Button
					iconOnly
					rounded
					size="sm"
					variant="text"
					severity="secondary"
					class="ui-hit"
					icon={<Icon name="share" size="sm" />}
					aria-label="Share"
					onClick={() => requestShare({ href, title: item.title })}
				/>
			</Tooltip>
			<span class="ui-visually-hidden" role="status">{status.value}</span>
		</>
	);
}
