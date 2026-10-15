const path = require("path");
const axios = require("axios");
const Task = require("../models/TaskModel");
const { sendResponse } = require("../helper/sendResponse");
const cloudinary = require("../config/cloudinaryConfig");

const computeProgress = (subTasks) => {
  const total = subTasks.length;
  const completed = subTasks.filter((st) => st.isCompleted).length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { percentage, completed, total };
};

const getTaskProgressData = (task) => {
  const progress = computeProgress(task.subTasks || []);

  return {
    ...task.toObject(),
    progressPercentage: progress.percentage,
    completedSubtasks: progress.completed,
    totalSubtasks: progress.total,
  };
};

const getTasks = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.query;

    let filter = { user: userId };
    if (status && ["in-progress", "paused", "done"].includes(status)) {
      filter.status = status;
    }

    const tasks = await Task.find(filter).populate("assignees", "name profile_picture").lean(); // lean to modify objects

    // Add computed progress directly to each task
    const tasksWithProgress = tasks.map((task) => {
      const progress = computeProgress(task.subTasks);
      const commentCount = Array.isArray(task.comments) ? task.comments.length : 0;
      const attachmentCount = Array.isArray(task.attachments) ? task.attachments.length : 0;

      delete task.comments;
      delete task.attachments;

      return {
        ...task,
        progressPercentage: progress.percentage,
        completedSubtasks: progress.completed,
        totalSubtasks: progress.total,
        commentCount,
        attachmentCount
      };
    });

    return res.status(200).send(sendResponse(true, tasksWithProgress, "Tasks fetched"));
  } catch (error) {
    console.error(error);
    return res.status(500).send(sendResponse(false, null, error.message));
  }
};

const getTaskById = async (req, res) => {
  try {
    const userId = req.user.id;
    const taskId = req.params.id;

    const task = await Task.findOne({
      _id: taskId,
      user: userId,
    }).populate(
      "assignees", "name profile_picture email"
    ).populate(
      "comments.user", "name profile_picture"
    );

    if (!task) {
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    };

    const taskData = task.toObject();
    const progress = computeProgress(task.subTasks || []);

    return res.status(200).send(sendResponse(
      true,
      {
        ...taskData,
        progressPercentage: progress.percentage,
        completedSubtasks: progress.completed,
        totalSubtasks: progress.total,
        commentCount: task.comments.length,
        attachmentCount: task.attachments.length,
      },
      "Task details fetched"
    ));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, error.message));
  }
};

const createTask = async (req, res) => {
  try {
    const userId = req.user.id;
    let { title, project, description, dueDate, priority, status, assignees, subTasks } = req.body;

    // assignees and subTasks might be sent as JSON strings
    if (typeof assignees === "string") {
      try {
        assignees = JSON.parse(assignees);
      } catch {
        assignees = [];
      }
    };

    if (typeof subTasks === "string") {
      try {
        subTasks = JSON.parse(subTasks);
      } catch {
        subTasks = [];
      }
    };

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
      project,
      description: description || "",
      dueDate: dueDate,
      priority: priority,
      status: status || "in-progress",
      assignees: assignees || [],
      subTasks: subTasks || [],
      attachments
    });

    await newTask.save();

    await newTask.populate("assignees", "name profile_picture email");
    await newTask.populate("comments.user", "name profile_picture");

    return res.status(201).send(
      sendResponse(true, { ...newTask.toObject(), ...getTaskProgressData(newTask) }, "Task created")
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

const addSubTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const title = req.body.title?.trim();

    if (!title) {
      return res.status(400).send(sendResponse(false, null, "Subtask title is required"));
    };

    const task = await Task.findOne({ _id: id, user: userId, });

    if (!task) {
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    };

    task.subTasks.push({ title });

    // A completed task becomes active when new work is added.
    if (task.status === "done") {
      task.status = "in-progress";
    };

    await task.save();

    return res.status(201).send(
      sendResponse(
        true,
        getTaskProgressData(task),
        "Subtask added successfully"
      )
    );
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, error.message));
  }
};

