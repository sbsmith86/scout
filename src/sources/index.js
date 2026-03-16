'use strict';

// Source plugins — each plugin fetches and normalizes opportunities to the standard schema.
// See CLAUDE.md for the standard source plugin shape.

const idealist = require('./idealist');
const foundationRss = require('./foundation-rss');
const propublica = require('./propublica');

module.exports = {
  idealist,
  foundationRss,
  propublica,
};
