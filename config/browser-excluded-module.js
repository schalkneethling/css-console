/**
 * The empty module that stands in for a dependency a package has excluded
 * from browser builds through the `browser` field of its package.json.
 *
 * postcss declares `"path": false`, `"fs": false`, `"url": false`, and
 * `"source-map-js": false` (node_modules/postcss/package.json), which asks a
 * browser bundler to give those specifiers nothing at all. postcss then
 * destructures them at module scope in `lib/input.js`, `lib/previous-map.js`,
 * and `lib/map-generator.js`, and guards every use, so the destructuring is
 * the only access and an empty object satisfies it.
 *
 * This module is that empty object. It is the same thing Rolldown already
 * produces for the relative entry in the same field,
 * `"./lib/terminal-highlight": false`, which the pre-bundle emits as an
 * ignored, empty module.
 */

export default {};
