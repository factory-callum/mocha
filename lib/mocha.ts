"use strict";

/*!
 * mocha
 * Copyright(c) 2011 TJ Holowaychuk <tj@vision-media.ca>
 * MIT Licensed
 */

import type {
  DoneCB,
  MochaGlobalFixture,
  MochaOptions,
  MochaRootHookObject,
} from "./types.d.ts";

const escapeRe: (str: string) => string = require("escape-string-regexp");
const path: typeof import("node:path") = require("node:path");
const builtinReporters: Record<string, unknown> & {
  Base: { useColors?: boolean; inlineDiffs?: boolean; hideDiff?: boolean };
  base: unknown;
} = require("./reporters");
const utils: {
  defineConstants: <T extends Record<string, string>>(obj: T) => Readonly<T>;
  isBrowser: () => boolean;
  cwd: () => string;
  isString: (obj: unknown) => obj is string;
  noop: () => void;
  castArray: <T>(val: T | T[]) => T[];
  stackTraceFilter: () => (stack: string) => string;
  stringify: (value: unknown) => string;
  [key: string]: unknown;
} = require("./utils");
const mocharc: Record<string, unknown> = require("./mocharc.json");
const Suite: {
  new (
    title: string,
    parentContext: unknown,
    isRoot?: boolean,
  ): SuiteInstance;
  constants: Record<string, string>;
} = require("./suite");
const esmUtils: {
  loadFilesAsync: (
    files: string[],
    preRequire: (file: string) => void,
    postRequire: (file: string, resultModule: unknown) => void,
    esmDecorator?: (name: string) => string,
  ) => Promise<void>;
} = require("./nodejs/esm-utils");
const createStatsCollector: (runner: unknown) => void =
  require("./stats-collector");
const {
  createInvalidReporterError,
  createInvalidInterfaceError,
  createMochaInstanceAlreadyDisposedError,
  createMochaInstanceAlreadyRunningError,
  createUnsupportedError,
}: {
  createInvalidReporterError: (message: string, reporter: string) => Error;
  createInvalidInterfaceError: (message: string, ui: string) => Error;
  createMochaInstanceAlreadyDisposedError: (
    message: string,
    cleanReferencesAfterRun: boolean,
    instance: Mocha,
  ) => Error;
  createMochaInstanceAlreadyRunningError: (
    message: string,
    instance?: Mocha,
  ) => Error;
  createUnsupportedError: (message: string) => Error;
} = require("./errors");
const {
  EVENT_FILE_PRE_REQUIRE,
  EVENT_FILE_POST_REQUIRE,
  EVENT_FILE_REQUIRE,
}: Record<string, string> = Suite.constants;
const debug: (...args: unknown[]) => void = require("debug")("mocha:mocha");

/** Hook function type */
type HookFn = (...args: unknown[]) => unknown;

/** Interface for a Suite instance */
interface SuiteInstance {
  bail(bail: boolean): void;
  slow(ms: number | string): void;
  timeout(ms: number | string): void;
  retries(n: number): void;
  emit(event: string, ...args: unknown[]): void;
  on(event: string, fn: (...args: unknown[]) => void): void;
  dispose(): void;
  reset(): void;
  beforeAll(fn: HookFn): void;
  beforeEach(fn: HookFn): void;
  afterAll(fn: HookFn): void;
  afterEach(fn: HookFn): void;
  [key: string]: unknown;
}

/** Interface for a Runner-like instance */
interface RunnerInstance {
  runAsync(opts: { files: string[]; options: MochaOptions & Record<string, unknown> }): Promise<number>;
  globals(globals: string[]): void;
  grep(re: RegExp, invert?: boolean): void;
  dispose(): void;
  checkLeaks: boolean;
  fullStackTrace: boolean;
  asyncOnly: boolean;
  allowUncaught: boolean;
  forbidOnly: boolean;
  forbidPending: boolean;
  stats: unknown;
  [key: string]: unknown;
}

/** Interface for a Reporter instance */
interface ReporterInstance {
  done?: (failures: number, fn: DoneCB) => void;
  [key: string]: unknown;
}

/** Runner constructor type */
interface RunnerConstructor {
  new (suite: SuiteInstance, options: Record<string, unknown>): RunnerInstance;
  constants: Record<string, string>;
}

exports = module.exports = Mocha;

/**
 * A Mocha instance is a finite state machine.
 * These are the states it can be in.
 * @private
 */
const mochaStates: Readonly<{
  INIT: string;
  RUNNING: string;
  REFERENCES_CLEANED: string;
  DISPOSED: string;
}> = utils.defineConstants({
  /**
   * Initial state of the mocha instance
   * @private
   */
  INIT: "init",
  /**
   * Mocha instance is running tests
   * @private
   */
  RUNNING: "running",
  /**
   * Mocha instance is done running tests and references to test functions and hooks are cleaned.
   * You can reset this state by unloading the test files.
   * @private
   */
  REFERENCES_CLEANED: "referencesCleaned",
  /**
   * Mocha instance is disposed and can no longer be used.
   * @private
   */
  DISPOSED: "disposed",
});

/**
 * To require local UIs and reporters when running in node.
 */

if (!utils.isBrowser() && typeof module.paths !== "undefined") {
  const cwdPath: string = utils.cwd();
  module.paths.push(cwdPath, path.join(cwdPath, "node_modules"));
}

/**
 * Expose internals.
 * @private
 */

exports.utils = utils;
exports.interfaces = require("./interfaces");
/**
 * @public
 * @memberof Mocha
 */
exports.reporters = builtinReporters;
exports.Runnable = require("./runnable");
exports.Context = require("./context");
/**
 *
 * @memberof Mocha
 */
exports.Runner = require("./runner");
exports.Suite = Suite;
exports.Hook = require("./hook");
exports.Test = require("./test");

/** Interface for context functions that have .only and .skip */
interface ContextFunction {
  (...args: unknown[]): unknown;
  only: (...args: unknown[]) => unknown;
  skip: (...args: unknown[]) => unknown;
}

