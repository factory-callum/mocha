"use strict";

/**
 * @module interfaces/common
 */

const Suite: {
  create(parent: SuiteInstance, title: string): SuiteInstance;
  constants: Record<string, string>;
} = require("../suite");
const errors: {
  createMissingArgumentError(
    message: string,
    argument: string,
    expected: string,
  ): Error;
  createUnsupportedError(message: string): Error;
  createForbiddenExclusivityError(mocha: MochaLike): Error;
} = require("../errors");
const createMissingArgumentError = errors.createMissingArgumentError;
const createUnsupportedError = errors.createUnsupportedError;
const createForbiddenExclusivityError = errors.createForbiddenExclusivityError;

/** Interface for a Suite instance used by interfaces */
interface SuiteInstance {
  pending: boolean;
  file: string | undefined;
  ctx: unknown;
  fullTitle(): string;
  markOnly(): void;
  run(): void;
  beforeAll(
    title: string | ((...args: unknown[]) => unknown),
    fn?: (...args: unknown[]) => unknown,
  ): unknown;
  afterAll(
    title: string | ((...args: unknown[]) => unknown),
    fn?: (...args: unknown[]) => unknown,
  ): unknown;
  beforeEach(
    title: string | ((...args: unknown[]) => unknown),
    fn?: (...args: unknown[]) => unknown,
  ): unknown;
  afterEach(
    title: string | ((...args: unknown[]) => unknown),
    fn?: (...args: unknown[]) => unknown,
  ): unknown;
  addTest(test: TestInstance): unknown;
  isPending(): boolean;
  [key: string]: unknown;
}

/** Interface for a Test instance */
interface TestInstance {
  file: string | undefined;
  markOnly(): void;
  [key: string]: unknown;
}

/** Mocha-like object passed to interfaces */
interface MochaLike {
  options: {
    grep?: RegExp;
    invert?: boolean;
    delay?: boolean;
    forbidOnly?: boolean;
    forbidPending?: boolean;
    [key: string]: unknown;
  };
  isWorker?: boolean;
  [key: string]: unknown;
}

/** Context-like object augmented by interfaces */
interface ContextLike {
  test(title: string): void;
  [key: string]: unknown;
}

/** Options for creating a suite */
interface SuiteCreateOptions {
  title: string;
  fn?: ((...args: unknown[]) => void) | false;
  pending?: boolean;
  file?: string;
  isOnly?: boolean;
}

/** Hook function type */
type HookFn = (...args: unknown[]) => unknown;

/** Object returned by the common function */
interface CommonFunctions {
  runWithSuite(suite: SuiteInstance): () => void;
  before(name: string | HookFn, fn?: HookFn): unknown;
  after(name: string | HookFn, fn?: HookFn): unknown;
  beforeEach(name: string | HookFn, fn?: HookFn): unknown;
  afterEach(name: string | HookFn, fn?: HookFn): unknown;
  suite: {
    only(opts: SuiteCreateOptions): SuiteInstance;
    skip(opts: SuiteCreateOptions): SuiteInstance;
    create(opts: SuiteCreateOptions): SuiteInstance;
  };
  test: {
    only(mocha: MochaLike, test: TestInstance): TestInstance;
    skip(title: string): void;
  };
}

/**
 * Functions common to more than one interface.
 *
 * @private
 */
module.exports = function (
  suites: SuiteInstance[],
  context: ContextLike,
  mocha: MochaLike,
): CommonFunctions {
  /**
   * Check if the suite should be tested.
   *
   * @private
   */
  function shouldBeTested(suite: SuiteInstance): boolean {
    return (
      !mocha.options.grep ||
      (mocha.options.grep !== undefined &&
        mocha.options.grep.test(suite.fullTitle()) &&
        !mocha.options.invert)
    );
  }

  return {
    /**
     * This is only present if flag --delay is passed into Mocha. It triggers
     * root suite execution.
     */
    runWithSuite: function runWithSuite(suite: SuiteInstance): () => void {
      return function run(): void {
        suite.run();
      };
    },

    /**
     * Execute before running tests.
     */
    before: function (name: string | HookFn, fn?: HookFn): unknown {
      return suites[0].beforeAll(name, fn);
    },

    /**
     * Execute after running tests.
     */
    after: function (name: string | HookFn, fn?: HookFn): unknown {
      return suites[0].afterAll(name, fn);
    },

    /**
     * Execute before each test case.
     */
    beforeEach: function (name: string | HookFn, fn?: HookFn): unknown {
      return suites[0].beforeEach(name, fn);
    },

    /**
     * Execute after each test case.
     */
    afterEach: function (name: string | HookFn, fn?: HookFn): unknown {
      return suites[0].afterEach(name, fn);
    },

    suite: {
      /**
       * Create an exclusive Suite; convenience function.
       * See docstring for create() below.
       */
      only: function only(opts: SuiteCreateOptions): SuiteInstance {
        if (mocha.options.forbidOnly) {
          throw createForbiddenExclusivityError(mocha);
        }
        opts.isOnly = true;
        return this.create(opts);
      },

      /**
       * Create a Suite, but skip it; convenience function.
       * See docstring for create() below.
       */
      skip: function skip(opts: SuiteCreateOptions): SuiteInstance {
        opts.pending = true;
        return this.create(opts);
      },

      /**
       * Creates a suite.
       */
      create: function create(opts: SuiteCreateOptions): SuiteInstance {
        const suite = Suite.create(suites[0], opts.title);
        suite.pending = Boolean(opts.pending);
        suite.file = opts.file;
        suites.unshift(suite);
        if (opts.isOnly) {
          suite.markOnly();
        }
        if (
          suite.pending &&
          mocha.options.forbidPending &&
          shouldBeTested(suite)
        ) {
          throw createUnsupportedError("Pending test forbidden");
        }
        if (typeof opts.fn === "function") {
          opts.fn.call(suite);
          suites.shift();
        } else if (typeof opts.fn === "undefined" && !suite.pending) {
          throw createMissingArgumentError(
            'Suite "' +
              suite.fullTitle() +
              '" was defined but no callback was supplied. ' +
              "Supply a callback or explicitly skip the suite.",
            "callback",
            "function",
          );
        } else if (!opts.fn && suite.pending) {
          suites.shift();
        }

        return suite;
      },
    },

    test: {
      /**
       * Exclusive test-case.
       */
      only: function (mocha: MochaLike, test: TestInstance): TestInstance {
        if (mocha.options.forbidOnly) {
          throw createForbiddenExclusivityError(mocha);
        }
        test.markOnly();
        return test;
      },

      /**
       * Pending test case.
       */
      skip: function (title: string): void {
        context.test(title);
      },
    },
  };
};
