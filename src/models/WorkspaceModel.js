const mongoose = require("mongoose");
const generateRandomColor = require("../utils/generateRandomColor");

const WorkspaceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
  },
  background: {
    type: String,
    default: generateRandomColor
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
}, {
  timestamps: true
});

const Workspace = mongoose.model("Workspace", WorkspaceSchema);
module.exports = Workspace;