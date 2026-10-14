import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { cx } from "../../../core/cx.ts";
import { styleVars } from "../../../core/style.ts";
import { Button } from "../../../fields/components/Button.tsx";
import { Popover } from "../../../feedback/islands/Popover.tsx";
import { Icon } from "../../../icons/components/Icon.tsx";
import { dateName, monthName, ruleName, weekdayName } from "./announce.ts";
import { DAY_MINUTES, monthMatrix, monthOf, weekColumns } from "./civil.ts";
import { type SchedulerContextValue, useScheduler } from "./context.ts";
import { bucketByDate, type DayBands, explanationLines, summarise } from "./month.ts";
import type { Band, SchedulerBlackout } from "./types.ts";

// #region Pieces
interface BarsProps {
	bands: Band[];
	layer: "working" | "call";
}

function Bars({ bands, layer }: BarsProps): JSX.Element {
	return (
		<span
			class={cx("ui-avsched__date-track", `ui-avsched__date-track--${layer}`)}
			aria-hidden="true"
		>
			{bands.map((b) => (
				<span
					key={b.start}
					class={cx("ui-avsched__date-bar", `ui-avsched__date-bar--${layer}`)}
					style={styleVars({
						"--avsched-from": b.start / DAY_MINUTES,
						"--avsched-to": b.end / DAY_MINUTES,
					})}
				/>
			))}
		</span>
	);
}

interface WhyPanelProps {
	date: string;
	blackout: SchedulerBlackout | undefined;
	ctx: SchedulerContextValue;
}

function WhyPanel(props: WhyPanelProps): JSX.Element {
	const { store, locale, viewerOwns } = props.ctx;
	const draft = store.draft.value;
	const nameOf = (ruleId: string, label: string) => {
		const rule = draft.rules.find((r) => r.id === ruleId);
		return label.trim() || (rule ? ruleName(rule, (r) => store.engine.describe(r)) : ruleId);
	};
	const lines = explanationLines(store.engine.explain(draft, props.date), nameOf);
	const { blackout } = props;
	return (
		<div class="ui-avsched__why">
			<p class="ui-avsched__heading">Why {dateName(props.date, locale)} looks like this</p>
			<ul class="ui-avsched__why-list">
				{blackout && (
					<li>
						Blackout{blackout.label && (blackout.labelIsPublic || viewerOwns)
							? `: ${blackout.label}`
							: ""}
					</li>
				)}
				{lines.map((line, i) => <li key={i}>{line}</li>)}
			</ul>
		</div>
	);
}
// #endregion

// #region MonthPreview
/**
 * The evaluated result for the focused month: each date carries band bars for both layers and a
 * summary, and opening a date shows the engine's "why" in a popover.
 */
