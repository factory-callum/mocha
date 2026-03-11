"use strict";

import type { FSWatcher } from "chokidar" with {
  "resolution-mode": "import",
};
import type {
  BeforeWatchRun,
  FileCollectionOptions,
  PathFilter,
  PathMatcher,
  PathPattern,
  Rerunner,
} from "../types.d.ts";

/**
 * The `Pattern` class from the `glob` package is not exported publicly.
 * This interface mirrors the subset we use.
 * @see node_modules/glob/dist/commonjs/pattern.d.ts
 * @private
 */
interface GlobPattern {
  pattern(): string | RegExp | symbol;
  globString(): string;
  rest(): GlobPattern | null;
}

const debug: (...args: unknown[]) => void =
  require("debug")("mocha:cli:watch");
const path: typeof import("node:path") = require("node:path");
const chokidar: { watch: (paths: string[], opts: Record<string, unknown>) => FSWatcher } =
  require("chokidar");
const glob: {
  Glob: new (
    pattern: string,
    opts: Record<string, unknown>,
  ) => { patterns: GlobPattern[] };
} = require("glob");
const isPathInside: (childPath: string, parentPath: string) => boolean =
  require("is-path-inside");
const { minimatch }: { minimatch: (file: string, pattern: string, opts?: Record<string, unknown>) => boolean } =
  require("minimatch");
const Context: new () => Record<string, unknown> = require("../context");
const collectFiles: (
  params: FileCollectionOptions,
) => { files: string[]; unmatchedFiles: { pattern: string; absolutePath: string }[] } =
  require("./collect-files");
const { logSymbols }: { logSymbols: Record<string, string> } =
  require("../utils");

// Forward-declared Mocha type for re-require pattern
type MochaInstance = Record<string, unknown> & {
  suite: Record<string, unknown> & {
    clone: () => Record<string, unknown>;
    ctx: Record<string, unknown>;
  };
  options: Record<string, unknown> & {
    ui?: string;
    rootHooks?: unknown;
  };
  dispose: () => void;
  unloadFiles: () => void;
  files: string[];
  ui: (name?: string) => MochaInstance;
  rootHooks: (hooks: unknown) => MochaInstance;
  lazyLoadFiles: (flag: boolean) => MochaInstance;
  loadFilesAsync: () => Promise<void>;
  run: (fn?: (failures: number) => void) => RunnerInstance;
  enableGlobalSetup: (enabled: boolean) => MochaInstance;
  enableGlobalTeardown: (enabled: boolean) => MochaInstance;
  runGlobalSetup: (context?: unknown) => Promise<unknown>;
  runGlobalTeardown: (context?: unknown) => Promise<void>;
  hasGlobalTeardownFixtures: () => boolean;
};

type RunnerInstance = {
  abort: () => void;
};

/**
 * Exports the `watchRun` function that runs mocha in "watch" mode.
 * @see module:lib/cli/run-helpers
 * @module
 * @private
 */

/**
 * Run Mocha in parallel "watch" mode
 * @private
 */
exports.watchParallelRun = (
  mocha: MochaInstance,
  {
    watchFiles,
    watchIgnore,
  }: { watchFiles?: string[]; watchIgnore: string[] },
  fileCollectParams: FileCollectionOptions,
): FSWatcher => {
  debug("creating parallel watcher");

  return createWatcher(mocha, {
    watchFiles,
    watchIgnore,
    beforeRun({ mocha }: { mocha: MochaInstance; watcher: FSWatcher }): MochaInstance {
      // I don't know why we're cloning the root suite.
      const rootSuite = mocha.suite.clone();

      // ensure we aren't leaking event listeners
      mocha.dispose();

      // this `require` is needed because the require cache has been cleared.  the dynamic
      // exports set via the below call to `mocha.ui()` won't work properly if a
      // test depends on this module.
      const Mocha: new (opts: Record<string, unknown>) => MochaInstance =
        require("../mocha");

      // ... and now that we've gotten a new module, we need to use it again due
      // to `mocha.ui()` call
      const newMocha = new Mocha(mocha.options);
      // don't know why this is needed
      newMocha.suite = rootSuite as MochaInstance["suite"];
      // nor this
      newMocha.suite.ctx = new Context();

      // reset the list of files
      newMocha.files = collectFiles(fileCollectParams).files;

      // because we've swapped out the root suite (see the `run` inner function
      // in `createRerunner`), we need to call `mocha.ui()` again to set up the context/globals.
      newMocha.ui(newMocha.options.ui);

      // we need to call `newMocha.rootHooks` to set up rootHooks for the new
      // suite
      newMocha.rootHooks(newMocha.options.rootHooks);

      // in parallel mode, the main Mocha process doesn't actually load the
      // files. this flag prevents `mocha.run()` from autoloading.
      newMocha.lazyLoadFiles(true);
      return newMocha;
    },
    fileCollectParams,
  });
};

