import type { JSX } from "preact";
import type { Ref } from "preact";
import { useEffect, useMemo } from "preact/hooks";
import { type Signal, useSignal } from "@preact/signals";
import { LaneSearch, TreeNav, type TreeNavNode } from "@projective/ui/navigation";
import { Icon } from "@projective/ui/icons";
import type { UserContext } from "@projective/types/auth";
import {
	normalizeQuery,
	searchSettings,
	type SettingsSectionKey,
	topSearchTarget,
} from "../core/settings-registry.ts";
import type { AttentionTone } from "../core/attention-model.ts";

/**
 * SettingsNavigator — the search field and the section tree, shared verbatim by the contextual modal's
 * left pane and the console's middle-nav lane (Decision #150), so filtering and keyboard behaviour are
 * one implementation.
 *
 * - Typing filters the tree through the registry's search (every word must match; "dark mode" leaves
 *   Appearance → Theme). Enter opens the best match and moves focus INTO it.
 * - The tree is `TreeNav`: one tab stop, ArrowUp/Down between rows, Right/Left to open and close a
 *   section, Home/End, Enter/Space to activate.
 * - A section that needs attention carries a toned mark — a glyph AND a word for assistive tech,
 *   never the colour alone.
 */

// #region Shapes
/** Where the person is. */
export interface SettingsLocation {
	section: SettingsSectionKey;
	anchor: string | null;
}

export interface SettingsNavigatorProps {
	context: UserContext | null;
	selected: SettingsLocation | null;
	/** `focus` is true when the person asked to go INTO the section (Enter in the search field). */
	onSelect: (location: SettingsLocation, focus: boolean) => void;
	/** The live query — owned by the caller so the lane and the modal can each keep their own. */
	query: Signal<string>;
	/** Attention marks per section. */
	marks?: Partial<Record<SettingsSectionKey, AttentionTone>>;
	/** The search input, for the `/` shortcut. */
	searchRef?: Ref<HTMLDivElement>;
	label?: string;
}
// #endregion

const TONE_WORD: Readonly<Record<AttentionTone, string>> = {
	danger: "needs attention",
	warning: "action needed",
	info: "update",
};

const TONE_ICON: Readonly<Record<AttentionTone, "error" | "warning" | "info">> = {
	danger: "error",
	warning: "warning",
	info: "info",
};

function nodeKey(section: SettingsSectionKey, anchor: string | null): string {
	return anchor ? `${section}#${anchor}` : section;
}

function parseKey(key: string): SettingsLocation {
	const [section, anchor] = key.split("#");
	return { section: section as SettingsSectionKey, anchor: anchor ?? null };
}

export function SettingsNavigator(props: SettingsNavigatorProps): JSX.Element {
	const { query, context, selected } = props;
	const q = normalizeQuery(query.value);
	const hits = useMemo(() => searchSettings(query.value, context), [query.value, context]);
	const expanded = useSignal<Set<string>>(new Set(selected ? [selected.section] : []));

	// Searching opens every matching section; otherwise the open one follows the selection.
	useEffect(() => {
		if (q) expanded.value = new Set(hits.map((hit) => hit.section.key));
		else if (selected) expanded.value = new Set([...expanded.peek(), selected.section]);
	}, [q, hits, selected?.section]);

	const nodes: TreeNavNode[] = hits.map(({ section, entries }) => {
		const tone = props.marks?.[section.key];
		return {
			key: section.key,
			label: section.label,
			icon: <Icon name={section.icon} size="sm" />,
			status: tone
				? (
					<span class={`stg-mark stg-mark--${tone}`} role="img" aria-label={TONE_WORD[tone]}>
						<Icon name={TONE_ICON[tone]} size="xs" aria-hidden="true" />
					</span>
				)
				: null,
			children: entries.map((entry) => ({
				key: nodeKey(section.key, entry.anchor),
				label: entry.label,
			})),
		};
	});

	function onKeyDown(event: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
		if (event.key !== "Enter") return;
		const target = topSearchTarget(query.peek(), context);
		if (!target) return;
		event.preventDefault();
		props.onSelect({ section: target.section, anchor: target.anchor }, true);
	}

	return (
		<div class="stg-nav">
			<div class="stg-nav__search" ref={props.searchRef} onKeyDown={onKeyDown}>
				<LaneSearch
					value={query.value}
					placeholder="Search settings"
					label="Search settings (press / to focus)"
					icon={<Icon name="search" size="sm" />}
					onInput={(value) => (query.value = value)}
				/>
			</div>
			{nodes.length === 0
				? <p class="stg-nav__empty" role="status">No settings match “{query.value.trim()}”.</p>
				: (
					<TreeNav
						class="stg-nav__tree"
						nodes={nodes}
						selectedKey={selected ? nodeKey(selected.section, selected.anchor) : null}
						expanded={expanded}
						aria-label={props.label ?? "Settings sections"}
						onSelect={(node) => props.onSelect(parseKey(node.key), false)}
					/>
				)}
			{q
				? (
					<p class="ui-visually-hidden" role="status">
						{`${hits.length} ${hits.length === 1 ? "section matches" : "sections match"}`}
					</p>
				)
				: null}
		</div>
	);
}
