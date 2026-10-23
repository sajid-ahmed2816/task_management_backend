const mongoose = require("mongoose");

const WorkspaceInvitationSchema = new mongoose.Schema({
  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Workspace",
    required: true,
    index: true,
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  tokenHash: {
    type: String,
    required: true,
    select: false,
  },
  status: {
    type: String,
    enum: ["Pending", "Accepted", "Revoked", "Expired"],
    default: "Pending",
    index: true,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  acceptedAt: Date,
  revokedAt: Date,
  lastSentAt: Date,
}, { timestamps: true });

WorkspaceInvitationSchema.index({ workspace: 1, email: 1, status: 1 });

module.exports = mongoose.model("WorkspaceInvitation", WorkspaceInvitationSchema);
