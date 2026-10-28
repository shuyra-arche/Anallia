/**
 * Test-compatible author-data entry point.
 *
 * Production code should use `contentManifest` and `LocalContentSource` so the
 * full body is not part of the initial bundle. These exports remain for the
 * existing catalog tests and for callers that explicitly opt into eager rows.
 */
export { rawContent } from "./generated/raw.ts";
export { hubDefinitions } from "./generated/hubs.ts";
