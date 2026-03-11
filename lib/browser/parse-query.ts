"use strict";

/**
 * Parse the given `qs`.
 *
 * @private
 */
module.exports = function parseQuery(qs: string): Record<string, string> {
  return qs
    .replace("?", "")
    .split("&")
    .reduce(function (obj: Record<string, string>, pair: string) {
      const i = pair.indexOf("=");
      const key = pair.slice(0, i);
      const val = pair.slice(i + 1);

      // Due to how the URLSearchParams API treats spaces
      obj[key] = decodeURIComponent(val.replace(/\+/g, "%20"));

      return obj;
    }, {});
};
