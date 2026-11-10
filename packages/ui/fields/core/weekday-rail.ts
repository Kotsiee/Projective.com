/**
 * weekday-rail — the pure model behind `WeekdayRail`: the rail's day order and the selection a drag
 * across it leaves. Weekdays are numbered 0 = Sunday … 6 = Saturday; positions are rail order.
 */

/** The seven weekdays in rail order, starting at `weekStartsOn`. */
export function weekdayOrder(weekStartsOn: number): number[] {
	const first = ((Math.trunc(weekStartsOn) % 7) + 7) % 7;
	return Array.from({ length: 7 }, (_, i) => (first + i) % 7);
}

/**
 * The selection a drag across the rail leaves: every day between rail positions `from` and `to`,
 * inclusive, switched `on` or off over `base`. `null` when the result would fall outside
 * `[min, max]`, so a sweep stops at the last selection it was allowed to make.
 */
export function sweptSelection(
	base: readonly number[],
	order: readonly number[],
	from: number,
	to: number,
	on: boolean,
	min: number,
	max: number,
): number[] | null {
	const next = new Set(base);
	for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
		if (on) next.add(order[i]);
		else next.delete(order[i]);
	}
	if (next.size < min || next.size > max) return null;
	return [...next].sort((a, b) => a - b);
}
