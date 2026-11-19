import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { requestShare, shareAnchor } from "@web/features/share/core/share-request.ts";
import { savedFlag, savedTypeOf, toggleFlag } from "@features/saved/core/saved-state.ts";
import { type HrefContext, itemHref } from "../core/routing.ts";
import type { ExploreItem } from "../types/explore-types.ts";

/**
 * DetailTools — the Search Results drawer's header tools beside Close: Save and Share as muted,
 * icon-only ghost buttons (Decision #182). Save is the shared saved system (Decision #180): the same
 * `savedFlag` the card behind the drawer reads and the same `/api/saved` write, so starring here
 * stars that card too and the save lists on `/saved`. A signed-out reader gets the same control as a
 * sign-in link.
 */
export function DetailTools(
	{ item, ctx, authed }: { item: ExploreItem; ctx: HrefContext; authed: boolean },
): JSX.Element {
	const href = itemHref(item, ctx);
	const kind = savedTypeOf(item.type);
	const flag = authed ? savedFlag(kind, item.id) : null;
	const saved = flag?.value === true;
	const status = useSignal("");

	useEffect(() => {
		status.value = "";
	}, [item.id]);

	async function toggleSave(): Promise<void> {
		const out = await toggleFlag(kind, item.id);
		if (out.message) status.value = out.message;
	}

	return (
		<>
			{flag
				? (
					<Tooltip content={saved ? "Remove from saved" : "Save"} placement="bottom">
						<Button
							iconOnly
							rounded
							size="sm"
							variant="text"
							severity="secondary"
							class="ui-hit"
							icon={<Icon name="bookmark" size="sm" filled={saved} />}
							aria-label="Save"
							aria-pressed={saved}
							aria-busy={flag.value === null}
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
								<Icon name="bookmark" size="sm" />
							</span>
						</a>
					</Tooltip>
				)}
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
					onClick={(event) => requestShare({ href, title: item.title, anchor: shareAnchor(event) })}
				/>
			</Tooltip>
			<span class="ui-visually-hidden" role="status">{status.value}</span>
		</>
	);
}
