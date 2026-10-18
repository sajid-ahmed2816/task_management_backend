const mongoose = require("mongoose");
const Task = require("../models/TaskModel");
const Project = require("../models/ProjectModel");
require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env")
});


mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log("Database connected successfully");
  const result = await Task.updateMany({ isDeleted: { $exists: false } }, { $set: { isDeleted: false } });
  console.log("🚀 ~ result:", result)
}).catch((err) => {
  console.log(err);
});