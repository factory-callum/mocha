"use strict";

/**
 @module Pending
*/

/**
 * Initialize a new `PendingError` error with the given message.
 */
class PendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PendingError";
  }
}

module.exports = PendingError;
