"use strict";

/**
 * @module Markdown
 */
/**
 * Module dependencies.
 */

const Base = require("./base");
const utils = require("../utils");
const constants = require("../runner").constants;
const EVENT_RUN_END: string = constants.EVENT_RUN_END;
const EVENT_SUITE_BEGIN: string = constants.EVENT_SUITE_BEGIN;
const EVENT_SUITE_END: string = constants.EVENT_SUITE_END;
const EVENT_TEST_PASS: string = constants.EVENT_TEST_PASS;

/**
 * Constants
 */

const SUITE_PREFIX: string = "$";

/** Interface for test-like objects */
interface TestLike {
  title: string;
  body: string;
}

/** Interface for suite-like objects */
interface SuiteLike {
  title: string;
  suites: SuiteLike[];
  fullTitle(): string;
}

/** Interface for TOC map node */
interface TocNode {
  suite?: SuiteLike;
  [key: string]: TocNode | SuiteLike | undefined;
}

/** Interface for runner-like objects */
interface RunnerLike {
  suite: SuiteLike;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once(event: string, listener: (...args: any[]) => void): void;
}

/** Interface for reporter options */
interface ReporterOptions {
  [key: string]: unknown;
}

class Markdown extends Base {
  static description: string = "GitHub Flavored Markdown";

  /**
   * Constructs a new `Markdown` reporter instance.
   *
   * @public
   * @memberof Mocha.reporters
   * @extends Mocha.reporters.Base
   */
  constructor(runner: RunnerLike, options?: ReporterOptions) {
    super(runner, options);

    let level: number = 0;
    let buf: string = "";

    function title(str: string): string {
      return Array(level).join("#") + " " + str;
    }

    function mapTOC(suite: SuiteLike, obj: TocNode): TocNode {
      const ret: TocNode = obj;
      const key: string = SUITE_PREFIX + suite.title;

      obj = obj[key] = (obj[key] as TocNode) || { suite };
      suite.suites.forEach(function (s: SuiteLike) {
        mapTOC(s, obj);
      });

      return ret;
    }

    function stringifyTOC(obj: TocNode, lvl: number): string {
      ++lvl;
      let result: string = "";
      let link: string;
      for (const key in obj) {
        if (key === "suite") {
          continue;
        }
        if (key !== SUITE_PREFIX) {
          link = " - [" + key.substring(1) + "]";
          link += "(#" + utils.slug((obj[key] as TocNode).suite!.fullTitle()) + ")\n";
          result += Array(lvl).join("  ") + link;
        }
        result += stringifyTOC(obj[key] as TocNode, lvl);
      }
      return result;
    }

    function generateTOC(suite: SuiteLike): string {
      const obj: TocNode = mapTOC(suite, {});
      return stringifyTOC(obj, 0);
    }

    generateTOC(runner.suite);

    runner.on(EVENT_SUITE_BEGIN, function (suite: SuiteLike) {
      ++level;
      const slug: string = utils.slug(suite.fullTitle());
      buf += '<a name="' + slug + '"></a>' + "\n";
      buf += title(suite.title) + "\n";
    });

    runner.on(EVENT_SUITE_END, function () {
      --level;
    });

    runner.on(EVENT_TEST_PASS, function (test: TestLike) {
      const code: string = utils.clean(test.body);
      buf += test.title + ".\n";
      buf += "\n```js\n";
      buf += code + "\n";
      buf += "```\n\n";
    });

    runner.once(EVENT_RUN_END, function () {
      process.stdout.write("# TOC\n");
      process.stdout.write(generateTOC(runner.suite));
      process.stdout.write(buf);
    });
  }
}

exports = module.exports = Markdown;
