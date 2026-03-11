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

/** describe function with skip and only */
interface DescribeFunction {
  (title: string, fn?: (...args: unknown[]) => void): SuiteInstance;
  skip: (title: string, fn?: (...args: unknown[]) => void) => SuiteInstance;
  only: (title: string, fn?: (...args: unknown[]) => void) => SuiteInstance;
}

/** it function with skip and only */
interface ItFunction {
  (title: string, fn?: ((...args: unknown[]) => void) | null): TestInstance;
  skip: (title: string) => TestInstance;
  only: (title: string, fn?: ((...args: unknown[]) => void) | null) => TestInstance;
}

/**
 * BDD-style interface:
 *
 *      describe('Array', function() {
 *        describe('#indexOf()', function() {
 *          it('should return -1 when not present', function() {
 *            // ...
 *          });
 *
 *          it('should return the index when present', function() {
 *            // ...
 *          });
 *        });
 *      });
 *
 */
function bddInterface(suite: SuiteInstance): void {
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
     * Describe a "suite" with the given `title`
     * and callback `fn` containing nested suites
     * and/or tests.
     */

    context.describe = context.context = function (title: string, fn?: (...args: unknown[]) => void): SuiteInstance {
      return common.suite.create({
        title,
        file,
        fn,
      });
    } as DescribeFunction;

    /**
     * Pending describe.
     */

    context.xdescribe =
      context.xcontext =
      (context.describe as DescribeFunction).skip =
        function (title: string, fn?: (...args: unknown[]) => void): SuiteInstance {
          return common.suite.skip({
            title,
            file,
            fn,
          });
        };

    /**
     * Exclusive suite.
     */

    (context.describe as DescribeFunction).only = function (title: string, fn?: (...args: unknown[]) => void): SuiteInstance {
      return common.suite.only({
        title,
        file,
        fn,
      });
    };

    /**
     * Describe a specification or test-case
     * with the given `title` and callback `fn`
     * acting as a thunk.
     */

    context.it = context.specify = function (title: string, fn?: ((...args: unknown[]) => void) | null): TestInstance {
      const suite = suites[0];
      if (suite.isPending()) {
        fn = null;
      }
      const test = new Test(title, fn);
      test.file = file;
      suite.addTest(test);
      return test;
    } as ItFunction;

    /**
     * Exclusive test-case.
     */

    (context.it as ItFunction).only = function (title: string, fn?: ((...args: unknown[]) => void) | null): TestInstance {
      return common.test.only(mocha, (context.it as ItFunction)(title, fn));
    };

    /**
     * Pending test case.
     */

    context.xit =
      context.xspecify =
      (context.it as ItFunction).skip =
        function (title: string): TestInstance {
          return (context.it as ItFunction)(title);
        };
  });
}

module.exports = bddInterface;

module.exports.description = "BDD or RSpec style [default]";