const updateTask = async (req, res) => {
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
    let { title, project, description, dueDate, priority, status, assignees, subTasks, removeAttachments } = req.body;

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

    if (project === undefined) {
      return res.status(400).send(sendResponse(false, null, "Project is required"));
    };

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
    if (project !== undefined) task.project = project;
    if (description !== undefined) task.description = description;
    if (dueDate !== undefined) task.dueDate = dueDate;
    if (priority !== undefined) task.priority = priority;
    if (status !== undefined) task.status = status;
    if (assignees !== undefined) task.assignees = assignees;
    if (subTasks !== undefined) task.subTasks = subTasks;

    await task.save();
    await task.populate("assignees", "name profile_picture email");
    await task.populate("comments.user", "name profile_picture");

    return res.status(200).send(
      sendResponse(true, { ...task.toObject(), ...getTaskProgressData(task) }, "Task updated")
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

const updateSubTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id, subTaskId } = req.params;
    const { title, isCompleted } = req.body;

    const task = await Task.findOne({ _id: id, user: userId, });

    if (!task) {
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    };

    const subTask = task.subTasks.id(subTaskId);

    if (!subTask) {
      return res.status(404).send(sendResponse(false, null, "Subtask not found"));
    } ''

    if (title !== undefined) {
      if (typeof title !== "string" || !title.trim()) {
        return res.status(400).send(sendResponse(false, null, "Subtask title is required"));
      };

      subTask.title = title.trim();
    };

    if (isCompleted !== undefined) {
      if (typeof isCompleted !== "boolean") {
        return res.status(400).send(sendResponse(false, null, "isCompleted must be a boolean"));
      };

      subTask.isCompleted = isCompleted;
      subTask.completedAt = isCompleted ? new Date() : null;
    };

    const allCompleted = task.subTasks.length > 0 && task.subTasks.every((item) => item.isCompleted);

    if (allCompleted) {
      task.status = "done";
    } else if (task.status === "done") {
      task.status = "in-progress";
    };

    await task.save();

    return res.status(200).send(sendResponse(true, getTaskProgressData(task), "Subtask updated successfully"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, error.message));
  }
};

const deleteTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const taskId = req.params.id;

    const task = await Task.findOne({
      _id: taskId,
      user: userId,
    });

    if (!task) {
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    };

    // Delete files from Cloudinary before deleting the task.
    const attachments = task.attachments || [];

    await Promise.all(attachments.filter(
      (attachment) => attachment.public_id).map(
        (attachment) => cloudinary.uploader.destroy(attachment.public_id)
      )
    );

    await task.deleteOne();

    return res.status(200).send(sendResponse(true, null, "Task deleted"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, error.message));
  }
};

const deleteSubTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id, subTaskId } = req.params;

    const task = await Task.findOne({ _id: id, user: userId, });

    if (!task) {
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    };

    const subTask = task.subTasks.id(subTaskId);

    if (!subTask) {
      return res.status(404).send(sendResponse(false, null, "Subtask not found"));
    };

    subTask.deleteOne();

    const allCompleted = task.subTasks.length > 0 && task.subTasks.every((item) => item.isCompleted);

    if (allCompleted) {
      task.status = "done";
    } else if (task.status === "done") {
      task.status = "in-progress";
    };

    await task.save();

    return res.status(200).send(sendResponse(true, getTaskProgressData(task), "Subtask deleted successfully"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, error.message));
  }
};

const addComment = async (req, res) => {
  try {
    const userId = req.user.id;
    const taskId = req.params.id;
    const text = req.body.text?.trim();

    if (!text) {
      return res.status(400).send(sendResponse(false, null, "Comment text required"));
    };

    const task = await Task.findOne({
      _id: taskId,
      user: userId,
    });

    if (!task) {
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    };

    task.comments.push({
      user: userId,
      text,
    });

    await task.save();
    await task.populate("comments.user", "name profile_picture");

    const addedComment = task.comments[task.comments.length - 1];

    return res.status(201).send(
      sendResponse(true, addedComment, "Comment added")
    );
  } catch (error) {
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
    console.error(error.message);
    // Attempt cleanup if error occurs after upload
    if (req.files && req.files.length > 0) {
      await Promise.all(
        req.files.map((file) => cloudinary.uploader.destroy(file.filename))
      ).catch((e) => console.error("Cleanup failed", e));
    }
    return res.status(500).send(sendResponse(false, null, error.message));
  }
};

const deleteAttachment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id: taskId, attachmentId } = req.params;

    const task = await Task.findOne({
      _id: taskId,
      user: userId,
    });

    if (!task) {
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    };

    const attachment = task.attachments.id(attachmentId);

    if (!attachment) {
      return res.status(404).send(sendResponse(false, null, "Attachment not found"));
    };

    if (attachment.public_id) {
      await cloudinary.uploader.destroy(attachment.public_id);
    };

    attachment.deleteOne();
    await task.save();

    return res.status(200).send(sendResponse(
      true,
      task.attachments,
      "Attachment deleted successfully"
    ));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, error.message));
  }
};

const downloadAttachment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id: taskId, attachmentId } = req.params;

    const task = await Task.findOne({
      _id: taskId,
      user: userId,
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    const attachment = task.attachments.id(attachmentId);

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: "Attachment not found",
      });
    }

    const filename = path.basename(
      attachment.filename || "download"
    );

    const response = await axios.get(attachment.url, {
      responseType: "stream",
      timeout: 30000,
    });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );

    res.setHeader(
      "Content-Type",
      response.headers["content-type"] ||
      "application/octet-stream"
    );

    response.data.on("error", (error) => {
      console.error("File stream error:", error);
      if (!res.headersSent) res.sendStatus(502);
      else res.destroy(error);
    });

    response.data.pipe(res);
  } catch (error) {
    console.error("Download attachment error:", error.message);

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to download attachment",
      });
    }
  }
};

module.exports = {
  getTasks,
  getTaskById,
  createTask,
  addSubTask,
  updateTask,
  updateSubTask,
  deleteTask,
  deleteSubTask,
  addComment,
  addAttachment,
  deleteAttachment,
  downloadAttachment
};