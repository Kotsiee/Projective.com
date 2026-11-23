import type { JSX } from "preact";
import "../styles/ledger-health.css";
import type {
	AmlSignalsRead,
	AmlSignalView,
	ConservationCurrency,
	ConservationNight,
	ConversionDrift,
	EscrowAge,
	EscrowAgeRow,
	LedgerConservation,
	LedgerDrift,
	WalletDrift,
} from "@projective/types/finance";
import type { AlertDeliveryView, AlertsRead } from "@projective/types/ops";
import { type DataColumn, DataTable, MetaLine } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import { Message } from "@projective/ui/feedback";
import {
	alertChannelLabel,
	alertGroup,
	alertStatus,
	AML_KIND_LABEL,
	amlFactsText,
	amlSubject,
	conservationGroups,
	conservationStatus,
	daysText,
	ESCROW_AGE_KIND_COPY,
	imbalancedNights,
	LEDGER_SECTION_COPY,
	type LedgerSectionResult,
	shortId,
} from "../core/ledger-health.ts";

/** Props for {@link LedgerHealth}. */
export interface LedgerHealthProps {
	/** Every section in page order, each as its own read returned it. */
	sections: LedgerSectionResult[];
}

// #region Figures
/** An exact figure in its own currency: the ledger is never converted for display. */
function Money(props: { minor: number; currency: string; signed?: boolean }): JSX.Element {
	const { minor, currency, signed } = props;
	const sign = signed ? (minor > 0 ? "+" : minor < 0 ? "−" : null) : null;
	return <MoneyView minor={Math.abs(minor)} currency={currency} sign={sign} size="micro" exact />;
}

const money = <T,>(
	id: string,
	header: string,
	value: (row: T) => { minor: number; currency: string },
	signed = false,
	priority?: number,
): DataColumn<T> => ({
	id,
	header,
	type: "custom",
	align: "end",
	width: 152,
	priority,
	render: (row) => {
		const v = value(row);
		return <Money minor={v.minor} currency={v.currency} signed={signed} />;
	},
	sortValue: (row) => value(row).minor,
});

const figure = <T,>(
	id: string,
	header: string,
	value: (row: T) => string,
	width = 96,
	priority?: number,
): DataColumn<T> => ({
	id,
	header,
	type: "custom",
	align: "end",
	width,
	priority,
	render: (row) => <span class="ui-dt__num">{value(row)}</span>,
});

/** "1 currency", "3 currencies". */
function plural(n: number, one: string, many: string): string {
	return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}

const walletId = <T,>(
	id: string,
	header: string,
	value: (row: T) => string | null,
): DataColumn<T> => ({
	id,
	header,
	type: "custom",
	width: 112,
	render: (row) => (
		<span class="ledger__id" title={value(row) ?? undefined}>{shortId(value(row))}</span>
	),
});
// #endregion

// #region Columns
const CURRENCY_COLUMNS: readonly DataColumn<ConservationCurrency>[] = [
	{ id: "currency", header: "Currency", type: "text", width: 88, value: (r) => r.currency },
	{
		id: "status",
		header: "Status",
		type: "status",
		width: 144,
		value: (r) => conservationStatus(r),
	},
	money("external", "In − out", (r) => ({ minor: r.externalMinor, currency: r.currency }), true, 1),
	money(
		"accounted",
		"Accounted for",
		(r) => ({ minor: r.accountedMinor, currency: r.currency }),
		true,
		1,
	),
	// The one figure that must stay in view: it takes the width the hidden columns leave.
	{
		...money(
			"imbalance",
			"Imbalance",
			(r) => ({ minor: r.imbalanceMinor, currency: r.currency }),
			true,
		),
		width: undefined,
		fill: true,
		minWidth: 120,
	},
];

