'use strict';

/**
 * Converts a zero-based column index to a Google Sheets column letter.
 * Examples: 0 → 'A', 25 → 'Z', 26 → 'AA', 27 → 'AB'
 *
 * @param {number} index  Zero-based column index
 * @returns {string}
 */
function columnLetter(index) {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

module.exports = { columnLetter };
