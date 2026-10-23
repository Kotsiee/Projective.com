import type { ExportFile } from "./calendar-export.ts";

/**
 * Hand a written file to the reader as a download.
 *
 * There is no `/api/scheduling/export` endpoint, and a link to an invented one would ship a control
 * that 404s, so the file is a client-side Blob. The anchor is appended before the click and removed
 * after, and the object URL is released on the NEXT task: a detached anchor is ignored by some
 * engines, and revoking synchronously can pull the blob out from under a download that has not
 * started reading it — the lifecycle the `/checkout` and `/files` rigs settled.
 *
 * Kept apart from `calendar-export.ts` because it touches `document`, and `deno test` type-checks
 * without the DOM lib. Throws when the browser refuses; the caller reports it.
 */
export function downloadExportFile(file: ExportFile): void {
	let url = "";
	try {
		url = URL.createObjectURL(new Blob([file.content], { type: file.mime }));
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = file.filename;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
	} finally {
		if (url) setTimeout(() => URL.revokeObjectURL(url), 0);
	}
}
