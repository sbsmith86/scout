'use strict';

// Source plugins — each plugin fetches and normalizes opportunities to the standard schema.
// See CLAUDE.md for the standard source plugin shape.

const foundationRss = require('./foundation-rss');

module.exports = {
  foundationRss,
};
