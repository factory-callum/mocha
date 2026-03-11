"use strict";

/**
 * @module Landing
 */
/**
 * Module dependencies.
 */

const Base = require("./base");
const constants = require("../runner").constants;
const EVENT_RUN_BEGIN: string = constants.EVENT_RUN_BEGIN;
const EVENT_RUN_END: string = constants.EVENT_RUN_END;
const EVENT_TEST_END: string = constants.EVENT_TEST_END;
const STATE_FAILED: string = require("../runnable").constants.STATE_FAILED;

const cursor: {
  hide(): void;
  show(): void;
  CR(): void;
  deleteLine(): void;
  beginningOfLine(): void;
} = Base.cursor;
const color: (type: string, str: string) => string = Base.color;

/**
 * Airplane color.
 */

Base.colors.plane = 0;

/**
 * Airplane crash color.
 */

Base.colors["plane crash"] = 31;

/**
 * Runway color.
 */

Base.colors.runway = 90;

/** Interface for test-like objects */
interface TestLike {
  state?: string;
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

class Landing extends Base {
  static description: string = "Unicode landing strip";

  /**
   * Constructs a new `Landing` reporter instance.
   *
   * @public
   * @memberof Mocha.reporters
   * @extends Mocha.reporters.Base
   */
  constructor(runner: RunnerLike, options?: ReporterOptions) {
    super(runner, options);

    const self = this;
    const width: number = (Base.window.width * 0.75) | 0;
    const stream: NodeJS.WriteStream = process.stdout;

    let plane: string = color("plane", "✈");
    let crashed: number = -1;
    let n: number = 0;
    let total: number = 0;

    function runway(): string {
      const buf: string = Array(width).join("-");
      return "  " + color("runway", buf);
    }

    runner.on(EVENT_RUN_BEGIN, function () {
      stream.write("\n\n\n  ");
      cursor.hide();
    });

    runner.on(EVENT_TEST_END, function (test: TestLike) {
      // check if the plane crashed
      const col: number =
        crashed === -1 ? ((width * ++n) / ++total) | 0 : crashed;
      // show the crash
      if (test.state === STATE_FAILED) {
        plane = color("plane crash", "✈");
        crashed = col;
      }

      // render landing strip
      stream.write("\u001b[" + (width + 1) + "D\u001b[2A");
      stream.write(runway());
      stream.write("\n  ");
      stream.write(color("runway", Array(col).join("⋅")));
      stream.write(plane);
      stream.write(color("runway", Array(width - col).join("⋅") + "\n"));
      stream.write(runway());
      stream.write("\u001b[0m");
    });

    runner.once(EVENT_RUN_END, function () {
      cursor.show();
      process.stdout.write("\n");
      self.epilogue();
    });

    // if cursor is hidden when we ctrl-C, then it will remain hidden unless...
    process.once("SIGINT", function () {
      cursor.show();
      process.nextTick(function () {
        process.kill(process.pid, "SIGINT");
      });
    });
  }
}

exports = module.exports = Landing;
