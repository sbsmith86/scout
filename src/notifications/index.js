'use strict';

// Resend email notification helpers.
// Sends run-summary notification with dashboard link — does not send proposals.

const { sendRunSummaryEmail } = require('./email');

module.exports = { sendRunSummaryEmail };
