import type { AssetItem, AssetListParams } from "@projective/types/files";

// #region Name match
/** The query a read narrows by, lower-cased and trimmed; `""` when there is none. */
export function needleOf(params: Pick<AssetListParams, "query">): string {
	return (params.query ?? "").trim().toLowerCase();
}

/**
 * Whether any of `names` contains `needle`. An asset answers to its display name AND the name it was
 * uploaded under: a renamed file is still found by the filename its owner remembers.
 */
export function nameMatches(
	needle: string,
	...names: ReadonlyArray<string | null | undefined>
): boolean {
	if (!needle) return true;
	return names.some((name) => (name ?? "").toLowerCase().includes(needle));
}
// #endregion

// #region Asset match
/**
 * Whether one projected asset survives a read's filters. `originalName` is the row's
 * `files.items.original_name`, which the projection does not carry.
 */
export function assetMatches(
	item: AssetItem,
	params: AssetListParams,
	originalName: string | null = null,
): boolean {
	if (params.kinds?.length && !params.kinds.includes(item.kind)) return false;
	if (params.categories?.length && !params.categories.includes(item.category)) return false;
	if (params.sources?.length && !params.sources.includes(item.source)) return false;
	if (params.visibility?.length && !params.visibility.includes(item.visibility)) return false;
	return nameMatches(needleOf(params), item.name, originalName);
}
// #endregion
