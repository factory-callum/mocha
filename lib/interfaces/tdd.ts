"use strict";

const Test: {
  new (title: string, fn?: ((...args: unknown[]) => void) | null): TestInstance;
} = require("../test");
const EVENT_FILE_PRE_REQUIRE: string =
  require("../suite").constants.EVENT_FILE_PRE_REQUIRE;

/** Interface for a Suite instance */
interface SuiteInstance {
  on(event: string, listener: (...args: unknown[]) => void): this;
  isPending(): boolean;
  addTest(test: TestInstance): unknown;
  [key: string]: unknown;
}

/** Interface for a Test instance */
interface TestInstance {
  file: string | undefined;
  markOnly(): void;
  [key: string]: unknown;
}

/** Suite create options */
interface SuiteCreateOptions {
  title: string;
  file?: string;
  fn?: ((...args: unknown[]) => void) | false;
  pending?: boolean;
  isOnly?: boolean;
}

/** Common functions returned by the common module */
interface CommonFunctions {
  before(name: string | ((...args: unknown[]) => unknown), fn?: (...args: unknown[]) => unknown): unknown;
  after(name: string | ((...args: unknown[]) => unknown), fn?: (...args: unknown[]) => unknown): unknown;
  beforeEach(name: string | ((...args: unknown[]) => unknown), fn?: (...args: unknown[]) => unknown): unknown;
  afterEach(name: string | ((...args: unknown[]) => unknown), fn?: (...args: unknown[]) => unknown): unknown;
  runWithSuite(suite: SuiteInstance): () => void;
  suite: {
    create(opts: SuiteCreateOptions): SuiteInstance;
    skip(opts: SuiteCreateOptions): SuiteInstance;
    only(opts: SuiteCreateOptions): SuiteInstance;
  };
  test: {
    only(mocha: MochaLike, test: TestInstance): TestInstance;
    skip(title: string): void;
  };
}

/** Mocha-like object */
interface MochaLike {
  options: {
    delay?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Context augmented by interfaces */
interface InterfaceContext {
  [key: string]: unknown;
}

/** suite function with skip and only */
interface SuiteFunction {
  (title: string, fn?: (...args: unknown[]) => void): SuiteInstance;
  skip: (title: string, fn?: (...args: unknown[]) => void) => SuiteInstance;
  only: (title: string, fn?: (...args: unknown[]) => void) => SuiteInstance;
}

/** test function with skip and only */
interface TestFunction {
  (title: string, fn?: ((...args: unknown[]) => void) | null): TestInstance;
  skip: (title: string) => void;
  only: (title: string, fn?: ((...args: unknown[]) => void) | null) => TestInstance;
}

/**
 * TDD-style interface:
 *
 *      suite('Array', function() {
 *        suite('#indexOf()', function() {
 *          suiteSetup(function() {
 *
 *          });
 *
 *          test('should return -1 when not present', function() {
 *
 *          });
 *
 *          test('should return the index when present', function() {
 *
 *          });
 *
 *          suiteTeardown(function() {
 *
 *          });
 *        });
 *      });
 *
 */
function tddInterface(suite: SuiteInstance): void {
  const suites = [suite];

  suite.on(EVENT_FILE_PRE_REQUIRE, function (...args: unknown[]) {
    const context = args[0] as InterfaceContext;
    const file = args[1] as string;
    const mocha = args[2] as MochaLike;
    const common: CommonFunctions = require("./common")(suites, context, mocha);

    context.setup = common.beforeEach;
    context.teardown = common.afterEach;
    context.suiteSetup = common.before;
    context.suiteTeardown = common.after;
    context.run = mocha.options.delay && common.runWithSuite(suite);

    /**
     * Describe a "suite" with the given `title` and callback `fn` containing
     * nested suites and/or tests.
     */
    context.suite = function (title: string, fn?: (...args: unknown[]) => void): SuiteInstance {
      return common.suite.create({
        title,
        file,
        fn,
      });
    } as SuiteFunction;

    /**
     * Pending suite.
     */
    (context.suite as SuiteFunction).skip = function (title: string, fn?: (...args: unknown[]) => void): SuiteInstance {
      return common.suite.skip({
        title,
        file,
        fn,
      });
    };

    /**
     * Exclusive test-case.
     */
    (context.suite as SuiteFunction).only = function (title: string, fn?: (...args: unknown[]) => void): SuiteInstance {
      return common.suite.only({
        title,
        file,
        fn,
      });
    };

    /**
     * Describe a specification or test-case with the given `title` and
     * callback `fn` acting as a thunk.
     */
    context.test = function (title: string, fn?: ((...args: unknown[]) => void) | null): TestInstance {
      const suite = suites[0];
      if (suite.isPending()) {
        fn = null;
      }
      const test = new Test(title, fn);
      test.file = file;
      suite.addTest(test);
      return test;
    } as TestFunction;

    /**
     * Exclusive test-case.
     */

    (context.test as TestFunction).only = function (title: string, fn?: ((...args: unknown[]) => void) | null): TestInstance {
      return common.test.only(mocha, (context.test as TestFunction)(title, fn));
    };

    (context.test as TestFunction).skip = common.test.skip;
  });
}

module.exports = tddInterface;

module.exports.description =
  'traditional "suite"/"test" instead of BDD\'s "describe"/"it"';
