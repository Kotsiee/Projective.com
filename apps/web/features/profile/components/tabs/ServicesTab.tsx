import type { JSX } from "preact";
import { ServicesGrid } from "@features/explore/components/collections/ServicesGrid.tsx";
import { Empty } from "./tab-shared.tsx";
import type { ServiceItem } from "../../types/profile-types.ts";

/**
 * ServicesTab — the profile's Services tab body. Reuses the explore {@link ServicesGrid} collection so
 * a profile's service cards match the discovery surface exactly (root CLAUDE.md Part 2).
 */
export function ServicesTab(
	{ items, authed }: { items: ServiceItem[]; authed: boolean },
): JSX.Element {
	return items.length ? <ServicesGrid items={items} authed={authed} /> : <Empty />;
}
