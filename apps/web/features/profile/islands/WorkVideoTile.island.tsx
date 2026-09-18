import type { JSX } from "preact";
import { VideoPlayer } from "@projective/ui/display/video";
import "../styles/profile.css";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import type { WorkPiece } from "../types/profile-types.ts";

/**
 * WorkVideoTile — a Selected-work tile whose piece is a video. The image tiles beside it are zero-JS
 * server markup (`WorkMasonry`); a video tile is the ONE tile that hydrates, because Play ⁄ Pause and
 * Mute need a script and a poster does not.
 *
 * # The link is inside the player, and that is the whole trick
 *
 * The image tile is an `<a class="pf-tile">` and nothing else. A control inside a link is two
 * interactive elements in one — the outer takes the role, the inner takes the click — so the video
 * tile is a `<div class="pf-tile">` holding the shared {@link VideoPlayer}, and the piece's link is
 * rendered as the player's CHILD: a stretched anchor layered between the picture and the controls,
 * carrying the scrim and the caption exactly as the image tile carries them. The controls sit above
 * it, so a press on Play never follows the link (and stops propagation besides), and the link sits
 * inside the player's box, so a pointer over it is a pointer over the player — which is what lets
 * the compact cluster fade in with the caption on the tile's own hover.
 *
 * The tile reserves its box from the piece's aspect (`--pf-tile-ratio`), the same fact the image
 * tile derives its `width`/`height` attributes from, so a video tile lands at its final height
 * before a byte of media arrives and the column never reflows.
 *
 * Nothing autoplays: a field of clips starting on scroll competes with the hero's one showreel, and
 * `preload="none"` keeps a tile a poster until the reader asks. The clip plays once, silent, and its
 * Mute control is the reader's to press. Where hover does not exist the cluster is pinned visible by
 * `profile-work.css` — a tile whose surface IS a link cannot spend its tap on a reveal.
 */
export default function WorkVideoTile({ piece }: { piece: WorkPiece }): JSX.Element {
	const reduced = useReducedMotion();
	const { media } = piece;
	return (
		<div class="pf-tile pf-tile--video" style={`--pf-tile-ratio:${media.aspect}`}>
			<VideoPlayer
				variant="compact"
				class="pf-tile__player"
				src={media.src}
				poster={media.poster}
				label={media.alt}
				preload="none"
				muted
				reduced={reduced}
			>
				<a class="pf-tile__link" href={piece.href}>
					<span class="pf-tile__scrim" aria-hidden="true" />
					<span class="pf-tile__caption">
						<span class="pf-tile__title">{piece.title}</span>
						<span class="pf-tile__meta">
							{piece.client ? `${piece.client} · ` : ""}
							{piece.category}
						</span>
					</span>
				</a>
			</VideoPlayer>
		</div>
	);
}
