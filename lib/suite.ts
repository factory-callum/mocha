"use strict";

/**
 * Module dependencies.
 * @private
 */
const { EventEmitter } = require("node:events");
const Hook = require("./hook");
const {
  assignNewMochaID,
  clamp,
  constants: utilsConstants,
  defineConstants,
  getMochaID,
  isString,
} = require("./utils");
const debug = require("debug")("mocha:suite");
const milliseconds = require("ms");
const errors = require("./errors");

const { MOCHA_ID_PROP_NAME } = utilsConstants;

/** Interface for a Test-like object */
interface TestLike {
  parent: unknown;
  timeout(ms: number): unknown;
  retries(n: number): unknown;
  slow(ms: number): unknown;
  ctx: unknown;
  fn?: unknown;
  reset(): void;
}

/** Interface for a Hook-like object */
interface HookLike {
  parent: unknown;
  timeout(ms: number): unknown;
  retries(n: number): unknown;
  slow(ms: number): unknown;
  ctx: unknown;
  file: string | undefined;
  fn?: unknown;
  reset(): void;
}

/** Interface for serialized Suite data suitable for IPC */
interface SerializedSuite {
  _bail: boolean;
  $$fullTitle: string;
  $$isPending: boolean;
  root: boolean;
  title: string;
  parent: { [key: string]: unknown } | null;
  [key: string]: unknown;
}

class Suite extends EventEmitter {
  static constants = defineConstants(
    /**
     * {@link Suite}-related constants.
     * @public
     * @memberof Suite
     * @alias constants
     * @readonly
     * @static
     * @enum {string}
     */
    {
      /**
       * Event emitted after a test file has been loaded. Not emitted in browser.
       */
      EVENT_FILE_POST_REQUIRE: "post-require",
      /**
       * Event emitted before a test file has been loaded. In browser, this is emitted once an interface has been selected.
       */
      EVENT_FILE_PRE_REQUIRE: "pre-require",
      /**
       * Event emitted immediately after a test file has been loaded. Not emitted in browser.
       */
      EVENT_FILE_REQUIRE: "require",
      /**
       * Event emitted when `global.run()` is called (use with `delay` option).
       */
      EVENT_ROOT_SUITE_RUN: "run",

      /**
       * Namespace for collection of a `Suite`'s "after all" hooks.
       */
      HOOK_TYPE_AFTER_ALL: "afterAll",
      /**
       * Namespace for collection of a `Suite`'s "after each" hooks.
       */
      HOOK_TYPE_AFTER_EACH: "afterEach",
      /**
       * Namespace for collection of a `Suite`'s "before all" hooks.
       */
      HOOK_TYPE_BEFORE_ALL: "beforeAll",
      /**
       * Namespace for collection of a `Suite`'s "before each" hooks.
       */
      HOOK_TYPE_BEFORE_EACH: "beforeEach",

      /**
       * Emitted after a child `Suite` has been added to a `Suite`.
       */
      EVENT_SUITE_ADD_SUITE: "suite",
      /**
       * Emitted after an "after all" `Hook` has been added to a `Suite`.
       */
      EVENT_SUITE_ADD_HOOK_AFTER_ALL: "afterAll",
      /**
       * Emitted after an "after each" `Hook` has been added to a `Suite`.
       */
      EVENT_SUITE_ADD_HOOK_AFTER_EACH: "afterEach",
      /**
       * Emitted after an "before all" `Hook` has been added to a `Suite`.
       */
      EVENT_SUITE_ADD_HOOK_BEFORE_ALL: "beforeAll",
      /**
       * Emitted after an "before each" `Hook` has been added to a `Suite`.
       */
      EVENT_SUITE_ADD_HOOK_BEFORE_EACH: "beforeEach",
      /**
       * Emitted after a `Test` has been added to a `Suite`.
       */
      EVENT_SUITE_ADD_TEST: "test",
    },
  );

  /**
   * Create a new `Suite` with the given `title` and parent `Suite`.
   *
   * @public
   */
  static create(parent: Suite, title: string): Suite {
    const suite = new Suite(title, parent.ctx);
    suite.parent = parent;
    parent.addSuite(suite);
    return suite;
  }

  title: string;
  ctx: unknown;
  suites: Suite[];
  tests: TestLike[];
  root: boolean;
  pending: boolean;
  _retries: number;
  _beforeEach: HookLike[];
  _beforeAll: HookLike[];
  _afterEach: HookLike[];
  _afterAll: HookLike[];
  _timeout: number;
  _slow: number;
  _bail: boolean;
  _onlyTests: TestLike[];
  _onlySuites: Suite[];
  delayed!: boolean;
  parent!: Suite;
  file: string | undefined;
  id!: string;

