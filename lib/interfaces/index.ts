"use strict";

/** Interface function type: takes a root suite and sets up the test DSL */
type InterfaceFunction = ((suite: unknown) => void) & {
  description: string;
};

exports.bdd = require("./bdd") as InterfaceFunction;
exports.tdd = require("./tdd") as InterfaceFunction;
exports.qunit = require("./qunit") as InterfaceFunction;
exports.exports = require("./exports") as InterfaceFunction;
