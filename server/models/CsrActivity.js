const mongoose = require('mongoose');

const csrActivityMediaSchema = new mongoose.Schema({
  type: { type: String, enum: ['image', 'video'], default: 'image' },
  url: { type: String, required: true, trim: true },
  thumbnailUrl: { type: String, default: '', trim: true },
  caption: { type: String, default: '', trim: true, maxlength: 200 },
}, { _id: false });

const csrActivitySchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, default: '', trim: true, maxlength: 2000 },
  milestoneNumber: { type: Number, required: true, min: 1 },
  milestoneAmount: { type: Number, required: true, min: 1, default: 20000 },
  targetAmount: { type: Number, required: true, min: 1, default: 20000 },
  fundedAmount: { type: Number, required: true, min: 0, default: 20000 },
  ordersCounted: { type: Number, required: true, min: 0, default: 20000 },
  activityDate: { type: Date, default: null },
  location: { type: String, default: '', trim: true, maxlength: 160 },
  media: [csrActivityMediaSchema],
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  publishedAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, {
  timestamps: true,
});

csrActivitySchema.index({ milestoneNumber: 1 }, { unique: true });
csrActivitySchema.index({ status: 1, publishedAt: -1, createdAt: -1 });

module.exports = mongoose.model('CsrActivity', csrActivitySchema);
