import type { JSX } from "preact";
import { cx } from "../../../core/cx.ts";
import { Button } from "../../../fields/components/Button.tsx";
import { dateName, ruleName } from "./announce.ts";
import { useScheduler } from "./context.ts";

/** Conflicts, call time outside working hours and empty stretches, errors first. */
export function Issues(): JSX.Element {
	const { store, locale } = useScheduler();
	const draft = store.draft.value;
	const issues = [...store.issues.value].sort((a, b) =>
		a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1
	);
	const errors = issues.filter((i) => i.severity === "error").length;

	return (
		<div class="ui-avsched__issues">
			<div class="ui-avsched__rules-head">
				<h3 class="ui-avsched__heading">Checks</h3>
				<span class="ui-avsched__count">
					{issues.length
						? `${errors} ${errors === 1 ? "error" : "errors"} · ${issues.length - errors} ${
							issues.length - errors === 1 ? "warning" : "warnings"
						}`
						: "All clear"}
				</span>
			</div>
			{issues.length > 0 && (
				<ul class="ui-avsched__issue-list">
					{issues.map((issue, i) => {
						const rule = issue.ruleId ? draft.rules.find((r) => r.id === issue.ruleId) : undefined;
						const name = rule ? ruleName(rule, (r) => store.engine.describe(r)) : null;
						const meta = [name, issue.date ? `from ${dateName(issue.date, locale)}` : null]
							.filter(Boolean).join(" · ");
						return (
							<li
								key={`${issue.kind}-${issue.ruleId ?? ""}-${issue.layer ?? ""}-${i}`}
								class={cx(
									"ui-avsched__issue",
									issue.severity === "error"
										? "ui-avsched__issue--error"
										: "ui-avsched__issue--warn",
								)}
							>
								<span class="ui-avsched__issue-kind">
									{issue.severity === "error" ? "Error" : "Warning"}
								</span>
								<span class="ui-avsched__issue-text">
									{issue.message}
									{meta && <span class="ui-avsched__issue-meta">{meta}</span>}
								</span>
								{rule && (
									<Button
										variant="text"
										size="sm"
										label="Edit rule"
										aria-label={`Edit rule ${name}`}
										onClick={() => store.dispatch({ type: "edit", ruleId: rule.id })}
									/>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
