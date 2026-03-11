"use strict";

/**
 * Some settings and code related to Mocha's handling of Node.js/V8 flags.
 * @private
 * @module
 */

const nodeFlags: ReadonlySet<string> | undefined =
  process.allowedNodeEnvironmentFlags;
const { isMochaFlag }: { isMochaFlag: (flag: string) => boolean } =
  require("./run-option-metadata");
const unparse: (opts: Record<string, unknown>) => string[] =
  require("yargs-unparser");

/**
 * These flags are considered "debug" flags.
 * @see {@link impliesNoTimeouts}
 * @private
 */
const debugFlags: Set<string> = new Set(["inspect", "inspect-brk"]);

/**
 * Mocha has historical support for various `node` and V8 flags which might not
 * appear in `process.allowedNodeEnvironmentFlags`.
 * These include:
 *   - `--preserve-symlinks`
 *   - `--harmony-*`
 *   - `--gc-global`
 *   - `--trace-*`
 *   - `--es-staging`
 *   - `--use-strict`
 *   - `--v8-*` (but *not* `--v8-options`)
 * @summary Whether or not to pass a flag along to the `node` executable.
 * @private
 */
exports.isNodeFlag = (flag: string, bareword: boolean = true): boolean => {
  if (!bareword) {
    // check if the flag begins with dashes; if not, not a node flag.
    if (!/^--?/.test(flag)) {
      return false;
    }
    // strip the leading dashes to match against subsequent checks
    flag = flag.replace(/^--?/, "");
  }
  return (
    // check actual node flags from `process.allowedNodeEnvironmentFlags`,
    // then historical support for various V8 and non-`NODE_OPTIONS` flags
    // and also any V8 flags with `--v8-` prefix
    (!isMochaFlag(flag) && nodeFlags && nodeFlags.has(flag)) ||
    debugFlags.has(flag) ||
    /(?:preserve-symlinks(?:-main)?|harmony(?:[_-]|$)|(?:trace[_-].+$)|gc[_-]global$|es[_-]staging$|use[_-]strict$|v8[_-](?!options).+?$)/.test(
      flag,
    )
  );
};

/**
 * Returns `true` if the flag is a "debug-like" flag.  These require timeouts
 * to be suppressed, or pausing the debugger on breakpoints will cause test failures.
 * @private
 */
exports.impliesNoTimeouts = (flag: string): boolean => debugFlags.has(flag);

/**
 * All non-strictly-boolean arguments to node--those with values--must specify those values using `=`, e.g., `--inspect=0.0.0.0`.
 * Unparse these arguments using `yargs-unparser` (which would result in `--inspect 0.0.0.0`), then supply `=` where we have values.
 * There's probably an easier or more robust way to do this; fixes welcome
 * @private
 */
exports.unparseNodeFlags = (opts: Record<string, unknown>): string[] => {
  const args = unparse(opts);
  return args.length
    ? args
        .join(" ")
        .split(/\b/)
        .map((arg: string) => (arg === " " ? "=" : arg))
        .join("")
        .split(" ")
    : [];
};
