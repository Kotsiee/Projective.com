import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import "../styles/workspace.css";
import { Drawer } from "@projective/ui/feedback";
import { useMediaQuery } from "@projective/ui/navigation";
import type { ProductItem, ServiceItem } from "@projective/types/explore";
import type {
	CatalogueKind,
	PublishReadiness,
	ServiceType,
	WorkspaceUrlState,
} from "../types/catalogue-types.ts";
import { LiveCardPreview } from "../components/inspector/LiveCardPreview.tsx";
import { ReadinessList } from "../components/inspector/ReadinessList.tsx";
import { ClientPending } from "../components/inspector/ClientPending.tsx";
import {
	cardItem,
	draft,
	markPanelMounted,
	readiness,
	startWorkspaceSync,
	workspaceReady,
	workspaceUrl,
} from "../core/workspace-store.ts";
import { INSPECTOR_ID, workspacePanelOf } from "../core/workspace-model.ts";
import {
	CONTEXT_PANEL_INFLOW_QUERY,
	contextDrawerOpen,
	contextPanelDocked,
} from "@web/features/shell/core/context-panel-state.ts";

/** Props for {@link ListingInspector}. */
export interface ListingInspectorProps {
	kind: CatalogueKind;
	/** The delivery model, which decides the archetype's own publish requirements. */
	serviceType: ServiceType | null;
	/** The SSR live card and gate, so the panel paints before the workspace hydrates. */
	card: ServiceItem | ProductItem;
	readiness: PublishReadiness;
	/** The workspace URL state the server resolved. */
	url: WorkspaceUrlState;
}

/**
 * ListingInspector — the workspace's middle-nav PANEL: on Edit, the live card (the real feed card,
 * redrawn on every keystroke) and the publish checklist; with `?client=`, the chosen buyer. From
 * 1280px it docks in the frame and the header's Card button opens and closes it; below that the
 * same body slides over in a drawer. On a tab with no panel (Analytics, or Clients with nobody
 * chosen) it folds the docked column away for this page, and gives it back when the seller returns.
 */
export default function ListingInspector(props: ListingInspectorProps): JSX.Element {
	const inflow = useMediaQuery(CONTEXT_PANEL_INFLOW_QUERY);
	const folded = useRef<boolean | null>(null);
	const ready = workspaceReady.value;
	const url = ready ? workspaceUrl.value : props.url;
	const panel = workspacePanelOf(url);

	useEffect(() => {
		markPanelMounted();
		startWorkspaceSync();
	}, []);

	useEffect(() => {
		if (panel === null && folded.current === null) {
			folded.current = contextPanelDocked.peek();
			contextPanelDocked.value = false;
			contextDrawerOpen.value = false;
		} else if (panel !== null && folded.current !== null) {
			contextPanelDocked.value = folded.current;
			folded.current = null;
		}
	}, [panel]);

	const card = (ready ? cardItem.value : null) ?? props.card;
	const gate = (ready ? readiness.value : null) ?? props.readiness;
	const serviceType = (ready ? draft.value?.serviceType : undefined) ?? props.serviceType;

	const body = (scope: string) => {
		if (panel === "client" && url.client) return <ClientPending client={url.client} />;
		if (panel !== "inspector") return null;
		return (
			<div class="cat-ws-inspector__body">
				<LiveCardPreview item={card} idBase={scope} />
				<ReadinessList
					listing={{ kind: props.kind, serviceType }}
					readiness={gate}
					idBase={scope}
				/>
			</div>
		);
	};

	return (
		<>
			<aside
				id={INSPECTOR_ID}
				class="cat-ws-inspector"
				aria-label={panel === "client" ? "Client" : "Listing card"}
			>
				{body("docked")}
			</aside>
			{!inflow && panel !== null && (
				<Drawer
					visible={contextDrawerOpen}
					position="right"
					header={panel === "client" ? "Client" : "Listing card"}
					size="min(24rem, 100vw)"
					class="cat-ws-inspector-drawer"
				>
					{body("drawer")}
				</Drawer>
			)}
		</>
	);
}
