/// <reference lib="dom" />
"use strict";

/**
 * @module HTML
 */
/**
 * Module dependencies.
 */

const Base = require("./base");
const utils = require("../utils");
const escapeRe: (str: string) => string = require("escape-string-regexp");
const constants = require("../runner").constants;
const EVENT_TEST_PASS: string = constants.EVENT_TEST_PASS;
const EVENT_TEST_FAIL: string = constants.EVENT_TEST_FAIL;
const EVENT_SUITE_BEGIN: string = constants.EVENT_SUITE_BEGIN;
const EVENT_SUITE_END: string = constants.EVENT_SUITE_END;
const EVENT_TEST_PENDING: string = constants.EVENT_TEST_PENDING;
const escape: (html: string) => string = utils.escape;

/**
 * Save timer references to avoid Sinon interfering (see GH-237).
 */

const DateConstructor: DateConstructor = global.Date;

/**
 * Stats template: Result, progress, passes, failures, and duration.
 */

const statsTemplate: string =
  '<ul id="mocha-stats">' +
  '<li class="result"></li>' +
  '<li class="progress-contain"><progress class="progress-element" max="100" value="0"></progress><svg class="progress-ring"><circle class="ring-flatlight" stroke-dasharray="100%,0%"/><circle class="ring-highlight" stroke-dasharray="0%,100%"/></svg><div class="progress-text">0%</div></li>' +
  '<li class="passes"><a href="javascript:void(0);">passes:</a> <em>0</em></li>' +
  '<li class="failures"><a href="javascript:void(0);">failures:</a> <em>0</em></li>' +
  '<li class="duration">duration: <em>0</em>s</li>' +
  "</ul>";

const playIcon: string = "&#x2023;";

/** Interface for test-like objects in HTML reporter */
interface HTMLTestLike {
  title: string;
  fullTitle(): string;
  speed?: string;
  duration?: number;
  body: string;
  err?: HTMLErrorLike;
}

/** Interface for error-like objects */
interface HTMLErrorLike {
  message?: string;
  stack?: string;
  sourceURL?: string;
  line?: number;
  htmlMessage?: string;
  toString(): string;
}

/** Interface for suite-like objects */
interface HTMLSuiteLike {
  title: string;
  root: boolean;
  fullTitle(): string;
}

/** Interface for stats */
interface HTMLStatsLike {
  tests: number;
  passes: number;
  failures: number;
  start?: Date;
}

/** Interface for runner-like objects */
interface HTMLRunnerLike {
  total: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once(event: string, listener: (...args: any[]) => void): void;
}

/** Interface for reporter options */
interface HTMLReporterOptions {
  [key: string]: unknown;
}

class HTML extends Base {
  static browserOnly: boolean = true;

