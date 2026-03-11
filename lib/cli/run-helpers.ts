"use strict";

/**
 * Helper scripts for the `run` command
 * @see module:lib/cli/run
 * @module
 * @private
 */

import type { FSWatcher } from "chokidar" with {
  "resolution-mode": "import",
};
import type { FileCollectionOptions } from "../types.d.ts";

const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const pc: typeof import("picocolors") = require("picocolors");
const debug: (...args: unknown[]) => void =
  require("debug")("mocha:cli:run:helpers");
const {
  watchRun,
  watchParallelRun,
}: {
  watchRun: (
    mocha: MochaLike,
    opts: { watchFiles?: string[]; watchIgnore: string[] },
    fileCollectParams: FileCollectionOptions,
  ) => FSWatcher;
  watchParallelRun: (
    mocha: MochaLike,
    opts: { watchFiles?: string[]; watchIgnore: string[] },
    fileCollectParams: FileCollectionOptions,
  ) => FSWatcher;
} = require("./watch-run");
const collectFiles: (
  params: FileCollectionOptions,
) => { files: string[]; unmatchedFiles: { pattern: string; absolutePath: string }[] } =
  require("./collect-files");
const { format }: typeof import("node:util") = require("node:util");
const {
  createInvalidLegacyPluginError,
}: {
  createInvalidLegacyPluginError: (
    message: string,
    pluginType: string,
    pluginId?: string,
  ) => Error;
} = require("../errors");
const {
  requireOrImport,
}: { requireOrImport: (module: string) => Promise<unknown> } =
  require("../nodejs/esm-utils");
const PluginLoader: {
  create: (opts: { ignore: string[] }) => PluginLoaderInstance;
} = require("../plugin-loader");

interface PluginLoaderInstance {
  load: (module: unknown) => boolean;
  finalize: () => Promise<Record<string, unknown>>;
}

/**
 * Mocha instance shape as used by run-helpers
 */
interface MochaLike {
  files: string[];
  run: (fn?: (failures: number) => void) => RunnerLike;
  loadFilesAsync: () => Promise<void>;
  [key: string]: unknown;
}

interface RunnerLike {
  [key: string]: unknown;
}

interface RunOptions {
  exit?: boolean;
  passOnFailingTestSuite?: boolean;
  watch?: boolean;
  extension?: string[];
  ignore?: string[];
  file?: string[];
  parallel?: boolean;
  recursive?: boolean;
  sort?: boolean;
  spec?: string[];
  watchFiles?: string[];
  watchIgnore?: string[];
  [key: string]: unknown;
}

/**
 * Exits Mocha when tests + code under test has finished execution (default)
 * @private
 */
const exitMochaLater = (clampedCode: number): void => {
  process.on("exit", () => {
    process.exitCode = Math.min(
      clampedCode,
      process.argv.includes("--posix-exit-codes") ? 1 : 255,
    );
  });
};

/**
 * Exits Mocha when Mocha itself has finished execution, regardless of
 * what the tests or code under test is doing.
 * @private
 */
const exitMocha = (clampedCode: number): void => {
  const usePosixExitCodes = process.argv.includes("--posix-exit-codes");
  clampedCode = Math.min(clampedCode, usePosixExitCodes ? 1 : 255);
  let draining = 0;

  // Eagerly set the process's exit code in case stream.write doesn't
  // execute its callback before the process terminates.
  process.exitCode = clampedCode;

  // flush output for Node.js Windows pipe bug
  // https://github.com/joyent/node/issues/6247 is just one bug example
  // https://github.com/visionmedia/mocha/issues/333 has a good discussion
  const done = (): void => {
    if (!draining--) {
      process.exit(clampedCode);
    }
  };

  const streams = [process.stdout, process.stderr];

  streams.forEach((stream) => {
    // submit empty write request and wait for completion
    draining += 1;
    stream.write("", done);
  });

  done();
};

/**
 * Coerce a comma-delimited string (or array thereof) into a flattened array of
 * strings
 * @private
 */
exports.list = (str: string | string[]): string[] =>
  Array.isArray(str) ? exports.list(str.join(",")) : str.split(/ *, */);

/**
 * `require()` the modules as required by `--require <require>`.
 *
 * Returns array of `mochaHooks` exports, if any.
 * @private
 */
exports.handleRequires = async (
  requires: string[] = [],
  { ignoredPlugins = [] }: { ignoredPlugins?: string[] } = {},
): Promise<Record<string, unknown>> => {
  const pluginLoader = PluginLoader.create({ ignore: ignoredPlugins });
  for await (const mod of requires) {
    let modpath = mod;
    // this is relative to cwd
    if (fs.existsSync(mod) || fs.existsSync(`${mod}.js`)) {
      modpath = path.resolve(mod);
      debug("resolved required file %s to %s", mod, modpath);
    }
    const requiredModule = await requireOrImport(modpath);
    if (requiredModule && typeof requiredModule === "object") {
      if (pluginLoader.load(requiredModule)) {
        debug("found one or more plugin implementations in %s", modpath);
      }
    }
    debug('loaded required module "%s"', mod);
  }
  const plugins = await pluginLoader.finalize();
  if (Object.keys(plugins).length) {
    debug("finalized plugin implementations: %O", plugins);
  }
  return plugins;
};