const NIGHT_COLUMNS: readonly DataColumn<ConservationNight>[] = [
	{
		id: "checked",
		header: "Checked",
		type: "date",
		format: "datetime",
		fill: true,
		minWidth: 144,
		value: (r) => r.checkedAt,
	},
	{ id: "currency", header: "Currency", type: "text", width: 88, value: (r) => r.currency },
	{
		id: "status",
		header: "Status",
		type: "status",
		width: 144,
		value: (r) => conservationStatus(r),
	},
	money("imbalance", "Imbalance", (r) => ({ minor: r.imbalanceMinor, currency: r.currency }), true),
];

const WALLET_DRIFT_COLUMNS: readonly DataColumn<WalletDrift>[] = [
	walletId("wallet", "Wallet", (r) => r.walletId),
	{ id: "owner", header: "Owner", type: "text", width: 112, value: (r) => r.ownerType },
	money("balance", "Cached balance", (r) => ({ minor: r.balanceMinor, currency: r.currency })),
	money("ledger", "Ledger sum", (r) => ({ minor: r.ledgerSumMinor, currency: r.currency }), true),
	money(
		"latest",
		"Newest running balance",
		(r) => ({ minor: r.latestBalanceAfterMinor ?? 0, currency: r.currency }),
		false,
		2,
	),
	money(
		"earmarked",
		"In pots",
		(r) => ({ minor: r.earmarkedMinor, currency: r.currency }),
		false,
		1,
	),
	money("pots", "Pot drift", (r) => ({ minor: r.potDriftMinor, currency: r.currency }), true, 1),
];

const CONVERSION_DRIFT_COLUMNS: readonly DataColumn<ConversionDrift>[] = [
	walletId("conversion", "Conversion", (r) => r.conversionId),
	walletId("escrow", "Escrow", (r) => r.escrowId),
	{
		id: "problem",
		header: "What disagrees",
		type: "text",
		fill: true,
		minWidth: 160,
		value: (r) => `${r.kind} · ${r.problem}`,
	},
	figure("expected", "Expected", (r) => r.expectedMinor.toLocaleString("en-GB"), 120),
	figure("ledger", "In the ledger", (r) => r.ledgerMinor.toLocaleString("en-GB"), 120),
];

const overColumn = (index: number, days: number, priority: number): DataColumn<EscrowAgeRow> => ({
	id: `over_${days}`,
	header: `Over ${days} d`,
	type: "custom",
	align: "end",
	width: 152,
	priority,
	render: (row) => {
		const over = row.over[index];
		if (!over || over.count === 0) return <span class="ui-dt__num">0</span>;
		return (
			<MetaLine
				as="span"
				size="xs"
				items={[
					{ text: String(over.count), tabular: true },
					{
						text: String(over.totalMinor),
						node: <Money minor={over.totalMinor} currency={row.currency} />,
					},
				]}
			/>
		);
	},
	sortValue: (row) => row.over[index]?.totalMinor ?? 0,
});

const ALERT_COLUMNS: readonly DataColumn<AlertDeliveryView>[] = [
	{
		id: "scope",
		header: "Alert",
		type: "text",
		fill: true,
		minWidth: 200,
		value: (r) => r.scope,
		secondary: (r) => `${alertGroup(r)} · ${alertChannelLabel(r.channel)} · ${r.level}`,
	},
	{ id: "status", header: "Status", type: "status", width: 120, value: (r) => alertStatus(r) },
	figure("count", "Rows", (r) => String(r.count), 72),
	{
		id: "first",
		header: "First seen",
		type: "date",
		format: "datetime",
		width: 168,
		priority: 2,
		value: (r) => r.firstSeen,
	},
	{
		id: "last",
		header: "Last seen",
		type: "date",
		format: "datetime",
		width: 168,
		priority: 3,
		value: (r) => r.lastSeen,
	},
	{
		id: "attempts",
		header: "Sends",
		type: "custom",
		align: "end",
		width: 128,
		priority: 1,
		render: (r) => (
			<MetaLine
				as="span"
				size="xs"
				items={[
					{ text: `${r.attempts} ${r.attempts === 1 ? "try" : "tries"}`, tabular: true },
					r.lastError ? { text: r.lastError, tabular: true } : null,
				]}
			/>
		),
		sortValue: (r) => r.attempts,
	},
];

