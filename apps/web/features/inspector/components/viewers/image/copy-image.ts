import type { InspectorShell } from "../../../core/inspector-shell.ts";

/**
 * Put the picture the canvas draws on the clipboard as a PNG, the one image type every browser's
 * clipboard takes. The PNG is handed over as a promise so Safari keeps the click's permission while
 * it is drawn. An SVG is copied as a bitmap at its laid-out size (Decision #400 flag (f)).
 */
export async function copyImage(stage: HTMLElement | null, shell: InspectorShell): Promise<void> {
	const img = stage?.querySelector<HTMLImageElement>("img");
	const clipboard = globalThis.navigator?.clipboard;
	const width = img ? img.naturalWidth || img.width : 0;
	const height = img ? img.naturalHeight || img.height : 0;
	if (!img || !width || !height || !clipboard?.write || typeof ClipboardItem === "undefined") {
		shell.announce("Copying pictures isn't available here.");
		return;
	}
	const png = new Promise<Blob>((resolve, reject) => {
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		canvas.getContext("2d")?.drawImage(img, 0, 0, width, height);
		canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no image"))), "image/png");
	});
	try {
		await clipboard.write([new ClipboardItem({ "image/png": png })]);
		shell.announce("Picture copied");
	} catch {
		shell.announce("Couldn't copy the picture.");
	}
}