let currentContext: Record<string, ContextFunction>;
exports.afterEach = function (...args: unknown[]): unknown {
  return (currentContext.afterEach || currentContext.teardown).apply(
    this,
    args,
  );
};
exports.after = function (...args: unknown[]): unknown {
  return (currentContext.after || currentContext.suiteTeardown).apply(
    this,
    args,
  );
};
exports.beforeEach = function (...args: unknown[]): unknown {
  return (currentContext.beforeEach || currentContext.setup).apply(this, args);
};
exports.before = function (...args: unknown[]): unknown {
  return (currentContext.before || currentContext.suiteSetup).apply(this, args);
};
exports.describe = function (...args: unknown[]): unknown {
  return (currentContext.describe || currentContext.suite).apply(this, args);
};
exports.describe.only = function (...args: unknown[]): unknown {
  return (currentContext.describe || currentContext.suite).only.apply(
    this,
    args,
  );
};
exports.describe.skip = function (...args: unknown[]): unknown {
  return (currentContext.describe || currentContext.suite).skip.apply(
    this,
    args,
  );
};
exports.it = function (...args: unknown[]): unknown {
  return (currentContext.it || currentContext.test).apply(this, args);
};
exports.it.only = function (...args: unknown[]): unknown {
  return (currentContext.it || currentContext.test).only.apply(this, args);
};
exports.it.skip = function (...args: unknown[]): unknown {
  return (currentContext.it || currentContext.test).skip.apply(this, args);
};
exports.xdescribe = exports.describe.skip;
exports.xit = exports.it.skip;
exports.setup = exports.beforeEach;
exports.suiteSetup = exports.before;
exports.suiteTeardown = exports.after;
exports.suite = exports.describe;
exports.teardown = exports.afterEach;
exports.test = exports.it;
exports.run = function (...args: unknown[]): unknown {
  return currentContext.run.apply(this, args);
};

/**
 * Constructs a new Mocha instance with `options`.
 *
 * @public
 * @class Mocha
 * @param options - Settings object.
 */
function Mocha(
  this: Mocha,
  options: MochaOptions & Record<string, unknown> = {},
): void {
  options = { ...mocharc, ...options };
  this.files = [];
  this.options = options;
  // root suite
  this.suite = new (exports as { Suite: typeof Suite; Context: new () => unknown }).Suite(
    "",
    new (exports as { Suite: typeof Suite; Context: new () => unknown }).Context(),
    true,
  );
  this._cleanReferencesAfterRun = true;
  this._state = mochaStates.INIT;

  this.grep(options.grep)
    .fgrep(options.fgrep as string | undefined)
    .ui(options.ui)
    .reporter(
      options.reporter as string | ((...args: unknown[]) => unknown) | undefined,
      (options["reporter-option"] as object | undefined) ||
        options.reporterOption ||
        (options.reporterOptions as object | undefined), // for backwards compatibility
    )
    .slow(options.slow)
    .global(options.global);

  // this guard exists because Suite#timeout does not consider `undefined` to be valid input
  if (typeof options.timeout !== "undefined") {
    this.timeout(
      (options as Record<string, unknown>).timeout === false
        ? 0
        : options.timeout!,
    );
  }

  if ("retries" in options) {
    this.retries(options.retries as number);
  }

  (
    [
      "allowUncaught",
      "asyncOnly",
      "bail",
      "checkLeaks",
      "color",
      "delay",
      "diff",
      "dryRun",
      "passOnFailingTestSuite",
      "failZero",
      "forbidOnly",
      "forbidPending",
      "fullTrace",
      "inlineDiffs",
      "invert",
    ] as const
  ).forEach(function (this: Mocha, opt: string) {
    if ((options as Record<string, unknown>)[opt]) {
      (this as unknown as Record<string, () => void>)[opt]();
    }
  }, this);

  if (options.rootHooks) {
    this.rootHooks(options.rootHooks);
  }

  /**
   * The class which we'll instantiate in {@link Mocha#run}.  Defaults to
   * {@link Runner} in serial mode; changes in parallel mode.
   * @memberof Mocha
   * @private
   */
  this._runnerClass = exports.Runner;

  /**
   * Whether or not to call {@link Mocha#loadFiles} implicitly when calling
   * {@link Mocha#run}.  If this is `true`, then it's up to the consumer to call
   * {@link Mocha#loadFiles} _or_ {@link Mocha#loadFilesAsync}.
   * @private
   * @memberof Mocha
   */
  this._lazyLoadFiles = false;

  /**
   * It's useful for a Mocha instance to know if it's running in a worker process.
   * We could derive this via other means, but it's helpful to have a flag to refer to.
   * @memberof Mocha
   * @private
   */
  this.isWorker = Boolean(options.isWorker);

  this.globalSetup(options.globalSetup as MochaGlobalFixture | MochaGlobalFixture[] | undefined)
    .globalTeardown(options.globalTeardown as MochaGlobalFixture | MochaGlobalFixture[] | undefined)
    .enableGlobalSetup(options.enableGlobalSetup as boolean | undefined)
    .enableGlobalTeardown(options.enableGlobalTeardown as boolean | undefined);

  if (
    options.parallel &&
    (typeof options.jobs === "undefined" || (options.jobs as number) > 1)
  ) {
    debug("attempting to enable parallel mode");
    this.parallelMode(true);
  }
}

/** Mocha instance interface */
interface Mocha {
  files: string[];
  options: MochaOptions & Record<string, unknown>;
  suite: SuiteInstance;
  _cleanReferencesAfterRun: boolean;
  _state: string;
  _runnerClass: RunnerConstructor;
  _lazyLoadFiles: boolean;
  _previousRunner?: RunnerInstance;
  _reporter: (new (runner: RunnerInstance, options: unknown) => ReporterInstance) | ((...args: unknown[]) => unknown);
  isWorker: boolean;