  /**
   * Constructs a new `Suite` instance with the given `title`, `ctx`, and `isRoot`.
   *
   * @public
   * @extends EventEmitter
   * @see {@link https://nodejs.org/api/events.html#events_class_eventemitter|EventEmitter}
   */
  constructor(title: string, parentContext?: unknown, isRoot?: boolean) {
    if (!isString(title)) {
      throw errors.createInvalidArgumentTypeError(
        'Suite argument "title" must be a string. Received type "' +
          typeof title +
          '"',
        "title",
        "string",
      );
    }
    super();
    this.title = title;
    function Context(this: unknown): void {}
    Context.prototype = parentContext;
    this.ctx = new (Context as unknown as new () => unknown)();
    this.suites = [];
    this.tests = [];
    this.root = isRoot === true;
    this.pending = false;
    this._retries = -1;
    this._beforeEach = [];
    this._beforeAll = [];
    this._afterEach = [];
    this._afterAll = [];
    this._timeout = 2000;
    this._slow = 75;
    this._bail = false;
    this._onlyTests = [];
    this._onlySuites = [];
    assignNewMochaID(this);

    Object.defineProperty(this, "id", {
      get() {
        return getMochaID(this);
      },
    });

    this.reset();
  }

  /**
   * Resets the state initially or for a next run.
   */
  reset(): void {
    this.delayed = false;
    function doReset(thingToReset: { reset(): void }): void {
      thingToReset.reset();
    }
    this.suites.forEach(doReset);
    this.tests.forEach(doReset);
    this._beforeEach.forEach(doReset);
    this._afterEach.forEach(doReset);
    this._beforeAll.forEach(doReset);
    this._afterAll.forEach(doReset);
  }

  /**
   * Return a clone of this `Suite`.
   *
   * @private
   */
  clone(): Suite {
    const suite = new Suite(this.title);
    debug("clone");
    suite.ctx = this.ctx;
    suite.root = this.root;
    suite.timeout(this.timeout());
    suite.retries(this.retries());
    suite.slow(this.slow());
    suite.bail(this.bail());
    return suite;
  }

  /**
   * Set or get timeout `ms` or short-hand such as "2s".
   *
   * @private
   */
  timeout(): number;
  timeout(ms: number | string): this;
  timeout(ms?: number | string): number | this {
    if (!arguments.length) {
      return this._timeout;
    }
    if (typeof ms === "string") {
      ms = milliseconds(ms) as number;
    }

    // Clamp to range
    const INT_MAX = Math.pow(2, 31) - 1;
    const range: [number, number] = [0, INT_MAX];
    ms = clamp(ms as number, range);

    debug("timeout %d", ms);
    this._timeout = parseInt(ms as unknown as string, 10);

    // Allow overriding inner/nested suites
    // See and test-cases with chain-called timeout argument.
    // https://github.com/mochajs/mocha/issues/5422
    for (const t of this.tests) {
      t.timeout(this._timeout);
    }
    for (const s of this.suites) {
      s.timeout(this._timeout);
    }
    return this;
  }

  /**
   * Set or get number of times to retry a failed test.
   *
   * @private
   */
  retries(): number;
  retries(n: number | string): this;
  retries(n?: number | string): number | this {
    if (!arguments.length) {
      return this._retries;
    }
    debug("retries %d", n);
    this._retries = parseInt(n as unknown as string, 10) || 0;
    return this;
  }

  /**
   * Set or get slow `ms` or short-hand such as "2s".
   *
   * @private
   */
  slow(): number;
  slow(ms: number | string): this;
  slow(ms?: number | string): number | this {
    if (!arguments.length) {
      return this._slow;
    }
    if (typeof ms === "string") {
      ms = milliseconds(ms) as number;
    }
    debug("slow %d", ms);
    this._slow = ms as number;
    return this;
  }

  /**
   * Set or get whether to bail after first error.
   *
   * @private
   */
  bail(): boolean;
  bail(bail: boolean): this;
  bail(bail?: boolean): boolean | this {
    if (!arguments.length) {
      return this._bail;
    }
    debug("bail %s", bail);
    this._bail = bail!;
    return this;
  }

  /**
   * Check if this suite or its parent suite is marked as pending.
   *
   * @private
   */
  isPending(): boolean {
    return this.pending || (this.parent && this.parent.isPending());
  }

