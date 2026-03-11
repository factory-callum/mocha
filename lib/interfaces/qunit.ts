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

/** suite function with only */
interface QUnitSuiteFunction {
  (title: string): SuiteInstance;
  only: (title: string) => SuiteInstance;
}

/** test function with skip and only */
interface QUnitTestFunction {
  (title: string, fn?: ((...args: unknown[]) => void) | null): TestInstance;
  skip: (title: string) => void;
  only: (title: string, fn?: ((...args: unknown[]) => void) | null) => TestInstance;
}

/**
 * QUnit-style interface:
 *
 *     suite('Array');
 *
 *     test('#length', function() {
 *       var arr = [1,2,3];
 *       ok(arr.length == 3);
 *     });
 *
 *     test('#indexOf()', function() {
 *       var arr = [1,2,3];
 *       ok(arr.indexOf(1) == 0);
 *       ok(arr.indexOf(2) == 1);
 *       ok(arr.indexOf(3) == 2);
 *     });
 *
 *     suite('String');
 *
 *     test('#length', function() {
 *       ok('foo'.length == 3);
 *     });
 *
 */
function qUnitInterface(suite: SuiteInstance): void {
  const suites = [suite];

  suite.on(EVENT_FILE_PRE_REQUIRE, function (...args: unknown[]) {
    const context = args[0] as InterfaceContext;
    const file = args[1] as string;
    const mocha = args[2] as MochaLike;
    const common: CommonFunctions = require("./common")(suites, context, mocha);

    context.before = common.before;
    context.after = common.after;
    context.beforeEach = common.beforeEach;
    context.afterEach = common.afterEach;
    context.run = mocha.options.delay && common.runWithSuite(suite);
    /**
     * Describe a "suite" with the given `title`.
     */

    context.suite = function (title: string): SuiteInstance {
      if (suites.length > 1) {
        suites.shift();
      }
      return common.suite.create({
        title,
        file,
        fn: false,
      });
    } as QUnitSuiteFunction;

    /**
     * Exclusive Suite.
     */

    (context.suite as QUnitSuiteFunction).only = function (title: string): SuiteInstance {
      if (suites.length > 1) {
        suites.shift();
      }
      return common.suite.only({
        title,
        file,
        fn: false,
      });
    };

    /**
     * Describe a specification or test-case
     * with the given `title` and callback `fn`
     * acting as a thunk.
     */

    context.test = function (title: string, fn?: ((...args: unknown[]) => void) | null): TestInstance {
      const test = new Test(title, fn);
      test.file = file;
      suites[0].addTest(test);
      return test;
    } as QUnitTestFunction;

    /**
     * Exclusive test-case.
     */

    (context.test as QUnitTestFunction).only = function (title: string, fn?: ((...args: unknown[]) => void) | null): TestInstance {
      return common.test.only(mocha, (context.test as QUnitTestFunction)(title, fn));
    };

    (context.test as QUnitTestFunction).skip = common.test.skip;
  });
}

module.exports = qUnitInterface;

module.exports.description = "QUnit style";
