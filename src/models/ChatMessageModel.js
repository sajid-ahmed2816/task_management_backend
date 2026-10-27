const mongoose = require("mongoose");

const chatMessageSchema = new mongoose.Schema({
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: "ChatConversation", required: true, index: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, required: true, trim: true, maxlength: 4000 },
}, { timestamps: true });

chatMessageSchema.index({ conversation: 1, createdAt: -1, _id: -1 });
chatMessageSchema.index({ workspace: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model("ChatMessage", chatMessageSchema);
