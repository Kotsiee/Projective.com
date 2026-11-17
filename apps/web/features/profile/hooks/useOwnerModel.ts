import { useEffect } from "preact/hooks";
import type { ProfileEditModel } from "@projective/types/profile";
import { ownerModel, seedOwnerModel } from "../core/owner-store.ts";

/**
 * The owner's edit model as stored now: the shared one once any save has answered, else this
 * island's first-byte copy (`null` for a visitor). Seeded in an effect, never during render — a
 * module-level signal is shared by every request the server renders, so it is only written in the
 * browser.
 */
export function useOwnerModel<T extends ProfileEditModel | null>(initial: T): T | ProfileEditModel {
	useEffect(() => seedOwnerModel(initial), []);
	if (!initial) return initial;
	return ownerModel.value ?? initial;
}
