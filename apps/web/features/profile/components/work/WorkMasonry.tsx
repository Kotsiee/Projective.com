import type { JSX } from "preact";
import { ProgressiveImage } from "@projective/ui/display";
import WorkVideoTile from "../../islands/WorkVideoTile.island.tsx";
import type { WorkPiece, WorkPieceMedia } from "../../types/profile-types.ts";

/**
 * WorkMasonry — the portfolio as a CSS-column masonry of media tiles. The columns are `column-count`
 * under container queries, and each tile's box is reserved BEFORE its bytes arrive — an image tile
 * through the media's `width`/`height` attributes (derived from the piece's `aspect`), a video tile
 * through the same aspect as a ratio on its box — so a column never reflows as media lands. A tile
 * at rest is media only — the caption and its scrim arrive on hover / focus (permanently below
 * `--bp-md`), and the piece's link is the tile's only navigation.
 *
 * An image tile is zero-JS: the anchor IS the tile. A video tile is the one tile that hydrates
 * ({@link WorkVideoTile}): it carries the shared `VideoPlayer`'s compact Play ⁄ Pause + Mute pair
 * in its top corner, revealed with the caption, and the link moves inside the player so a control is
 * never nested in an anchor. It does not autoplay — a field of clips starting on scroll competes
 * with the hero's one showreel — and the tile still opens the piece, where it plays large.
 */
export function WorkMasonry({ pieces }: { pieces: readonly WorkPiece[] }): JSX.Element | null {
	if (!pieces.length) return null;
	return (
		<ul class="pf-masonry" role="list" aria-label="Selected work">
			{pieces.map((piece) => (
				<li class="pf-masonry__item" key={piece.id}>
					{piece.media.kind === "video"
						? <WorkVideoTile piece={piece} />
						: (
							<a class="pf-tile" href={piece.href}>
								<TileImage media={piece.media} />
								<span class="pf-tile__scrim" aria-hidden="true" />
								<span class="pf-tile__caption">
									<span class="pf-tile__title">{piece.title}</span>
									<span class="pf-tile__meta">
										{piece.client ? `${piece.client} · ` : ""}
										{piece.category}
									</span>
								</span>
							</a>
						)}
				</li>
			))}
		</ul>
	);
}

const GEOMETRY_WIDTH = 1000;

function geometry(aspect: number): { width: number; height: number } {
	const safe = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
	return { width: GEOMETRY_WIDTH, height: Math.max(1, Math.round(GEOMETRY_WIDTH / safe)) };
}

function TileImage({ media }: { media: WorkPieceMedia }): JSX.Element {
	const { width, height } = geometry(media.aspect);
	return (
		<ProgressiveImage
			imgClass="pf-tile__media"
			src={media.src}
			placeholder={media.placeholder}
			alt={media.alt}
			width={width}
			height={height}
			loading="lazy"
		/>
	);
}
