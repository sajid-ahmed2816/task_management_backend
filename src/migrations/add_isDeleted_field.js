const mongoose = require("mongoose");
const Task = require("../models/TaskModel");
const Project = require("../models/ProjectModel");
require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env")
});


mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log("Database connected successfully");
  const result = await Task.updateMany({ isDeleted: { $exists: false } }, { $set: { isDeleted: false } });
  console.log("Tasks updated:", result);
  const projectResult = await Project.updateMany({ isDeleted: { $exists: false } }, { $set: { isDeleted: false } });
  console.log("Projects updated:", projectResult);
}).catch((err) => {
  console.log(err);
});
