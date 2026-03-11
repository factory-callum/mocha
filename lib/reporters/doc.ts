"use strict";

/**
 * @module Doc
 */
/**
 * Module dependencies.
 */

const Base = require("./base");
const utils = require("../utils");
const constants = require("../runner").constants;
const EVENT_TEST_PASS: string = constants.EVENT_TEST_PASS;
const EVENT_TEST_FAIL: string = constants.EVENT_TEST_FAIL;
const EVENT_SUITE_BEGIN: string = constants.EVENT_SUITE_BEGIN;
const EVENT_SUITE_END: string = constants.EVENT_SUITE_END;

/** Interface for test-like objects */
interface TestLike {
  title: string;
  file?: string;
  body: string;
}

/** Interface for suite-like objects */
interface SuiteLike {
  root: boolean;
  title: string;
}

/** Interface for runner-like objects */
interface RunnerLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once(event: string, listener: (...args: any[]) => void): void;
}

/** Interface for reporter options */
interface ReporterOptions {
  [key: string]: unknown;
}

class Doc extends Base {
  static description: string = "HTML documentation";

  /**
   * Constructs a new `Doc` reporter instance.
   *
   * @public
   * @memberof Mocha.reporters
   * @extends Mocha.reporters.Base
   */
  constructor(runner: RunnerLike, options?: ReporterOptions) {
    super(runner, options);

    let indents: number = 2;

    function indent(): string {
      return Array(indents).join("  ");
    }

    runner.on(EVENT_SUITE_BEGIN, function (suite: SuiteLike) {
      if (suite.root) {
        return;
      }
      ++indents;
      Base.consoleLog('%s<section class="suite">', indent());
      ++indents;
      Base.consoleLog("%s<h1>%s</h1>", indent(), utils.escape(suite.title));
      Base.consoleLog("%s<dl>", indent());
    });

    runner.on(EVENT_SUITE_END, function (suite: SuiteLike) {
      if (suite.root) {
        return;
      }
      Base.consoleLog("%s</dl>", indent());
      --indents;
      Base.consoleLog("%s</section>", indent());
      --indents;
    });

    runner.on(EVENT_TEST_PASS, function (test: TestLike) {
      Base.consoleLog("%s  <dt>%s</dt>", indent(), utils.escape(test.title));
      Base.consoleLog("%s  <dt>%s</dt>", indent(), utils.escape(test.file));
      const code: string = utils.escape(utils.clean(test.body));
      Base.consoleLog(
        "%s  <dd><pre><code>%s</code></pre></dd>",
        indent(),
        code,
      );
    });

    runner.on(EVENT_TEST_FAIL, function (test: TestLike, err: Error) {
      Base.consoleLog(
        '%s  <dt class="error">%s</dt>',
        indent(),
        utils.escape(test.title),
      );
      Base.consoleLog(
        '%s  <dt class="error">%s</dt>',
        indent(),
        utils.escape(test.file),
      );
      const code: string = utils.escape(utils.clean(test.body));
      Base.consoleLog(
        '%s  <dd class="error"><pre><code>%s</code></pre></dd>',
        indent(),
        code,
      );
      Base.consoleLog(
        '%s  <dd class="error">%s</dd>',
        indent(),
        utils.escape(err),
      );
    });
  }
}

exports = module.exports = Doc;
