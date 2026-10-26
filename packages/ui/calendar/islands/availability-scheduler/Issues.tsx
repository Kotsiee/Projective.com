import type { JSX } from "preact";
import { cx } from "../../../core/cx.ts";
import { Tooltip } from "../../../feedback/islands/Tooltip.tsx";
import { Button } from "../../../fields/components/Button.tsx";
import { Icon } from "../../../icons/components/Icon.tsx";
import { dateName, ruleName } from "./announce.ts";
import { useScheduler } from "./context.ts";

/**
 * Conflicts, call time outside working hours and empty stretches, errors first. Renders nothing while
 * there is nothing to say.
 */
export function Issues(): JSX.Element | null {
	const { store, locale } = useScheduler();
	const draft = store.draft.value;
	const issues = [...store.issues.value].sort((a, b) =>
		a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1
	);
	if (issues.length === 0) return null;

	return (
		<section class="ui-avsched__issues" aria-label="Checks">
			<div class="ui-avsched__section-head">
				<h3 class="ui-avsched__heading">Checks</h3>
				<span class="ui-avsched__count">{issues.length}</span>
			</div>
			<ul class="ui-avsched__issue-list">
				{issues.map((issue, i) => {
					const rule = issue.ruleId ? draft.rules.find((r) => r.id === issue.ruleId) : undefined;
					const name = rule ? ruleName(rule, (r) => store.engine.describe(r)) : null;
					const meta = [name, issue.date ? `from ${dateName(issue.date, locale)}` : null]
						.filter(Boolean).join(" · ");
					const error = issue.severity === "error";
					return (
						<li
							key={`${issue.kind}-${issue.ruleId ?? ""}-${issue.layer ?? ""}-${i}`}
							class={cx(
								"ui-avsched__issue",
								error ? "ui-avsched__issue--error" : "ui-avsched__issue--warn",
							)}
						>
							<span class="ui-avsched__issue-kind">
								<Icon name={error ? "error" : "warning"} size="xs" />
								<span class="ui-visually-hidden">{error ? "Error" : "Warning"}</span>
							</span>
							<span class="ui-avsched__issue-text">
								{issue.message}
								{meta && <span class="ui-avsched__issue-meta">{meta}</span>}
							</span>
							{rule && (
								<Tooltip content="Edit rule">
									<Button
										variant="text"
										size="sm"
										iconOnly
										class="ui-hit"
										icon={<Icon name="edit" />}
										aria-label={`Edit rule ${name}`}
										onClick={() => store.dispatch({ type: "edit", ruleId: rule.id })}
									/>
								</Tooltip>
							)}
						</li>
					);
				})}
			</ul>
		</section>
	);
}
