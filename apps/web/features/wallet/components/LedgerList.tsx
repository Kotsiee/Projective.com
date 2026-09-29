import type { JSX } from "preact";
import { InlineNotice, Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { MoneyView } from "@projective/ui/display/money";
import type { LedgerLine } from "../types/wallet-types.ts";
import { bandLedger, type LedgerBand } from "../core/wallet-home.ts";
import { categoryLabel, fundStateLabel } from "../core/wallet-model.ts";
import { CategoryIcon, FundStateIcon } from "./wallet-glyphs.tsx";

/** Props for {@link LedgerList}. */
export interface LedgerListProps {
	lines: LedgerLine[];
	hasMore: boolean;
	loading: boolean;
	error: string | null;
	/** The CSV export address for this wallet, or `null` when there is nothing to export. */
	exportHref: string | null;
	/** Whether the island has hydrated; local times are only drawn once the browser's clock is known. */
	mounted: boolean;
	onOpen: (line: LedgerLine) => void;
	onMore: () => void;
	onRetry: () => void;
}

const TIME = typeof Intl !== "undefined"
	? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" })
	: null;

function whenOf(line: LedgerLine, band: LedgerBand["key"], mounted: boolean): string | null {
	if (band === "earlier") return line.dateLabel;
	if (!mounted || !TIME) return null;
	const at = Date.parse(line.at);
	return Number.isFinite(at) ? TIME.format(at) : null;
}

function LedgerRow(
	{ line, band, mounted, onOpen }: {
		line: LedgerLine;
		band: LedgerBand["key"];
		mounted: boolean;
		onOpen: (line: LedgerLine) => void;
	},
): JSX.Element {
	const credit = line.direction === "credit";
	const when = whenOf(line, band, mounted);
	const meta = [line.counterparty, categoryLabel(line.category), when].filter(Boolean) as string[];
	return (
		<li class="wlt-txn-item">
			<button type="button" class="wlt-txn" onClick={() => onOpen(line)}>
				<span class="wlt-txn__mark" data-category={line.category} aria-hidden="true">
					<CategoryIcon category={line.category} size="sm" />
				</span>
				<span class="wlt-txn__body">
					<span class="wlt-txn__title">{line.title}</span>
					<span class="wlt-txn__meta">
						{meta.map((part, i) => (
							<span key={i} class="wlt-txn__part">
								{i > 0 && <span class="wlt-dot" aria-hidden="true">·</span>}
								{part}
							</span>
						))}
					</span>
				</span>
				<span class="wlt-txn__amount">
					<MoneyView
						value={line.amount}
						size="body"
						sign={credit ? "+" : "−"}
						tone={credit ? "credit" : "default"}
						hideOrigin
					/>
					{line.fundState !== "available" && (
						<Tooltip content={fundStateLabel(line.fundState)}>
							<span class="wlt-txn__state">
								<FundStateIcon state={line.fundState} size="2xs" />
								<span class="ui-visually-hidden">{fundStateLabel(line.fundState)}</span>
							</span>
						</Tooltip>
					)}
				</span>
			</button>
		</li>
	);
}

/** The wallet's movements, newest first, banded Today · Yesterday · Earlier. */
export function LedgerList(props: LedgerListProps): JSX.Element {
	const bands = bandLedger(props.lines);
	return (
		<section class="wlt-section wlt-ledger" id="transactions" aria-labelledby="wlt-ledger-title">
			<header class="wlt-section__head">
				<h2 id="wlt-ledger-title" class="wlt-section__title">Transactions</h2>
				{props.exportHref && props.lines.length > 0 && (
					<a class="wlt-textlink" href={props.exportHref} download>
						<Icon name="download" size="xs" />
						Download CSV
					</a>
				)}
			</header>
			{bands.map((band) => (
				<div class="wlt-band" key={band.key} aria-labelledby={`wlt-band-${band.key}`} role="group">
					<h3 id={`wlt-band-${band.key}`} class="wlt-band__title">{band.label}</h3>
					<ul class="wlt-txns">
						{band.lines.map((line) => (
							<LedgerRow
								key={line.id}
								line={line}
								band={band.key}
								mounted={props.mounted}
								onOpen={props.onOpen}
							/>
						))}
					</ul>
				</div>
			))}
			{props.lines.length === 0 && !props.error && (
				<p class="wlt-empty">
					No transactions yet. Money in and out of this wallet will appear here.
				</p>
			)}
			{props.hasMore && !props.error && (
				<Button
					variant="outlined"
					size="sm"
					class="wlt-ledger__more"
					label="Show more"
					loading={props.loading}
					disabled={props.loading}
					onClick={props.onMore}
				/>
			)}
			{props.error && (
				<InlineNotice
					text={props.error}
					actionLabel="Try again"
					onAction={props.onRetry}
					busy={props.loading}
					align="start"
					class="wlt-notice"
				/>
			)}
		</section>
	);
}