  bail(bail?: boolean): Mocha;
  addFile(file: string): Mocha;
  reporter(reporterName?: string | ((...args: unknown[]) => unknown), reporterOptions?: object): Mocha;
  ui(ui?: string | ((...args: unknown[]) => unknown)): Mocha;
  loadFiles(fn?: () => void): void;
  loadFilesAsync(options?: { esmDecorator?: (name: string) => string }): Promise<void>;
  unloadFiles(): Mocha;
  fgrep(str?: string): Mocha;
  grep(re?: RegExp | string): Mocha;
  invert(): Mocha;
  checkLeaks(checkLeaks?: boolean): Mocha;
  cleanReferencesAfterRun(cleanReferencesAfterRun?: boolean): Mocha;
  dispose(): void;
  fullTrace(fullTrace?: boolean): Mocha;
  global(global?: string[] | string): Mocha;
  globals(global?: string[] | string): Mocha;
  color(color?: boolean): Mocha;
  inlineDiffs(inlineDiffs?: boolean): Mocha;
  diff(diff?: boolean): Mocha;
  timeout(msecs?: number | string): Mocha;
  retries(retry?: number): Mocha;
  slow(msecs?: number | string): Mocha;
  asyncOnly(asyncOnly?: boolean): Mocha;
  noHighlighting(): Mocha;
  allowUncaught(allowUncaught?: boolean): Mocha;
  delay(): Mocha;
  dryRun(dryRun?: boolean): Mocha;
  failHookAffectedTests(failHookAffectedTests?: boolean): Mocha;
  failZero(failZero?: boolean): Mocha;
  passOnFailingTestSuite(passOnFailingTestSuite?: boolean): Mocha;
  forbidOnly(forbidOnly?: boolean): Mocha;
  forbidPending(forbidPending?: boolean): Mocha;
  _guardRunningStateTransition(): void;
  version: string;
  run(fn?: DoneCB): RunnerInstance;
  rootHooks(hooks?: MochaRootHookObject): Mocha;
  parallelMode(enable?: boolean): Mocha;
  lazyLoadFiles(enable?: boolean): Mocha;
  globalSetup(setupFns?: MochaGlobalFixture | MochaGlobalFixture[]): Mocha;
  globalTeardown(teardownFns?: MochaGlobalFixture | MochaGlobalFixture[]): Mocha;
  runGlobalSetup(context?: Record<string, unknown>): Promise<Record<string, unknown>>;
  runGlobalTeardown(context?: Record<string, unknown>, opts?: { context?: Record<string, unknown> }): Promise<Record<string, unknown>>;
  _runGlobalFixtures(fixtureFns?: MochaGlobalFixture[], context?: Record<string, unknown>): Promise<Record<string, unknown>>;
  enableGlobalSetup(enabled?: boolean): Mocha;
  enableGlobalTeardown(enabled?: boolean): Mocha;
  hasGlobalSetupFixtures(): boolean;
  hasGlobalTeardownFixtures(): boolean;
  [key: string]: unknown;
}

/**
 * Enables or disables bailing on the first failure.
 *
 * @public
 * @see [CLI option](../#-bail-b)
 * @param bail - Whether to bail on first error.
 * @returns this
 * @chainable
 */
Mocha.prototype.bail = function (this: Mocha, bail?: boolean): Mocha {
  this.suite.bail(bail !== false);
  return this;
};

/**
 * Adds `file` to be loaded for execution.
 *
 * Useful for generic setup code that must be included within test suite.
 *
 * @public
 * @see [CLI option](../#-file-filedirectoryglob)
 * @param file - Pathname of file to be loaded.
 * @returns this
 * @chainable
 */
Mocha.prototype.addFile = function (this: Mocha, file: string): Mocha {
  this.files.push(file);
  return this;
};

/**
 * Sets reporter to `reporter`, defaults to "spec".
 *
 * @public
 * @see [CLI option](../#-reporter-name-r-name)
 * @see [Reporters](../#reporters)
 * @param reporterName - Reporter name or constructor.
 * @param reporterOptions - Options used to configure the reporter.
 * @returns this
 * @chainable
 * @throws {Error} if requested reporter cannot be loaded
 *
 * @example
 * // Use XUnit reporter and direct its output to file
 * mocha.reporter('xunit', { output: '/path/to/testspec.xunit.xml' });
 */
Mocha.prototype.reporter = function (
  this: Mocha,
  reporterName?: string | ((...args: unknown[]) => unknown),
  reporterOptions?: object,
): Mocha {
  if (typeof reporterName === "function") {
    this._reporter = reporterName;
  } else {
    reporterName = reporterName || "spec";
    let reporter: unknown;
    // Try to load a built-in reporter.
    if ((builtinReporters as Record<string, unknown>)[reporterName]) {
      reporter = (builtinReporters as Record<string, unknown>)[reporterName];
    }
    // Try to load reporters from process.cwd() and node_modules
    if (!reporter) {
      let foundReporter: string | undefined;
      try {
        foundReporter = require.resolve(reporterName);
        reporter = require(foundReporter);
      } catch (err: unknown) {
        if (foundReporter) {
          throw createInvalidReporterError(
            (err as Error).message,
            foundReporter,
          );
        }
        // Try to load reporters from a cwd-relative path
        try {
          reporter = require(path.resolve(reporterName));
        } catch (err: unknown) {
          throw createInvalidReporterError(
            (err as Error).message,
            reporterName,
          );
        }
      }
    }
    if ((reporter as Record<string, unknown>).default) {
      reporter = (reporter as Record<string, unknown>).default;
    }

    this._reporter = reporter as Mocha["_reporter"];
  }
  this.options.reporterOption = reporterOptions;
  // alias option name is used in built-in reporters xunit/tap/progress
  this.options.reporterOptions = reporterOptions;
  return this;
};

/**
 * Sets test UI `name`, defaults to "bdd".
 *
 * @public
 * @see [CLI option](../#-ui-name-u-name)
 * @see [Interface DSLs](../#interfaces)
 * @param ui - Interface name or class.
 * @returns this
 * @chainable
 * @throws {Error} if requested interface cannot be loaded
 */
