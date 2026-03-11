"use strict";

/**
 * Command module for "init" command
 *
 * @private
 * @module
 */

import type { Argv, ArgumentsCamelCase } from "yargs";

const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");

interface InitArgs {
  path: string;
}

exports.command = "init <path>";

exports.description = "create a client-side Mocha setup at <path>";

exports.builder = (yargs: Argv): Argv<InitArgs> =>
  yargs.positional("path", {
    type: "string",
    normalize: true,
  }) as Argv<InitArgs>;

exports.handler = (argv: ArgumentsCamelCase<InitArgs>): void => {
  const destdir = argv.path;
  const srcdir = path.join(__dirname, "..", "..");
  fs.mkdirSync(destdir, { recursive: true });
  const css = fs.readFileSync(path.join(srcdir, "mocha.css"));
  const js = fs.readFileSync(path.join(srcdir, "mocha.js"));
  const tmpl = fs.readFileSync(
    path.join(srcdir, "lib", "browser", "template.html"),
  );
  fs.writeFileSync(path.join(destdir, "mocha.css"), css);
  fs.writeFileSync(path.join(destdir, "mocha.js"), js);
  fs.writeFileSync(path.join(destdir, "tests.spec.js"), "");
  fs.writeFileSync(path.join(destdir, "index.html"), tmpl);
};
