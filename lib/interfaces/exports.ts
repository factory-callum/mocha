"use strict";

const Suite: {
  create(parent: SuiteInstance, title: string): SuiteInstance;
  constants: Record<string, string>;
} = require("../suite");
const Test: {
  new (title: string, fn?: ((...args: unknown[]) => void) | null): TestInstance;
} = require("../test");

/** Interface for a Suite instance */
interface SuiteInstance {
  on(event: string, listener: (...args: unknown[]) => void): this;
  beforeAll(fn: (...args: unknown[]) => unknown): unknown;
  afterAll(fn: (...args: unknown[]) => unknown): unknown;
  beforeEach(fn: (...args: unknown[]) => unknown): unknown;
  afterEach(fn: (...args: unknown[]) => unknown): unknown;
  addTest(test: TestInstance): unknown;
  [key: string]: unknown;
}

/** Interface for a Test instance */
interface TestInstance {
  file: string | undefined;
  [key: string]: unknown;
}

/** Recursive type for exports-style test definitions */
interface ExportsObject {
  [key: string]: ((...args: unknown[]) => void) | ExportsObject;
}

/**
 * Exports-style (as Node.js module) interface:
 *
 *     exports.Array = {
 *       '#indexOf()': {
 *         'should return -1 when the value is not present': function() {
 *
 *         },
 *
 *         'should return the correct index when the value is present': function() {
 *
 *         }
 *       }
 *     };
 *
 */
function exportsInterface(suite: SuiteInstance): void {
  const suites = [suite];

  suite.on(Suite.constants.EVENT_FILE_REQUIRE, function (...args: unknown[]) {
    const obj = args[0] as ExportsObject;
    const file = args[1] as string;
    visit(obj, file);
  });

  function visit(obj: ExportsObject, file: string): void {
    let suite: SuiteInstance;
    for (const key in obj) {
      if (typeof obj[key] === "function") {
        const fn = obj[key] as (...args: unknown[]) => void;
        switch (key) {
          case "before":
            suites[0].beforeAll(fn);
            break;
          case "after":
            suites[0].afterAll(fn);
            break;
          case "beforeEach":
            suites[0].beforeEach(fn);
            break;
          case "afterEach":
            suites[0].afterEach(fn);
            break;
          default: {
            const test = new Test(key, fn);
            test.file = file;
            suites[0].addTest(test);
          }
        }
      } else {
        suite = Suite.create(suites[0], key);
        suites.unshift(suite);
        visit(obj[key] as ExportsObject, file);
        suites.shift();
      }
    }
  }
}

module.exports = exportsInterface;

module.exports.description = 'Node.js module ("exports") style';
