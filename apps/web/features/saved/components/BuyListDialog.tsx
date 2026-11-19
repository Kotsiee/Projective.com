import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { SavedCollection, SavedListToBasketResult } from "@projective/types/org";
import type { BasketListEntry } from "@projective/types/finance";
import { Dialog, InlineNotice } from "@projective/ui/feedback";
import { Button, InputText, RadioGroup } from "@projective/ui/fields";
import { BasketService } from "@web/features/checkout/core/BasketService.ts";
import { notifyBasketChanged } from "@web/features/checkout/core/basket-state.ts";
import { SavedService } from "../core/SavedService.ts";

/** Props for {@link BuyListDialog}. */
export interface BuyListDialogProps {
	open: Signal<boolean>;
	list: SavedCollection | null;
	/** Whose baskets: `personal` or `{entity}:{id}`, as the shell acts. */
	owner: string;
	/** The sentence to announce once the items have landed. */
	onDone: (message: string) => void;
}

/** The radio value for "a new basket". */
const NEW = "new";

/**
 * BuyListDialog — put one list's purchasable items into a basket: one the buyer already has, or a new
 * named one. Products land as they are; a service needs its own step (a brief, a time or a project),
 * so the answer names each one with a link to finish it rather than adding it half-configured.
 */
export function BuyListDialog({ open, list, owner, onDone }: BuyListDialogProps): JSX.Element {
	const baskets = useSignal<BasketListEntry[] | null>(null);
	const choice = useSignal("");
	const name = useSignal("");
	const error = useSignal("");
	const busy = useSignal(false);
	const result = useSignal<SavedListToBasketResult | null>(null);

	useEffect(() => {
		if (!open.value) return;
		result.value = null;
		error.value = "";
		name.value = list ? list.name : "";
		void BasketService.lists({ basketId: null, owner, display: null }).then((res) => {
			const own = res.ok && res.data ? res.data.lists.lists.filter((l) => l.kind === "basket") : [];
			baskets.value = own;
			choice.value = own.find((l) => l.isDefault)?.id ?? own[0]?.id ?? NEW;
			if (!res.ok) error.value = res.message ?? "Your baskets couldn't be read just now.";
		});
	}, [open.value, list?.id]);

	async function submit(): Promise<void> {
		if (!list) return;
		const fresh = choice.value === NEW;
		if (fresh && !name.value.trim()) return;
		busy.value = true;
		const res = await SavedService.listToBasket(list.id, {
			owner,
			...(fresh ? { newBasketName: name.value.trim() } : { basketId: choice.value }),
		});
		busy.value = false;
		if (!res.ok) {
			error.value = res.message;
			return;
		}
		result.value = res.data;
		if (res.data.added.length > 0) {
			notifyBasketChanged();
			onDone(res.message);
		}
	}

	const done = result.value;
	const basketHref = done?.basketId
		? `/basket?list=${encodeURIComponent(done.basketId)}`
		: "/basket";
	const options = [
		...(baskets.value ?? []).map((b) => ({
			label: b.label,
			value: b.id,
			description: b.itemCount === 1 ? "1 item" : `${b.itemCount} items`,
		})),
		{ label: "A new basket", value: NEW },
	];

	return (
		<Dialog
			visible={open}
			header={list ? `Buy “${list.name}”` : "Buy list"}
			width="28rem"
			footer={
				<div class="svd-picker__actions">
					<Button variant="text" onClick={() => (open.value = false)}>
						{done ? "Close" : "Cancel"}
					</Button>
					{done
						? (
							done.added.length > 0 && (
								<a
									class="ui-button ui-button--primary ui-button--filled ui-button--size-md ui-button--rounded svd-buylist__open"
									href={basketHref}
								>
									<span class="ui-button__label">Open basket</span>
								</a>
							)
						)
						: (
							<Button
								onClick={() => void submit()}
								disabled={busy.value || !list || baskets.value === null ||
									(choice.value === NEW && !name.value.trim())}
							>
								Add to basket
							</Button>
						)}
				</div>
			}
		>
			{error.value && <InlineNotice text={error.value} align="start" assertive />}
			{done
				? <BuyListOutcome result={done} />
				: (
					<>
						<p class="svd-picker__subject">
							Products go straight in. Services need a step of their own, and we'll point you to
							each one.
						</p>
						<RadioGroup
							aria-label="Basket"
							orientation="vertical"
							loading={baskets.value === null}
							options={options}
							value={choice}
						/>
						{choice.value === NEW && (
							<div class="svd-picker__new">
								<InputText
									aria-label="New basket name"
									placeholder="Name the basket"
									maxLength={120}
									value={name}
									fluid
								/>
							</div>
						)}
					</>
				)}
		</Dialog>
	);
}

/** What landed, and what needs its own page. */
function BuyListOutcome({ result }: { result: SavedListToBasketResult }): JSX.Element {
	return (
		<div class="svd-buylist">
			<p class="svd-buylist__lead" role="status">
				{result.added.length === 0
					? "Nothing went into the basket."
					: result.added.length === 1
					? "1 item is in your basket."
					: `${result.added.length} items are in your basket.`}
			</p>
			{result.skipped.length > 0 && (
				<>
					<h3 class="svd-section__title">Needs a step first</h3>
					<ul class="svd-buylist__skips" role="list">
						{result.skipped.map((skip, i) => (
							<li key={`${i}:${skip.title}`} class="svd-buylist__skip">
								{skip.href
									? <a class="svd-buylist__link" href={skip.href}>{skip.title}</a>
									: <span class="svd-buylist__title">{skip.title}</span>}
								<span class="svd-buylist__reason">{skip.reason}</span>
							</li>
						))}
					</ul>
				</>
			)}
		</div>
	);
}
