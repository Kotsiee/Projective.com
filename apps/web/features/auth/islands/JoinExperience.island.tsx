import { useMemo } from "preact/hooks";
import { AuthShell } from "../components/AuthShell.tsx";
import { SummaryPanel } from "../components/SummaryPanel.tsx";
import { StepForm } from "../components/StepForm.tsx";
import { createJoinStore } from "../core/wizardStore.ts";
import type { JoinFormProps } from "../types/mod.ts";

/**
 * JoinExperience — the `/join` island. It owns the single wizard store and renders BOTH columns from
 * it: the live summary/passport panel (left) and the stepped form (right). Because both read the same
 * signals, typing on the right updates the passport on the left in real time. All server-parsed props
 * (return path, account type, initial intent, OAuth pre-fill) seed the store once on mount.
 */
export default function JoinExperience(props: JoinFormProps) {
	const store = useMemo(
		() =>
			createJoinStore({
				redirectTo: props.redirectTo,
				accountType: props.accountType,
				intent: props.intent,
				prefill: props.prefill,
			}),
		[],
	);

	return (
		<AuthShell wide aside={<SummaryPanel store={store} />}>
			<StepForm store={store} />
		</AuthShell>
	);
}
