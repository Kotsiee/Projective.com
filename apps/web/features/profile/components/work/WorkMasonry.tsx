import type { JSX } from "preact";
import type { WorkPiece, WorkPieceMedia } from "../../types/profile-types.ts";

/**
 * WorkMasonry — the portfolio as a CSS-column masonry of media tiles. Zero client JS: the columns
 * are `column-count` under container queries, and each tile's box is reserved BEFORE its bytes
 * arrive through the media's `width`/`height` attributes (derived from the piece's `aspect`), so a
 * column never reflows as images land. A tile at rest is media only — the caption and its scrim
 * arrive on hover / focus (permanently below `--bp-md`), and the anchor is the tile's only control.
 *
 * A video tile shows its poster and does not play: a server component cannot honour either
 * reduced-motion channel, and a field of looping clips competes with the hero's one showreel. The
 * tile opens the piece, where it plays.
 */
export function WorkMasonry({ pieces }: { pieces: readonly WorkPiece[] }): JSX.Element | null {
	if (!pieces.length) return null;
	return (
		<ul class="pf-masonry" role="list" aria-label="Selected work">
			{pieces.map((piece) => (
				<li class="pf-masonry__item" key={piece.id}>
					<a class="pf-tile" href={piece.href}>
						<TileMedia media={piece.media} />
						<span class="pf-tile__scrim" aria-hidden="true" />
						<span class="pf-tile__caption">
							<span class="pf-tile__title">{piece.title}</span>
							<span class="pf-tile__meta">
								{piece.client ? `${piece.client} · ` : ""}
								{piece.category}
							</span>
						</span>
					</a>
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

function TileMedia({ media }: { media: WorkPieceMedia }): JSX.Element {
	const { width, height } = geometry(media.aspect);
	if (media.kind === "video") {
		return (
			<video
				class="pf-tile__media"
				src={media.src}
				poster={media.poster}
				width={width}
				height={height}
				muted
				playsInline
				preload="none"
				aria-label={media.alt}
			/>
		);
	}
	return (
		<img
			class="pf-tile__media"
			src={media.src}
			alt={media.alt}
			width={width}
			height={height}
			loading="lazy"
			decoding="async"
		/>
	);
}