/**
 * Run Mocha in "watch" mode
 * @private
 */
exports.watchRun = (
  mocha: MochaInstance,
  {
    watchFiles,
    watchIgnore,
  }: { watchFiles?: string[]; watchIgnore: string[] },
  fileCollectParams: FileCollectionOptions,
): FSWatcher => {
  debug("creating serial watcher");

  return createWatcher(mocha, {
    watchFiles,
    watchIgnore,
    beforeRun({ mocha }: { mocha: MochaInstance; watcher: FSWatcher }): MochaInstance {
      mocha.unloadFiles();

      // I don't know why we're cloning the root suite.
      const rootSuite = mocha.suite.clone();

      // ensure we aren't leaking event listeners
      mocha.dispose();

      // this `require` is needed because the require cache has been cleared.  the dynamic
      // exports set via the below call to `mocha.ui()` won't work properly if a
      // test depends on this module.
      const Mocha: new (opts: Record<string, unknown>) => MochaInstance =
        require("../mocha");

      // ... and now that we've gotten a new module, we need to use it again due
      // to `mocha.ui()` call
      const newMocha = new Mocha(mocha.options);
      // don't know why this is needed
      newMocha.suite = rootSuite as MochaInstance["suite"];
      // nor this
      newMocha.suite.ctx = new Context();

      // reset the list of files
      newMocha.files = collectFiles(fileCollectParams).files;

      // because we've swapped out the root suite (see the `run` inner function
      // in `createRerunner`), we need to call `mocha.ui()` again to set up the context/globals.
      newMocha.ui(newMocha.options.ui);

      // we need to call `newMocha.rootHooks` to set up rootHooks for the new
      // suite
      newMocha.rootHooks(newMocha.options.rootHooks);

      return newMocha;
    },
    fileCollectParams,
  });
};

/**
 * Extracts out paths without the glob part, the directory paths,
 * and the paths for matching from the provided glob paths.
 * @private
 */
function createPathFilter(globPaths: string[], basePath: string): PathFilter {
  debug("creating path filter from glob paths: %s", globPaths);

  const res: PathFilter = {
    dir: { paths: new Set<string>(), globs: new Set<string>() },
    match: { paths: new Set<string>(), globs: new Set<string>() },
  };

  // for checking if a path ends with `/**/*`
  const globEnd = path.join(path.sep, "**", "*");

  const patterns: GlobPattern[] = globPaths.flatMap((globPath: string) => {
    return new glob.Glob(globPath, {
      dot: true,
      magicalBraces: true,
      windowsPathsNoEscape: true,
    }).patterns;
  });

  // each pattern will have its own path because of the `magicalBraces` option
  for (const pattern of patterns) {
    debug("processing glob pattern: %s", pattern.globString());

    const segments: string[] = [];

    let currentPattern: GlobPattern | null = pattern;
    let isGlob = false;

    do {
      // save string patterns until a non-string (glob or regexp) is matched
      const entry = currentPattern.pattern();
      const isString = typeof entry === "string";
      debug(
        "found %s pattern: %s",
        isString ? "string" : "glob or regexp",
        entry,
      );
      if (!isString) {
        // if the entry is a glob
        isGlob = true;
        break;
      }

      segments.push(entry);

      // go to next pattern
    } while ((currentPattern = currentPattern.rest()));
    if (!isGlob) {
      debug("all subpatterns of %j processed", pattern.globString());
    }

    // match `cleanPath` (path without the glob part) and its subdirectories
    const cleanPath = path.resolve(basePath, ...segments);
    debug("clean path: %s", cleanPath);
    res.dir.paths.add(cleanPath);
    res.dir.globs.add(path.resolve(cleanPath, "**", "*"));

    // match `absPath` and all of its contents
    const absPath = path.resolve(basePath, pattern.globString());
    debug("absolute path: %s", absPath);
    (isGlob ? res.match.globs : res.match.paths).add(absPath);

    // always include `/**/*` to the full pattern for matching
    // since it's possible for the last path segment to be a directory
    if (!absPath.endsWith(globEnd)) {
      res.match.globs.add(path.resolve(absPath, "**", "*"));
    }
  }

  debug("returning path filter: %o", res);
  return res;
}

/**
 * Checks if the provided path matches with the path pattern.
 * @private
 */
