import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/saved.css";
import {
	COLLECTABLE_TYPES,
	type SavedCollection,
	type SavedItem,
	type SavedTab,
} from "@projective/types/org";
import { Button, Select } from "@projective/ui/fields";
import { InlineNotice, Skeleton } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { TabMenu } from "@projective/ui/navigation";
import { EmptyState } from "@projective/ui/utils";
import { subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { ProfileService } from "@features/profile/core/ProfileService.ts";
import { SavedService } from "../core/SavedService.ts";
import {
	emptyCopy,
	SAVED_TABS,
	savedHref,
	TAB_LABEL,
	tabHasCollections,
} from "../core/saved-model.ts";
import { SavedRow } from "../components/SavedRow.tsx";
import { CollectionPicker, type PickerTarget } from "../components/CollectionPicker.tsx";

/** Props for {@link SavedPage}. */
export interface SavedPageProps {
	/** The tab and collection decoded from `?tab=&collection=`. */
	initialTab: SavedTab;
	initialCollection?: string;
}

const PANEL_ID = "svd-panel";
/** The collection filter's "everything" value. */
const ALL = "";

/**
 * SavedPage — `/saved` (Decision #180): everything the viewer has saved, starred, favourited or
 * followed, by tab (All · Services & products · People · Projects · Messages · Files), newest save
 * first, with "People you follow" after the saves. Bookmark kinds can be narrowed to one named
 * collection and filed into one from the row; any row can be removed in place (optimistic, rolled back
 * and explained on refusal). The tab and collection live in the URL. Dumb island: `SavedService` only.
 */
export default function SavedPage(props: SavedPageProps): JSX.Element {
	const tab = useSignal<SavedTab>(props.initialTab);
	const collection = useSignal<string | undefined>(props.initialCollection);
	const items = useSignal<SavedItem[]>([]);
	const collections = useSignal<SavedCollection[]>([]);
	const cursor = useSignal<string | null>(null);
	const phase = useSignal<"loading" | "ready" | "error">("loading");
	const failure = useSignal<string | null>(null);
	const loadingMore = useSignal(false);
	const said = useSignal("");
	const picking = useSignal(false);
	const target = useSignal<PickerTarget | null>(null);
	const epoch = useSignal(0);

	async function load(more: boolean): Promise<void> {
		const asked = { tab: tab.peek(), collection: collection.peek() };
		if (more) loadingMore.value = true;
		else phase.value = "loading";
		const res = await SavedService.list({ ...asked, cursor: more ? cursor.peek() : null });
		// A tab switched while this was in flight: its answer is not for what is on screen.
		if (asked.tab !== tab.peek() || asked.collection !== collection.peek()) return;
		loadingMore.value = false;
		if (!res.ok) {
			if (more) failure.value = res.message;
			else {
				failure.value = res.message;
				phase.value = "error";
			}
			return;
		}
		items.value = more ? [...items.peek(), ...res.data.items] : res.data.items;
		collections.value = res.data.collections;
		cursor.value = res.data.nextCursor;
		failure.value = null;
		phase.value = "ready";
	}

	// Keep the address on what is shown, and read it.
	useSignalEffect(() => {
		const href = savedHref(tab.value, collection.value);
		void epoch.value;
		if (globalThis.location && location.pathname + location.search !== href) {
			history.replaceState(history.state, "", href);
		}
		void load(false);
	});

	// The dev axis swaps the whole saved set — read it again.
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

	/** Reflect a filing: the row's collection changes, and it leaves a list narrowed to another one. */
	function filed(collectionId: string | null, message: string): void {
		const ref = target.value?.ref;
		const narrowed = collection.value;
		items.value = items.value
			.map((i) => (i.ref === ref && !i.following ? { ...i, collectionId } : i))
			.filter((i) =>
				i.ref !== ref || i.following || !narrowed ||
				(narrowed === "unfiled" ? collectionId === null : collectionId === narrowed)
			);
		said.value = message;
		// A collection created in the picker belongs in the filter now.
		void SavedService.collections().then((res) => {
			if (res.ok) collections.value = res.data;
		});
	}

	async function deleteCollection(id: string): Promise<void> {
		const name = collections.value.find((c) => c.id === id)?.name ?? "The collection";
		const res = await SavedService.deleteCollection(id);
		if (!res.ok) {
			failure.value = res.message;
			return;
		}
		said.value = `${name} deleted. Its items are still saved.`;
		collection.value = undefined;
	}

	const now = Date.now();
	const list = items.value;
	const saves = list.filter((i) => !i.following);
	const follows = list.filter((i) => i.following);
	const empty = emptyCopy(tab.value, collection.value);
	const showFilter = tabHasCollections(tab.value) && collections.value.length > 0;
	const named = collection.value && collection.value !== "unfiled" ? collection.value : null;
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
				icon={<Icon name="star" />}
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
			<header class="svd-page__head">
				<h1 class="svd-page__title">Saved</h1>
			</header>

			<TabMenu
				class="svd-tabs"
				aria-label="Saved kinds"
				panelId={PANEL_ID}
				activeIndex={SAVED_TABS.indexOf(tab.value)}
				onActiveIndexChange={(i) => {
					tab.value = SAVED_TABS[i];
					if (!tabHasCollections(SAVED_TABS[i])) collection.value = undefined;
				}}
				model={SAVED_TABS.map((t) => ({ key: t, label: TAB_LABEL[t] }))}
			/>

			{showFilter && (
				<div class="svd-page__bar">
					<Select
						// A raw value seeds the field once; the key remounts it when code resets the filter.
						key={collection.value ?? ALL}
						aria-label="Collection"
						size="sm"
						options={[
							{ label: "All saved", value: ALL },
							{ label: "Not in a collection", value: "unfiled" },
							...collections.value.map((c) => ({ label: c.name, value: c.id })),
						]}
						value={collection.value ?? ALL}
						onValueChange={(v) => (collection.value = v === ALL ? undefined : v)}
					/>
					{named && (
						<Button
							variant="text"
							severity="secondary"
							size="sm"
							label="Delete collection"
							onClick={() => void deleteCollection(named)}
						/>
					)}
				</div>
			)}

			<div
				class="svd-panel"
				role="tabpanel"
				id={PANEL_ID}
				aria-label={`Saved: ${TAB_LABEL[tab.value]}`}
			>
				{phase.value === "ready" && failure.value
					? <InlineNotice text={failure.value} assertive />
					: null}
				{body}
			</div>

			<CollectionPicker open={picking} target={target.value} onDone={filed} />
			<p class="ui-visually-hidden" role="status" aria-live="polite">{said.value}</p>
		</div>
	);
}
