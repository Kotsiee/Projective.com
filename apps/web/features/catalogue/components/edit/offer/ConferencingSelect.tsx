import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Select } from "@projective/ui/fields";
import type { ConnectionsView } from "@projective/types/integrations";
import type { MeetingProvider } from "@projective/types/scheduling";
import { IntegrationsService } from "@web/features/files/core/IntegrationsService.ts";
import { DEFAULT_PROVIDER, providerChoices, providerOf } from "../../../core/conferencing-model.ts";
import { FieldHead } from "../FieldHead.tsx";

const SELECT_ID = "cat-offer-provider";
const HINT_ID = "cat-offer-provider-hint";

/**
 * ConferencingSelect — which tool mints the room for each booking: the seller's default (resolved
 * at booking time) or one of their active conferencing connections. With none connected, it says so
 * and links to Settings → Integrations instead of offering an empty list.
 */
export function ConferencingSelect(
	props: { value: MeetingProvider | null; onChange: (provider: MeetingProvider | null) => void },
): JSX.Element {
	const view = useSignal<ConnectionsView | null>(null);
	const failed = useSignal<string | null>(null);

	useEffect(() => {
		let live = true;
		void IntegrationsService.connections().then((res) => {
			if (!live) return;
			if (res.ok && res.data) view.value = res.data;
			else failed.value = res.message ?? "Your connections couldn't be loaded.";
		});
		return () => {
			live = false;
		};
	}, []);

	const choices = view.value ? providerChoices(view.value, props.value) : null;

	return (
		<div class="cat-sec__field">
			<FieldHead
				label="Meeting room"
				htmlFor={SELECT_ID}
				hint="Each booking gets a room from this tool."
				hintId={HINT_ID}
			/>
			<Select
				id={SELECT_ID}
				options={choices?.options ?? [{ value: DEFAULT_PROVIDER, label: "My default" }]}
				value={props.value ?? DEFAULT_PROVIDER}
				onValueChange={(v) => props.onChange(providerOf(v))}
				loading={view.value === null && failed.value === null}
				aria-describedby={HINT_ID}
			/>
			{(failed.value || choices?.empty) && (
				<p class="cat-sec__hint" role={failed.value ? "status" : undefined}>
					{failed.value ?? (
						<>
							No meeting tool is connected, so buyers get a room once you connect one.{" "}
							<a class="cat-offer__link" href="/settings/integrations">Connect one</a>
						</>
					)}
				</p>
			)}
		</div>
	);
}