  /**
   * Constructs a new `HTML` reporter instance.
   *
   * @public
   * @memberof Mocha.reporters
   * @extends Mocha.reporters.Base
   */
  constructor(runner: HTMLRunnerLike, options?: HTMLReporterOptions) {
    super(runner, options);

    const self = this;
    const stats: HTMLStatsLike = this.stats;
    const stat: Node = fragment(statsTemplate)!;
    const items: HTMLCollectionOf<HTMLLIElement> = (
      stat as HTMLElement
    ).getElementsByTagName("li");
    const resultIndex: number = 0;
    const progressIndex: number = 1;
    const passesIndex: number = 2;
    const failuresIndex: number = 3;
    const durationIndex: number = 4;
    /** Stat item containing the root suite pass or fail indicator (hasFailures ? '✖' : '✓') */
    const resultIndicator: HTMLLIElement = items[resultIndex];
    /** Passes text and count */
    const passesStat: HTMLLIElement = items[passesIndex];
    /** Stat item containing the pass count (not the word, just the number) */
    const passesCount: HTMLElement = passesStat.getElementsByTagName("em")[0];
    /** Stat item linking to filter to show only passing tests */
    const passesLink: HTMLAnchorElement =
      passesStat.getElementsByTagName("a")[0];
    /** Failures text and count */
    const failuresStat: HTMLLIElement = items[failuresIndex];
    /** Stat item containing the failure count (not the word, just the number) */
    const failuresCount: HTMLElement =
      failuresStat.getElementsByTagName("em")[0];
    /** Stat item linking to filter to show only failing tests */
    const failuresLink: HTMLAnchorElement =
      failuresStat.getElementsByTagName("a")[0];
    /** Stat item linking to the duration time (not the word or unit, just the number) */
    const duration: HTMLElement =
      items[durationIndex].getElementsByTagName("em")[0];
    const report: Node = fragment('<ul id="mocha-report"></ul>')!;
    const stack: Node[] = [report];
    const progressText: HTMLDivElement = items[progressIndex].getElementsByTagName(
      "div",
    )[0] as HTMLDivElement;
    const progressBar: HTMLProgressElement = items[
      progressIndex
    ].getElementsByTagName("progress")[0] as HTMLProgressElement;
    const progressRing: [Element, Element] = [
      items[progressIndex].getElementsByClassName("ring-flatlight")[0],
      items[progressIndex].getElementsByClassName("ring-highlight")[0],
    ];
    const root: HTMLElement | null = document.getElementById("mocha");

    if (!root) {
      error("#mocha div missing, add it to your document");
      return;
    }

    // pass toggle
    on(passesLink, "click", function (evt: Event) {
      evt.preventDefault();
      unhide();
      const name: string = /pass/.test((report as HTMLElement).className)
        ? ""
        : " pass";
      (report as HTMLElement).className =
        (report as HTMLElement).className.replace(/fail|pass/g, "") + name;
      if ((report as HTMLElement).className.trim()) {
        hideSuitesWithout("test pass");
      }
    });

    // failure toggle
    on(failuresLink, "click", function (evt: Event) {
      evt.preventDefault();
      unhide();
      const name: string = /fail/.test((report as HTMLElement).className)
        ? ""
        : " fail";
      (report as HTMLElement).className =
        (report as HTMLElement).className.replace(/fail|pass/g, "") + name;
      if ((report as HTMLElement).className.trim()) {
        hideSuitesWithout("test fail");
      }
    });

    root.appendChild(stat);
    root.appendChild(report);

    runner.on(EVENT_SUITE_BEGIN, function (suite: HTMLSuiteLike) {
      if (suite.root) {
        return;
      }

      // suite
      const url: string = self.suiteURL(suite);
      const el: Node = fragment(
        '<li class="suite"><h1><a href="%s">%s</a></h1></li>',
        url,
        escape(suite.title),
      )!;

      // container
      stack[0].appendChild(el);
      stack.unshift(document.createElement("ul"));
      el.appendChild(stack[0]);
    });

    runner.on(EVENT_SUITE_END, function (suite: HTMLSuiteLike) {
      if (suite.root) {
        if (stats.failures === 0) {
          text(resultIndicator, "✓");
          (stat as HTMLElement).className += " pass";
        }
        updateStats();
        return;
      }
      stack.shift();
    });

    runner.on(EVENT_TEST_PASS, function (test: HTMLTestLike) {
      const url: string = self.testURL(test);
      const markup: string =
        '<li class="test pass %e"><h2>%e<span class="duration">%ems</span> ' +
        '<a href="%s" class="replay">' +
        playIcon +
        "</a></h2></li>";
      const el: Node = fragment(
        markup,
        test.speed!,
        test.title,
        test.duration!,
        url,
      )!;
      self.addCodeToggle(el as HTMLLIElement, test.body);
      appendToStack(el);
      updateStats();
    });

    runner.on(EVENT_TEST_FAIL, function (test: HTMLTestLike) {
      // Update stat items
      text(resultIndicator, "✖");
      (stat as HTMLElement).className += " fail";

      const el: Node = fragment(
        '<li class="test fail"><h2>%e <a href="%e" class="replay">' +
          playIcon +
          "</a></h2></li>",
        test.title,
        self.testURL(test),
      )!;
      let stackString: string; // Note: Includes leading newline
      let message: string = test.err!.toString();

      // <=IE7 stringifies to [Object Error]. Since it can be overloaded, we
      // check for the result of the stringifying.
      if (message === "[object Error]") {
        message = test.err!.message!;
      }

      if (test.err!.stack) {
        const indexOfMessage: number = test.err!.stack!.indexOf(
          test.err!.message!,
        );
        if (indexOfMessage === -1) {
          stackString = test.err!.stack!;
        } else {
          stackString = test.err!.stack!.slice(
            test.err!.message!.length + indexOfMessage,
          );
        }
      } else if (
        test.err!.sourceURL &&
        test.err!.line !== undefined
      ) {
        // Safari doesn't give you a stack. Let's at least provide a source line.
        stackString =
          "\n(" + test.err!.sourceURL + ":" + test.err!.line + ")";
      }

      stackString = stackString! || "";

      if (test.err!.htmlMessage && stackString) {
        el.appendChild(
          fragment(
            '<div class="html-error">%s\n<pre class="error">%e</pre></div>',
            test.err!.htmlMessage,
            stackString,
          )!,
        );
      } else if (test.err!.htmlMessage) {
        el.appendChild(
          fragment(
            '<div class="html-error">%s</div>',
            test.err!.htmlMessage,
          )!,
        );
      } else {
        el.appendChild(
          fragment('<pre class="error">%e%e</pre>', message, stackString)!,
        );
      }

      self.addCodeToggle(el as HTMLLIElement, test.body);
      appendToStack(el);
      updateStats();
    });

    runner.on(EVENT_TEST_PENDING, function (test: HTMLTestLike) {
      const el: Node = fragment(
        '<li class="test pass pending"><h2>%e</h2></li>',
        test.title,
      )!;
      appendToStack(el);
      updateStats();
    });

    function appendToStack(el: Node): void {
      // Don't call .appendChild if #mocha-report was already .shift()'ed off the stack.
      if (stack[0]) {
        stack[0].appendChild(el);
      }
    }

    function updateStats(): void {
      const percent: number = ((stats.tests / runner.total) * 100) | 0;
      progressBar.value = percent;
      if (progressText) {
        // setting a toFixed that is too low, makes small changes to progress not shown
        // setting it too high, makes the progress text longer then it needs to
        // to address this, calculate the toFixed based on the magnitude of total
        const decimalPlaces: number = Math.ceil(
          Math.log10(runner.total / 100),
        );
        text(
          progressText,
          percent.toFixed(Math.min(Math.max(decimalPlaces, 0), 100)) + "%",
        );
      }
      if (progressRing) {
        const radius: number = parseFloat(
          getComputedStyle(progressRing[0]).getPropertyValue("r"),
        );
        const wholeArc: number = Math.PI * 2 * radius;
        const highlightArc: number = percent * (wholeArc / 100);
        // The progress ring is in 2 parts, the flatlight color and highlight color.
        // Rendering both on top of the other, seems to make a 3rd color on the edges.
        // To create 1 whole ring with 2 colors, both parts are inverse of the other.
        (progressRing[0] as HTMLElement).style.strokeDasharray =
          `0,${highlightArc}px,${wholeArc}px`;
        (progressRing[1] as HTMLElement).style.strokeDasharray =
          `${highlightArc}px,${wholeArc}px`;
      }

      // update stats
      const ms: number =
        +new DateConstructor() - +(stats.start as unknown as Date);
      text(passesCount, String(stats.passes));
      text(failuresCount, String(stats.failures));
      text(duration, (ms / 1000).toFixed(2));
    }
  }

