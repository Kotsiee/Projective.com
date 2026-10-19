/**
 * `community` schema shapes (Decision #274) — what people do around the platform: the newsletter
 * opt-in, the help centre's helpfulness votes and the feedback board. One module per surface; the
 * shared primitives in `./common.ts` stay internal to the folder.
 */
export * from "./newsletter.ts";
export * from "./help-feedback.ts";
export * from "./feedback.ts";
