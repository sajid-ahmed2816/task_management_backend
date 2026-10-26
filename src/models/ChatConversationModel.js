const mongoose = require("mongoose");

const chatConversationSchema = new mongoose.Schema({
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }],
  participantKey: { type: String, required: true },
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: "ChatMessage", default: null },
}, { timestamps: true });

chatConversationSchema.index({ workspace: 1, participantKey: 1 }, { unique: true });
chatConversationSchema.index({ workspace: 1, participants: 1, updatedAt: -1 });

module.exports = mongoose.model("ChatConversation", chatConversationSchema);