/**
 * Logs errors and exits the app if unmatched files exist
 * @private
 */
const handleUnmatchedFiles = (
  mocha: MochaLike,
  unmatchedFiles: { pattern: string; absolutePath: string }[],
): RunnerLike | undefined => {
  if (unmatchedFiles.length === 0) {
    return;
  }

  unmatchedFiles.forEach(({ pattern, absolutePath }) => {
    console.error(
      pc.yellow(
        `Warning: Cannot find any files matching pattern "${pattern}" at the absolute path "${absolutePath}"`,
      ),
    );
  });
  console.log(
    "No test file(s) found with the given pattern, exiting with code 1",
  );

  return mocha.run(exitMocha(1) as unknown as undefined);
};

/**
 * Collect and load test files, then run mocha instance.
 * @private
 */
const singleRun = async (
  mocha: MochaLike,
  { exit, passOnFailingTestSuite }: RunOptions,
  fileCollectParams: FileCollectionOptions,
): Promise<RunnerLike | undefined> => {
  const fileCollectionObj = collectFiles(fileCollectParams);

  if (fileCollectionObj.unmatchedFiles.length > 0) {
    return handleUnmatchedFiles(mocha, fileCollectionObj.unmatchedFiles);
  }

  debug("single run with %d file(s)", fileCollectionObj.files.length);
  mocha.files = fileCollectionObj.files;

  // handles ESM modules
  await mocha.loadFilesAsync();
  return mocha.run(createExitHandler({ exit, passOnFailingTestSuite }));
};

/**
 * Collect files and run tests (using `Runner`).
 *
 * This is `async` for consistency.
 * @private
 */
const parallelRun = async (
  mocha: MochaLike,
  options: RunOptions,
  fileCollectParams: FileCollectionOptions,
): Promise<RunnerLike | undefined> => {
  const fileCollectionObj = collectFiles(fileCollectParams);

  if (fileCollectionObj.unmatchedFiles.length > 0) {
    return handleUnmatchedFiles(mocha, fileCollectionObj.unmatchedFiles);
  }

  debug(
    "executing %d test file(s) in parallel mode",
    fileCollectionObj.files.length,
  );
  mocha.files = fileCollectionObj.files;

  // note that we DO NOT load any files here; this is handled by the worker
  return mocha.run(createExitHandler(options));
};

/**
 * Actually run tests.  Delegates to one of four different functions:
 * - `singleRun`: run tests in serial & exit
 * - `watchRun`: run tests in serial, rerunning as files change
 * - `parallelRun`: run tests in parallel & exit
 * - `watchParallelRun`: run tests in parallel, rerunning as files change
 * @private
 */
exports.runMocha = async (
  mocha: MochaLike,
  options: RunOptions,
): Promise<RunnerLike | FSWatcher | undefined> => {
  const {
    watch = false,
    extension = [],
    ignore = [],
    file = [],
    parallel = false,
    recursive = false,
    sort = false,
    spec = [],
  } = options;

  const fileCollectParams: FileCollectionOptions = {
    ignore,
    extension,
    file,
    recursive,
    sort,
    spec,
  };

  if (watch) {
    const run = parallel ? watchParallelRun : watchRun;
    return run(mocha, options as Parameters<typeof run>[1], fileCollectParams);
  }

  const run = parallel ? parallelRun : singleRun;
  return run(mocha, options, fileCollectParams);
};

/**
 * Used for `--reporter` and `--ui`.  Ensures there's only one, and asserts that
 * it actually exists. This must be run _after_ requires are processed (see
 * {@link handleRequires}), as it'll prevent interfaces from loading otherwise.
 * @private
 */
exports.validateLegacyPlugin = (
  opts: Record<string, unknown>,
  pluginType: "reporter" | "ui",
  map: Record<string, unknown> = {},
): void => {
  /**
   * This should be a unique identifier; either a string (present in `map`),
   * or a resolvable (via `require.resolve`) module ID/path.
   */
  const pluginId = opts[pluginType] as string | string[];

  if (Array.isArray(pluginId)) {
    throw createInvalidLegacyPluginError(
      `"--${pluginType}" can only be specified once`,
      pluginType,
    );
  }

  const createUnknownError = (err: unknown): Error =>
    createInvalidLegacyPluginError(
      format('Could not load %s "%s":\n\n %O', pluginType, pluginId, err),
      pluginType,
      pluginId,
    );

  // if this exists, then it's already loaded, so nothing more to do.
  if (!map[pluginId]) {
    let foundId: string | undefined;
    try {
      foundId = require.resolve(pluginId);
      map[pluginId] = require(foundId);
    } catch (err) {
      if (foundId) throw createUnknownError(err);

      // Try to load reporters from a cwd-relative path
      try {
        map[pluginId] = require(path.resolve(pluginId));
      } catch (err) {
        throw createUnknownError(err);
      }
    }
  }
};

const createExitHandler = ({
  exit,
  passOnFailingTestSuite,
}: {
  exit?: boolean;
  passOnFailingTestSuite?: boolean;
}): ((code: number) => void) => {
  return (code: number): void => {
    const clampedCode = passOnFailingTestSuite ? 0 : Math.min(code, 255);

    return exit ? exitMocha(clampedCode) : exitMochaLater(clampedCode);
  };
};