  /**
   * Generic hook-creator.
   * @private
   */
  _createHook(title: string, fn?: (...args: unknown[]) => unknown): HookLike {
    const hook = new Hook(title, fn);
    hook.parent = this;
    hook.timeout(this.timeout());
    hook.retries(this.retries());
    hook.slow(this.slow());
    hook.ctx = this.ctx;
    hook.file = this.file;
    return hook;
  }

  /**
   * Run `fn(test[, done])` before running tests.
   *
   * @private
   */
  beforeAll(title: string | ((...args: unknown[]) => unknown), fn?: (...args: unknown[]) => unknown): HookLike | this {
    if (this.isPending()) {
      return this;
    }
    if (typeof title === "function") {
      fn = title;
      title = fn.name;
    }
    title = '"before all" hook' + (title ? ": " + title : "");

    const hook = this._createHook(title, fn);
    this._beforeAll.push(hook);
    this.emit(Suite.constants.EVENT_SUITE_ADD_HOOK_BEFORE_ALL, hook);
    return hook;
  }

  /**
   * Run `fn(test[, done])` after running tests.
   *
   * @private
   */
  afterAll(title: string | ((...args: unknown[]) => unknown), fn?: (...args: unknown[]) => unknown): HookLike | this {
    if (this.isPending()) {
      return this;
    }
    if (typeof title === "function") {
      fn = title;
      title = fn.name;
    }
    title = '"after all" hook' + (title ? ": " + title : "");

    const hook = this._createHook(title, fn);
    this._afterAll.push(hook);
    this.emit(Suite.constants.EVENT_SUITE_ADD_HOOK_AFTER_ALL, hook);
    return hook;
  }

  /**
   * Run `fn(test[, done])` before each test case.
   *
   * @private
   */
  beforeEach(title: string | ((...args: unknown[]) => unknown), fn?: (...args: unknown[]) => unknown): HookLike | this {
    if (this.isPending()) {
      return this;
    }
    if (typeof title === "function") {
      fn = title;
      title = fn.name;
    }
    title = '"before each" hook' + (title ? ": " + title : "");

    const hook = this._createHook(title, fn);
    this._beforeEach.push(hook);
    this.emit(Suite.constants.EVENT_SUITE_ADD_HOOK_BEFORE_EACH, hook);
    return hook;
  }

  /**
   * Run `fn(test[, done])` after each test case.
   *
   * @private
   */
  afterEach(title: string | ((...args: unknown[]) => unknown), fn?: (...args: unknown[]) => unknown): HookLike | this {
    if (this.isPending()) {
      return this;
    }
    if (typeof title === "function") {
      fn = title;
      title = fn.name;
    }
    title = '"after each" hook' + (title ? ": " + title : "");

    const hook = this._createHook(title, fn);
    this._afterEach.push(hook);
    this.emit(Suite.constants.EVENT_SUITE_ADD_HOOK_AFTER_EACH, hook);
    return hook;
  }

  /**
   * Add a test `suite`.
   *
   * @private
   */
  addSuite(suite: Suite): this {
    suite.parent = this;
    suite.root = false;
    suite.timeout(this.timeout());
    suite.retries(this.retries());
    suite.slow(this.slow());
    suite.bail(this.bail());
    this.suites.push(suite);
    this.emit(Suite.constants.EVENT_SUITE_ADD_SUITE, suite);
    return this;
  }

  /**
   * Add a `test` to this suite.
   *
   * @private
   */
  addTest(test: TestLike): this {
    test.parent = this;
    test.timeout(this.timeout());
    test.retries(this.retries());
    test.slow(this.slow());
    test.ctx = this.ctx;
    this.tests.push(test);
    this.emit(Suite.constants.EVENT_SUITE_ADD_TEST, test);
    return this;
  }

  /**
   * Return the full title generated by recursively concatenating the parent's
   * full title.
   *
   * @memberof Suite
   * @public
   */
  fullTitle(): string {
    return this.titlePath().join(" ");
  }

  /**
   * Return the title path generated by recursively concatenating the parent's
   * title path.
   *
   * @memberof Suite
   * @public
   */
  titlePath(): string[] {
    let result: string[] = [];
    if (this.parent) {
      result = result.concat(this.parent.titlePath());
    }
    if (!this.root) {
      result.push(this.title);
    }
    return result;
  }

  /**
   * Return the total number of tests.
   *
   * @memberof Suite
   * @public
   */
  total(): number {
    return (
      this.suites.reduce(function (sum: number, suite: Suite) {
        return sum + suite.total();
      }, 0) + this.tests.length
    );
  }

