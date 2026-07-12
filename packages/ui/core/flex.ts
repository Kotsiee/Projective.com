import type { Align, Justify } from "../types/mod.ts";

/** Shared flex alignment vocabulary → CSS values, for Stack/Row/Column. */

const ALIGN: Record<Align, string> = {
	start: "flex-start",
	center: "center",
	end: "flex-end",
	stretch: "stretch",
	baseline: "baseline",
};

const JUSTIFY: Record<Justify, string> = {
	start: "flex-start",
	center: "center",
	end: "flex-end",
	between: "space-between",
	around: "space-around",
	evenly: "space-evenly",
};

export const alignValue = (a?: Align): string | undefined => (a ? ALIGN[a] : undefined);
export const justifyValue = (j?: Justify): string | undefined => (j ? JUSTIFY[j] : undefined);