Mocha.prototype.ui = function (
  this: Mocha,
  ui?: string | ((...args: unknown[]) => unknown),
): Mocha {
  let bindInterface: (...args: unknown[]) => unknown;
  if (typeof ui === "function") {
    bindInterface = ui;
  } else {
    ui = ui || "bdd";
    bindInterface = (
      exports as Record<
        string,
        Record<string, (...args: unknown[]) => unknown>
      >
    ).interfaces[ui];
    if (!bindInterface) {
      try {
        bindInterface = require(ui);
      } catch {
        throw createInvalidInterfaceError(`invalid interface '${ui}'`, ui);
      }
    }
  }
  if ((bindInterface as unknown as Record<string, unknown>).default) {
    bindInterface = (
      bindInterface as unknown as Record<
        string,
        (...args: unknown[]) => unknown
      >
    ).default;
  }

  bindInterface(this.suite);

  this.suite.on(
    EVENT_FILE_PRE_REQUIRE,
    function (context: unknown) {
      currentContext = context as Record<string, ContextFunction>;
    },
  );

  return this;
};

/**
 * Loads `files` prior to execution. Does not support ES Modules.
 *
 * The implementation relies on Node's `require` to execute
 * the test interface functions and will be subject to its cache.
 * Supports only CommonJS modules. To load ES modules, use Mocha#loadFilesAsync.
 *
 * @private
 * @see {@link Mocha#addFile}
 * @see {@link Mocha#run}
 * @see {@link Mocha#unloadFiles}
 * @see {@link Mocha#loadFilesAsync}
 * @param fn - Callback invoked upon completion.
 */
Mocha.prototype.loadFiles = function (this: Mocha, fn?: () => void): void {
  const self = this;
  const suite = this.suite;
  this.files.forEach(function (file: string) {
    file = path.resolve(file);
    suite.emit(EVENT_FILE_PRE_REQUIRE, global, file, self);
    suite.emit(EVENT_FILE_REQUIRE, require(file), file, self);
    suite.emit(EVENT_FILE_POST_REQUIRE, global, file, self);
  });
  if (fn) {
    fn();
  }
};

/**
 * Loads `files` prior to execution. Supports Node ES Modules.
 *
 * The implementation relies on Node's `require` and `import` to execute
 * the test interface functions and will be subject to its cache.
 * Supports both CJS and ESM modules.
 *
 * @public
 * @see {@link Mocha#addFile}
 * @see {@link Mocha#run}
 * @see {@link Mocha#unloadFiles}
 * @param options - Settings object.
 * @param options.esmDecorator - Function invoked on esm module name right before importing it.
 * @returns Promise
 *
 * @example
 * // loads ESM (and CJS) test files asynchronously, then runs root suite
 * mocha.loadFilesAsync()
 *   .then(() => mocha.run(failures => process.exitCode = failures ? 1 : 0))
 *   .catch(() => process.exitCode = 1);
 */
Mocha.prototype.loadFilesAsync = function (
  this: Mocha,
  { esmDecorator }: { esmDecorator?: (name: string) => string } = {},
): Promise<void> {
  const self = this;
  const suite = this.suite;
  this.lazyLoadFiles(true);

  return esmUtils.loadFilesAsync(
    this.files,
    function (file: string) {
      suite.emit(EVENT_FILE_PRE_REQUIRE, global, file, self);
    },
    function (file: string, resultModule: unknown) {
      suite.emit(EVENT_FILE_REQUIRE, resultModule, file, self);
      suite.emit(EVENT_FILE_POST_REQUIRE, global, file, self);
    },
    esmDecorator,
  );
};

/**
 * Removes a previously loaded file from Node's `require` cache.
 *
 * @private
 * @static
 * @see {@link Mocha#unloadFiles}
 * @param file - Pathname of file to be unloaded.
 */
Mocha.unloadFile = function (file: string): void {
  if (utils.isBrowser()) {
    throw createUnsupportedError(
      "unloadFile() is only supported in a Node.js environment",
    );
  }
  return require("./nodejs/file-unloader").unloadFile(file);
};

/**
 * Unloads `files` from Node's `require` cache.
 *
 * This allows required files to be "freshly" reloaded, providing the ability
 * to reuse a Mocha instance programmatically.
 * Note: does not clear ESM module files from the cache
 *
 * <strong>Intended for consumers &mdash; not used internally</strong>
 *
 * @public
 * @see {@link Mocha#run}
 * @returns this
 * @chainable
 */
Mocha.prototype.unloadFiles = function (this: Mocha): Mocha {
  if (this._state === mochaStates.DISPOSED) {
    throw createMochaInstanceAlreadyDisposedError(
      "Mocha instance is already disposed, it cannot be used again.",
      this._cleanReferencesAfterRun,
      this,
    );
  }

  this.files.forEach(function (file: string) {
    Mocha.unloadFile(file);
  });
  this._state = mochaStates.INIT;
  return this;
};

/**
 * Sets `grep` filter after escaping RegExp special characters.
 *
 * @public
 * @see {@link Mocha#grep}
 * @param str - Value to be converted to a regexp.
 * @returns this
 * @chainable
 *
 * @example
 * // Select tests whose full title begins with `"foo"` followed by a period
 * mocha.fgrep('foo.');
 */
Mocha.prototype.fgrep = function (this: Mocha, str?: string): Mocha {
  if (!str) {
    return this;
  }
  return this.grep(new RegExp(escapeRe(str)));
};

/**
 * Sets `grep` filter used to select specific tests for execution.
 *
 * If `re` is a regexp-like string, it will be converted to regexp.
 * The regexp is tested against the full title of each test (i.e., the
 * name of the test preceded by titles of each its ancestral suites).
 * As such, using an <em>exact-match</em> fixed pattern against the
 * test name itself will not yield any matches.
 * <br>
 * <strong>Previous filter value will be overwritten on each call!</strong>
 *
 * @public
 * @see [CLI option](../#-grep-regexp-g-regexp)
 * @see {@link Mocha#fgrep}
 * @see {@link Mocha#invert}
 * @param re - Regular expression used to select tests.
 * @returns this
 * @chainable
 *
 * @example
 * // Select tests whose full title contains `"match"`, ignoring case
 * mocha.grep(/match/i);
 *
 * @example
 * // Same as above but with regexp-like string argument
 * mocha.grep('/match/i');
 */
