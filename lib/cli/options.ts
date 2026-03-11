"use strict";

/**
 * Main entry point for handling filesystem-based configuration,
 * whether that's a config file or `package.json` or whatever.
 * @module lib/cli/options
 * @private
 */

const fs: typeof import("node:fs") = require("node:fs");
const pc: typeof import("picocolors") = require("picocolors");
const yargsParser: {
  (args: string | string[], opts?: Record<string, unknown>): YargsArguments;
  detailed: (
    args: string | string[],
    opts?: Record<string, unknown>,
  ) => { argv: YargsArguments; error: Error | null };
} = require("yargs-parser");
const {
  types,
  aliases,
  isMochaFlag,
  expectedTypeForFlag,
}: {
  types: { array: string[]; boolean: string[]; number: string[]; string: string[]; [key: string]: string[] };
  aliases: Record<string, string[]>;
  isMochaFlag: (flag: string) => boolean;
  expectedTypeForFlag: (flag: string) => string | undefined;
} = require("./run-option-metadata");
const { ONE_AND_DONE_ARGS }: { ONE_AND_DONE_ARGS: Set<string> } =
  require("./one-and-dones");
const mocharc: Record<string, unknown> = require("../mocharc.json");
const { list }: { list: (str: string | string[]) => string[] } =
  require("./run-helpers");
const {
  loadConfig,
  findConfig,
}: {
  loadConfig: (filepath: string) => Record<string, unknown>;
  findConfig: () => string | undefined;
} = require("./config");
const findUp: { sync: (name: string) => string | undefined } =
  require("find-up");
const debug: (...args: unknown[]) => void =
  require("debug")("mocha:cli:options");
const { isNodeFlag }: { isNodeFlag: (flag: string, stripLeadingDashes?: boolean) => boolean } =
  require("./node-flags");
const {
  createUnparsableFileError,
  createInvalidArgumentTypeError,
  createUnsupportedError,
}: {
  createUnparsableFileError: (message: string, filepath: string) => Error;
  createInvalidArgumentTypeError: (
    message: string,
    argument: unknown,
    expected: string | undefined,
  ) => Error;
  createUnsupportedError: (message: string) => Error;
} = require("../errors");
const { isNumeric }: { isNumeric: (value: unknown) => boolean } =
  require("../utils");

/**
 * Parsed arguments from yargs-parser
 */
interface YargsArguments {
  _: (string | number)[];
  "--"?: (string | number)[];
  [key: string]: unknown;
}

/**
 * Base yargs parser configuration
 * @private
 */
const YARGS_PARSER_CONFIG: Record<string, boolean> = {
  "combine-arrays": true,
  "short-option-groups": false,
  "dot-notation": false,
  "strip-aliased": true,
};

/**
 * This is the config pulled from the `yargs` property of Mocha's
 * `package.json`, but it also disables camel case expansion as to
 * avoid outputting non-canonical keynames, as we need to do some
 * lookups.
 * @private
 */
const configuration: Record<string, boolean> = Object.assign(
  {},
  YARGS_PARSER_CONFIG,
  {
    "camel-case-expansion": false,
  },
);

/**
 * This is a really fancy way to:
 * - `array`-type options: ensure unique values and evtl. split comma-delimited lists
 * - `boolean`/`number`/`string`- options: use last element when given multiple times
 * This is passed as the `coerce` option to `yargs-parser`
 * @private
 */
const globOptions = ["spec", "ignore"];
const coerceOpts: Record<string, (v: unknown) => unknown> = Object.assign(
  types.array.reduce<Record<string, (v: unknown) => unknown>>(
    (acc, arg) =>
      Object.assign(acc, {
        [arg]: (v: unknown): unknown[] =>
          Array.from(
            new Set(
              globOptions.includes(arg)
                ? (v as unknown[])
                : list(v as string | string[]),
            ),
          ),
      }),
    {},
  ),
  types.boolean
    .concat(types.string, types.number)
    .reduce<Record<string, (v: unknown) => unknown>>(
      (acc, arg) =>
        Object.assign(acc, {
          [arg]: (v: unknown): unknown =>
            Array.isArray(v) ? v.pop() : v,
        }),
      {},
    ),
);

