import type { JSX } from "preact";
import { StatTile, StatTileRow } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { ChurnView, TileView } from "../../core/analytics-view.ts";

/**
 * AnalyticsTiles — the stat row (gross volume, orders, conversion, standing impact) and the churn line
 * beneath it. Tiles are unboxed and spacing-separated; a figure below its threshold prints "Not enough
 * data yet" and carries the threshold in a `Tooltip` on an info glyph, never a zero.
 */

function Why({ subject, note }: { subject: string; note: string }): JSX.Element {
	return (
		<Tooltip content={note} placement="bottom">
			<button type="button" class="cat-an__why" aria-label={`Why: ${subject}`}>
				<Icon name="info" />
				<span>Why?</span>
			</button>
		</Tooltip>
	);
}

function Tile({ tile }: { tile: TileView }): JSX.Element {
	return (
		<div class="cat-an__tile" data-key={tile.key} data-sufficient={tile.sufficient}>
			<StatTile label={tile.label} value={tile.value} delta={tile.delta} />
			{tile.note && <Why subject={tile.label} note={tile.note} />}
		</div>
	);
}

/** Props for {@link AnalyticsTiles}. */
export interface AnalyticsTilesProps {
	tiles: readonly TileView[];
	churn: ChurnView | null;
}

/** The stat row and the churn line. */
export function AnalyticsTiles({ tiles, churn }: AnalyticsTilesProps): JSX.Element {
	return (
		<div class="cat-an__figures">
			<StatTileRow label="Key figures" class="cat-an__tiles">
				{tiles.map((tile) => <Tile key={tile.key} tile={tile} />)}
			</StatTileRow>
			{churn && (
				<p class="cat-an__churn" data-sufficient={churn.sufficient}>
					<span class="cat-an__churn-label">Churn</span>
					<span class="cat-an__dot" aria-hidden="true">·</span>
					<span>{churn.text}</span>
					{churn.delta && (
						<>
							<span class="cat-an__dot" aria-hidden="true">·</span>
							<span class="cat-an__figure">{churn.delta}</span>
						</>
					)}
					{churn.note && <Why subject="Churn" note={churn.note} />}
				</p>
			)}
		</div>
	);
}
