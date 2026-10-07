import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Icon } from "@projective/ui/icons";
import type { UserContext } from "@projective/types/auth";
import type { SettingsAttentionFacts } from "@projective/types/settings";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { useEffectiveContext } from "@features/shell/core/effective-context.ts";
import {
	attentionBySection,
	attentionItems,
	type AttentionSimulation,
	simulatedAttentionFacts,
} from "../core/attention-model.ts";
import { settingsHref, visibleSections } from "../core/settings-registry.ts";

// #region Stylesheet carrier
import "../styles/settings.css";
// #endregion

/**
 * SettingsHome — the `/settings` root (Decision #150). On every viewport it leads with the ATTENTION
 * dashboard: the few things that block earning or paying (an identity check, a missing payout bank
 * account, an unverified business, an expired connector, an unconfirmed email), most urgent first, each
 * with its one action. Below the console's container breakpoint — where the shell has no lane — it
 * also renders the drill-down menu of every section; on a wide console the lane IS that menu.
 *
 * Built from FACTS through the shipping rule (`attentionItems`), so the dev `settingsAttention` axis
 * can substitute facts and still exercise the real rule.
 */

export interface SettingsHomeProps {
	context: UserContext;
	facts: SettingsAttentionFacts;
}

export default function SettingsHome(props: SettingsHomeProps): JSX.Element {
	const effective = useEffectiveContext(props.context);
	const simulation = useSignal<AttentionSimulation>("auto");

	useEffect(() => {
		const apply = () => (simulation.value = readDevSeam()?.settingsAttention ?? "auto");
		apply();
		return subscribeDevSeam(apply);
	}, []);

	const facts = simulatedAttentionFacts(simulation.value, props.facts);
	const items = attentionItems(facts);
	const marks = attentionBySection(items);
	const unknown = facts.verification === null && facts.connections === null;

	return (
		<div class="stg-home">
			<header class="stg-head stg-head--page">
				<h1 class="stg-head__title">Settings</h1>
				<p class="stg-head__lede">
					Your account, how Projective looks and talks to you, and how you get paid.
				</p>
			</header>

			<section class="stg-attention" aria-labelledby="stg-attention-title">
				<h2 id="stg-attention-title" class="stg-block__title">Needs your attention</h2>
				{items.length === 0
					? (
						<p class="stg-attention__clear" role="status">
							<Icon name={unknown ? "info" : "success"} size="sm" aria-hidden="true" />
							{unknown
								? "We couldn't check your account just now. Everything below still works."
								: "You're all set. Nothing needs your attention."}
						</p>
					)
					: (
						<ul class="stg-attention__list">
							{items.map((item) => (
								<li key={item.key} class="stg-attention__item" data-tone={item.tone}>
									<span class="stg-attention__mark" aria-hidden="true">
										<Icon
											name={item.tone === "danger"
												? "error"
												: item.tone === "warning"
												? "warning"
												: "info"}
											size="sm"
										/>
									</span>
									<div class="stg-attention__text">
										<span class="stg-attention__title">{item.title}</span>
										<span class="stg-attention__detail">{item.detail}</span>
									</div>
									<a class="stg-attention__action" href={item.href}>
										{item.action}
										<span class="ui-visually-hidden">: {item.title}</span>
									</a>
								</li>
							))}
						</ul>
					)}
			</section>

			<nav class="stg-drill" aria-labelledby="stg-drill-title">
				<h2 id="stg-drill-title" class="stg-block__title stg-drill__title">All settings</h2>
				<ul class="stg-drill__list">
					{visibleSections(effective.value.context).map((section) => (
						<li key={section.key}>
							<a class="stg-drill__item" href={settingsHref(section.key)}>
								<span class="stg-drill__icon" aria-hidden="true">
									<Icon name={section.icon} size="md" />
								</span>
								<span class="stg-drill__text">
									<span class="stg-drill__label">
										{section.label}
										{marks[section.key]
											? (
												<span
													class={`stg-mark stg-mark--${marks[section.key]}`}
													role="img"
													aria-label="needs attention"
												>
													<Icon name="warning" size="xs" aria-hidden="true" />
												</span>
											)
											: null}
									</span>
									<span class="stg-drill__desc">{section.description}</span>
								</span>
								<Icon name="chevron-right" size="sm" aria-hidden="true" class="stg-drill__chev" />
							</a>
						</li>
					))}
				</ul>
			</nav>
		</div>
	);
}
