import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { BoardService } from "@features/projects/core/BoardService.ts";
import { ticketStack } from "@features/projects/core/ticket-view.ts";
import { TicketView } from "@features/projects/components/ticket/TicketView.tsx";
import type { BoardCard, BoardPage } from "@features/projects/types/projects-types.ts";
import { ticketSubmissionHref } from "@features/projects/core/ticket-view.ts";
import type { BasketItem } from "../types/checkout-types.ts";

/**
 * BasketTicketModal — opens a basket ticket line in the **board's own** ticket surface.
 *
 * A buyer about to pay for a ticket is entitled to the same view of it the board gives: the brief, the
 * stage run, the derived price, the history, the attachments. Building a second, thinner ticket panel
 * in the checkout would be a second answer to "what am I buying", and the two would drift the first
 * time either changed — so this mounts {@link TicketView} itself, unchanged, and confines the work to
 * resolving the board page that surface needs.
 *
 * ## Resolving the ticket
 *
 * A basket line is a PURCHASE, not a board card: it carries the engagement it is bought against
 * (`metadata.projectId` / `metadata.serviceId`, falling back to `itemId`) and the stage it routes
 * through, but no ticket id. So the board is fetched for that engagement and the card is matched by
 * title, then by stage, then not at all.
 *
 * **"Then not at all" is deliberate and is the whole safety property here.** When nothing matches, the
 * modal reports that it could not find the ticket rather than opening the first card on the board —
 * showing a buyer a different ticket's brief and price on the screen where they are deciding whether
 * to buy is far worse than showing them nothing.
 *
 * ## Read-only, by construction
 *
 * `canEdit` is hard `false` and both submission callbacks are inert. The basket is not a place work
 * gets rewritten: the buyer may not even own this engagement yet, and a Save here would write to a
 * board the checkout has no mandate over. The same component in a different posture, not a different
 * component.
 */

// #region Props
/** Props for {@link BasketTicketModal}. */
export interface BasketTicketModalProps {
	/** The line to open, or `null` when nothing is open. */
	item: BasketItem | null;
	onClose: () => void;
}
// #endregion

/**
 * The board a ticket line's engagement is addressed by.
 *
 * `boardProjectId` first, because it is the only one of the three that names a BOARD. The other two
 * name the purchasable the line was bought from, which is the same id on the live path and a different
 * corpus in fixtures — see `boardSlugFor` in `basket-fixtures.ts`. Preferring the explicit key means
 * the live path can simply stop stamping it and the fallbacks take over unchanged.
 */
function engagementIdOf(item: BasketItem): string {
	const meta = item.metadata;
	if (typeof meta.boardProjectId === "string" && meta.boardProjectId !== "") {
		return meta.boardProjectId;
	}
	if (typeof meta.projectId === "string" && meta.projectId !== "") return meta.projectId;
	if (typeof meta.serviceId === "string" && meta.serviceId !== "") return meta.serviceId;
	return item.itemId;
}

/**
 * The board card a basket line refers to.
 *
 * Title first, because it is the fact the buyer just clicked; stage second, because a line routing
 * through one stage of a pipeline is meaningfully "that stage's ticket".
 *
 * **When neither matches, the answer depends on whether the ids are real.** On the live path a miss is
 * a genuine miss and this returns `null`, because showing a buyer a different ticket's brief and price
 * on the screen where they are deciding whether to buy is far worse than showing them nothing. On the
 * FIXTURE bridge (`metadata.boardProjectId`, see `boardSlugFor`) the board itself was already chosen by
 * a hash, so refusing to pick a card on it would be a strictness that protects nothing — a deterministic
 * card off the same id keeps the surface demonstrable and is no more arbitrary than the board it sits on.
 */
function matchCard(page: BoardPage, item: BasketItem): BoardCard | null {
	const byTitle = page.cards.find((card) =>
		card.title.trim().toLowerCase() === item.title.trim().toLowerCase()
	);
	if (byTitle) return byTitle;

	if (item.stageId) {
		const byStage = page.cards.find((card) =>
			card.stages.some((ref) => ref.stageId === item.stageId)
		);
		if (byStage) return byStage;
	}

	const bridged = typeof item.metadata.boardProjectId === "string";
	if (!bridged || page.cards.length === 0) return null;

	let h = 2166136261;
	for (let i = 0; i < item.id.length; i++) h = (h * 31 + item.id.charCodeAt(i)) >>> 0;
	return page.cards[h % page.cards.length];
}

export function BasketTicketModal(props: BasketTicketModalProps): JSX.Element | null {
	const page = useSignal<BoardPage | null>(null);
	const failed = useSignal<string | null>(null);
	const loading = useSignal(false);

	const lineId = props.item?.id ?? null;

	useEffect(() => {
		const item = props.item;
		if (!item) {
			page.value = null;
			failed.value = null;
			return;
		}

		// A stale response must never paint over a newer request: the reader can click a second ticket
		// while the first is still in flight, and without this the slower answer wins.
		let live = true;
		loading.value = true;
		failed.value = null;
		page.value = null;

		void (async () => {
			const res = await BoardService.list({ projectId: engagementIdOf(item) });
			if (!live) return;
			loading.value = false;
			if (!res.ok || !res.data) {
				failed.value = "That ticket's board could not be loaded.";
				return;
			}
			const card = matchCard(res.data.page, item);
			if (!card) {
				failed.value = "This ticket is not on the board yet.";
				return;
			}
			page.value = res.data.page;
			ticketStack.open("ticket", card.id, { ticketId: card.id });
		})();

		return () => {
			live = false;
			ticketStack.close();
		};
	}, [lineId]);

	const item = props.item;
	if (!item) return null;

	const resolved = page.value;
	const card = resolved ? matchCard(resolved, item) : null;
	const frame = ticketStack.top.value;

	// The states that are NOT a ticket get a plain, dismissible panel rather than an empty modal:
	// something was clicked, so something has to answer.
	if (!resolved || !card || frame?.kind !== "ticket") {
		if (loading.value) {
			return (
				<div class="bsk-tkt" role="status">
					<p class="bsk-tkt__note">Opening ticket…</p>
				</div>
			);
		}
		if (failed.value) {
			return (
				<div class="bsk-tkt" role="alert">
					<p class="bsk-tkt__note">{failed.value}</p>
					<button type="button" class="bsk-act ui-hit" onClick={props.onClose}>
						<span class="bsk-act__label">Close</span>
					</button>
				</div>
			);
		}
		return null;
	}

	return (
		<TicketView
			key={frame.uid}
			uid={frame.uid}
			mode="view"
			card={card}
			stages={resolved.stages}
			cards={resolved.cards}
			// Read-only from the basket: see the class doc. `isClient` follows the board's own answer so
			// the panel still tells the truth about which side of the market the viewer is on.
			canEdit={false}
			isClient={resolved.viewerIsClient}
			isFreelancer={!resolved.viewerIsClient}
			workspaceKind={resolved.workspaceKind}
			workspaceLabel={resolved.workspaceLabel}
			clientMembers={resolved.clientMembers}
			projectId={resolved.projectId}
			onClose={props.onClose}
			// Inert: a read-only frame has nothing to commit. Kept as no-ops rather than omitted so the
			// component's contract is satisfied without a cast.
			onSubmit={() => {}}
			onOpenSubmission={(path) => {
				// Submissions live on the board, and reviewing one is not a basket activity — so this
				// LEAVES for the real surface rather than pushing a review frame the checkout cannot host.
				globalThis.location.assign(
					ticketSubmissionHref(resolved.projectId, path, { review: true }),
				);
			}}
			onCreateSubmission={() => {}}
		/>
	);
}
