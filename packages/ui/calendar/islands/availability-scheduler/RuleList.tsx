import type { JSX } from "preact";
import { cx } from "../../../core/cx.ts";
import { Tooltip } from "../../../feedback/islands/Tooltip.tsx";
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
		<section class="ui-avsched__rules" aria-label="Rules">
			<div class="ui-avsched__section-head">
				<h3 class="ui-avsched__heading">Rules</h3>
				{draft.rules.length > 0 && (
					<span class="ui-avsched__count" aria-label={`${active} of ${draft.rules.length} active`}>
						{active}/{draft.rules.length}
					</span>
				)}
				<Tooltip content="Add rule">
					<Button
						variant="text"
						size="sm"
						iconOnly
						class="ui-hit"
						icon={<Icon name="plus" />}
						aria-label="Add rule"
						onClick={() => store.dispatch({ type: "addRule" })}
					/>
				</Tooltip>
			</div>
			{draft.rules.length === 0
				? <p class="ui-avsched__meta">Drag on the calendar to add hours.</p>
				: (
					<ul class="ui-avsched__rule-list">
						{draft.rules.map((rule) => {
							const name = ruleName(rule, describe);
							const verb = rule.active ? "Pause" : "Resume";
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
									<Tooltip content={verb}>
										<Button
											variant="text"
											size="sm"
											iconOnly
											class="ui-hit"
											icon={<Icon name={rule.active ? "pause" : "play"} />}
											aria-label={`${verb} rule ${name}`}
											onClick={() => store.upsertRule({ ...rule, active: !rule.active })}
										/>
									</Tooltip>
									<Tooltip content="Delete">
										<Button
											variant="text"
											severity="danger"
											size="sm"
											iconOnly
											class="ui-hit"
											icon={<Icon name="trash" />}
											aria-label={`Delete rule ${name}`}
											onClick={() => store.deleteRule(rule.id, name)}
										/>
									</Tooltip>
								</li>
							);
						})}
					</ul>
				)}
		</section>
	);
}
