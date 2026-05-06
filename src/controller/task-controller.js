const Task = require("../models/TaskModel");
const { sendResponse } = require("../helper/sendResponse");
const cloudinary = require("../config/cloudinaryConfig");

const computeProgress = (subTasks) => {
  const total = subTasks.length;
  const completed = subTasks.filter((st) => st.completed).length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { percentage, completed, total };
};

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

const createTask = async (req, res) => {
  try {
    const userId = req.user.id;
    let { title, category, description, status, assignees, subTasks } = req.body;

    // assignees and subTasks might be sent as JSON strings
    if (typeof assignees === "string") {
      try {
        assignees = JSON.parse(assignees);
      } catch {
        assignees = [];
      }
    }
    if (typeof subTasks === "string") {
      try {
        subTasks = JSON.parse(subTasks);
      } catch {
        subTasks = [];
      }
    }

    if (!title) {
      // If title missing, delete uploaded files before responding
      if (req.files && req.files.length > 0) {
        await Promise.all(
          req.files.map((file) => cloudinary.uploader.destroy(file.filename))
        );
      }
      return res.status(400).send(sendResponse(false, null, "Title is required"));
    };

    const attachments = (req.files || []).map((file) => ({
      filename: file.originalname,
      url: file.path,
      public_id: file.filename,
    }));

    const newTask = new Task({
      user: userId,
      title,
      category: category || "",
      description: description || "",
      status: status || "in-progress",
      assignees: assignees || [],
      subTasks: subTasks || [],
      attachments
    });

    await newTask.save();

    await newTask.populate("assignees", "name profile_picture email");
    await newTask.populate("comments.user", "name profile_picture");
    const progress = computeProgress(newTask.subTasks);

    return res.status(201).send(
      sendResponse(true, { ...newTask.toObject(), ...progress }, "Task created")
    );
  } catch (error) {
    console.error(error);
    if (req.files && req.files.length > 0) {
      await Promise.all(
        req.files.map((file) => cloudinary.uploader.destroy(file.filename))
      ).catch((cleanupErr) => console.error("Cleanup failed:", cleanupErr));
    }
    return res.status(500).send(sendResponse(false, null, error.message));
  }
};

const updateTask = async (req, res) => {
  console.log("🚀 ~ updateTask ~ req:", req)
  const newlyUploadedPublicIds = [];
  try {
    const userId = req.user.id;
    const taskId = req.params.id;

    const task = await Task.findOne({ _id: taskId, user: userId });
    if (!task) {
      // Cleanup uploaded files if task doesn't exist
      if (req.files && req.files.length > 0) {
        await Promise.all(
          req.files.map(file => cloudinary.uploader.destroy(file.filename))
        );
      }
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    }

    // --- Parse text/JSON fields ---
    let { title, category, description, status, assignees, subTasks, removeAttachments } = req.body;

    const parseJSONField = (field, fieldName) => {
      if (typeof field === 'string') {
        try {
          return JSON.parse(field);
        } catch {
          throw new Error(`${fieldName} must be valid JSON`);
        }
      }
      return field;
    };

    try {
      if (assignees !== undefined) assignees = parseJSONField(assignees, 'assignees');
      if (subTasks !== undefined) subTasks = parseJSONField(subTasks, 'subTasks');
      if (removeAttachments !== undefined) removeAttachments = parseJSONField(removeAttachments, 'removeAttachments');
    } catch (err) {
      // Cleanup uploaded files before sending error
      if (req.files && req.files.length > 0) {
        await Promise.all(req.files.map(f => cloudinary.uploader.destroy(f.filename)));
      }
      return res.status(400).send(sendResponse(false, null, err.message));
    }

    // --- Process removals (if any) ---
    if (removeAttachments && Array.isArray(removeAttachments)) {
      const removeIds = removeAttachments.filter(id => typeof id === 'string');

      // Find the attachments to delete from Cloudinary
      const attachmentsToDelete = task.attachments.filter(att =>
        removeIds.includes(att._id.toString())
      );

      // Delete from Cloudinary in parallel (FIX: now actually calls destroy)
      await Promise.all(
        attachmentsToDelete.map(att =>
          cloudinary.uploader.destroy(att.public_id) // uses stored public_id
        )
      );

      // Remove these attachments from the task array
      task.attachments = task.attachments.filter(
        att => !removeIds.includes(att._id.toString())
      );
    }

    // --- Handle new file uploads ---
    if (req.files && req.files.length > 0) {
      const newAttachments = req.files.map(file => ({
        filename: file.originalname,
        url: file.path,
        public_id: file.filename,  // FIX: added public_id
      }));
      task.attachments.push(...newAttachments);

      // Track new public IDs for potential cleanup on failure
      req.files.forEach(file => newlyUploadedPublicIds.push(file.filename));
    }

    // --- Update other fields ---
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
    // Cleanup newly uploaded files if an error happens after upload but before save
    if (newlyUploadedPublicIds.length > 0) {
      await Promise.all(
        newlyUploadedPublicIds.map(id => cloudinary.uploader.destroy(id))
      ).catch(e => console.error("Cleanup error:", e));
    }
    return res.status(500).send(sendResponse(false, null, error.message));
  }
};

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

const addAttachment = async (req, res) => {
  try {
    const userId = req.user.id;
    const taskId = req.params.id;

    // Find the task owned by the user
    const task = await Task.findOne({ _id: taskId, user: userId });
    if (!task) {
      // Clean up any uploaded files before sending error
      if (req.files && req.files.length > 0) {
        await Promise.all(
          req.files.map((file) => cloudinary.uploader.destroy(file.filename))
        ).catch((e) => console.error("Cleanup failed", e));
      }
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    }

    // Build new attachments from uploaded files
    const newAttachments = (req.files || []).map((file) => ({
      filename: file.originalname,
      url: file.path,
      public_id: file.filename,
    }));

    if (newAttachments.length === 0) {
      return res.status(400).send(sendResponse(false, null, "No files uploaded"));
    }

    // Add them to the task's attachments array
    task.attachments.push(...newAttachments);
    await task.save();

    return res.status(201).send(sendResponse(true, task.attachments, "Attachments added"));
  } catch (error) {
    console.error(error);
    // Attempt cleanup if error occurs after upload
    if (req.files && req.files.length > 0) {
      await Promise.all(
        req.files.map((file) => cloudinary.uploader.destroy(file.filename))
      ).catch((e) => console.error("Cleanup failed", e));
    }
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