'use strict';

// Source plugins — each plugin fetches and normalizes opportunities to the standard schema.
// See CLAUDE.md for the standard source plugin shape.

const idealist = require('./idealist');

module.exports = { idealist };
