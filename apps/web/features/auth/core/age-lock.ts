import { readStored, SessionKeys, writeStored } from "@web/utils/storage-keys.ts";

/**
 * The `/join` device-session lock (Decision #208): once a date of birth under 13 has been entered and
 * submitted — or the server has refused one — this browser session shows only the minimum-age
 * message, so stepping back and nudging the birth year does not reopen the form. Session storage, so
 * it holds nothing about the person and ends with the tab; the join route keeps its own cookie twin.
 */
export function isJoinAgeLocked(): boolean {
	return readStored("session", SessionKeys.JOIN_AGE_LOCK) === "1";
}

/** Lock the join form for the rest of this browser session. */
export function lockJoinAge(): void {
	writeStored("session", SessionKeys.JOIN_AGE_LOCK, "1");
}