const ESCROW_AGE_COLUMNS: readonly DataColumn<EscrowAgeRow>[] = [
	{
		id: "kind",
		header: "Held as",
		type: "text",
		fill: true,
		minWidth: 220,
		value: (r) => ESCROW_AGE_KIND_COPY[r.kind].label,
		secondary: (r) => ESCROW_AGE_KIND_COPY[r.kind].clock,
	},
	{ id: "currency", header: "Currency", type: "text", width: 104, value: (r) => r.currency },
	figure("count", "Count", (r) => String(r.count), 88),
	money("total", "Total", (r) => ({ minor: r.totalMinor, currency: r.currency })),
	{
		id: "oldest",
		header: "Since",
		type: "date",
		format: "date",
		width: 128,
		priority: 4,
		value: (r) => r.oldestAt,
	},
	figure("p50", "p50", (r) => daysText(r.p50Days), 96, 3),
	figure("p90", "p90", (r) => daysText(r.p90Days), 96, 3),
	figure("max", "Max", (r) => daysText(r.maxDays), 96, 5),
	overColumn(0, 30, 6),
	overColumn(1, 60, 2),
	overColumn(2, 90, 1),
];

const AML_COLUMNS: readonly DataColumn<AmlSignalView>[] = [
	{
		id: "kind",
		header: "Signal",
		type: "text",
		fill: true,
		minWidth: 240,
		value: (r) => AML_KIND_LABEL[r.kind],
		secondary: (r) => amlFactsText(r),
	},
	{
		id: "subject",
		header: "Person",
		type: "custom",
		width: 160,
		render: (r) => <span class="ledger__id" title={r.subjectUserId}>{amlSubject(r)}</span>,
	},
	money("amount", "Amount", (r) => ({ minor: r.amountMinor, currency: r.currency })),
	{
		id: "seen",
		header: "Seen",
		type: "date",
		format: "datetime",
		width: 168,
		priority: 2,
		value: (r) => r.createdAt,
	},
];
// #endregion

// #region Sections
function ConservationSection({ data }: { data: LedgerConservation }): JSX.Element {
	const bad = data.currencies.filter((c) => c.imbalanceMinor !== 0).length;
	return (
		<>
			<MetaLine
				items={[
					{ text: plural(data.currencies.length, "currency", "currencies"), tabular: true },
					bad === 0 ? "every one balanced" : { text: `${bad} out of balance`, tabular: true },
					{
						text: `${
							plural(imbalancedNights(data), "imbalanced check", "imbalanced checks")
						} in 30 nights`,
						tabular: true,
					},
				]}
			/>
			{data.currencies.length === 0
				? <p class="ledger-section__empty">No money has moved yet, in any currency.</p>
				: (
					<DataTable
						rows={data.currencies}
						rowKey={(r) => r.currency}
						columns={CURRENCY_COLUMNS}
						aria-label="The conservation identity per currency"
						virtualize={false}
						columnChooser={false}
						reorderable={false}
					/>
				)}
			{data.currencies.length > 0
				? (
					<ul class="ledger-terms" aria-label="Each currency's terms">
						{data.currencies.map((c) => (
							<li key={c.currency} class="ledger-terms__currency">
								<p class="ledger-terms__name">{c.currency}</p>
								{conservationGroups(c).map((g) => (
									<div key={g.label} class="ledger-terms__row">
										<span class="ledger-terms__label">{g.label}</span>
										<MetaLine
											as="span"
											items={[
												{
													text: String(g.totalMinor),
													node: <Money minor={g.totalMinor} currency={c.currency} />,
												},
												...g.terms.map((t) => ({
													text: `${t.label} ${t.minor}`,
													node: (
														<span>
															{t.label} <Money minor={t.minor} currency={c.currency} />
														</span>
													),
												})),
											]}
										/>
									</div>
								))}
							</li>
						))}
					</ul>
				)
				: null}
			<h3 class="ledger-section__subhead">The last 30 nights</h3>
			{data.nights.length === 0
				? <p class="ledger-section__empty">No nightly check has run in the last 30 days.</p>
				: (
					<DataTable
						rows={data.nights}
						rowKey={(r) => `${r.runId}:${r.currency}`}
						columns={NIGHT_COLUMNS}
						aria-label="Nightly conservation checks, newest first"
						virtualize={false}
						columnChooser={false}
						reorderable={false}
					/>
				)}
		</>
	);
}

