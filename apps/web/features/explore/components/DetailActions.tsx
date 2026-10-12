import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import { isSaveableEntity } from "@projective/types/explore";
import { requestShare } from "@web/features/share/core/share-request.ts";
import { hydrateSaved, savedIds, setSaved } from "../core/bookmark-state.ts";
import { type HrefContext, itemHref } from "../core/routing.ts";
import type { ExploreItem } from "../types/explore-types.ts";

/**
 * DetailActions — the Search Results drawer's pinned footer: "Open full page" (a real anchor, so a
 * middle-click opens a tab) as the one primary, with Save and Share beside it. Save shares the cards'
 * page-wide bookmark store, so starring here stars the card behind the drawer too; a signed-out
 * reader gets the sign-in link in the same slot, and a type `org.user_bookmarks` cannot name gets no
 * Save at all. Share opens the one share modal.
 */
export function DetailActions(
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

	async function toggleSave() {
		const res = await setSaved(item.id, !saved);
		status.value = res.message;
	}

	return (
		<div class="ex-detail-actions">
			<a class="ex-btn ex-btn--solid ex-detail-actions__open" href={href}>
				<span>Open full page</span>
				<Icon name="arrow-right" aria-hidden />
			</a>
			<div class="ex-detail-actions__aside">
				{saveable && (authed
					? (
						<button
							type="button"
							class="ex-btn ex-btn--ghost"
							aria-pressed={saved}
							onClick={toggleSave}
						>
							<Icon name="star" filled={saved} aria-hidden />
							<span>{saved ? "Saved" : "Save"}</span>
						</button>
					)
					: (
						<a
							class="ex-btn ex-btn--ghost"
							href={`/login?redirectTo=${encodeURIComponent(href)}`}
						>
							<Icon name="star" aria-hidden />
							<span>Sign in to save</span>
						</a>
					))}
				<button
					type="button"
					class="ex-btn ex-btn--ghost"
					onClick={() => requestShare({ href, title: item.title })}
				>
					<Icon name="share" aria-hidden />
					<span>Share</span>
				</button>
			</div>
			<span class="ui-visually-hidden" role="status">{status.value}</span>
		</div>
	);
}