/**
 * We do not have a case when multiple arguments are ever allowed after a flag
 * (e.g., `--foo bar baz quux`), so we fix the number of arguments to 1 across
 * the board of non-boolean options.
 * This is passed as the `narg` option to `yargs-parser`
 * @private
 */
const nargOpts: Record<string, number> = types.array
  .concat(types.string, types.number)
  .reduce<Record<string, number>>(
    (acc, arg) => Object.assign(acc, { [arg]: 1 }),
    {},
  );

/**
 * Throws either "UNSUPPORTED" error or "INVALID_ARG_TYPE" error for numeric positional arguments.
 * @private
 */
const createErrorForNumericPositionalArg = (
  numericArg: string | number,
  allArgs: string[],
  parsedResult: YargsArguments,
): void => {
  // A flag for `numericArg` exists if:
  // 1. A mocha flag immediately preceeded the numericArg in `allArgs` array and
  // 2. `numericArg` value could not be assigned to this flag by `yargs-parser` because of incompatible datatype.
  const flag = allArgs.find((arg, index) => {
    const normalizedArg = arg.replace(/^--?/, "");
    return (
      isMochaFlag(arg) &&
      allArgs[index + 1] === String(numericArg) &&
      parsedResult[normalizedArg] !== String(numericArg)
    );
  });

  if (flag) {
    throw createInvalidArgumentTypeError(
      `Mocha flag '${flag}' given invalid option: '${numericArg}'`,
      numericArg,
      expectedTypeForFlag(flag),
    );
  } else {
    throw createUnsupportedError(
      `Option ${numericArg} is unsupported by the mocha cli`,
    );
  }
};

/**
 * Wrapper around `yargs-parser` which applies our settings
 * @private
 */
const parse = (
  args: string | string[] = [],
  defaultValues: Record<string, unknown> = {},
  ...configObjects: Record<string, unknown>[]
): YargsArguments => {
  // save node-specific args for special handling.
  // 1. when these args have a "=" they should be considered to have values
  // 2. if they don't, they are just boolean flags
  // 3. to avoid explicitly defining the set of them, we tell yargs-parser they
  //    are ALL boolean flags.
  // 4. we can then reapply the values after yargs-parser is done.
  const allArgs: string[] = Array.isArray(args) ? args : args.split(" ");
  const nodeArgs: [string, string | boolean][] = allArgs.reduce<
    [string, string | boolean][]
  >((acc, arg) => {
    const pair = arg.split("=");
    let flag = pair[0];
    if (isNodeFlag(flag, false)) {
      flag = flag.replace(/^--?/, "");
      return acc.concat([[flag, arg.includes("=") ? pair[1] : true]]);
    }
    return acc;
  }, []);

  const result = yargsParser.detailed(args, {
    configuration,
    configObjects,
    default: defaultValues,
    coerce: coerceOpts,
    narg: nargOpts,
    alias: aliases,
    string: types.string,
    array: types.array,
    number: types.number,
    boolean: types.boolean.concat(nodeArgs.map((pair) => pair[0])),
  });
  if (result.error) {
    console.error(pc.red(`Error: ${result.error.message}`));
    process.exit(1);
  }

  const numericPositionalArg = result.argv._.find((arg) => isNumeric(arg));
  if (numericPositionalArg) {
    createErrorForNumericPositionalArg(
      numericPositionalArg,
      allArgs,
      result.argv,
    );
  }

  // reapply "=" arg values from above
  nodeArgs.forEach(([key, value]) => {
    result.argv[key] = value;
  });

  return result.argv;
};

/**
 * Given path to config file in `args.config`, attempt to load & parse config file.
 * @public
 * @alias module:lib/cli.loadRc
 */
