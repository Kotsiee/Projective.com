import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import type { SettingsSectionKey } from "@projective/types/settings";
import {
	settingsHref,
	type SettingsRegistryEntry,
	type SettingsSearchHit,
} from "../../core/settings-registry.ts";
import type { AttentionTone } from "../../core/attention-model.ts";

/** Props for {@link SectionCards}. */
export interface SectionCardsProps {
	hits: readonly SettingsSearchHit[];
	/** Every visible entry per section — what an unfiltered card lists as its contents. */
	contents: Readonly<Partial<Record<SettingsSectionKey, readonly SettingsRegistryEntry[]>>>;
	searching: boolean;
	query: string;
	marks: Partial<Record<SettingsSectionKey, AttentionTone>>;
}

const TONE_WORD: Readonly<Record<AttentionTone, string>> = {
	danger: "needs attention",
	warning: "action needed",
	info: "update",
};

/**
 * SectionCards — the hub's grid of settings categories. Each card is ONE discrete, addressable
 * object (a section of the console), so it is interactive end to end: the whole card opens the
 * section. At rest a card lists what it holds as plain meta text; while searching it lists the
 * matching settings as links straight to each one. A section needing attention carries the same dot
 * badge the lane does.
 */
export function SectionCards(props: SectionCardsProps): JSX.Element {
	if (props.hits.length === 0) {
		return (
			<p class="stg-hub-cards__empty" role="status">
				No settings match “{props.query.trim()}”.
			</p>
		);
	}
	return (
		<ul class="stg-hub-cards" aria-label={props.searching ? "Matching settings" : "All settings"}>
			{props.hits.map(({ section, entries }) => {
				const tone = props.marks[section.key];
				const titleId = `stg-hub-card-${section.key}`;
				const contents = props.contents[section.key] ?? [];
				return (
					<li key={section.key} class="stg-hub-card" data-tone={tone}>
						<span class="stg-hub-card__icon" aria-hidden="true">
							<Icon name={section.icon} size="md" />
						</span>
						<div class="stg-hub-card__body">
							<h3 class="stg-hub-card__title" id={titleId}>
								<a class="stg-hub-card__link" href={settingsHref(section.key)}>{section.label}</a>
								{tone
									? (
										<span
											class={`stg-dot stg-dot--${tone}`}
											role="img"
											aria-label={TONE_WORD[tone]}
										/>
									)
									: null}
							</h3>
							<p class="stg-hub-card__desc">{section.description}</p>
							{props.searching
								? (
									<ul class="stg-hub-card__hits" aria-labelledby={titleId}>
										{entries.map((entry) => (
											<li key={entry.key}>
												<a class="stg-hub-card__hit" href={settingsHref(section.key, entry.anchor)}>
													{entry.label}
												</a>
											</li>
										))}
									</ul>
								)
								: contents.length > 0
								? (
									<p class="stg-hub-card__meta">
										{contents.map((entry) => entry.label).join(" · ")}
									</p>
								)
								: null}
						</div>
						<Icon name="chevron-right" size="sm" aria-hidden="true" class="stg-hub-card__chev" />
					</li>
				);
			})}
		</ul>
	);
}