  /**
   * Iterates through each suite recursively to find all tests. Applies a
   * function in the format `fn(test)`.
   *
   * @private
   */
  eachTest(fn: (test: TestLike) => void): this {
    this.tests.forEach(fn);
    this.suites.forEach(function (suite: Suite) {
      suite.eachTest(fn);
    });
    return this;
  }

  /**
   * This will run the root suite if we happen to be running in delayed mode.
   * @private
   */
  run(): void {
    if (this.root) {
      this.emit(Suite.constants.EVENT_ROOT_SUITE_RUN);
    }
  }

  /**
   * Determines whether a suite has an `only` test or suite as a descendant.
   *
   * @private
   */
  hasOnly(): boolean {
    return (
      this._onlyTests.length > 0 ||
      this._onlySuites.length > 0 ||
      this.suites.some(function (suite: Suite) {
        return suite.hasOnly();
      })
    );
  }

  /**
   * Filter suites based on `isOnly` logic.
   *
   * @private
   */
  filterOnly(): boolean {
    if (this._onlyTests.length) {
      // If the suite contains `only` tests, run those and ignore any nested suites.
      this.tests = this._onlyTests;
      this.suites = [];
    } else {
      // Otherwise, do not run any of the tests in this suite.
      this.tests = [];
      this._onlySuites.forEach(function (onlySuite: Suite) {
        // If there are other `only` tests/suites nested in the current `only` suite, then filter that `only` suite.
        // Otherwise, all of the tests on this `only` suite should be run, so don't filter it.
        if (onlySuite.hasOnly()) {
          onlySuite.filterOnly();
        }
      });
      // Run the `only` suites, as well as any other suites that have `only` tests/suites as descendants.
      const onlySuites = this._onlySuites;
      this.suites = this.suites.filter(function (childSuite: Suite) {
        return onlySuites.indexOf(childSuite) !== -1 || childSuite.filterOnly();
      });
    }
    // Keep the suite only if there is something to run
    return this.tests.length > 0 || this.suites.length > 0;
  }

  /**
   * Adds a suite to the list of subsuites marked `only`.
   *
   * @private
   */
  appendOnlySuite(suite: Suite): void {
    this._onlySuites.push(suite);
  }

  /**
   * Marks a suite to be `only`.
   *
   * @private
   */
  markOnly(): void {
    if (this.parent) {
      this.parent.appendOnlySuite(this);
    }
  }

  /**
   * Adds a test to the list of tests marked `only`.
   *
   * @private
   */
  appendOnlyTest(test: TestLike): void {
    this._onlyTests.push(test);
  }

  /**
   * Returns the array of hooks by hook name; see `HOOK_TYPE_*` constants.
   * @private
   */
  getHooks(name: string): HookLike[] {
    return (this as unknown as Record<string, HookLike[]>)["_" + name];
  }

  /**
   * cleans all references from this suite and all child suites.
   */
  dispose(): void {
    this.suites.forEach(function (suite: Suite) {
      suite.dispose();
    });
    this.cleanReferences();
  }

  /**
   * Cleans up the references to all the deferred functions
   * (before/after/beforeEach/afterEach) and tests of a Suite.
   * These must be deleted otherwise a memory leak can happen,
   * as those functions may reference variables from closures,
   * thus those variables can never be garbage collected as long
   * as the deferred functions exist.
   *
   * @private
   */
  cleanReferences(): void {
    function cleanArrReferences(arr: { fn?: unknown }[]): void {
      for (let i = 0; i < arr.length; i++) {
        delete arr[i].fn;
      }
    }

    if (Array.isArray(this._beforeAll)) {
      cleanArrReferences(this._beforeAll);
    }

    if (Array.isArray(this._beforeEach)) {
      cleanArrReferences(this._beforeEach);
    }

    if (Array.isArray(this._afterAll)) {
      cleanArrReferences(this._afterAll);
    }

    if (Array.isArray(this._afterEach)) {
      cleanArrReferences(this._afterEach);
    }

    for (let i = 0; i < this.tests.length; i++) {
      delete this.tests[i].fn;
    }
  }

  /**
   * Returns an object suitable for IPC.
   * Functions are represented by keys beginning with `$$`.
   * @private
   */
  serialize(): SerializedSuite {
    return {
      _bail: this._bail,
      $$fullTitle: this.fullTitle(),
      $$isPending: Boolean(this.isPending()),
      root: this.root,
      title: this.title,
      [MOCHA_ID_PROP_NAME]: this.id,
      parent: this.parent ? { [MOCHA_ID_PROP_NAME]: this.parent.id } : null,
    };
  }
}

exports = module.exports = Suite;