function DriftSection({ data }: { data: LedgerDrift }): JSX.Element {
	return (
		<>
			<MetaLine
				items={[
					{
						text: `${plural(data.wallets.length, "wallet", "wallets")} out of step`,
						tabular: true,
					},
					{
						text: `${
							plural(data.conversions.length, "conversion", "conversions")
						} that don't add up`,
						tabular: true,
					},
					{
						text: `${plural(data.logged30d, "drift row", "drift rows")} logged in 30 days`,
						tabular: true,
					},
					data.lastLoggedAt
						? {
							text: `last logged ${new Date(data.lastLoggedAt).toLocaleString("en-GB")}`,
							tabular: true,
						}
						: null,
				]}
			/>
			{data.wallets.length === 0 && data.conversions.length === 0
				? (
					<p class="ledger-section__empty">
						Every wallet agrees with its ledger, and every conversion adds up.
					</p>
				)
				: null}
			{data.wallets.length > 0
				? (
					<DataTable
						rows={data.wallets}
						rowKey={(r) => r.walletId}
						columns={WALLET_DRIFT_COLUMNS}
						aria-label="Wallets out of step with their ledger"
						virtualize={false}
						columnChooser={false}
						reorderable={false}
					/>
				)
				: null}
			{data.conversions.length > 0
				? (
					<DataTable
						rows={data.conversions}
						rowKey={(r) => `${r.conversionId ?? ""}:${r.escrowId ?? ""}:${r.problem}`}
						columns={CONVERSION_DRIFT_COLUMNS}
						aria-label="Conversions whose ledger legs do not add up"
						virtualize={false}
						columnChooser={false}
						reorderable={false}
					/>
				)
				: null}
		</>
	);
}

function EscrowAgeSection({ data }: { data: EscrowAge }): JSX.Element {
	if (data.rows.length === 0) {
		return <p class="ledger-section__empty">No money is held right now.</p>;
	}
	return (
		<DataTable
			rows={data.rows}
			rowKey={(r) => `${r.currency}:${r.kind}`}
			columns={ESCROW_AGE_COLUMNS}
			aria-label="How long held money has sat in the platform balance"
			virtualize={false}
			columnChooser={false}
			reorderable={false}
		/>
	);
}

function AlertsSection({ data }: { data: AlertsRead }): JSX.Element {
	const silent = data.silence.map((s) => ({
		text: s.lastRowAt
			? `${s.scope} last wrote ${new Date(s.lastRowAt).toLocaleString("en-GB")}`
			: `${s.scope} has not written yet`,
		tabular: true,
	}));
	return (
		<>
			<MetaLine
				items={[
					{
						text: plural(data.pending, "alert waiting to send", "alerts waiting to send"),
						tabular: true,
					},
					{
						text: plural(data.rules.filter((r) => r.enabled).length, "rule", "rules"),
						tabular: true,
					},
				]}
			/>
			{silent.length > 0 ? <MetaLine items={silent} /> : null}
			{data.deliveries.length === 0
				? <p class="ledger-section__empty">No alert has been raised.</p>
				: (
					<DataTable
						rows={data.deliveries}
						rowKey={(r) => r.id}
						columns={ALERT_COLUMNS}
						aria-label="The newest alerts and whether they were sent"
						virtualize={false}
						columnChooser={false}
						reorderable={false}
					/>
				)}
		</>
	);
}

