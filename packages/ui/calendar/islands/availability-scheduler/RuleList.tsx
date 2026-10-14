import type { JSX } from "preact";
import { cx } from "../../../core/cx.ts";
import { Button } from "../../../fields/components/Button.tsx";
import { Icon } from "../../../icons/components/Icon.tsx";
import { ruleName } from "./announce.ts";
import { useScheduler } from "./context.ts";
import type { RuleDraft } from "./types.ts";

/** Every rule as its sentence; selecting one opens it in the RuleEditor. */
export function RuleList(): JSX.Element {
	const { store } = useScheduler();
	const draft = store.draft.value;
	const editing = store.editing.value;
	const describe = (rule: RuleDraft) => store.engine.describe(rule);
	const active = draft.rules.filter((r) => r.active).length;

	return (
		<div class="ui-avsched__rules">
			<div class="ui-avsched__rules-head">
				<h3 class="ui-avsched__heading">Rules</h3>
				<span class="ui-avsched__count">
					{active} of {draft.rules.length} active
				</span>
				<Button
					variant="text"
					size="sm"
					label="Add rule"
					icon={<Icon name="plus" />}
					onClick={() => store.dispatch({ type: "addRule" })}
				/>
			</div>
			{draft.rules.length === 0
				? (
					<p class="ui-avsched__meta">
						No rules yet. Drag on the week to add working hours, or start from a template.
					</p>
				)
				: (
					<ul class="ui-avsched__rule-list">
						{draft.rules.map((rule) => {
							const name = ruleName(rule, describe);
							return (
								<li
									key={rule.id}
									class={cx(
										"ui-avsched__rule",
										!rule.active && "ui-avsched__rule--inactive",
										editing === rule.id && "ui-avsched__rule--editing",
									)}
								>
									<button
										type="button"
										class="ui-avsched__rule-main"
										aria-current={editing === rule.id ? "true" : undefined}
										onClick={() => store.dispatch({ type: "edit", ruleId: rule.id })}
									>
										<span class="ui-avsched__rule-sentence">{describe(rule)}</span>
										{(rule.label || !rule.active) && (
											<span class="ui-avsched__rule-meta">
												{[rule.label, rule.active ? "" : "Paused"].filter(Boolean).join(" · ")}
											</span>
										)}
									</button>
									<Button
										variant="text"
										size="sm"
										label={rule.active ? "Pause" : "Resume"}
										aria-label={`${rule.active ? "Pause" : "Resume"} rule ${name}`}
										onClick={() => store.upsertRule({ ...rule, active: !rule.active })}
									/>
									<Button
										variant="text"
										severity="danger"
										size="sm"
										iconOnly
										icon={<Icon name="trash" />}
										aria-label={`Delete rule ${name}`}
										onClick={() => store.deleteRule(rule.id, name)}
									/>
								</li>
							);
						})}
					</ul>
				)}
		</div>
	);
}
