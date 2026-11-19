import type { JSX } from "preact";
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/saved.css";
import {
	COLLECTABLE_TYPES,
	type SavedCollection,
	type SavedItem,
	type SavedTab,
} from "@projective/types/org";
import { Button } from "@projective/ui/fields";
import { InlineNotice, Skeleton } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { EmptyState } from "@projective/ui/utils";
import { subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { ProfileService } from "@features/profile/core/ProfileService.ts";
import { SavedService } from "../core/SavedService.ts";
import { emptyCopy, listName, savedHref, TAB_LABEL, tabHasCollections } from "../core/saved-model.ts";
import {
	listDialog,
	patchSavedFilter,
	type SavedFilter,
	savedBoards,
	savedFilter,
} from "../core/saved-filter-state.ts";
import { SavedRow } from "../components/SavedRow.tsx";
import { CollectionPicker, type PickerTarget } from "../components/CollectionPicker.tsx";
import { ListBoards } from "../components/ListBoards.tsx";
import { ListNameDialog } from "../components/ListNameDialog.tsx";
import { BuyListDialog } from "../components/BuyListDialog.tsx";
import { SavedPageHeader } from "../components/SavedPageHeader.tsx";
import { SavedFilterBar } from "../components/SavedFilterBar.tsx";

/** Props for {@link SavedPage}. */
export interface SavedPageProps {
	/** The category and list decoded from `?tab=&collection=`. */
	initialTab: SavedTab;
	initialCollection?: string;
	/** Whose baskets a list is bought into: `personal` or `{entity}:{id}`. */
	basketOwner: string;
}

/**
 * SavedPage — the `/saved` body (Decision #180, laid out as `/notifications` is, Decision #520).
 * The filter lives in the middle-nav lane (and, below `--bp-md`, the phone filter bar), shared through
 * `savedFilter`: a category (All · Services & products · People · Projects · Messages · Files) that
 * only filters, and optionally one of the viewer's lists. With no list open the page leads with the
 * lists as boards; an open list can be renamed, deleted, or bought — its products put into a basket.
 * Rows are newest save first, with "People you follow" after them, removable in place (optimistic,
 * rolled back and explained on refusal). The filter lives in the URL. Dumb island: `SavedService` only.
 */
export default function SavedPage(props: SavedPageProps): JSX.Element {
	const filter = useComputed<SavedFilter>(() =>
		savedFilter.value ?? { tab: props.initialTab, collection: props.initialCollection }
	);
	const items = useSignal<SavedItem[]>([]);
	const cursor = useSignal<string | null>(null);
	const phase = useSignal<"loading" | "ready" | "error">("loading");
	const failure = useSignal<string | null>(null);
	const loadingMore = useSignal(false);
	const said = useSignal("");
	const picking = useSignal(false);
	const target = useSignal<PickerTarget | null>(null);
	const buying = useSignal(false);
	const epoch = useSignal(0);

	useEffect(() => {
		savedFilter.value = { tab: props.initialTab, collection: props.initialCollection };
		return () => {
			savedFilter.value = null;
		};
	}, []);

	async function load(more: boolean, quiet = false): Promise<void> {
		const asked = filter.peek();
		if (more) loadingMore.value = true;
		else if (!quiet) phase.value = "loading";
		const res = await SavedService.list({ ...asked, cursor: more ? cursor.peek() : null });
		const now = filter.peek();
		if (asked.tab !== now.tab || asked.collection !== now.collection) return;
		loadingMore.value = false;
		if (!res.ok) {
			failure.value = res.message;
			if (!more) phase.value = "error";
			return;
		}
		items.value = more ? [...items.peek(), ...res.data.items] : res.data.items;
		savedBoards.value = res.data.collections;
		cursor.value = res.data.nextCursor;
		failure.value = null;
		phase.value = "ready";
	}

	useSignalEffect(() => {
		const { tab, collection } = filter.value;
		const href = savedHref(tab, collection);
		void epoch.value;
		if (globalThis.location && location.pathname + location.search !== href) {
			history.replaceState(history.state, "", href);
		}
		void load(false);
	});

	useEffect(() => subscribeDevSeam(() => epoch.value++), []);

	/** Remove a row in place; a refusal puts it back where it was and says why. */
	async function remove(item: SavedItem): Promise<void> {
		const at = items.value.indexOf(item);
		items.value = items.value.filter((i) => i !== item);
		const res = item.following
			? await ProfileService.follow(item.ref, false)
			: await SavedService.toggle({ type: item.type, ref: item.ref, saved: false });
		if (res.ok) {
			said.value = item.following
				? `Unfollowed ${item.title}.`
				: `${item.title} removed from saved.`;
			if (item.collectionId) {
				savedBoards.value = (savedBoards.peek() ?? []).map((b) =>
					b.id === item.collectionId ? { ...b, count: Math.max(0, (b.count ?? 1) - 1) } : b
				);
			}
			return;
		}
		const back = [...items.value];
		back.splice(Math.min(at, back.length), 0, item);
		items.value = back;
		failure.value = res.message ?? "That didn't save. Try again.";
	}

	function collect(item: SavedItem): void {
		target.value = {
			type: item.type,
			ref: item.ref,
			title: item.title,
			collectionId: item.collectionId,
		};
		picking.value = true;
	}

	/** Reflect a filing, then read again so the row leaves a list it no longer belongs to. */
	function filed(_collectionId: string | null, message: string): void {
		said.value = message;
		void load(false, true);
	}

	async function deleteList(list: SavedCollection): Promise<void> {
		const res = await SavedService.deleteCollection(list.id);
		if (!res.ok) {
			failure.value = res.message;
			return;
		}
		said.value = `${list.name} deleted. Its items are still saved.`;
		if (!patchSavedFilter({ collection: undefined })) void load(false, true);
	}

	const current = filter.value;
	const boards = savedBoards.value ?? [];
	const open = current.collection && current.collection !== "unfiled"
		? boards.find((b) => b.id === current.collection) ?? null
		: null;
	const label = listName(current.collection, boards);
	const now = Date.now();
	const list = items.value;
	const saves = list.filter((i) => !i.following);
	const follows = list.filter((i) => i.following);
	const empty = emptyCopy(current.tab, current.collection);
	const showBoards = !current.collection && tabHasCollections(current.tab) &&
		phase.value !== "error";
	const row = (item: SavedItem) => (
		<SavedRow
			key={`${item.type}:${item.ref}:${item.following}`}
			item={item}
			now={now}
			onRemove={(i) => void remove(i)}
			onCollect={!item.following && COLLECTABLE_TYPES.includes(item.type) ? collect : undefined}
		/>
	);

	let body: JSX.Element;
	if (phase.value === "loading") {
		body = (
			<ul class="svd-list" aria-busy="true" aria-label="Loading saved items">
				{[0, 1, 2, 3].map((i) => (
					<li key={i} class="svd-row svd-row--placeholder" aria-hidden="true">
						<Skeleton shape="circle" class="svd-row__lead-ph" />
						<Skeleton lines={2} class="svd-row__body" />
					</li>
				))}
			</ul>
		);
	} else if (phase.value === "error") {
		body = (
			<InlineNotice
				text={failure.value ?? "We couldn't load your saved items."}
				actionLabel="Try again"
				onAction={() => void load(false)}
			/>
		);
	} else if (list.length === 0) {
		body = (
			<EmptyState
				size="sm"
				icon={<Icon name="bookmark" />}
				title={empty.title}
				description={empty.description}
			/>
		);
	} else {
		body = (
			<>
				{saves.length > 0 && <ul class="svd-list" role="list">{saves.map(row)}</ul>}
				{follows.length > 0 && (
					<section class="svd-section" aria-labelledby="svd-follows">
						<h2 class="svd-section__title" id="svd-follows">People you follow</h2>
						<ul class="svd-list" role="list">{follows.map(row)}</ul>
					</section>
				)}
				{cursor.value && (
					<div class="svd-list__more">
						<Button
							variant="text"
							size="sm"
							label={loadingMore.value ? "Loading…" : "Load more"}
							disabled={loadingMore.value}
							onClick={() => void load(true)}
						/>
					</div>
				)}
			</>
		);
	}

	return (
		<div class="svd-page">
			<SavedPageHeader
				tab={current.tab}
				listLabel={label}
				list={open}
				onNewList={() => (listDialog.value = { mode: "new" })}
				onBuyList={() => (buying.value = true)}
				onRenameList={() => open && (listDialog.value = { mode: "rename", list: open })}
				onDeleteList={() => open && void deleteList(open)}
			/>

			<SavedFilterBar filter={current} lists={boards} />

			{showBoards && savedBoards.value !== null && (
				<ListBoards
					lists={boards}
					tab={current.tab}
					onOpen={(l) => patchSavedFilter({ collection: l.id })}
					onNew={() => (listDialog.value = { mode: "new" })}
				/>
			)}

			<section
				class="svd-panel"
				aria-label={label ? `Saved in ${label}` : `Saved: ${TAB_LABEL[current.tab]}`}
			>
				{showBoards && <h2 class="svd-section__title">Recently saved</h2>}
				{phase.value === "ready" && failure.value
					? <InlineNotice text={failure.value} assertive />
					: null}
				{body}
			</section>

			<CollectionPicker open={picking} target={target.value} onDone={filed} />
			<ListNameDialog
				onDone={(made, created, message) => {
					said.value = message;
					if (!created) void load(false, true);
					else patchSavedFilter({ collection: made.id });
				}}
			/>
			<BuyListDialog
				open={buying}
				list={open}
				owner={props.basketOwner}
				onDone={(message) => (said.value = message)}
			/>
			<p class="ui-visually-hidden" role="status" aria-live="polite">{said.value}</p>
		</div>
	);
}