function AmlSignalsSection({ data }: { data: AmlSignalsRead }): JSX.Element {
	return (
		<>
			<MetaLine
				items={[
					{ text: plural(data.counts.round_trip, "round trip", "round trips"), tabular: true },
					{ text: plural(data.counts.rapid_churn, "rapid churn", "rapid churns"), tabular: true },
					{
						text: plural(data.counts.safety_hold, "held withdrawal", "held withdrawals"),
						tabular: true,
					},
					{
						text: data.holdEnabled
							? "Safety Hold on"
							: "Safety Hold off: signals are recorded, no withdrawal is held",
					},
				]}
			/>
			{data.signals.length === 0
				? <p class="ledger-section__empty">No signal has been recorded.</p>
				: (
					<DataTable
						rows={data.signals}
						rowKey={(r) => r.id}
						columns={AML_COLUMNS}
						aria-label="The newest AML monitoring signals and their facts"
						virtualize={false}
						columnChooser={false}
						reorderable={false}
					/>
				)}
		</>
	);
}

function SectionBody({ section }: { section: LedgerSectionResult }): JSX.Element {
	if (!section.ok) {
		return <Message severity="danger" variant="subtle" size="sm">{section.message}</Message>;
	}
	switch (section.id) {
		case "conservation":
			return <ConservationSection data={section.data} />;
		case "drift":
			return <DriftSection data={section.data} />;
		case "escrow_age":
			return <EscrowAgeSection data={section.data} />;
		case "alerts":
			return <AlertsSection data={section.data} />;
		case "aml_signals":
			return <AmlSignalsSection data={section.data} />;
	}
}
// #endregion

/**
 * LedgerHealth — `/admin/ledger`, the operator's read-only view of the ledger (FBP DB16; Decision
 * #337, ruling M2 (A)): Conservation (the identity per currency and its last 30 nightly checks),
 * Wallet drift (what disagrees with its ledger now), Escrow age (MR7, Decision #473), Alerts (MR4,
 * Decision #461: what was raised, and whether it was sent) and AML signals (LG7, Decision #529: what
 * the money doors recorded, with no action to take). A list of
 * sections, each filled by one `LedgerHealthService` read in the controller; a section whose read
 * failed says so in place and the rest still render. Every figure is exact in its own currency
 * (`MoneyView exact`) and `tabular-nums`; kinds and terms are inline meta text, statuses one Tag. It
 * renders no control: nothing here acts on money.
 */
export default function LedgerHealth(props: LedgerHealthProps): JSX.Element {
	const asOf = props.sections.map((s) => (s.ok ? s.data.asOf : null)).find((at) => at !== null);
	return (
		<div class="ledger">
			<header class="ledger__head">
				<h1 class="ledger__title">Ledger</h1>
				<p class="ledger__lede">
					Whether the books add up. Read-only: every figure is read straight from the ledger in its
					own currency, never converted, and nothing on this page moves money.
				</p>
				{asOf
					? (
						<MetaLine
							items={[{ text: `As of ${new Date(asOf).toLocaleString("en-GB")}`, tabular: true }]}
						/>
					)
					: null}
			</header>
			{props.sections.map((section) => {
				const copy = LEDGER_SECTION_COPY[section.id];
				return (
					<section key={section.id} class="ledger-section" aria-labelledby={`ledger-${section.id}`}>
						<h2 class="ledger-section__title" id={`ledger-${section.id}`}>{copy.title}</h2>
						<p class="ledger-section__lede">{copy.lede}</p>
						<SectionBody section={section} />
					</section>
				);
			})}
		</div>
	);
}
