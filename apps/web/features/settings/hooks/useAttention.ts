import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
	type SettingsAttentionFacts,
	type SettingsSectionKey,
	UNKNOWN_ATTENTION_FACTS,
} from "@projective/types/settings";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import {
	attentionBySection,
	type AttentionItem,
	attentionItems,
	type AttentionSimulation,
	type AttentionTone,
	simulatedAttentionFacts,
} from "../core/attention-model.ts";
import { SettingsService } from "../core/SettingsService.ts";

/** What {@link useAttention} answers. */
export interface AttentionView {
	/** The facts the rule ran on (after any dev simulation). */
	facts: SettingsAttentionFacts;
	items: AttentionItem[];
	marks: Partial<Record<SettingsSectionKey, AttentionTone>>;
	/** Whether real facts have been read (a fetch can still be in flight). */
	known: boolean;
}

/**
 * The attention items and per-section marks for a Settings surface — the server's facts when the
 * page was rendered with them, otherwise read once from `/api/settings/attention` (the modal opens
 * over any page). The dev `settingsAttention` axis substitutes the facts; the shipping rule still
 * decides what shows.
 */
export function useAttention(
	initial: SettingsAttentionFacts | null,
	locale: string,
): AttentionView {
	const real = useSignal<SettingsAttentionFacts | null>(initial);
	const simulation = useSignal<AttentionSimulation>("auto");

	useEffect(() => {
		const apply = () => (simulation.value = readDevSeam()?.settingsAttention ?? "auto");
		apply();
		const unsubscribe = subscribeDevSeam(apply);
		if (initial === null) {
			SettingsService.attention().then((res) => {
				if (res.ok) real.value = res.data.facts;
			});
		}
		return unsubscribe;
	}, []);

	const facts = simulatedAttentionFacts(simulation.value, real.value ?? UNKNOWN_ATTENTION_FACTS);
	const items = attentionItems(facts, { locale });
	return { facts, items, marks: attentionBySection(items), known: real.value !== null };
}
