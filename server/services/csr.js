const CsrSummary = require('../models/CsrSummary');
const Order = require('../models/Order');

const CSR_SUMMARY_KEY = 'global';
const CSR_CONTRIBUTION_PER_ORDER = 1;
const CSR_MILESTONE_AMOUNT = 20000;

async function getOrCreateCsrSummary() {
  const existing = await CsrSummary.findOne({ key: CSR_SUMMARY_KEY });
  if (existing) return existing;

  return CsrSummary.create({
    key: CSR_SUMMARY_KEY,
    contributionPerOrder: CSR_CONTRIBUTION_PER_ORDER,
    milestoneAmount: CSR_MILESTONE_AMOUNT,
    totalPaidOrdersCounted: 0,
    totalContributionAmount: 0,
    completedMilestones: 0,
  });
}

async function reconcileCsrSummaryFromPaidOrders() {
  const summary = await getOrCreateCsrSummary();
  const contributionPerOrder = Math.max(0, Number(summary.contributionPerOrder || CSR_CONTRIBUTION_PER_ORDER));
  const milestoneAmount = Math.max(1, Number(summary.milestoneAmount || CSR_MILESTONE_AMOUNT));

  const [aggregate] = await Order.aggregate([
    {
      $match: {
        isDraft: { $ne: true },
        paymentStatus: 'completed',
      },
    },
    {
      $group: {
        _id: null,
        paidOrders: { $sum: 1 },
        lastContributionAt: {
          $max: {
            $ifNull: ['$csrCreditedAt', '$updatedAt'],
          },
        },
      },
    },
  ]);

  const paidOrders = Math.max(0, Number(aggregate?.paidOrders || 0));
  const totalContributionAmount = paidOrders * contributionPerOrder;

  summary.contributionPerOrder = contributionPerOrder;
  summary.milestoneAmount = milestoneAmount;
  summary.totalPaidOrdersCounted = paidOrders;
  summary.totalContributionAmount = totalContributionAmount;
  summary.completedMilestones = Math.floor(totalContributionAmount / milestoneAmount);
  summary.lastContributionAt = aggregate?.lastContributionAt || null;

  await summary.save();
  return summary;
}

async function recordCsrContributionForPaidOrder() {
  return reconcileCsrSummaryFromPaidOrders();
}

module.exports = {
  CSR_SUMMARY_KEY,
  CSR_CONTRIBUTION_PER_ORDER,
  CSR_MILESTONE_AMOUNT,
  getOrCreateCsrSummary,
  reconcileCsrSummaryFromPaidOrders,
  recordCsrContributionForPaidOrder,
};
