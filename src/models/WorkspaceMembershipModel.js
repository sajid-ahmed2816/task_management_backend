const mongoose = require("mongoose");

const WorkspaceMembershipSchema = new mongoose.Schema({
  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Workspace",
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  role: {
    type: String,
    default: "Member",
    enum: ["Owner", "Member"]
  },
  status: {
    type: String,
    default: "Active",
    enum: ["Active", "Inactive"]
  },
  removedAt: {
    type: Date
  }
}, {
  timestamps: true
});

WorkspaceMembershipSchema.index({ workspace: 1, user: 1 }, { unique: true });

const WorkspaceMembership = mongoose.model("WorkspaceMembership", WorkspaceMembershipSchema);
module.exports = WorkspaceMembership;