  /**
   * Provide suite URL.
   */
  suiteURL(suite: HTMLSuiteLike): string {
    return makeUrl("^" + escapeRe(suite.fullTitle()) + " ");
  }

  /**
   * Provide test URL.
   */
  testURL(test: HTMLTestLike): string {
    return makeUrl("^" + escapeRe(test.fullTitle()) + "$");
  }

  /**
   * Adds code toggle functionality for the provided test's list element.
   */
  addCodeToggle(el: HTMLLIElement, contents: string): void {
    const h2: HTMLHeadingElement = el.getElementsByTagName("h2")[0];

    on(h2, "click", function () {
      pre.style.display = pre.style.display === "none" ? "block" : "none";
    });

    const pre: HTMLPreElement = fragment(
      "<pre><code>%e</code></pre>",
      utils.clean(contents),
    ) as HTMLPreElement;
    el.appendChild(pre);
    pre.style.display = "none";
  }
}

/**
 * Makes a URL, preserving querystring ("search") parameters.
 */
function makeUrl(s: string): string {
  let search: string = window.location.search;

  // Remove previous {grep, fgrep, invert} query parameters if present
  if (search) {
    search = search
      .replace(/[?&](?:f?grep|invert)=[^&\s]*/g, "")
      .replace(/^&/, "?");
  }

  return (
    window.location.pathname +
    (search ? search + "&" : "?") +
    "grep=" +
    encodeURIComponent(s)
  );
}

/**
 * Display error `msg`.
 */
function error(msg: string): void {
  document.body.appendChild(
    fragment('<div id="mocha-error">%s</div>', msg)!,
  );
}

/**
 * Return a DOM fragment from `html`.
 */
function fragment(html: string, ...rest: unknown[]): ChildNode | null {
  const args: unknown[] = [html, ...rest];
  const div: HTMLDivElement = document.createElement("div");
  let i: number = 1;

  div.innerHTML = html.replace(
    /%([se])/g,
    function (_: string, type: string): string {
      switch (type) {
        case "s":
          return String(args[i++]);
        case "e":
          return escape(String(args[i++]));
        // no default
      }
      return "";
    },
  );

  return div.firstChild;
}

/**
 * Check for suites that do not have elements
 * with `classname`, and hide them.
 */
function hideSuitesWithout(classname: string): void {
  const suites: HTMLCollectionOf<Element> =
    document.getElementsByClassName("suite");
  for (let i = 0; i < suites.length; i++) {
    const els: HTMLCollectionOf<Element> =
      suites[i].getElementsByClassName(classname);
    if (!els.length) {
      (suites[i] as HTMLElement).className += " hidden";
    }
  }
}

/**
 * Unhide .hidden suites.
 */
function unhide(): void {
  const els: HTMLCollectionOf<Element> =
    document.getElementsByClassName("suite hidden");
  while (els.length > 0) {
    (els[0] as HTMLElement).className = (
      els[0] as HTMLElement
    ).className.replace("suite hidden", "suite");
  }
}

/**
 * Set an element's text contents.
 */
function text(el: HTMLElement, contents: string): void {
  if (el.textContent) {
    el.textContent = contents;
  } else {
    el.innerText = contents;
  }
}

/**
 * Listen on `event` with callback `fn`.
 */
function on(
  el: HTMLElement,
  event: string,
  fn: EventListenerOrEventListenerObject,
): void {
  if (el.addEventListener) {
    el.addEventListener(event, fn, false);
  } else {
    (el as unknown as { attachEvent: (event: string, fn: EventListenerOrEventListenerObject) => void }).attachEvent(
      "on" + event,
      fn,
    );
  }
}

exports = module.exports = HTML;
