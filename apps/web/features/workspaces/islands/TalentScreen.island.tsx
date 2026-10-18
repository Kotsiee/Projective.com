import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/workspace.css";
import { MetaLine } from "@projective/ui/display";
import { InlineNotice } from "@projective/ui/feedback";
import { useIsMobile } from "@projective/ui/hooks";
import { EmptyState } from "@projective/ui/utils";
import type { BenchEntry, BusinessBench } from "@projective/types/workspace";
import { openMemberChat } from "@features/projects/core/member-chat.ts";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { benchSummary } from "../core/bench-model.ts";
import { BenchTable } from "../components/BenchTable.tsx";

// #region Props
/** What the business `[module]` route hands the Talent screen: the first read and the viewer's stance. */
export interface TalentScreenProps {
	/** The business's display name, for the page's sentences and the menu's refusal reasons. */
	businessName: string;
	/** The business's handle — the bench's address for a retry. */
	businessHandle: string;
	/** `viewerCan.hire`: the capability and an active business; `false` refuses Add to project. */
	canHire: boolean;
	/** The viewer's own handle, so their own row is not offered to them. */
	viewerHandle: string | null;
	/** The server's first read, or `null` when it failed. */
	initial: BusinessBench | null;
	/** Why the first read failed, else `null`. */
	initialError: string | null;
}
// #endregion

/**
 * TalentScreen — the business console's Talent module: the bench (Decision #230 (i), #241).
 *
 * The freelancers and teams this business has hired — at least one live or completed engagement on a
 * project billed to it — with how many of its projects each worked on, when they last delivered, and
 * the business's own rating of them. Each row opens the party's profile (when it opens for the
 * viewer); its menu messages them (a team through its owner) or brings them onto another project
 * through the profile's own Add-to-project picker, which is the re-hire. Only members holding `hire`
 * reach this module.
 *
 * The bench is read server-side for the first paint (`resolveBench`); this island only re-reads it
 * when that read failed and the viewer asks to try again. It renders the server's figures verbatim
 * and decides nothing. The page carries no filled control: the row actions are menu items and the
 * empty state's way out is a tier-4 link to Explore.
 */
export default function TalentScreen(props: TalentScreenProps): JSX.Element {
	// #region State
	const bench = useSignal<BusinessBench | null>(props.initial);
	const error = useSignal<string | null>(props.initial ? null : props.initialError);
	const busy = useSignal(false);
	const mobile = useIsMobile();
	// #endregion

	// #region Actions
	/** Re-read the bench after a failed first read. */
	async function retry(): Promise<void> {
		if (busy.value) return;
		busy.value = true;
		const res = await WorkspaceService.bench(props.businessHandle);
		busy.value = false;
		if (res.ok && res.data) {
			bench.value = res.data;
			error.value = null;
		} else {
			error.value = res.message ?? "The bench couldn't be read just now. Try again in a moment.";
		}
	}

	/** Open the conversation with the row's contact — the freelancer, or a team's owner. */
	function message(entry: BenchEntry): void {
		if (!entry.contact) return;
		openMemberChat({
			name: entry.contact.name || `@${entry.contact.handle}`,
			handle: entry.contact.handle,
			avatar: entry.kind === "freelancer" ? entry.avatar || null : null,
		}, mobile);
	}
	// #endregion

	// #region Render
	const entries = bench.value?.entries ?? [];
	const facts = benchSummary(entries);

	return (
		<div class="wsp" data-kind="business">
			<div class="wsp__stack">
				<section class="wsp-band wsp-band--head" aria-labelledby="wsp-talent-title">
					<div class="wsp-band__inner">
						<div class="wsp-pagehead">
							<h1 class="wsp-pagehead__title" id="wsp-talent-title">Talent</h1>
							<p class="wsp-pagehead__note">
								The freelancers and teams {props.businessName}{" "}
								has hired — message them, or bring them onto another project.
							</p>
						</div>
					</div>
				</section>
				<section
					class="wsp-band wsp-band--plain wsp-band--tail"
					aria-labelledby="wsp-bench-title"
				>
					<div class="wsp-band__inner">
						<div class="wsp-band__head">
							<h2 class="wsp-band__title" id="wsp-bench-title">The bench</h2>
							{facts.length > 0 && (
								<MetaLine as="span" items={facts.map((text) => ({ text, tabular: true }))} />
							)}
						</div>
						<div class="wsp-band__body">
							{error.value
								? (
									<InlineNotice
										text={error.value}
										actionLabel="Try again"
										onAction={retry}
										busy={busy.value}
										align="start"
									/>
								)
								: entries.length === 0
								? (
									<EmptyState
										size="sm"
										title={`Nobody on the bench yet — the freelancers and teams ${props.businessName} hires appear here.`}
										actions={
											<a
												class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm wsp-talent__explore"
												href="/explore"
											>
												<span class="ui-button__label">Find talent on Explore</span>
											</a>
										}
									/>
								)
								: (
									<BenchTable
										entries={entries}
										businessName={props.businessName}
										menu={{
											canHire: props.canHire,
											viewerHandle: props.viewerHandle,
											onMessage: message,
										}}
									/>
								)}
						</div>
					</div>
				</section>
			</div>
		</div>
	);
	// #endregion
}
