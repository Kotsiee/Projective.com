import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Icon } from "@projective/ui/icons";
import { Tooltip } from "@projective/ui/feedback";
import { ActionMenu, linkActionItems } from "@projective/ui/navigation";
import type { ExploreEntity } from "@projective/types/explore";
import { Button } from "@ui/fields/components/Button.tsx";
import { requestShare } from "@web/features/share/core/share-request.ts";
import { savedFlag, savedTypeOf, toggleFlag } from "@features/saved/core/saved-state.ts";

/**
 * CardActions — the per-card utility cluster in the card's top-right corner: **Share · Save**, as one
 * horizontal row.
 *
 * Every button is icon-only, so each carries all three things §B.8.5 makes a merge gate: an
 * `aria-label`, a portal `Tooltip` (never a native `title`), and a hit target past the 24px floor —
 * 32×32 here.
 *
 * Save is the shared saved system (Decision #180): the card's flag comes from one batched
 * `/api/saved/state` read for the whole grid, a press writes `/api/saved` optimistically and rolls back
 * on refusal, and the outcome is announced. A signed-out reader gets a sign-in link in the same slot
 * rather than a control that silently does nothing. The kebab's Report and Add-to-project were stubs
 * with no backend and are gone (UI gate 11, as Decision #140); hiring into a project lives on the
 * profile's own Add-to-project flow.
 *
 * The cluster is revealed on card hover/focus via CSS. Right-clicking anywhere on the card opens the
 * same Share · Save beside Open · Open in new tab · Copy link (Decision #222); there is no kebab, so
 * the menu has no trigger of its own. Dumb island: it fetches internal routes only.
 */
export default function CardActions(
	{ title, href, id, type, authed = false }: {
		/** The card's title — used in share metadata + action labels. */
		title: string;
		/** The card's canonical relative href — used to build the absolute share URL. */
		href: string;
		/** The item's id — its slug, or a profile's handle (what `/api/saved` takes as `ref`). */
		id: string;
		/** The item's Explore type, which decides what kind of save it is. */
		type: ExploreEntity;
		/** Whether the current visitor is signed in (gates Save). */
		authed?: boolean;
	},
) {
	const status = useSignal(""); // polite aria-live confirmation
	const kind = savedTypeOf(type);
	const saved = authed ? savedFlag(kind, id) : null;

	/** Open the unified share modal (people on Projective · external apps · copy · the device sheet). */
	function share() {
		requestShare({ href, title });
		status.value = "";
	}

	async function save() {
		const out = await toggleFlag(kind, id);
		if (out.message) status.value = out.message;
	}

	const signIn = `/login?redirectTo=${encodeURIComponent(href)}`;
	const on = saved?.value === true;
	const root = useRef<HTMLDivElement>(null);
	const menu = linkActionItems({
		href,
		title,
		onShare: share,
		save: saved ? { saved: on, onToggle: () => void save() } : undefined,
		onCopied: (ok) => {
			status.value = ok ? "Link copied" : "Couldn't copy the link";
		},
	});

	return (
		<div class="ex-actions" data-stop ref={root}>
			<ActionMenu
				model={menu}
				surface={() => root.current?.closest<HTMLElement>(".ex-card") ?? null}
				aria-label={`Actions for ${title}`}
			/>
			<Tooltip content="Share">
				<Button
					type="button"
					class="ex-actions__btn"
					aria-label={`Share ${title}`}
					onClick={share}
				>
					<Icon name="share" />
				</Button>
			</Tooltip>

			{
				/*
				 * Save is a claim on the reader's own account, so a signed-out visitor gets the sign-in
				 * link in the same slot rather than a control that toggles and forgets. Same shape, same
				 * position — only the destination differs.
				 */
			}
			{saved
				? (
					<Tooltip content={on ? "Saved" : "Save"}>
						<Button
							type="button"
							class="ex-actions__btn"
							aria-label={on ? `Remove ${title} from saved` : `Save ${title}`}
							aria-pressed={on}
							aria-busy={saved.value === null}
							onClick={save}
						>
							<Icon name="star" filled={on} />
						</Button>
					</Tooltip>
				)
				: (
					<Tooltip content="Sign in to save">
						<a class="ex-actions__btn" href={signIn} aria-label="Sign in to save this">
							<Icon name="star" />
						</a>
					</Tooltip>
				)}

			<span class="ex-actions__status" role="status" aria-live="polite">{status.value}</span>
		</div>
	);
}
