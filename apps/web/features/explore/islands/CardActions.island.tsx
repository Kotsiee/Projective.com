import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Icon } from "@projective/ui/icons";
import { Tooltip } from "@projective/ui/feedback";
import { ActionMenu } from "@projective/ui/navigation";
import { Button } from "@ui/fields/components/Button.tsx";
import { COLLECTABLE_TYPES } from "@projective/types/org";
import { requestShare, shareAnchor } from "@web/features/share/core/share-request.ts";
import {
	ensureSavedLists,
	savedFlag,
	savedLists,
	savedTypeOf,
	saveToList,
	toggleFlag,
} from "@features/saved/core/saved-state.ts";
import { saveListRows } from "@features/saved/core/saved-menu.ts";
import { CollectionPicker } from "@features/saved/components/CollectionPicker.tsx";
import "@features/saved/styles/saved.css";
import { cardMenu, type CardMenuFacts } from "../core/card-menu.ts";

/**
 * CardActions — the per-card utility cluster in the card's top-right corner: **Share · Save · More**,
 * as one horizontal row of ghost icon buttons that stay muted on hover.
 *
 * Every button is icon-only, so each carries all three things §B.8.5 makes a merge gate: an
 * `aria-label`, a portal `Tooltip` (never a native `title`), and a hit target past the 24px floor —
 * 32×32 here.
 *
 * Save is the shared saved system (Decision #180), drawn as the platform's one save glyph, the
 * bookmark (Decision #520). The card's flag comes from one batched `/api/saved/state` read for the
 * whole grid, a press writes `/api/saved` optimistically and rolls back on refusal, and the outcome is
 * announced. A saved card keeps its amber bookmark visible at rest, in the far-end slot; on hover or
 * focus it slides back to its own slot and More takes the end. A signed-out reader gets a sign-in link
 * in the Save slot rather than a control that silently does nothing.
 *
 * `cardMenu` — the split Open row over Copy link · Share · Save (Decisions #222, #373), then the item's
 * own verbs and its creator's profile (Decision #422) — opens from **More** (⋯) and from a right-click,
 * the ContextMenu key or Shift+F10 anywhere on the card. For a kind that files into a list, Save is a
 * split row whose submenu saves straight into one of the viewer's lists or a new one. Dumb island: it
 * fetches internal routes only.
 */
export default function CardActions(
	{ facts, authed = false }: {
		/** The card's menu facts (`cardMenuFacts`) — title, href, id, type, service model, owner. */
		facts: CardMenuFacts;
		/** Whether the current visitor is signed in (gates Save). */
		authed?: boolean;
	},
) {
	const { title, href, id, type } = facts;
	const status = useSignal("");
	const picking = useSignal(false);
	const kind = savedTypeOf(type);
	const saved = authed ? savedFlag(kind, id) : null;
	const collectable = COLLECTABLE_TYPES.includes(kind);

	/** Open the unified share surface, anchored to the card's Share button when it asked. */
	function share(event?: Event) {
		requestShare({ href, title, anchor: shareAnchor(event) });
		status.value = "";
	}

	async function save() {
		const out = await toggleFlag(kind, id);
		if (out.message) status.value = out.message;
	}

	const signIn = `/login?redirectTo=${encodeURIComponent(href)}`;
	const on = saved?.value === true;
	const root = useRef<HTMLDivElement>(null);
	const lists = saved && collectable
		? saveListRows({
			lists: savedLists.value,
			onPick: (list) => void saveToList(kind, id, list).then((msg) => (status.value = msg)),
			onNewList: () => (picking.value = true),
		})
		: undefined;
	const menu = cardMenu(facts, {
		authed,
		onShare: () => share(),
		save: saved ? { saved: on, onToggle: () => void save(), lists } : undefined,
		onCopied: (ok) => {
			status.value = ok ? "Link copied" : "Couldn't copy the link";
		},
	});

	return (
		<div class="ex-actions" data-stop data-saved={on ? "true" : undefined} ref={root}>
			<Tooltip content="Share">
				<Button
					type="button"
					class="ex-actions__btn ex-actions__btn--share"
					aria-label={`Share ${title}`}
					onClick={share}
				>
					<Icon name="share" />
				</Button>
			</Tooltip>

			{saved
				? (
					<Tooltip content={on ? "Saved" : "Save"}>
						<Button
							type="button"
							class="ex-actions__btn ex-actions__btn--save"
							aria-label={on ? `Remove ${title} from saved` : `Save ${title}`}
							aria-pressed={on}
							aria-busy={saved.value === null}
							onClick={save}
						>
							<Icon name="bookmark" filled={on} />
						</Button>
					</Tooltip>
				)
				: (
					<Tooltip content="Sign in to save">
						<a
							class="ex-actions__btn ex-actions__btn--save"
							href={signIn}
							aria-label="Sign in to save this"
						>
							<Icon name="bookmark" />
						</a>
					</Tooltip>
				)}

			<ActionMenu
				model={menu}
				surface={() => root.current?.closest<HTMLElement>(".ex-card") ?? null}
				aria-label={`Actions for ${title}`}
				onOpenChange={(open) => {
					if (open && lists) ensureSavedLists();
				}}
				trigger={(api) => (
					<Tooltip content="More">
						<Button
							type="button"
							class="ex-actions__btn ex-actions__btn--more"
							triggerRef={api.ref}
							aria-label={`More actions for ${title}`}
							aria-haspopup="menu"
							aria-expanded={api.expanded}
							aria-controls={api.expanded ? api.panelId : undefined}
							onClick={api.toggle}
						>
							<Icon name="kebab-horizontal" />
						</Button>
					</Tooltip>
				)}
			/>

			{saved && collectable && picking.value && (
				<CollectionPicker
					open={picking}
					target={{ type: kind, ref: id, title }}
					onDone={(_collectionId, message) => {
						saved.value = true;
						status.value = message;
					}}
				/>
			)}

			<span class="ex-actions__status" role="status" aria-live="polite">{status.value}</span>
		</div>
	);
}