Mocha.prototype.grep = function (
  this: Mocha,
  re?: RegExp | string,
): Mocha {
  if (utils.isString(re)) {
    // extract args if it's regex-like, i.e: [string, pattern, flag]
    const arg: RegExpMatchArray = re.match(/^\/(.*)\/([gimy]{0,4})$|.*/)!;
    this.options.grep = new RegExp(arg[1] || arg[0], arg[2]);
  } else {
    this.options.grep = re;
  }
  return this;
};

/**
 * Inverts `grep` matches.
 *
 * @public
 * @see {@link Mocha#grep}
 * @returns this
 * @chainable
 *
 * @example
 * // Select tests whose full title does *not* contain `"match"`, ignoring case
 * mocha.grep(/match/i).invert();
 */
Mocha.prototype.invert = function (this: Mocha): Mocha {
  this.options.invert = true;
  return this;
};

/**
 * Enables or disables checking for global variables leaked while running tests.
 *
 * @public
 * @see [CLI option](../#-check-leaks)
 * @param checkLeaks - Whether to check for global variable leaks.
 * @returns this
 * @chainable
 */
Mocha.prototype.checkLeaks = function (
  this: Mocha,
  checkLeaks?: boolean,
): Mocha {
  this.options.checkLeaks = checkLeaks !== false;
  return this;
};

/**
 * Enables or disables whether or not to dispose after each test run.
 * Disable this to ensure you can run the test suite multiple times.
 * If disabled, be sure to dispose mocha when you're done to prevent memory leaks.
 * @public
 * @see {@link Mocha#dispose}
 * @param cleanReferencesAfterRun
 * @returns this
 * @chainable
 */
Mocha.prototype.cleanReferencesAfterRun = function (
  this: Mocha,
  cleanReferencesAfterRun?: boolean,
): Mocha {
  this._cleanReferencesAfterRun = cleanReferencesAfterRun !== false;
  return this;
};

/**
 * Manually dispose this mocha instance. Mark this instance as `disposed` and unable to run more tests.
 * It also removes function references to tests functions and hooks, so variables trapped in closures can be cleaned by the garbage collector.
 * @public
 */
Mocha.prototype.dispose = function (this: Mocha): void {
  if (this._state === mochaStates.RUNNING) {
    throw createMochaInstanceAlreadyRunningError(
      "Cannot dispose while the mocha instance is still running tests.",
    );
  }
  this.unloadFiles();
  if (this._previousRunner) {
    this._previousRunner.dispose();
  }
  this.suite.dispose();
  this._state = mochaStates.DISPOSED;
};

/**
 * Displays full stack trace upon test failure.
 *
 * @public
 * @see [CLI option](../#-full-trace)
 * @param fullTrace - Whether to print full stacktrace upon failure.
 * @returns this
 * @chainable
 */
Mocha.prototype.fullTrace = function (
  this: Mocha,
  fullTrace?: boolean,
): Mocha {
  this.options.fullTrace = fullTrace !== false;
  return this;
};

/**
 * Specifies whitelist of variable names to be expected in global scope.
 *
 * @public
 * @see [CLI option](../#-global-variable-name)
 * @see {@link Mocha#checkLeaks}
 * @param global - Accepted global variable name(s).
 * @returns this
 * @chainable
 *
 * @example
 * // Specify variables to be expected in global scope
 * mocha.global(['jQuery', 'MyLib']);
 */
Mocha.prototype.global = function (
  this: Mocha,
  global?: string[] | string,
): Mocha {
  this.options.global = ((this.options.global || []) as string[])
    .concat(global as string | string[])
    .filter(Boolean)
    .filter(function (elt: string, idx: number, arr: string[]) {
      return arr.indexOf(elt) === idx;
    });
  return this;
};
// for backwards compatibility, 'globals' is an alias of 'global'
Mocha.prototype.globals = Mocha.prototype.global;

/**
 * Enables or disables TTY color output by screen-oriented reporters.
 *
 * @public
 * @see [CLI option](../#-color-c-colors)
 * @param color - Whether to enable color output.
 * @returns this
 * @chainable
 */
Mocha.prototype.color = function (this: Mocha, color?: boolean): Mocha {
  this.options.color = color !== false;
  return this;
};

/**
 * Enables or disables reporter to use inline diffs (rather than +/-)
 * in test failure output.
 *
 * @public
 * @see [CLI option](../#-inline-diffs)
 * @param inlineDiffs - Whether to use inline diffs.
 * @returns this
 * @chainable
 */
Mocha.prototype.inlineDiffs = function (
  this: Mocha,
  inlineDiffs?: boolean,
): Mocha {
  this.options.inlineDiffs = inlineDiffs !== false;
  return this;
};

/**
 * Enables or disables reporter to include diff in test failure output.
 *
 * @public
 * @see [CLI option](../#-diff)
 * @param diff - Whether to show diff on failure.
 * @returns this
 * @chainable
 */
Mocha.prototype.diff = function (this: Mocha, diff?: boolean): Mocha {
  this.options.diff = diff !== false;
  return this;
};

/**
 * Sets timeout threshold value.
 *
 * A string argument can use shorthand (such as "2s") and will be converted.
 * If the value is `0`, timeouts will be disabled.
 *
 * @public
 * @see [CLI option](../#-timeout-ms-t-ms)
 * @see [Timeouts](../#timeouts)
 * @param msecs - Timeout threshold value.
 * @returns this
 * @chainable
 *
 * @example
 * // Sets timeout to one second
 * mocha.timeout(1000);
 *
 * @example
 * // Same as above but using string argument
 * mocha.timeout('1s');
 */
