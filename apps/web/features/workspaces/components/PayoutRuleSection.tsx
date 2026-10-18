import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import type { Signal } from "@preact/signals";
import { InlineNotice } from "@projective/ui/feedback";
import { FormControl, InputNumber, Select, SelectButton } from "@projective/ui/fields";
import { Link } from "@projective/ui/navigation";
import type { SplitRuleType } from "@projective/types/finance";
import type { SplitStake } from "@projective/types/workspace";
import { openSettings } from "@features/settings/core/settings-bridge.ts";
import { settingsHref } from "@features/settings/core/settings-registry.ts";
import {
	ruleFields,
	type RuleProblems,
	stakesMode,
	TEMPLATE_SENTENCE,
	type TemplateChoice,
} from "../core/payout-model.ts";
import { cloneGlyph } from "../core/workspace-glyphs.tsx";
import { LockGlyph } from "./policy-glyphs.tsx";

/**
 * PayoutRuleSection — the Payouts module's "Split rule": which template the release plan applies before
 * the members' stakes, and that template's parameters (Teams work order C4, Decision #234).
 *
 * A SelectButton of the three templates; under it one Meta sentence saying what the chosen template
 * does (finance-model §5), then its parameters in FormControls — the Vault's cut for Co-op and Finder's
 * fee, the finder and the finder's cut for Finder's fee, nothing for Benevolent dictator, which instead
 * says where the money goes and links to Finance, where it is distributed by hand. Percentages are typed
 * with two decimals and stored as basis points by the island (`payout-model.ts`).
 *
 * A template the team's plan does not unlock is offered DISABLED, with the plan notice and its "See
 * plans" link beside it — never hidden, and never a 402 after the reader pressed Save. The saved
 * template stays selectable even when locked (a downgraded team keeps applying it), but its parameters
 * are read-only: changing them is a write the plan gate refuses.
 */

// #region Props
export interface PayoutRuleSectionProps {
	/** The draft template (the SelectButton's bound value). */
	ruleType: Signal<string | string[]>;
	/** The resolved draft template, for what renders under the control. */
	current: SplitRuleType;
	/** The Vault's cut, in percent (two decimals). */
	vaultPct: Signal<number | null>;
	/** The finder's user id; `""` until chosen. */
	finderId: Signal<string>;
	/** The finder's cut, in percent (two decimals). */
	finderPct: Signal<number | null>;
	/** The three templates, locked and selectable as the team's plan decides. */
	choices: readonly TemplateChoice[];
	/** The active members, the finder's candidates. */
	members: readonly SplitStake[];
	/** The reader may edit (manage_finances, team not archived). */
	editable: boolean;
	/** The draft template's parameters are read-only (its plan no longer unlocks it). */
	paramsLocked: boolean;
	/** The plan notice, or `null` when every template is unlocked. */
	notice: string | null;
	/** Field problems, painted once a Save was attempted. */
	problems: RuleProblems;
	/** The Finance module's address, or `null` when the reader may not open it. */
	financeHref: string | null;
	/** A template was chosen. */
	onTemplate: (value: string | string[]) => void;
	/** Any parameter was edited. */
	onEdit: () => void;
}
// #endregion

// #region See plans
/** Settings → Billing → plan — the same "See plans" the create dialog offers for a plan gate. */
const PLAN_HREF = settingsHref("billing", "plan");

/** Open the plans in the settings modal for a plain click; a modified click follows the link. */
function openPlans(event: JSX.TargetedMouseEvent<HTMLAnchorElement>): void {
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
		return;
	}
	event.preventDefault();
	openSettings("billing", "plan");
}

/** The "See plans" link a plan gate offers — a navigation, so a link, never a button. */
export function PlansLink(): JSX.Element {
	return <Link href={PLAN_HREF} onClick={openPlans}>See plans</Link>;
}
// #endregion

// #region Component
export function PayoutRuleSection(props: PayoutRuleSectionProps): JSX.Element {
	const fields = ruleFields(props.current);
	const readOnly = !props.editable || props.paramsLocked;
	const lockGlyph = useMemo(() => cloneGlyph(LockGlyph), []);
	const finderOptions = props.members
		.filter((m) => m.userId.length > 0)
		.map((m) => ({ label: m.name, value: m.userId }));

	return (
		<section class="wsp-payout__section" aria-labelledby="wsp-payout-rule">
			<div class="wsp-payout__head">
				<h2 class="wsp-band__title" id="wsp-payout-rule">Split rule</h2>
			</div>

			<SelectButton
				aria-label="Split rule"
				options={props.choices.map((choice) => ({
					label: choice.label,
					value: choice.value,
					disabled: choice.disabled,
				}))}
				value={props.ruleType}
				onValueChange={props.onTemplate}
				disabled={!props.editable}
			/>

			{stakesMode(props.current) === "vault"
				? (
					// The template's sentence IS the line that replaces Member stakes, with Finance linked.
					<p class="wsp-payout__meta">
						Everything is paid to the Team Vault; distribute it from{" "}
						{props.financeHref ? <Link href={props.financeHref}>Finance</Link> : "Finance"}.
					</p>
				)
				: <p class="wsp-payout__meta">{TEMPLATE_SENTENCE[props.current]}</p>}

			{props.notice && (
				<InlineNotice align="start" class="wsp-payout__notice" icon={lockGlyph}>
					<span>{props.notice}</span> <PlansLink />
				</InlineNotice>
			)}

			{(fields.vault || fields.finder) && (
				<div class="wsp-payout__fields">
					{fields.finder && (
						<FormControl
							label="Finder"
							hint="The member who originated the project."
							error={props.problems.finder}
							status={props.problems.finder ? "invalid" : "default"}
						>
							{({ id, describedBy, status }) => (
								<Select
									id={id}
									aria-describedby={describedBy}
									status={status}
									options={finderOptions}
									value={props.finderId}
									onValueChange={props.onEdit}
									placeholder="Choose a member"
									disabled={readOnly}
									fluid
								/>
							)}
						</FormControl>
					)}
					{fields.finder && (
						<FormControl
							label="Finder's cut"
							hint="Taken first, before the Vault's cut."
							error={props.problems.finderCut}
							status={props.problems.finderCut ? "invalid" : "default"}
						>
							{({ id, describedBy, status }) => (
								<InputNumber
									id={id}
									aria-describedby={describedBy}
									status={status}
									value={props.finderPct}
									onValueChange={props.onEdit}
									min={0}
									max={100}
									maxFractionDigits={2}
									suffix="%"
									disabled={!props.editable}
									readOnly={readOnly}
									fluid
								/>
							)}
						</FormControl>
					)}
					<FormControl
						label="Vault cut"
						hint={fields.finder
							? "Taken from what the finder leaves, before the members' split."
							: "Taken before the members' split."}
					>
						{({ id, describedBy }) => (
							<InputNumber
								id={id}
								aria-describedby={describedBy}
								value={props.vaultPct}
								onValueChange={props.onEdit}
								min={0}
								max={100}
								maxFractionDigits={2}
								suffix="%"
								disabled={!props.editable}
								readOnly={readOnly}
								fluid
							/>
						)}
					</FormControl>
				</div>
			)}
		</section>
	);
}
// #endregion
