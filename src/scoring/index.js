'use strict';

// Scorer and disqualifier logic.
// See CLAUDE.md for scoring dimensions and disqualifier rules.

const { disqualify } = require('./disqualify');
const { score, DEFAULT_PASS_THRESHOLD } = require('./scorer');

module.exports = { disqualify, score, DEFAULT_PASS_THRESHOLD };
