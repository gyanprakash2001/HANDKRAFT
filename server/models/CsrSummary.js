const mongoose = require('mongoose');

const csrSummarySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'global' },
  contributionPerOrder: { type: Number, required: true, min: 0, default: 1 },
  milestoneAmount: { type: Number, required: true, min: 1, default: 20000 },
  totalPaidOrdersCounted: { type: Number, required: true, min: 0, default: 0 },
  totalContributionAmount: { type: Number, required: true, min: 0, default: 0 },
  completedMilestones: { type: Number, required: true, min: 0, default: 0 },
  lastContributionAt: { type: Date, default: null },
}, {
  timestamps: true,
});

module.exports = mongoose.model('CsrSummary', csrSummarySchema);