Mocha.prototype.timeout = function (
  this: Mocha,
  msecs?: number | string,
): Mocha {
  this.suite.timeout(msecs!);
  return this;
};

/**
 * Sets the number of times to retry failed tests.
 *
 * @public
 * @see [CLI option](../#-retries-n)
 * @see [Retry Tests](../#retry-tests)
 * @param retry - Number of times to retry failed tests.
 * @returns this
 * @chainable
 *
 * @example
 * // Allow any failed test to retry one more time
 * mocha.retries(1);
 */
Mocha.prototype.retries = function (this: Mocha, retry?: number): Mocha {
  this.suite.retries(retry!);
  return this;
};

/**
 * Sets slowness threshold value.
 *
 * @public
 * @see [CLI option](../#-slow-ms-s-ms)
 * @param msecs - Slowness threshold value.
 * @returns this
 * @chainable
 *
 * @example
 * // Sets "slow" threshold to half a second
 * mocha.slow(500);
 *
 * @example
 * // Same as above but using string argument
 * mocha.slow('0.5s');
 */
Mocha.prototype.slow = function (
  this: Mocha,
  msecs?: number | string,
): Mocha {
  this.suite.slow(msecs!);
  return this;
};

/**
 * Forces all tests to either accept a `done` callback or return a promise.
 *
 * @public
 * @see [CLI option](../#-async-only-a)
 * @param asyncOnly - Whether to force `done` callback or promise.
 * @returns this
 * @chainable
 */
Mocha.prototype.asyncOnly = function (
  this: Mocha,
  asyncOnly?: boolean,
): Mocha {
  this.options.asyncOnly = asyncOnly !== false;
  return this;
};

/**
 * Disables syntax highlighting (in browser).
 *
 * @public
 * @returns this
 * @chainable
 */
Mocha.prototype.noHighlighting = function (this: Mocha): Mocha {
  this.options.noHighlighting = true;
  return this;
};

/**
 * Enables or disables uncaught errors to propagate.
 *
 * @public
 * @see [CLI option](../#-allow-uncaught)
 * @param allowUncaught - Whether to propagate uncaught errors.
 * @returns this
 * @chainable
 */
Mocha.prototype.allowUncaught = function (
  this: Mocha,
  allowUncaught?: boolean,
): Mocha {
  this.options.allowUncaught = allowUncaught !== false;
  return this;
};

/**
 * Delays root suite execution.
 *
 * Used to perform async operations before any suites are run.
 *
 * @public
 * @see [delayed root suite](../#delayed-root-suite)
 * @returns this
 * @chainable
 */
Mocha.prototype.delay = function delay(this: Mocha): Mocha {
  this.options.delay = true;
  return this;
};

/**
 * Enables or disables running tests in dry-run mode.
 *
 * @public
 * @see [CLI option](../#-dry-run)
 * @param dryRun - Whether to activate dry-run mode.
 * @returns this
 * @chainable
 */
Mocha.prototype.dryRun = function (this: Mocha, dryRun?: boolean): Mocha {
  this.options.dryRun = dryRun !== false;
  return this;
};

/**
 * Reports tests as failed when they are skipped due to a hook failure.
 *
 * @public
 * @see [CLI option](../#-fail-hook-affected-tests)
 * @param failHookAffectedTests - Whether to fail tests affected by hook failures.
 * @returns this
 * @chainable
 */
Mocha.prototype.failHookAffectedTests = function (
  this: Mocha,
  failHookAffectedTests?: boolean,
): Mocha {
  this.options.failHookAffectedTests = failHookAffectedTests !== false;
  return this;
};

/**
 * Fails test run if no tests encountered with exit-code 1.
 *
 * @public
 * @see [CLI option](../#-fail-zero)
 * @param failZero - Whether to fail test run.
 * @returns this
 * @chainable
 */
Mocha.prototype.failZero = function (
  this: Mocha,
  failZero?: boolean,
): Mocha {
  this.options.failZero = failZero !== false;
  return this;
};

/**
 * Fail test run if tests were failed.
 *
 * @public
 * @see [CLI option](../#-pass-on-failing-test-suite)
 * @param passOnFailingTestSuite - Whether to fail test run.
 * @returns this
 * @chainable
 */
Mocha.prototype.passOnFailingTestSuite = function (
  this: Mocha,
  passOnFailingTestSuite?: boolean,
): Mocha {
  this.options.passOnFailingTestSuite = passOnFailingTestSuite === true;
  return this;
};

/**
 * Causes tests marked `only` to fail the suite.
 *
 * @public
 * @see [CLI option](../#-forbid-only)
 * @param forbidOnly - Whether tests marked `only` fail the suite.
 * @returns this
 * @chainable
 */
Mocha.prototype.forbidOnly = function (
  this: Mocha,
  forbidOnly?: boolean,
): Mocha {
  this.options.forbidOnly = forbidOnly !== false;
  return this;
};

/**
 * Causes pending tests and tests marked `skip` to fail the suite.
 *
 * @public
 * @see [CLI option](../#-forbid-pending)
 * @param forbidPending - Whether pending tests fail the suite.
 * @returns this
 * @chainable
 */
Mocha.prototype.forbidPending = function (
  this: Mocha,
  forbidPending?: boolean,
): Mocha {
  this.options.forbidPending = forbidPending !== false;
  return this;
};

/**
 * Throws an error if mocha is in the wrong state to be able to transition to a "running" state.
 * @private
 */
Mocha.prototype._guardRunningStateTransition = function (this: Mocha): void {
  if (this._state === mochaStates.RUNNING) {
    throw createMochaInstanceAlreadyRunningError(
      "Mocha instance is currently running tests, cannot start a next test run until this one is done",
      this,
    );
  }
  if (
    this._state === mochaStates.DISPOSED ||
    this._state === mochaStates.REFERENCES_CLEANED
  ) {
    throw createMochaInstanceAlreadyDisposedError(
      "Mocha instance is already disposed, cannot start a new test run. Please create a new mocha instance. Be sure to set disable `cleanReferencesAfterRun` when you want to reuse the same mocha instance for multiple test runs.",
      this._cleanReferencesAfterRun,
      this,
    );
  }
};

