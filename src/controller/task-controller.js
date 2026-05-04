const Task = require("../models/TaskModel");
const { sendResponse } = require("../helper/sendResponse");

// Helper to compute progress info
const computeProgress = (subTasks) => {
  const total = subTasks.length;
  const completed = subTasks.filter((st) => st.completed).length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { percentage, completed, total };
};

// GET /api/tasks?status=in-progress (optional filter)
const getTasks = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.query;

    let filter = { user: userId };
    if (status && ["in-progress", "paused", "done"].includes(status)) {
      filter.status = status;
    }

    const tasks = await Task.find(filter)
      .populate("assignees", "name profile_picture email")
      .populate("comments.user", "name profile_picture")
      .lean(); // lean to modify objects

    // Add computed progress directly to each task
    const tasksWithProgress = tasks.map((task) => {
      const progress = computeProgress(task.subTasks);
      return {
        ...task,
        progressPercentage: progress.percentage,
        completedSubtasks: progress.completed,
        totalSubtasks: progress.total,
      };
    });

    return res.status(200).send(sendResponse(true, tasksWithProgress, "Tasks fetched"));
  } catch (error) {
    console.error(error);
    return res.status(500).send(sendResponse(false, null, error.message));
  }
};

// POST /api/tasks – create a new task
const createTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, category, description, status, assignees, subTasks } = req.body;

    if (!title) {
      return res.status(400).send(sendResponse(false, null, "Title is required"));
    }

    const newTask = new Task({
      user: userId,
      title,
      category: category || "",
      description: description || "",
      status: status || "in-progress",
      assignees: assignees || [],
      subTasks: subTasks || [],
    });

    await newTask.save();

    await newTask.populate("assignees", "name profile_picture email");
    const progress = computeProgress(newTask.subTasks);

    return res.status(201).send(
      sendResponse(true, { ...newTask.toObject(), ...progress }, "Task created")
    );
  } catch (error) {
    console.error(error);
    return res.status(500).send(sendResponse(false, null, error.message));
  }
};

// PUT /api/tasks/:id – update a task (status, details, subtasks, etc.)
const updateTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const taskId = req.params.id;

    const task = await Task.findOne({ _id: taskId, user: userId });
    if (!task) {
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    }

    // Allowed fields to update
    const { title, category, description, status, assignees, subTasks } = req.body;

    if (title !== undefined) task.title = title;
    if (category !== undefined) task.category = category;
    if (description !== undefined) task.description = description;
    if (status !== undefined) task.status = status;
    if (assignees !== undefined) task.assignees = assignees;
    if (subTasks !== undefined) task.subTasks = subTasks;

    await task.save();
    await task.populate("assignees", "name profile_picture email");
    await task.populate("comments.user", "name profile_picture");

    const progress = computeProgress(task.subTasks);

    return res.status(200).send(
      sendResponse(true, { ...task.toObject(), ...progress }, "Task updated")
    );
  } catch (error) {
    console.error(error);
    return res.status(500).send(sendResponse(false, null, error.message));
  }
};

// DELETE /api/tasks/:id
const deleteTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const taskId = req.params.id;

    const task = await Task.findOneAndDelete({ _id: taskId, user: userId });
    if (!task) {
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    }

    return res.status(200).send(sendResponse(true, null, "Task deleted"));
  } catch (error) {
    console.error(error);
    return res.status(500).send(sendResponse(false, null, error.message));
  }
};

// POST /api/tasks/:id/comments – add a comment
const addComment = async (req, res) => {
  try {
    const userId = req.user.id;
    const taskId = req.params.id;
    const { text } = req.body;

    if (!text) {
      return res.status(400).send(sendResponse(false, null, "Comment text required"));
    }

    const task = await Task.findOne({ _id: taskId, user: userId });
    if (!task) {
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    }

    task.comments.push({ user: userId, text });
    await task.save();

    await task.populate("comments.user", "name profile_picture");
    return res.status(201).send(sendResponse(true, task.comments, "Comment added"));
  } catch (error) {
    console.error(error);
    return res.status(500).send(sendResponse(false, null, error.message));
  }
};

// POST /api/tasks/:id/attachments – add an attachment (URL only, no file upload)
const addAttachment = async (req, res) => {
  try {
    const userId = req.user.id;
    const taskId = req.params.id;
    const { filename, url } = req.body;

    if (!filename || !url) {
      return res.status(400).send(sendResponse(false, null, "Filename and URL are required"));
    }

    const task = await Task.findOne({ _id: taskId, user: userId });
    if (!task) {
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    }

    task.attachments.push({ filename, url });
    await task.save();

    return res.status(201).send(sendResponse(true, task.attachments, "Attachment added"));
  } catch (error) {
    console.error(error);
    return res.status(500).send(sendResponse(false, null, error.message));
  }
};

module.exports = {
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  addComment,
  addAttachment,
};