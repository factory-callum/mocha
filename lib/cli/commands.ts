"use strict";

/**
 * Exports Yargs commands
 * @see https://github.com/yargs/yargs/blob/main/docs/advanced.md
 * @private
 * @module
 */

import type { CommandModule } from "yargs";

interface Commands {
  init: CommandModule;
  run: CommandModule;
}

const commands: Commands = {
  init: require("./init"),
  // default command
  run: require("./run"),
};

module.exports = commands;
