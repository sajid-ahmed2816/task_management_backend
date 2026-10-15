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
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  color: {
    type: String
  },
  link: {
    type: String
  }
}, {
  timestamps: true
});

const Project = mongoose.model("Project", projectSchema);
module.exports = Project;