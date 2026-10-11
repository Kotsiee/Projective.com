import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { type Option, type OptionGroup, Select } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { Amount } from "./Amount.tsx";
import type { BasketOwnerSummary, BasketSummary } from "../types/checkout-types.ts";

/**
 * BasketSwitcher — which account's basket or list is open, as one grouped `Select` (Decision #70(k)).
 *
 * Grouped by owner — Personal, then each team, business and organisation the buyer can spend from —
 * each listing that owner's baskets and named lists with their item count and selected subtotal. The
 * last row is "New list". Shared by the header basket drawer and the `/checkout` header band below
 * `--bp-md`, where the list lane is not rendered, so a phone switches lists with the same control.
 *
 * Every subtotal renders through {@link Amount}, so the rows follow a currency switch like every other
 * figure (Decision #70(D)).
 */

// #region Props
/** Props for {@link BasketSwitcher}. */
export interface BasketSwitcherProps {
	/** Every account the buyer can buy for, with its baskets. */
	owners: readonly BasketOwnerSummary[];
	/** The open owner scope key (`personal` · `team:{id}` · …). */
	owner: string;
	/** The open basket; `null` is the owner's default. */
	basketId: string | null;
	/** Open another owner's basket or list. */
	onSwitch: (owner: string, basketId: string) => void;
	/** Start a new list; omitted, the row is not offered. */
	onNewList?: () => void;
	/**
	 * Icon-only trigger (the open basket's name stays in the accessible name) — for the checkout header
	 * band below `--bp-md`, where a named trigger would crowd out the step trail. The panel is unchanged.
	 */
	compact?: boolean;
	class?: string;
}
// #endregion

const NEW_LIST = "__new";
const SEP = "|";

/** Owner + basket as one option value; owner keys never contain `|`. */
function valueOf(owner: string, basketId: string): string {
	return `${owner}${SEP}${basketId}`;
}

/** The group heading an owner is filed under. */
function groupLabel(owner: BasketOwnerSummary): string {
	return owner.kind === "personal" ? "Personal" : owner.name;
}

function countLabel(count: number): string {
	return `${count} ${count === 1 ? "item" : "items"}`;
}

export function BasketSwitcher(props: BasketSwitcherProps): JSX.Element {
	const { owners, owner, basketId, onSwitch, onNewList } = props;

	const byValue = new Map<string, { owner: BasketOwnerSummary; basket: BasketSummary }>();
	for (const entry of owners) {
		for (const basket of entry.baskets) {
			byValue.set(valueOf(entry.owner, basket.id), { owner: entry, basket });
		}
	}
	const ownBaskets = owners.find((entry) => entry.owner === owner)?.baskets ?? [];
	const open = ownBaskets.find((b) => b.id === basketId) ?? ownBaskets.find((b) => b.isDefault) ??
		ownBaskets[0];
	const current = open ? valueOf(owner, open.id) : "";

	// Controlled, so a "New list" pick snaps back to the open basket instead of naming itself.
	const value = useSignal(current);
	useEffect(() => {
		value.value = current;
	}, [current]);

	const options: OptionGroup[] = owners.map((entry) => ({
		label: groupLabel(entry),
		items: entry.baskets.map((basket) => ({
			label: basket.name,
			value: valueOf(entry.owner, basket.id),
			description: countLabel(basket.itemCount),
		})),
	}));
	if (onNewList) options.push({ label: "", items: [{ label: "New list", value: NEW_LIST }] });

	const row = (opt: Option): JSX.Element => {
		if (opt.value === NEW_LIST) {
			return (
				<span class="bsk-switch__row bsk-switch__row--new">
					<Icon name="plus" size="sm" />
					<span class="bsk-switch__name">New list</span>
				</span>
			);
		}
		const hit = byValue.get(opt.value);
		return (
			<span class="bsk-switch__row">
				<Icon name={hit?.basket.isDefault ? "basket" : "bookmark"} size="sm" />
				<span class="bsk-switch__name">{opt.label}</span>
				<span class="bsk-switch__meta">{opt.description}</span>
				{hit ? <Amount value={hit.basket.subtotal} size="micro" hideOrigin /> : null}
			</span>
		);
	};

	const trigger = (opt: Option): JSX.Element => {
		const hit = byValue.get(opt.value);
		if (props.compact) {
			return (
				<span class="bsk-switch__value">
					<Icon name={hit?.basket.isDefault === false ? "bookmark" : "basket"} size="sm" />
					<span class="ui-visually-hidden">{opt.label}</span>
				</span>
			);
		}
		return (
			<span class="bsk-switch__value">
				{hit && hit.owner.kind !== "personal"
					? <span class="bsk-switch__owner">{hit.owner.name}</span>
					: null}
				<span class="bsk-switch__name">{opt.label}</span>
				{hit ? <span class="bsk-switch__meta">{countLabel(hit.basket.itemCount)}</span> : null}
			</span>
		);
	};

	return (
		<Select
			class={[
				"bsk-switch",
				props.compact && "bsk-switch--compact",
				props.class,
			].filter(Boolean).join(" ")}
			panelClass="bsk-switch__panel"
			aria-label="Switch basket or list"
			options={options}
			grouping
			value={value}
			placeholder={open?.name ?? "Basket"}
			panelWidth="auto"
			optionTemplate={row}
			valueTemplate={trigger}
			onValueChange={(next) => {
				if (next === NEW_LIST) {
					value.value = current;
					onNewList?.();
					return;
				}
				const hit = byValue.get(next);
				if (hit && next !== current) onSwitch(hit.owner.owner, hit.basket.id);
			}}
		/>
	);
}