const loadRc = (
  args: { config?: string | boolean; [key: string]: unknown } = {},
): Record<string, unknown> | undefined => {
  if (args.config !== false) {
    const config = (args.config as string) || findConfig();
    return config ? loadConfig(config) : {};
  }
};

module.exports.loadRc = loadRc;

/**
 * Given path to `package.json` in `args.package`, attempt to load config from `mocha` prop.
 * @public
 * @alias module:lib/cli.loadPkgRc
 */
const loadPkgRc = (
  args: { package?: string | boolean; [key: string]: unknown } = {},
): Record<string, unknown> | undefined => {
  let result: Record<string, unknown> | undefined;
  if (args.package === false) {
    return result;
  }
  result = {};
  const filepath =
    (args.package as string) || findUp.sync(mocharc.package as string);
  if (filepath) {
    let configData: string;
    try {
      configData = fs.readFileSync(filepath, "utf8");
    } catch (err) {
      // If `args.package` was explicitly specified, throw an error
      if (filepath == args.package) {
        throw createUnparsableFileError(
          `Unable to read ${filepath}: ${err}`,
          filepath,
        );
      } else {
        debug("failed to read default package.json at %s; ignoring", filepath);
        return result;
      }
    }
    try {
      const pkg = JSON.parse(configData) as Record<
        string,
        unknown
      >;
      if (pkg.mocha) {
        debug("`mocha` prop of package.json parsed: %O", pkg.mocha);
        result = pkg.mocha as Record<string, unknown>;
      } else {
        debug("no config found in %s", filepath);
      }
    } catch (err) {
      // If JSON failed to parse, throw an error.
      throw createUnparsableFileError(
        `Unable to parse ${filepath}: ${err}`,
        filepath,
      );
    }
  }
  return result;
};

module.exports.loadPkgRc = loadPkgRc;

/**
 * Priority list:
 *
 * 1. Command-line args
 * 2. `MOCHA_OPTIONS` environment variable.
 * 3. RC file (`.mocharc.c?js`, `.mocharc.ya?ml`, `mocharc.json`)
 * 4. `mocha` prop of `package.json`
 * 5. default configuration (`lib/mocharc.json`)
 *
 * If a {@link module:lib/cli/one-and-dones.ONE_AND_DONE_ARGS "one-and-done" option} is present in the `argv` array, no external config files will be read.
 * @summary Parses options read from `.mocharc.*` and `package.json`.
 * @public
 * @alias module:lib/cli.loadOptions
 */
const loadOptions = (argv: string | string[] = []): YargsArguments => {
  let args = parse(argv);
  // short-circuit: look for a flag that would abort loading of options
  if (
    Array.from(ONE_AND_DONE_ARGS).reduce(
      (acc: boolean, arg: string) => acc || arg in args,
      false,
    )
  ) {
    return args;
  }

  const envConfig = parse(process.env.MOCHA_OPTIONS || "");
  const rcConfig = loadRc(args as { config?: string | boolean; [key: string]: unknown });
  const pkgConfig = loadPkgRc(args as { package?: string | boolean; [key: string]: unknown });

  if (rcConfig) {
    args.config = false;
    args._ = args._.concat(
      ((rcConfig as YargsArguments)._ || []) as (string | number)[],
    );
  }
  if (pkgConfig) {
    args.package = false;
    args._ = args._.concat(
      ((pkgConfig as YargsArguments)._ || []) as (string | number)[],
    );
  }

  args = parse(
    args._ as string[],
    mocharc,
    args as Record<string, unknown>,
    envConfig as Record<string, unknown>,
    (rcConfig || {}) as Record<string, unknown>,
    (pkgConfig || {}) as Record<string, unknown>,
  );

  // recombine positional arguments and "spec"
  if (args.spec) {
    args._ = args._.concat(args.spec as (string | number)[]);
    delete args.spec;
  }

  // make unique
  args._ = Array.from(new Set(args._));

  return args;
};

module.exports.loadOptions = loadOptions;
module.exports.YARGS_PARSER_CONFIG = YARGS_PARSER_CONFIG;
