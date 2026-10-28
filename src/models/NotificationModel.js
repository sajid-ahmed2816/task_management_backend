const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
  type: { type: String, enum: ["task_assigned", "chat_message"], required: true },
  task: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: "ChatConversation", default: null },
  message: { type: mongoose.Schema.Types.ObjectId, ref: "ChatMessage", default: null },
  title: { type: String, required: true },
  body: { type: String, default: "" },
  dedupeKey: { type: String, required: true, unique: true },
  isRead: { type: Boolean, default: false, index: true },
  readAt: { type: Date, default: null },
}, { timestamps: true });

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, workspace: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
