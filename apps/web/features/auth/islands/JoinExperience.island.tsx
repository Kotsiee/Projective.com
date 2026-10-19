import { useEffect, useMemo } from "preact/hooks";
import { AGE_MESSAGES } from "@projective/types/auth";
import { isJoinAgeLocked } from "../core/age-lock.ts";
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

	useEffect(() => {
		if (isJoinAgeLocked()) store.ageLocked.value = true;
	}, []);

	return (
		<AuthShell wide aside={<SummaryPanel store={store} />}>
			{
				/* The page's one `<h1>`, inside the shell's `<main>`. The wizard draws its title as the
				   aside's per-step headline (an `h2`), so the heading is visually hidden: it names the page
				   for assistive technology without adding a second visible title. */
			}
			<h1 class="ui-visually-hidden">Join Projective</h1>
			{store.ageLocked.value
				? (
					<div class="auth-agenote auth-agenote--blocked" role="alert">
						<span>{AGE_MESSAGES.blocked}</span>
					</div>
				)
				: <StepForm store={store} />}
		</AuthShell>
	);
}