function matchPattern(
  filePath: string,
  pattern: PathPattern,
  matchParent?: boolean,
): boolean {
  if (pattern.paths.has(filePath)) {
    return true;
  }

  if (matchParent) {
    for (const childPath of pattern.paths) {
      if (isPathInside(childPath, filePath)) {
        return true;
      }
    }
  }

  // loop through the set of glob paths instead of converting it into an array
  for (const globPath of pattern.globs) {
    if (
      minimatch(filePath, globPath, { dot: true, windowsPathsNoEscape: true })
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Creates an object for matching allowed or ignored file paths.
 * @private
 */
function createPathMatcher(
  allowed: PathFilter,
  ignored: PathFilter,
  basePath: string,
): PathMatcher {
  debug(
    "creating path matcher from allowed: %o, ignored: %o",
    allowed,
    ignored,
  );

  /**
   * Cache of known file paths processed by `matcher.allow()`.
   */
  const allowCache = new Map<string, boolean>();

  /**
   * Cache of known file paths processed by `matcher.ignore()`.
   */
  const ignoreCache = new Map<string, boolean>();

  const MAX_CACHE_SIZE = 10000;

  /**
   * Performs a `map.set()` but will delete the first key
   * for new key-value pairs whenever the limit is reached.
   */
  function cache(map: Map<string, boolean>, key: string, value: boolean): void {
    // only delete the first key if the key doesn't exist in the map
    if (map.size >= MAX_CACHE_SIZE && !map.has(key)) {
      map.delete(map.keys().next().value!);
    }
    map.set(key, value);
  }

  const matcher: PathMatcher = {
    allow(filePath: string): boolean {
      let allow = allowCache.get(filePath);
      if (allow !== undefined) {
        return allow;
      }

      allow = matchPattern(filePath, allowed.match);
      cache(allowCache, filePath, allow);
      return allow;
    },

    ignore(filePath: string, stats?: { isDirectory: () => boolean }): boolean {
      // Chokidar calls the ignore match function twice:
      // once without `stats` and again with `stats`
      // see `ignored` under https://github.com/paulmillr/chokidar?tab=readme-ov-file#path-filtering
      // note that the second call can also have no `stats` if the `filePath` does not exist
      // in which case, allow the nonexistent path since it may be created later
      if (!stats) {
        return false;
      }

      // resolve to ensure correct absolute path since, for some reason,
      // Chokidar paths for the ignore match function use slashes `/` even for Windows
      filePath = path.resolve(basePath, filePath);

      let ignore = ignoreCache.get(filePath);
      if (ignore !== undefined) {
        return ignore;
      }

      // `filePath` ignore conditions:
      // - check if it's ignored from the `ignored` path patterns
      // - otherwise, check if it's not ignored via `matcher.allow()` to also cache the result
      // - if no match was found and `filePath` is a directory,
      // check from the allowed directory paths if it's a valid
      // parent directory or if it matches any of the allowed patterns
      // since ignoring directories will have Chokidar ignore their contents
      // which we may need to watch changes for
      ignore =
        matchPattern(filePath, ignored.match) ||
        (!matcher.allow(filePath) &&
          (!stats.isDirectory() || !matchPattern(filePath, allowed.dir, true)));

      cache(ignoreCache, filePath, ignore);
      return ignore;
    },
  };

  return matcher;
}

interface CreateWatcherOptions {
  watchFiles?: string[];
  watchIgnore: string[];
  beforeRun?: BeforeWatchRun;
  fileCollectParams: FileCollectionOptions;
}

/**
 * Bootstraps a Chokidar watcher. Handles keyboard input & signals
 * @private
 */
const createWatcher = (
  mocha: MochaInstance,
  { watchFiles, watchIgnore, beforeRun, fileCollectParams }: CreateWatcherOptions,
): FSWatcher => {
  if (!watchFiles) {
    watchFiles = (fileCollectParams.extension || []).map(
      (ext: string) => `**/*.${ext}`,
    );
  }

  debug("watching files: %s", watchFiles);
  debug("ignoring files matching: %s", watchIgnore);
  let globalFixtureContext: unknown;

  // we handle global fixtures manually
  mocha.enableGlobalSetup(false).enableGlobalTeardown(false);

  // glob file paths are no longer supported by Chokidar since v4
  // first, strip the glob paths from `watchFiles` for Chokidar to watch
  // then, create path patterns from `watchFiles` and `watchIgnore`
  // to determine if the files should be allowed or ignored
  // by the Chokidar `ignored` match function

  const basePath = process.cwd();
  const allowed = createPathFilter(watchFiles, basePath);
  const ignored = createPathFilter(watchIgnore, basePath);
  const matcher = createPathMatcher(allowed, ignored, basePath);

  // Chokidar has to watch the directory paths in case new files are created
  const watcher: FSWatcher = chokidar.watch(Array.from(allowed.dir.paths), {
    ignoreInitial: true,
    ignored: matcher.ignore,
  }) as FSWatcher;

  const rerunner = createRerunner(mocha, watcher, {
    beforeRun,
  });

  watcher.on("ready", async () => {
    debug("watcher ready");
    if (!globalFixtureContext) {
      debug("triggering global setup");
      globalFixtureContext = await mocha.runGlobalSetup();
    }
    rerunner.run();
  });

  watcher.on("all", (_event: string, filePath: string) => {
    // only allow file paths that match the allowed patterns
    if (matcher.allow(filePath)) {
      rerunner.scheduleRun();
    }
  });

  hideCursor();
  process.on("exit", () => {
    showCursor();
  });

  // this is for testing.
  // win32 cannot gracefully shutdown via a signal from a parent
  // process; a `SIGINT` from a parent will cause the process
  // to immediately exit.  during normal course of operation, a user
  // will type Ctrl-C and the listener will be invoked, but this
  // is not possible in automated testing.
  // there may be another way to solve this, but it too will be a hack.
  // for our watch tests on win32 we must _fork_ mocha with an IPC channel
  if (process.connected) {
    process.on("message", (msg: unknown) => {
      if (msg === "SIGINT") {
        process.emit("SIGINT");
      }
    });
  }

  let exiting = false;
  process.on("SIGINT", async () => {
    showCursor();
    console.error(`${logSymbols.warning} [mocha] cleaning up, please wait...`);
    if (!exiting) {
      exiting = true;
      if (mocha.hasGlobalTeardownFixtures()) {
        debug("running global teardown");
        try {
          await mocha.runGlobalTeardown(globalFixtureContext);
        } catch (err) {
          console.error(err);
        }
      }
      process.exit(130);
    }
  });

  // Keyboard shortcut for restarting when "rs\n" is typed (ala Nodemon)
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (data: Buffer | string) => {
    const str = data.toString().trim().toLowerCase();
    if (str === "rs") rerunner.scheduleRun();
  });

  return watcher;
};

interface CreateRerunnerOptions {
  beforeRun?: BeforeWatchRun;
}

/**
 * Create an object that allows you to rerun tests on the mocha instance.
 * @private
 */
const createRerunner = (
  mocha: MochaInstance,
  watcher: FSWatcher,
  { beforeRun }: CreateRerunnerOptions = {},
): Rerunner => {
  // Set to a `Runner` when mocha is running. Set to `null` when mocha is not
  // running.
  let runner: RunnerInstance | null = null;

  // true if a file has changed during a test run
  let rerunScheduled = false;

  const run = (): void => {
    try {
      mocha = beforeRun
        ? (beforeRun({ mocha, watcher } as Parameters<BeforeWatchRun>[0]) as unknown as MochaInstance) || mocha
        : mocha;
      runner = mocha.run(() => {
        debug("finished watch run");
        runner = null;
        blastCache(watcher);
        if (rerunScheduled) {
          rerun();
        } else {
          console.error(`${logSymbols.info} [mocha] waiting for changes...`);
        }
      });
    } catch (err: unknown) {
      console.error((err as Error).stack);
    }
  };

  const scheduleRun = (): void => {
    if (rerunScheduled) {
      return;
    }

    rerunScheduled = true;
    if (runner) {
      runner.abort();
    } else {
      rerun();
    }
  };

  const rerun = (): void => {
    rerunScheduled = false;
    eraseLine();
    run();
  };

  return {
    scheduleRun,
    run,
  };
};

/**
 * Return the list of absolute paths watched by a Chokidar watcher.
 * @private
 */
const getWatchedFiles = (watcher: FSWatcher): string[] => {
  const watchedDirs: Record<string, string[]> = watcher.getWatched();
  return Object.keys(watchedDirs).reduce<string[]>(
    (acc, dir) => [
      ...acc,
      ...watchedDirs[dir].map((file: string) => path.join(dir, file)),
    ],
    [],
  );
};

/**
 * Hide the cursor.
 * @private
 */
const hideCursor = (): void => {
  process.stdout.write("\u001b[?25l");
};

/**
 * Show the cursor.
 * @private
 */
const showCursor = (): void => {
  process.stdout.write("\u001b[?25h");
};

/**
 * Erases the line on stdout
 * @private
 */
const eraseLine = (): void => {
  process.stdout.write("\u001b[2K");
};

/**
 * Blast all of the watched files out of `require.cache`
 * @private
 */
const blastCache = (watcher: FSWatcher): void => {
  const files = getWatchedFiles(watcher);
  files.forEach((file: string) => {
    delete require.cache[file];
  });
  debug("deleted %d file(s) from the require cache", files.length);
};
