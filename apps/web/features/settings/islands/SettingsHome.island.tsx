import type { JSX } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { UserContext } from "@projective/types/auth";
import type { SettingsAttentionFacts, SettingsSectionKey } from "@projective/types/settings";
import { useEffectiveContext } from "@features/shell/core/effective-context.ts";
import { isEditableTarget, isFocusSearchShortcut } from "@features/shell/core/shortcuts.ts";
import {
	searchSettings,
	sectionEntries,
	settingsHref,
	type SettingsRegistryEntry,
	topSearchTarget,
	visibleSections,
} from "../core/settings-registry.ts";
import { useAttention } from "../hooks/useAttention.ts";
import { HubSearch } from "../components/home/HubSearch.tsx";
import { AttentionList } from "../components/home/AttentionList.tsx";
import { ProfileProgress } from "../components/home/ProfileProgress.tsx";
import { SectionCards } from "../components/home/SectionCards.tsx";

// #region Stylesheet carrier
import "../styles/settings.css";
import "../styles/settings-home.css";
// #endregion

/**
 * SettingsHome — the `/settings` hub (Decision #151, extended by #156). In order: an in-page search
 * over every setting; "Needs your attention", most urgent first, each with its one action; the profile
 * completeness tracker with one call to action to the next step; and every section as a card that
 * opens it — filtered, while searching, to the sections and settings that match.
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
	const query = useSignal("");
	const searchRef = useRef<HTMLDivElement>(null);
	const ctx = effective.value.context;
	const attention = useAttention(props.facts, ctx.locale);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (!isFocusSearchShortcut(event) || isEditableTarget(event.target as Element | null)) return;
			if (document.querySelector(".ui-dialog")) return;
			const input = searchRef.current?.querySelector<HTMLInputElement>("input");
			if (!input) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			input.focus();
			input.select();
		};
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, []);

	const searching = query.value.trim().length > 0;
	const hits = useMemo(() => searchSettings(query.value, ctx), [query.value, ctx]);
	const contents = useMemo(() => {
		const out: Partial<Record<SettingsSectionKey, SettingsRegistryEntry[]>> = {};
		for (const section of visibleSections(ctx)) out[section.key] = sectionEntries(section.key, ctx);
		return out;
	}, [ctx]);

	function openBest(): void {
		const target = topSearchTarget(query.peek(), ctx);
		if (target) globalThis.location.assign(settingsHref(target.section, target.anchor));
	}

	return (
		<div class="stg-home">
			<header class="stg-head stg-head--page">
				<h1 class="stg-head__title">Settings</h1>
				<p class="stg-head__lede">
					Your account, how Projective looks and talks to you, and how you get paid.
				</p>
			</header>

			<HubSearch query={query} matches={hits.length} inputRef={searchRef} onSubmit={openBest} />

			{searching ? null : <AttentionList items={attention.items} known={attention.known} />}

			{!searching && attention.facts.profile
				? <ProfileProgress profile={attention.facts.profile} />
				: null}

			<section class="stg-hub" aria-labelledby="stg-hub-title">
				<h2 id="stg-hub-title" class="stg-block__title">
					{searching ? "Results" : "All settings"}
				</h2>
				<SectionCards
					hits={hits}
					contents={contents}
					searching={searching}
					query={query.value}
					marks={attention.marks}
				/>
			</section>
		</div>
	);
}
