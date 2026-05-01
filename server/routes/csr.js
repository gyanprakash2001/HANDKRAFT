const express = require('express');
const auth = require('../middleware/auth');
const CsrSummary = require('../models/CsrSummary');
const CsrActivity = require('../models/CsrActivity');

const router = express.Router();

const CSR_SUMMARY_KEY = 'global';
const DEFAULT_CONTRIBUTION_PER_ORDER = 1;
const DEFAULT_MILESTONE_AMOUNT = 20000;

async function getOrCreateCsrSummary() {
  const existing = await CsrSummary.findOne({ key: CSR_SUMMARY_KEY });
  if (existing) return existing;

  return CsrSummary.create({
    key: CSR_SUMMARY_KEY,
    contributionPerOrder: DEFAULT_CONTRIBUTION_PER_ORDER,
    milestoneAmount: DEFAULT_MILESTONE_AMOUNT,
    totalPaidOrdersCounted: 0,
    totalContributionAmount: 0,
    completedMilestones: 0,
  });
}

function mapSummary(summaryDoc) {
  const contributionPerOrder = Math.max(0, Number(summaryDoc?.contributionPerOrder || DEFAULT_CONTRIBUTION_PER_ORDER));
  const milestoneAmount = Math.max(1, Number(summaryDoc?.milestoneAmount || DEFAULT_MILESTONE_AMOUNT));
  const totalContributionAmount = Math.max(0, Number(summaryDoc?.totalContributionAmount || 0));
  const totalPaidOrdersCounted = Math.max(0, Number(summaryDoc?.totalPaidOrdersCounted || 0));
  const completedMilestones = Math.max(0, Number(summaryDoc?.completedMilestones || Math.floor(totalContributionAmount / milestoneAmount)));
  const currentMilestoneProgressAmount = totalContributionAmount % milestoneAmount;
  const remainingAmountToNextMilestone = Math.max(0, milestoneAmount - currentMilestoneProgressAmount);
  const progressPercent = Number(((currentMilestoneProgressAmount / milestoneAmount) * 100).toFixed(2));

  return {
    contributionPerOrder,
    milestoneAmount,
    totalPaidOrdersCounted,
    totalContributionAmount,
    completedMilestones,
    currentMilestoneProgressAmount,
    remainingAmountToNextMilestone,
    nextMilestoneNumber: completedMilestones + 1,
    progressPercent,
    lastContributionAt: summaryDoc?.lastContributionAt || null,
    updatedAt: summaryDoc?.updatedAt || null,
  };
}

function mapActivity(activityDoc) {
  return {
    id: String(activityDoc?._id || ''),
    title: String(activityDoc?.title || ''),
    description: String(activityDoc?.description || ''),
    milestoneNumber: Number(activityDoc?.milestoneNumber || 0),
    milestoneAmount: Number(activityDoc?.milestoneAmount || DEFAULT_MILESTONE_AMOUNT),
    targetAmount: Number(activityDoc?.targetAmount || DEFAULT_MILESTONE_AMOUNT),
    fundedAmount: Number(activityDoc?.fundedAmount || 0),
    ordersCounted: Number(activityDoc?.ordersCounted || 0),
    activityDate: activityDoc?.activityDate || null,
    location: String(activityDoc?.location || ''),
    media: Array.isArray(activityDoc?.media)
      ? activityDoc.media.map((entry) => ({
          type: entry?.type === 'video' ? 'video' : 'image',
          url: String(entry?.url || ''),
          thumbnailUrl: String(entry?.thumbnailUrl || ''),
          caption: String(entry?.caption || ''),
        }))
      : [],
    status: String(activityDoc?.status || 'draft'),
    publishedAt: activityDoc?.publishedAt || null,
    createdAt: activityDoc?.createdAt || null,
    updatedAt: activityDoc?.updatedAt || null,
  };
}

// GET /api/csr/summary
router.get('/summary', auth, async (req, res) => {
  try {
    const summary = await getOrCreateCsrSummary();
    return res.json({ summary: mapSummary(summary) });
  } catch (err) {
    console.error('[CSR][SUMMARY] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch CSR summary' });
  }
});

// GET /api/csr/activities
router.get('/activities', auth, async (req, res) => {
  try {
    const activities = await CsrActivity.find({ status: 'published' })
      .sort({ publishedAt: -1, activityDate: -1, createdAt: -1 })
      .lean();

    return res.json({
      activities: activities.map(mapActivity),
    });
  } catch (err) {
    console.error('[CSR][ACTIVITIES] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch CSR activities' });
  }
});

module.exports = router;
