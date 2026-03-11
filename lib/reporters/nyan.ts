"use strict";

/**
 * @module Nyan
 */
/**
 * Module dependencies.
 */

const Base = require("./base");
const constants = require("../runner").constants;
const EVENT_RUN_BEGIN: string = constants.EVENT_RUN_BEGIN;
const EVENT_TEST_PENDING: string = constants.EVENT_TEST_PENDING;
const EVENT_TEST_PASS: string = constants.EVENT_TEST_PASS;
const EVENT_RUN_END: string = constants.EVENT_RUN_END;
const EVENT_TEST_FAIL: string = constants.EVENT_TEST_FAIL;

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

/** Interface for stats */
interface StatsLike {
  passes: number;
  failures: number;
  pending: number;
}

class NyanCat extends Base {
  static description: string = '"nyan cat"';

  nyanCatWidth: number;
  colorIndex: number;
  numberOfLines: number;
  rainbowColors: number[];
  scoreboardWidth: number;
  tick: boolean;
  trajectories: string[][];
  trajectoryWidthMax: number;

  /**
   * Constructs a new `Nyan` reporter instance.
   *
   * @public
   * @memberof Mocha.reporters
   * @extends Mocha.reporters.Base
   */
  constructor(runner: RunnerLike, options?: ReporterOptions) {
    super(runner, options);

    const self = this;
    const width: number = (Base.window.width * 0.75) | 0;
    const nyanCatWidth: number = (this.nyanCatWidth = 11);

    this.colorIndex = 0;
    this.numberOfLines = 4;
    this.rainbowColors = self.generateColors();
    this.scoreboardWidth = 5;
    this.tick = false;
    this.trajectories = [[], [], [], []];
    this.trajectoryWidthMax = width - nyanCatWidth;

    runner.on(EVENT_RUN_BEGIN, function () {
      Base.cursor.hide();
      self.draw();
    });

    runner.on(EVENT_TEST_PENDING, function () {
      self.draw();
    });

    runner.on(EVENT_TEST_PASS, function () {
      self.draw();
    });

    runner.on(EVENT_TEST_FAIL, function () {
      self.draw();
    });

    runner.once(EVENT_RUN_END, function () {
      Base.cursor.show();
      for (let i = 0; i < self.numberOfLines; i++) {
        process.stdout.write("\n");
      }
      self.epilogue();
    });
  }

  /**
   * Draw the nyan cat
   */
  draw(): void {
    this.appendRainbow();
    this.drawScoreboard();
    this.drawRainbow();
    this.drawNyanCat();
    this.tick = !this.tick;
  }

  /**
   * Draw the "scoreboard" showing the number
   * of passes, failures and pending tests.
   */
  drawScoreboard(): void {
    const stats: StatsLike = this.stats;

    function draw(type: string, n: number): void {
      process.stdout.write(" ");
      process.stdout.write(Base.color(type, n));
      process.stdout.write("\n");
    }

    draw("green", stats.passes);
    draw("fail", stats.failures);
    draw("pending", stats.pending);
    process.stdout.write("\n");

    this.cursorUp(this.numberOfLines);
  }

  /**
   * Append the rainbow.
   */
  appendRainbow(): void {
    const segment: string = this.tick ? "_" : "-";
    const rainbowified: string = this.rainbowify(segment);

    for (let index = 0; index < this.numberOfLines; index++) {
      const trajectory: string[] = this.trajectories[index];
      if (trajectory.length >= this.trajectoryWidthMax) {
        trajectory.shift();
      }
      trajectory.push(rainbowified);
    }
  }

  /**
   * Draw the rainbow.
   */
  drawRainbow(): void {
    const self = this;

    this.trajectories.forEach(function (line: string[]) {
      process.stdout.write("\u001b[" + self.scoreboardWidth + "C");
      process.stdout.write(line.join(""));
      process.stdout.write("\n");
    });

    this.cursorUp(this.numberOfLines);
  }

  /**
   * Draw the nyan cat
   */
  drawNyanCat(): void {
    const self = this;
    const startWidth: number =
      this.scoreboardWidth + this.trajectories[0].length;
    const dist: string = "\u001b[" + startWidth + "C";
    let padding: string;

    process.stdout.write(dist);
    process.stdout.write("_,------,");
    process.stdout.write("\n");

    process.stdout.write(dist);
    padding = self.tick ? "  " : "   ";
    process.stdout.write("_|" + padding + "/\\_/\\ ");
    process.stdout.write("\n");

    process.stdout.write(dist);
    padding = self.tick ? "_" : "__";
    const tail: string = self.tick ? "~" : "^";
    process.stdout.write(tail + "|" + padding + this.face() + " ");
    process.stdout.write("\n");

    process.stdout.write(dist);
    padding = self.tick ? " " : "  ";
    process.stdout.write(padding + '""  "" ');
    process.stdout.write("\n");

    this.cursorUp(this.numberOfLines);
  }

  /**
   * Draw nyan cat face.
   */
  face(): string {
    const stats: StatsLike = this.stats;
    if (stats.failures) {
      return "( x .x)";
    } else if (stats.pending) {
      return "( o .o)";
    } else if (stats.passes) {
      return "( ^ .^)";
    }
    return "( - .-)";
  }

  /**
   * Move cursor up `n`.
   */
  cursorUp(n: number): void {
    process.stdout.write("\u001b[" + n + "A");
  }

  /**
   * Move cursor down `n`.
   */
  cursorDown(n: number): void {
    process.stdout.write("\u001b[" + n + "B");
  }

  /**
   * Generate rainbow colors.
   */
  generateColors(): number[] {
    const colors: number[] = [];

    for (let i = 0; i < 6 * 7; i++) {
      const pi3: number = Math.floor(Math.PI / 3);
      const n: number = i * (1.0 / 6);
      const r: number = Math.floor(3 * Math.sin(n) + 3);
      const g: number = Math.floor(3 * Math.sin(n + 2 * pi3) + 3);
      const b: number = Math.floor(3 * Math.sin(n + 4 * pi3) + 3);
      colors.push(36 * r + 6 * g + b + 16);
    }

    return colors;
  }

  /**
   * Apply rainbow to the given `str`.
   */
  rainbowify(str: string): string {
    if (!Base.useColors) {
      return str;
    }
    const color: number =
      this.rainbowColors[this.colorIndex % this.rainbowColors.length];
    this.colorIndex += 1;
    return "\u001b[38;5;" + color + "m" + str + "\u001b[0m";
  }
}

exports = module.exports = NyanCat;
