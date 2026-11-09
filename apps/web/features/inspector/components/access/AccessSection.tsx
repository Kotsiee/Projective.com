import type { JSX } from "preact";
import { fileInspectHref } from "@projective/types/files";
import type { InspectorShell } from "../../core/inspector-shell.ts";
import { visibilityText } from "../../core/inspector-model.ts";
import { reachOf } from "../../core/access-live.ts";
import {
	type AccessDraft,
	addGrantee,
	addRefusalText,
	containerWithDraft,
	grantsActive,
	hasGrantee,
	isDirty,
	removeGrantee,
	setGrantRole,
	shownStanding,
} from "../../core/access-draft.ts";
import {
	editDraft,
	type ItemAccessStore,
	loadAccess,
	revertDraft,
	saveDraft,
} from "../../core/access-store.ts";
import { useItemAccess } from "../../hooks/use-item-access.ts";
import { useFileAccessSim } from "../../hooks/use-file-access-sim.ts";
import { useInspectorActions } from "../InspectorContext.ts";
import { AccessError, AccessLoading, AccessReadOnly, AccessSignedOut } from "./AccessStates.tsx";
import { AccessFooter } from "./AccessFooter.tsx";
import { PeoplePanel } from "./PeoplePanel.tsx";
import { ScopeRules } from "./ScopeRules.tsx";
import { ShareLinkRow } from "./ShareLinkRow.tsx";
import { TierChoice } from "./TierChoice.tsx";

/** Props for {@link AccessSection}. */
export interface AccessSectionProps {
	shell: InspectorShell;
	titleId: string;
}

function update(store: ItemAccessStore, change: (draft: AccessDraft) => AccessDraft): void {
	const draft = store.draft.peek();
	if (draft) editDraft(store, change(draft));
}

/**
 * The inspector's Access tab (Decision #402): who can open this file and how. It is read the first time
 * the tab shows. The owner chooses the tier, the library's member switch and the people, teams and
 * projects it is shared with; an editor changes only who it is shared with; anyone else reads the tier.
 * Every change is a draft until Save changes, and Revert returns to what is saved.
 */
export function AccessSection({ shell, titleId }: AccessSectionProps): JSX.Element {
	const { asset } = shell;
	const actions = useInspectorActions();
	const sim = useFileAccessSim().value;
	const store = useItemAccess(asset.id, actions.signedIn);
	const phase = store.phase.value;
	const returnTo = fileInspectHref(asset.id, { share: asset.share });

	function body(): JSX.Element {
		if (sim === "signed-out" || phase === "signed-out") {
			return <AccessSignedOut returnTo={returnTo} />;
		}
		if (phase === "idle" || phase === "loading") return <AccessLoading />;
		if (phase === "error") {
			return (
				<AccessError
					message={store.error.value ?? "Who has access couldn't be loaded."}
					onRetry={() => void loadAccess(store)}
				/>
			);
		}
		const access = store.access.value;
		const saved = store.saved.value;
		const draft = store.draft.value;
		if (phase === "unavailable" || !access || !saved || !draft) {
			const reach = reachOf(asset);
			return (
				<AccessReadOnly
					visibility={reach.visibility}
					container={null}
					fallbackLabel={visibilityText({ visibility: reach.visibility, canManage: false })}
				/>
			);
		}

		const standing = shownStanding(access.standing, sim);
		if (standing === "viewer") {
			return (
				<AccessReadOnly
					visibility={access.visibility}
					container={access.container}
					fallbackLabel={visibilityText({ visibility: access.visibility, canManage: false })}
				/>
			);
		}

		const owner = standing === "owner";
		const active = grantsActive(draft.visibility);
		const shared = draft.visibility === "link" || draft.visibility === "public";
		const busy = store.status.value.tone === "busy";

		return (
			<>
				<TierChoice
					value={draft.visibility}
					container={containerWithDraft(access.container, draft)}
					editable={owner}
					disabled={busy}
					onChange={(visibility) => update(store, (d) => ({ ...d, visibility }))}
				/>
				<ScopeRules
					container={access.container}
					memberAccess={draft.memberAccess}
					canManage={owner}
					messageShares={owner ? access.messageShares : null}
					active={active}
					onMemberAccess={(memberAccess) => update(store, (d) => ({ ...d, memberAccess }))}
				/>
				{owner && (shared || access.shareUrl !== null)
					? (
						<ShareLinkRow
							itemId={asset.id}
							name={asset.name}
							savedVisibility={access.visibility}
							shareUrl={access.shareUrl}
							onChanged={() => void loadAccess(store, { refresh: true })}
						/>
					)
					: null}
				<PeoplePanel
					grants={draft.grants}
					active={active}
					errors={store.rowErrors.value}
					notice={store.notice.value}
					excludeIds={access.ownerId ? [access.ownerId] : []}
					isAdded={(grantee) => hasGrantee(store.draft.peek() ?? draft, grantee)}
					onAdd={(grantee) => {
						const current = store.draft.peek();
						if (!current) return;
						const outcome = addGrantee(current, grantee);
						store.notice.value = addRefusalText(outcome.refusal);
						if (!outcome.refusal) editDraft(store, outcome.draft);
					}}
					onRemove={(key) => update(store, (d) => removeGrantee(d, key))}
					onRole={(key, role) => update(store, (d) => setGrantRole(d, key, role))}
				/>
				<AccessFooter
					dirty={isDirty(saved, draft)}
					status={store.status.value}
					onSave={() => void saveDraft(store, standing)}
					onRevert={() => revertDraft(store)}
				/>
			</>
		);
	}

	return (
		<section class="ins-panel__section ins-access" aria-labelledby={titleId}>
			<h2 id={titleId} class="ins-panel__title">Access</h2>
			{body()}
		</section>
	);
}