/**
 * Mocha version as specified by "package.json".
 *
 * @name Mocha#version
 * @type string
 * @readonly
 */
Object.defineProperty(Mocha.prototype, "version", {
  value: require("../package.json").version,
  configurable: false,
  enumerable: true,
  writable: false,
});

/**
 * Runs root suite and invokes `fn()` when complete.
 *
 * To run tests multiple times (or to run tests in files that are
 * already in the `require` cache), make sure to clear them from
 * the cache first!
 *
 * @public
 * @see {@link Mocha#unloadFiles}
 * @see Runner#run
 * @param fn - Callback invoked when test execution completed.
 * @returns runner instance
 *
 * @example
 * // exit with non-zero status if there were test failures
 * mocha.run(failures => process.exitCode = failures ? 1 : 0);
 */
Mocha.prototype.run = function (this: Mocha, fn?: DoneCB): RunnerInstance {
  this._guardRunningStateTransition();
  this._state = mochaStates.RUNNING;
  if (this._previousRunner) {
    this._previousRunner.dispose();
    this.suite.reset();
  }
  if (this.files.length && !this._lazyLoadFiles) {
    this.loadFiles();
  }
  const suite = this.suite;
  const options = this.options;
  (options as Record<string, unknown>).files = this.files;
  const runner: RunnerInstance = new this._runnerClass(suite, {
    cleanReferencesAfterRun: this._cleanReferencesAfterRun,
    delay: options.delay,
    dryRun: options.dryRun,
    failHookAffectedTests: options.failHookAffectedTests,
    failZero: options.failZero,
  });
  createStatsCollector(runner);
  const reporter: ReporterInstance = new (this._reporter as new (
    runner: RunnerInstance,
    options: unknown,
  ) => ReporterInstance)(runner, options);
  runner.checkLeaks = options.checkLeaks === true;
  runner.fullStackTrace = options.fullTrace!;
  runner.asyncOnly = options.asyncOnly!;
  runner.allowUncaught = options.allowUncaught!;
  runner.forbidOnly = options.forbidOnly!;
  runner.forbidPending = options.forbidPending!;
  if (options.grep) {
    runner.grep(options.grep, options.invert);
  }
  if (options.global) {
    runner.globals(options.global);
  }
  if (options.color !== undefined) {
    exports.reporters.Base.useColors = options.color;
  }
  exports.reporters.Base.inlineDiffs = options.inlineDiffs;
  exports.reporters.Base.hideDiff = !options.diff;

  const done = (failures: number): void => {
    this._previousRunner = runner;
    this._state = this._cleanReferencesAfterRun
      ? mochaStates.REFERENCES_CLEANED
      : mochaStates.INIT;
    fn = fn || utils.noop;
    if (typeof reporter.done === "function") {
      reporter.done(failures, fn);
    } else {
      fn(failures);
    }
  };

  const runAsync = async (runner: RunnerInstance): Promise<number> => {
    const context: Record<string, unknown> =
      this.options.enableGlobalSetup && this.hasGlobalSetupFixtures()
        ? await this.runGlobalSetup(runner as unknown as Record<string, unknown>)
        : {};
    const failureCount: number = await runner.runAsync({
      files: this.files,
      options,
    });
    if (this.options.enableGlobalTeardown && this.hasGlobalTeardownFixtures()) {
      await this.runGlobalTeardown(runner as unknown as Record<string, unknown>, { context });
    }
    return failureCount;
  };

  // no "catch" here is intentional. errors coming out of
  // Runner#run are considered uncaught/unhandled and caught
  // by the `process` event listeners.
  // also: returning anything other than `runner` would be a breaking
  // change
  runAsync(runner).then(done);

  return runner;
};

/**
 * Assigns hooks to the root suite
 * @param hooks - Hooks to assign to root suite
 * @chainable
 */
Mocha.prototype.rootHooks = function rootHooks(
  this: Mocha,
  {
    beforeAll = [],
    beforeEach = [],
    afterAll = [],
    afterEach = [],
  }: MochaRootHookObject = {},
): Mocha {
  const beforeAllArr: HookFn[] = utils.castArray(beforeAll) as HookFn[];
  const beforeEachArr: HookFn[] = utils.castArray(beforeEach) as HookFn[];
  const afterAllArr: HookFn[] = utils.castArray(afterAll) as HookFn[];
  const afterEachArr: HookFn[] = utils.castArray(afterEach) as HookFn[];
  beforeAllArr.forEach((hook: HookFn) => {
    this.suite.beforeAll(hook);
  });
  beforeEachArr.forEach((hook: HookFn) => {
    this.suite.beforeEach(hook);
  });
  afterAllArr.forEach((hook: HookFn) => {
    this.suite.afterAll(hook);
  });
  afterEachArr.forEach((hook: HookFn) => {
    this.suite.afterEach(hook);
  });
  return this;
};

/**
 * Toggles parallel mode.
 *
 * Must be run before calling {@link Mocha#run}. Changes the `Runner` class to
 * use; also enables lazy file loading if not already done so.
 *
 * Warning: when passed `false` and lazy loading has been enabled _via any means_ (including calling `parallelMode(true)`), this method will _not_ disable lazy loading. Lazy loading is a prerequisite for parallel
 * mode, but parallel mode is _not_ a prerequisite for lazy loading!
 * @param enable - If `true`, enable; otherwise disable.
 * @throws If run in browser
 * @throws If Mocha not in `INIT` state
 * @returns this
 * @chainable
 * @public
 */
