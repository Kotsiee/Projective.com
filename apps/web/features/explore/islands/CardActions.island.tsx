import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Icon } from "@projective/ui/icons";
import { Tooltip } from "@projective/ui/feedback";
import { ActionMenu } from "@projective/ui/navigation";
import { Button } from "@ui/fields/components/Button.tsx";
import { requestShare, shareAnchor } from "@web/features/share/core/share-request.ts";
import { savedFlag, savedTypeOf, toggleFlag } from "@features/saved/core/saved-state.ts";
import { cardMenu, type CardMenuFacts } from "../core/card-menu.ts";

/**
 * CardActions — the per-card utility cluster in the card's top-right corner: **Share · Save · More**,
 * as one horizontal row.
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
 * The cluster is revealed on card hover/focus via CSS, and always shown where there is no hover.
 * `cardMenu` — the split Open row over Copy link · Share · Save (Decisions #222, #373), then the item's
 * own verbs and its creator's profile (Decision #422) — opens from **More** (⋯) and from a right-click,
 * the ContextMenu key or Shift+F10 anywhere on the card. More is the touch route: iOS Safari raises no
 * `contextmenu`, and a long-press would fight the page's scroll. Dumb island: it fetches internal
 * routes only.
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
	const status = useSignal(""); // polite aria-live confirmation
	const kind = savedTypeOf(type);
	const saved = authed ? savedFlag(kind, id) : null;

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
	const menu = cardMenu(facts, {
		authed,
		onShare: () => share(),
		save: saved ? { saved: on, onToggle: () => void save() } : undefined,
		onCopied: (ok) => {
			status.value = ok ? "Link copied" : "Couldn't copy the link";
		},
	});

	return (
		<div class="ex-actions" data-stop ref={root}>
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

			<ActionMenu
				model={menu}
				surface={() => root.current?.closest<HTMLElement>(".ex-card") ?? null}
				aria-label={`Actions for ${title}`}
				trigger={(api) => (
					<Tooltip content="More">
						<Button
							type="button"
							class="ex-actions__btn"
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

			<span class="ex-actions__status" role="status" aria-live="polite">{status.value}</span>
		</div>
	);
}
