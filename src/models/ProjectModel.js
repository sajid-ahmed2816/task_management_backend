const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  dueDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    default: "active",
    enum: ["planning", "active", "on_hold", "completed", "cancelled"]
  },
  priority: {
    type: String,
    default: "medium",
    enum: ["low", "medium", "high", "urgent"]
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  color: {
    type: String
  },
  link: {
    type: String
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Workspace",
    required: true
  }
}, {
  timestamps: true
});

const Project = mongoose.model("Project", projectSchema);
module.exports = Project;