export function MonthPreview(): JSX.Element | null {
	const ctx = useScheduler();
	const { store, locale, weekStartsOn, today, blackouts, viewerOwns, idBase } = ctx;
	const active = useSignal<string | null>(null);
	const state = store.state.value;
	if (state.view !== "month") return null;

	const month = state.focusMonth;
	const dates = monthMatrix(month, weekStartsOn);
	const buckets = bucketByDate(store.occurrences.value, state.draft.timezone);
	const focusDate = active.value && dates.includes(active.value)
		? active.value
		: dates.includes(today)
		? today
		: `${month}-01`;
	const headingId = `${idBase}-month`;
	const dateId = (d: string) => `${idBase}-d${d}`;

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		const steps: Record<string, number> = {
			ArrowLeft: -1,
			ArrowRight: 1,
			ArrowUp: -7,
			ArrowDown: 7,
		};
		const i = dates.indexOf(focusDate);
		let next = i;
		if (e.key in steps) next = i + steps[e.key];
		else if (e.key === "Home") next = i - (i % 7);
		else if (e.key === "End") next = i - (i % 7) + 6;
		else return;
		e.preventDefault();
		if (next < 0 || next >= dates.length) {
			store.dispatch({ type: "shiftMonth", months: next < 0 ? -1 : 1 });
			return;
		}
		active.value = dates[next];
		document.getElementById(dateId(dates[next]))?.focus();
	};

	const weeks = Array.from({ length: 6 }, (_, w) => dates.slice(w * 7, w * 7 + 7));

	return (
		<div class="ui-avsched__month">
			<div class="ui-avsched__month-head">
				<Button
					variant="text"
					size="sm"
					iconOnly
					icon={<Icon name="chevron-left" />}
					aria-label="Previous month"
					aria-keyshortcuts="["
					onClick={() => store.dispatch({ type: "shiftMonth", months: -1 })}
				/>
				<h3 class="ui-avsched__month-title" id={headingId}>{monthName(month, locale)}</h3>
				<Button
					variant="text"
					size="sm"
					iconOnly
					icon={<Icon name="chevron-right" />}
					aria-label="Next month"
					aria-keyshortcuts="]"
					onClick={() => store.dispatch({ type: "shiftMonth", months: 1 })}
				/>
			</div>
			<div
				class="ui-avsched__month-grid"
				role="grid"
				aria-labelledby={headingId}
				onKeyDown={onKeyDown}
			>
				<div role="row" class="ui-avsched__month-row">
					{weekColumns(weekStartsOn).map((d) => (
						<div role="columnheader" class="ui-avsched__weekday" key={d}>
							<span aria-hidden="true">{weekdayName(d, locale, "short")}</span>
							<span class="ui-visually-hidden">{weekdayName(d, locale)}</span>
						</div>
					))}
				</div>
				{weeks.map((week) => (
					<div role="row" class="ui-avsched__month-row" key={week[0]}>
						{week.map((date) => {
							const day: DayBands | undefined = buckets.get(date);
							const blackout = blackouts.find((b) => b.date === date);
							const summary = blackout ? "Blackout" : summarise(day);
							const showLabel = blackout?.label && (blackout.labelIsPublic || viewerOwns);
							const label = [
								dateName(date, locale),
								summary,
								showLabel ? blackout?.label : "",
								date === today ? "today" : "",
							].filter(Boolean).join(", ");
							return (
								<div role="gridcell" class="ui-avsched__date-cell" key={date}>
									<Popover
										label={`Why ${dateName(date, locale)}`}
										placement="bottom-start"
										trigger={(api) => (
											<button
												ref={api.ref as RefObject<HTMLButtonElement>}
												id={dateId(date)}
												type="button"
												tabIndex={date === focusDate ? 0 : -1}
												class={cx(
													"ui-avsched__date",
													monthOf(date) !== month && "ui-avsched__date--outside",
													blackout && "ui-avsched__date--blackout",
													date === today && "ui-avsched__date--today",
												)}
												aria-label={label}
												aria-haspopup="dialog"
												aria-expanded={api.expanded}
												aria-controls={api.panelId}
												aria-current={date === today ? "date" : undefined}
												onFocus={() => {
													active.value = date;
												}}
												onClick={api.toggle}
											>
												<span class="ui-avsched__date-num" aria-hidden="true">
													{Number(date.slice(8))}
												</span>
												<Bars bands={day?.working ?? []} layer="working" />
												<Bars bands={day?.call ?? []} layer="call" />
												<span class="ui-avsched__date-summary" aria-hidden="true">
													{showLabel ? blackout?.label : summary}
												</span>
											</button>
										)}
									>
										<WhyPanel date={date} blackout={blackout} ctx={ctx} />
									</Popover>
								</div>
							);
						})}
					</div>
				))}
			</div>
			<p class="ui-avsched__legend" aria-hidden="true">
				<span class="ui-avsched__swatch ui-avsched__swatch--working" />Working hours
				<span class="ui-avsched__swatch ui-avsched__swatch--call" />Calls
				<span class="ui-avsched__swatch ui-avsched__swatch--blackout" />Blackout
			</p>
		</div>
	);
}
// #endregion
