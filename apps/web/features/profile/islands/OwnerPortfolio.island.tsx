import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { ConfirmDialog, Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { WorkPiece } from "@projective/types/profile";
import "../styles/profile.css";
import { WorkTile } from "../components/work/WorkMasonry.tsx";
import { OwnerEditButton } from "../components/edit/OwnerBlock.tsx";
import { PortfolioDialog } from "../components/edit/PortfolioDialog.tsx";
import type { OwnerEdit } from "../core/owner-edit.ts";
import { ProfileService } from "../core/ProfileService.ts";
import { useOwnerAnchor } from "../hooks/useOwnerAnchor.ts";

/**
 * OwnerPortfolio — "Selected work" as its OWNER sees it on `/[handle]` (Decision #439): the visitor's
 * masonry, with each tile's Edit and Remove beside it (revealed on hover or focus, always on touch)
 * and a private piece marked as one, plus **Add work**, which opens the {@link PortfolioDialog}. A
 * piece is edited in the same dialog — a tile is media, and a form inside a masonry column would
 * reflow every column around it. Every write answers with the portfolio as now stored, so the masonry
 * redraws at once; a removed piece is archived, never deleted.
 */
export interface OwnerPortfolioProps {
	pieces: WorkPiece[];
	edit: OwnerEdit;
}

export default function OwnerPortfolio(props: OwnerPortfolioProps): JSX.Element {
	const handle = props.edit.handle;
	const pieces = useSignal<WorkPiece[]>(props.pieces);
	const dialogOpen = useSignal(false);
	const dialogPiece = useSignal<WorkPiece | null>(null);
	const dialogSeq = useSignal(0);
	const removing = useSignal<WorkPiece | null>(null);
	const confirmOpen = useSignal(false);
	const notice = useSignal("");
	useOwnerAnchor("work", () => openDialog(null));

	function openDialog(piece: WorkPiece | null): void {
		dialogPiece.value = piece;
		dialogSeq.value += 1;
		dialogOpen.value = true;
	}

	async function archive(): Promise<void> {
		const piece = removing.peek();
		removing.value = null;
		if (!piece) return;
		const res = await ProfileService.archivePortfolioPiece(handle, piece.id);
		if (!res.ok || !res.data) {
			notice.value = res.message ?? "That piece couldn't be removed.";
			return;
		}
		pieces.value = res.data.pieces;
		notice.value = `“${piece.title}” was removed from your portfolio.`;
	}

	const list = pieces.value;

	return (
		<section class="pf-work__section" id="work" aria-labelledby="pf-work-selected">
			<div class="pf-ownerhead">
				<h2 class="pf-h" id="pf-work-selected">Selected work</h2>
				<Button
					size="sm"
					variant="text"
					class="pf-edit__ghost"
					aria-haspopup="dialog"
					icon={<Icon name="plus" size="sm" />}
					onClick={() => openDialog(null)}
				>
					Add work
				</Button>
			</div>
			<p class="pf-inline__status" role="status" aria-live="polite">{notice.value}</p>
			{list.length
				? (
					<ul class="pf-masonry" role="list" aria-label="Selected work">
						{list.map((piece) => (
							<li class="pf-masonry__item pf-masonry__item--owned pf-ownerblock" key={piece.id}>
								<WorkTile piece={piece} />
								{piece.isPublic === false && <span class="pf-tile__private">Only you</span>}
								<div class="pf-tile__owner">
									<OwnerEditButton
										label={`“${piece.title}”`}
										onClick={() =>
											openDialog(piece)}
									/>
									<Tooltip content="Remove" density="compact">
										<Button
											size="sm"
											severity="neutral"
											variant="outlined"
											iconOnly
											class="pf-owneredit"
											aria-label={`Remove “${piece.title}”`}
											icon={<Icon name="trash" size="sm" />}
											onClick={() => {
												removing.value = piece;
												confirmOpen.value = true;
											}}
										/>
									</Tooltip>
								</div>
							</li>
						))}
					</ul>
				)
				: <p class="pf-ownerstub__note">Visitors see your best work here once you add a piece.</p>}
			{dialogSeq.value > 0 && (
				<PortfolioDialog
					key={dialogSeq.value}
					open={dialogOpen}
					handle={handle}
					piece={dialogPiece.value}
					onSaved={(next, added) => {
						pieces.value = next;
						notice.value = added ? "Added to your portfolio." : "Piece saved.";
					}}
				/>
			)}
			<ConfirmDialog
				visible={confirmOpen}
				header="Remove this piece?"
				message="It leaves your profile. The picture stays in your library."
				acceptLabel="Remove"
				rejectLabel="Keep"
				acceptSeverity="danger"
				onAccept={() => void archive()}
				onReject={() => (removing.value = null)}
			/>
		</section>
	);
}
