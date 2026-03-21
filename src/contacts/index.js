'use strict';

// Contact resolution — looks up decision-maker name, title, email, and LinkedIn.
// See CLAUDE.md for resolution priority order and Hunter.io integration notes.

const { resolveContact, extractFromPosting, findOrgDomain, lookupWithHunter } = require('./resolver');

module.exports = { resolveContact, extractFromPosting, findOrgDomain, lookupWithHunter };
