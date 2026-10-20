import type { JSX } from "preact";
import { MetaLine, MoneyView } from "@projective/ui/display";
import { ProgressRing } from "@projective/ui/feedback";
import { Grid } from "@projective/ui/layout";
import type {
	DeckFact,
	DeckFigure,
	DeckMoney,
	DeckRung,
	DeckTile,
} from "../../core/overview-deck.ts";

/** Props for {@link TelemetryDeck}. */
export interface TelemetryDeckProps {
	tiles: readonly DeckTile[];
	/** The entity's name, for the deck's accessible label. */
	name: string;
}

/** An amount pinned to its own currency — a vault in GBP reads in pounds whoever is looking. */
function Money({ money }: { money: DeckMoney }): JSX.Element {
	return (
		<MoneyView
			minor={money.minor}
			currency={money.currency}
			displayCurrency={money.currency}
			size="body"
		/>
	);
}

function Figure({ figure }: { figure: DeckFigure }): JSX.Element {
	return figure.type === "money" ? <Money money={figure.money} /> : <>{figure.text}</>;
}

/** A fact as a MetaLine item: words, and its amount in place when it has one. */
function factItem(f: DeckFact) {
	return {
		text: f.text,
		tabular: true,
		node: f.money
			? (
				<>
					{f.text} <Money money={f.money} />
				</>
			)
			: undefined,
	};
}

/** The five rungs, the earned ones filled. Decorative: the unit line states the rung in words. */
function Rungs({ rung }: { rung: DeckRung }): JSX.Element {
	return (
		<span class="wsp-deck__rungs" aria-hidden="true">
			{Array.from({ length: rung.of }, (_, i) => (
				<span key={i} class="wsp-deck__rung" data-on={i < rung.level ? "" : undefined} />
			))}
		</span>
	);
}

function Tile({ tile }: { tile: DeckTile }): JSX.Element {
	return (
		<div class="wsp-deck__tile" data-tile={tile.key}>
			<dt class="wsp-deck__label">{tile.label}</dt>
			<dd class="wsp-deck__body">
				<div class="wsp-deck__readout">
					{tile.gauge && (
						<ProgressRing
							class="wsp-deck__gauge"
							value={tile.gauge.percent}
							size={44}
							strokeWidth={4}
							severity={tile.gauge.full ? "warning" : "primary"}
							showValue
							aria-label={tile.gauge.label}
						/>
					)}
					<p class="wsp-deck__line">
						{tile.figure && (
							<span class="wsp-deck__figure">
								<Figure figure={tile.figure} />
							</span>
						)}
						{tile.unit && <span class="wsp-deck__unit">{tile.unit}</span>}
					</p>
				</div>
				{tile.rung && <Rungs rung={tile.rung} />}
				{tile.facts.length > 0 && (
					<MetaLine class="wsp-deck__facts" size="xs" items={tile.facts.map(factItem)} />
				)}
			</dd>
		</div>
	);
}

/**
 * TelemetryDeck — the Overview's instruments, one unboxed tile each: a tracked label, the headline
 * figure with its unit on one line, and the facts behind it as one MetaLine (never chips, §B.11).
 * Tiles part by one block-start hairline and the grid's spacing — no fill, no box (§B.4). Every tile
 * is a fact the read carried (`telemetryDeck`); the deck holds no control.
 */
export function TelemetryDeck(props: TelemetryDeckProps): JSX.Element {
	return (
		<Grid
			as="dl"
			class="wsp-deck"
			minChildWidth="13.75rem"
			gap={5}
			aria-label={`${props.name} at a glance`}
		>
			{props.tiles.map((tile) => <Tile key={tile.key} tile={tile} />)}
		</Grid>
	);
}