Mocha.prototype.parallelMode = function parallelMode(
  this: Mocha,
  enable: boolean = true,
): Mocha {
  if (utils.isBrowser()) {
    throw createUnsupportedError("parallel mode is only supported in Node.js");
  }
  const parallel: boolean = Boolean(enable);
  if (
    parallel === this.options.parallel &&
    this._lazyLoadFiles &&
    this._runnerClass !== exports.Runner
  ) {
    return this;
  }
  if (this._state !== mochaStates.INIT) {
    throw createUnsupportedError(
      "cannot change parallel mode after having called run()",
    );
  }
  this.options.parallel = parallel;

  // swap Runner class
  this._runnerClass = parallel
    ? require("./nodejs/parallel-buffered-runner")
    : exports.Runner;

  // lazyLoadFiles may have been set `true` otherwise (for ESM loading),
  // so keep `true` if so.
  return this.lazyLoadFiles(this._lazyLoadFiles || parallel);
};

/**
 * Disables implicit call to {@link Mocha#loadFiles} in {@link Mocha#run}. This
 * setting is used by watch mode, parallel mode, and for loading ESM files.
 * @param enable - If `true`, disable eager loading of files in {@link Mocha#run}
 * @chainable
 * @public
 */
Mocha.prototype.lazyLoadFiles = function lazyLoadFiles(
  this: Mocha,
  enable?: boolean,
): Mocha {
  this._lazyLoadFiles = enable === true;
  debug("set lazy load to %s", enable);
  return this;
};

/**
 * Configures one or more global setup fixtures.
 *
 * If given no parameters, _unsets_ any previously-set fixtures.
 * @chainable
 * @public
 * @param setupFns - Global setup fixture(s)
 * @returns this
 */
Mocha.prototype.globalSetup = function globalSetup(
  this: Mocha,
  setupFns: MochaGlobalFixture | MochaGlobalFixture[] = [],
): Mocha {
  const fns: MochaGlobalFixture[] = utils.castArray(setupFns);
  this.options.globalSetup = fns;
  debug("configured %d global setup functions", fns.length);
  return this;
};

/**
 * Configures one or more global teardown fixtures.
 *
 * If given no parameters, _unsets_ any previously-set fixtures.
 * @chainable
 * @public
 * @param teardownFns - Global teardown fixture(s)
 * @returns this
 */
Mocha.prototype.globalTeardown = function globalTeardown(
  this: Mocha,
  teardownFns: MochaGlobalFixture | MochaGlobalFixture[] = [],
): Mocha {
  const fns: MochaGlobalFixture[] = utils.castArray(teardownFns);
  this.options.globalTeardown = fns;
  debug("configured %d global teardown functions", fns.length);
  return this;
};

/**
 * Run any global setup fixtures sequentially, if any.
 *
 * This is _automatically called_ by {@link Mocha#run} _unless_ the `runGlobalSetup` option is `false`; see {@link Mocha#enableGlobalSetup}.
 *
 * The context object this function resolves with should be consumed by {@link Mocha#runGlobalTeardown}.
 * @param context - Context object if already have one
 * @public
 * @returns Context object
 */
Mocha.prototype.runGlobalSetup = async function runGlobalSetup(
  this: Mocha,
  context: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const { globalSetup } = this.options;
  if (globalSetup && (globalSetup as MochaGlobalFixture[]).length) {
    debug("run(): global setup starting");
    await this._runGlobalFixtures(
      globalSetup as MochaGlobalFixture[],
      context,
    );
    debug("run(): global setup complete");
  }
  return context;
};

/**
 * Run any global teardown fixtures sequentially, if any.
 *
 * This is _automatically called_ by {@link Mocha#run} _unless_ the `runGlobalTeardown` option is `false`; see {@link Mocha#enableGlobalTeardown}.
 *
 * Should be called with context object returned by {@link Mocha#runGlobalSetup}, if applicable.
 * @param context - Context object if already have one
 * @public
 * @returns Context object
 */
Mocha.prototype.runGlobalTeardown = async function runGlobalTeardown(
  this: Mocha,
  context: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const { globalTeardown } = this.options;
  if (globalTeardown && (globalTeardown as MochaGlobalFixture[]).length) {
    debug("run(): global teardown starting");
    await this._runGlobalFixtures(
      globalTeardown as MochaGlobalFixture[],
      context,
    );
  }
  debug("run(): global teardown complete");
  return context;
};

/**
 * Run global fixtures sequentially with context `context`
 * @private
 * @param fixtureFns - Fixtures to run
 * @param context - context object
 * @returns context object
 */
Mocha.prototype._runGlobalFixtures = async function _runGlobalFixtures(
  this: Mocha,
  fixtureFns: MochaGlobalFixture[] = [],
  context: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  for await (const fixtureFn of fixtureFns) {
    await fixtureFn.call(context);
  }
  return context;
};

/**
 * Toggle execution of any global setup fixture(s)
 *
 * @chainable
 * @public
 * @param enabled - If `false`, do not run global setup fixture
 * @returns this
 */
Mocha.prototype.enableGlobalSetup = function enableGlobalSetup(
  this: Mocha,
  enabled: boolean = true,
): Mocha {
  this.options.enableGlobalSetup = Boolean(enabled);
  return this;
};

/**
 * Toggle execution of any global teardown fixture(s)
 *
 * @chainable
 * @public
 * @param enabled - If `false`, do not run global teardown fixture
 * @returns this
 */
Mocha.prototype.enableGlobalTeardown = function enableGlobalTeardown(
  this: Mocha,
  enabled: boolean = true,
): Mocha {
  this.options.enableGlobalTeardown = Boolean(enabled);
  return this;
};

/**
 * Returns `true` if one or more global setup fixtures have been supplied.
 * @public
 * @returns boolean
 */
Mocha.prototype.hasGlobalSetupFixtures =
  function hasGlobalSetupFixtures(this: Mocha): boolean {
    return Boolean((this.options.globalSetup as MochaGlobalFixture[]).length);
  };

/**
 * Returns `true` if one or more global teardown fixtures have been supplied.
 * @public
 * @returns boolean
 */
Mocha.prototype.hasGlobalTeardownFixtures =
  function hasGlobalTeardownFixtures(this: Mocha): boolean {
    return Boolean(
      (this.options.globalTeardown as MochaGlobalFixture[]).length,
    );
  };
