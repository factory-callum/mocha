"use strict";

/**
 * Metadata about various options of the `run` command
 * @see module:lib/cli/run
 * @module
 * @private
 */

/**
 * Dictionary of yargs option types to list of options having said type
 * @private
 */
interface OptionTypes {
  array: string[];
  boolean: string[];
  number: string[];
  string: string[];
  [key: string]: string[];
}

const TYPES: OptionTypes = (exports.types = {
  array: [
    "extension",
    "file",
    "global",
    "ignore",
    "node-option",
    "reporter-option",
    "require",
    "spec",
    "watch-files",
    "watch-ignore",
  ],
  boolean: [
    "allow-uncaught",
    "async-only",
    "bail",
    "check-leaks",
    "color",
    "delay",
    "diff",
    "dry-run",
    "exit",
    "fail-hook-affected-tests",
    "pass-on-failing-test-suite",
    "fail-zero",
    "forbid-only",
    "forbid-pending",
    "full-trace",
    "inline-diffs",
    "invert",
    "list-interfaces",
    "list-reporters",
    "no-colors",
    "parallel",
    "posix-exit-codes",
    "recursive",
    "sort",
    "watch",
  ],
  number: ["retries", "jobs"],
  string: [
    "config",
    "fgrep",
    "grep",
    "package",
    "reporter",
    "ui",
    "slow",
    "timeout",
  ],
});

/**
 * Option aliases keyed by canonical option name.
 * Arrays used to reduce
 * @private
 */
exports.aliases = {
  "async-only": ["A"],
  bail: ["b"],
  color: ["c", "colors"],
  fgrep: ["f"],
  global: ["globals"],
  grep: ["g"],
  ignore: ["exclude"],
  invert: ["i"],
  jobs: ["j"],
  "no-colors": ["C"],
  "node-option": ["n"],
  parallel: ["p"],
  reporter: ["R"],
  "reporter-option": ["reporter-options", "O"],
  require: ["r"],
  slow: ["s"],
  sort: ["S"],
  timeout: ["t", "timeouts"],
  ui: ["u"],
  watch: ["w"],
} as Record<string, string[]>;

const ALL_MOCHA_FLAGS: Set<string> = Object.keys(TYPES).reduce<Set<string>>(
  (acc, key) => {
    // gets all flags from each of the fields in `types`, adds those,
    // then adds aliases of each flag (if any)
    TYPES[key].forEach((flag: string) => {
      acc.add(flag);
      const flagAliases: string[] =
        (exports.aliases as Record<string, string[]>)[flag] || [];
      flagAliases.forEach((alias: string) => {
        acc.add(alias);
      });
    });
    return acc;
  },
  new Set<string>(),
);

/**
 * Returns `true` if the provided `flag` is known to Mocha.
 * @private
 */
exports.isMochaFlag = (flag: string): boolean => {
  return ALL_MOCHA_FLAGS.has(flag.replace(/^--?/, ""));
};

/**
 * Returns expected yarg option type for a given mocha flag.
 * @private
 */
exports.expectedTypeForFlag = (flag: string): string | undefined => {
  const normalizedName = flag.replace(/^--?/, "");

  // If flag is an alias, get its full name.
  const flagAliases = exports.aliases as Record<string, string[]>;
  const fullFlagName: string =
    Object.keys(flagAliases).find((flagName: string) =>
      flagAliases[flagName].includes(normalizedName),
    ) || normalizedName;

  return Object.keys(TYPES).find((flagType: string) =>
    TYPES[flagType].includes(fullFlagName),
  );
};
