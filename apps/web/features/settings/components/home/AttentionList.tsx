import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import type { AttentionItem } from "../../core/attention-model.ts";

/** Props for {@link AttentionList}. */
export interface AttentionListProps {
	items: readonly AttentionItem[];
	/** `false` while no facts could be read — said honestly rather than as an all-clear. */
	known: boolean;
}

const TONE_ICON = { danger: "error", warning: "warning", info: "info" } as const;

/**
 * AttentionList — "Needs your attention" at the top of the `/settings` hub: what stands between the
 * person and earning, paying or keeping their account, most urgent first, each with its one action.
 */
export function AttentionList(props: AttentionListProps): JSX.Element {
	return (
		<section class="stg-attention" aria-labelledby="stg-attention-title">
			<h2 id="stg-attention-title" class="stg-block__title">Needs your attention</h2>
			{props.items.length === 0
				? (
					<p class="stg-attention__clear" role="status">
						<Icon name={props.known ? "success" : "info"} size="sm" aria-hidden="true" />
						{props.known
							? "You're all set. Nothing needs your attention."
							: "We couldn't check your account just now. Everything below still works."}
					</p>
				)
				: (
					<ul class="stg-attention__list">
						{props.items.map((item) => (
							<li key={item.key} class="stg-attention__item" data-tone={item.tone}>
								<span class="stg-attention__mark" aria-hidden="true">
									<Icon name={TONE_ICON[item.tone]} size="sm" />
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
	);
}
