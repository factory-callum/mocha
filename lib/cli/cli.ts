"use strict";

/**
 * Contains CLI entry point and public API for programmatic usage in Node.js.
 * - Option parsing is handled by {@link https://npm.im/yargs yargs}.
 * - If executed via `node`, this module will run {@linkcode module:lib/cli.main main()}.
 * @public
 * @module lib/cli
 */

import type { Argv, CommandModule, ParserConfigurationOptions } from "yargs";

const debug: (...args: unknown[]) => void =
  require("debug")("mocha:cli:cli");
const yargs: () => Argv = require("yargs");
const path: typeof import("node:path") = require("node:path");
const {
  loadRc,
  loadPkgRc,
  loadOptions,
  YARGS_PARSER_CONFIG,
}: {
  loadRc: (filepath: string) => Record<string, unknown>;
  loadPkgRc: (args: Record<string, unknown>) => Record<string, unknown>;
  loadOptions: (argv: string[]) => Record<string, unknown> & { _: string[] };
  YARGS_PARSER_CONFIG: ParserConfigurationOptions;
} = require("./options");
const lookupFiles: (
  filepath: string,
  extensions?: string[],
  recursive?: boolean,
) => string[] | string | undefined = require("./lookup-files");
const commands: { run: CommandModule; init: CommandModule } =
  require("./commands");
const pc: typeof import("picocolors") = require("picocolors");
const {
  repository,
  homepage,
  version,
  discord,
}: {
  repository: { url: string };
  homepage: string;
  version: string;
  discord: string;
} = require("../../package.json");
const { cwd, logSymbols }: {
  cwd: () => string;
  logSymbols: Record<string, string>;
} = require("../utils");

/**
 * - Accepts an `Array` of arguments
 * - Modifies {@link https://nodejs.org/api/modules.html#modules_module_paths Node.js' search path} for easy loading of consumer modules
 * - Sets {@linkcode https://nodejs.org/api/errors.html#errors_error_stacktracelimit Error.stackTraceLimit} to `Infinity`
 * @public
 * @summary Mocha's main command-line entry-point.
 */
exports.main = (
  argv: string[] = process.argv.slice(2),
  mochaArgs?: Record<string, unknown> & { _: string[] },
): void => {
  debug("entered main with raw args", argv);
  // ensure we can require() from current working directory
  if (typeof module.paths !== "undefined") {
    module.paths.push(cwd(), path.resolve("node_modules"));
  }

  try {
    Error.stackTraceLimit = Infinity; // configurable via --stack-trace-limit?
  } catch (err) {
    debug("unable to set Error.stackTraceLimit = Infinity", err);
  }

  const args = mochaArgs || loadOptions(argv);

  yargs()
    .scriptName("mocha")
    .command(commands.run)
    .command(commands.init)
    .updateStrings({
      "Positionals:": "Positional Arguments",
      "Options:": "Other Options",
      "Commands:": "Commands",
    })
    .fail((msg: string, err: Error | undefined, yargs: Argv) => {
      debug("caught error sometime before command handler: %O", err);
      yargs.showHelp();
      console.error(`\n${logSymbols.error} ${pc.red("ERROR:")} ${msg}`);
      if (!msg) {
        // Log raw error and stack when an unexpected error is encountered, to
        // make debugging easier (instead of an inactionable "ERROR: null").
        console.error(err);
      }
      process.exit(1);
    })
    .help("help", "Show usage information & exit")
    .alias("help", "h")
    .version("version", "Show version number & exit", version)
    .alias("version", "V")
    .wrap(process.stdout.columns ? Math.min(process.stdout.columns, 80) : 80)
    .epilog(
      `${pc.reset("Mocha Resources")}
    Chat: ${pc.magenta(discord)}
  GitHub: ${pc.blue(repository.url)}
    Docs: ${pc.yellow(homepage)}
      `,
    )
    .parserConfiguration(YARGS_PARSER_CONFIG)
    .config(args)
    .parse(args._);
};

exports.lookupFiles = lookupFiles;
exports.loadOptions = loadOptions;
exports.loadPkgRc = loadPkgRc;
exports.loadRc = loadRc;

// allow direct execution
if (require.main === module) {
  exports.main();
}
