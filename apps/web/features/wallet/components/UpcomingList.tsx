import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { InlineNotice, ProgressRing } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { MoneyView } from "@projective/ui/display/money";
import type { UpcomingAction, UpcomingItem } from "../core/wallet-home.ts";
import { UpcomingIcon } from "./wallet-glyphs.tsx";

/** Props for {@link UpcomingList}. */
export interface UpcomingListProps {
	items: UpcomingItem[];
	/** Messages from the reads that fed this list and failed. */
	errors: string[];
	retrying: boolean;
	onAction: (action: UpcomingAction) => void;
	onRetry: () => void;
}

const VISIBLE = 5;

function UpcomingRow(
	{ item, onAction }: { item: UpcomingItem; onAction: (a: UpcomingAction) => void },
): JSX.Element {
	const action = item.action;
	return (
		<li class="wlt-row" data-attention={item.attention ? "true" : undefined}>
			<span class="wlt-row__mark" data-kind={item.kind}>
				{item.progress !== null
					? (
						<ProgressRing
							value={Math.round(item.progress * 100)}
							size={36}
							strokeWidth={3}
							aria-label="Safety window elapsed"
							class="wlt-row__ring"
						>
							<UpcomingIcon kind={item.kind} size="2xs" />
						</ProgressRing>
					)
					: <UpcomingIcon kind={item.kind} size="sm" />}
			</span>
			<span class="wlt-row__body">
				{item.href
					? <a class="wlt-row__title wlt-row__title--link" href={item.href}>{item.title}</a>
					: <span class="wlt-row__title">{item.title}</span>}
				{item.meta && <span class="wlt-row__meta">{item.meta}</span>}
			</span>
			{(item.amount || item.when) && (
				<span class="wlt-row__trail">
					{item.amount && (
						<MoneyView value={item.amount} size="body" hideOrigin class="wlt-row__amount" />
					)}
					{item.when && <span class="wlt-row__when">{item.when}</span>}
				</span>
			)}
			{action && (
				<Button
					variant="text"
					size="sm"
					class="wlt-row__action"
					label={action.label}
					aria-label={`${action.label}: ${item.title}`}
					onClick={() => onAction(action)}
				/>
			)}
		</li>
	);
}

/** Scheduled and pending obligations — releases clearing, funded stages, rules, payouts, approvals. */
export function UpcomingList(props: UpcomingListProps): JSX.Element {
	const expanded = useSignal(false);
	const { items } = props;
	const shown = expanded.value ? items : items.slice(0, VISIBLE);
	const hidden = items.length - shown.length;
	return (
		<section class="wlt-section wlt-upcoming" id="upcoming" aria-labelledby="wlt-upcoming-title">
			<header class="wlt-section__head">
				<h2 id="wlt-upcoming-title" class="wlt-section__title">Upcoming</h2>
				{items.length > 0 && <span class="wlt-section__count">{items.length}</span>}
			</header>
			{items.length > 0
				? (
					<ul class="wlt-rows">
						{shown.map((item) => (
							<UpcomingRow
								key={item.id}
								item={item}
								onAction={props.onAction}
							/>
						))}
					</ul>
				)
				: props.errors.length === 0 && <p class="wlt-empty">Nothing scheduled or on its way.</p>}
			{(hidden > 0 || expanded.value) && items.length > VISIBLE && (
				<Button
					variant="text"
					size="sm"
					class="wlt-section__more"
					label={expanded.value ? "Show fewer" : `Show ${hidden} more`}
					aria-expanded={expanded.value}
					onClick={() => {
						expanded.value = !expanded.value;
					}}
				/>
			)}
			{props.errors.length > 0 && (
				<InlineNotice
					text={props.errors[0]}
					actionLabel="Try again"
					onAction={props.onRetry}
					busy={props.retrying}
					align="start"
					class="wlt-notice"
				/>
			)}
		</section>
	);
}
