const mongoose = require("mongoose");
const path = require("path");
const axios = require("axios");
const Task = require("../models/TaskModel");
const Project = require("../models/ProjectModel");
const WorkspaceMembership = require("../models/WorkspaceMembershipModel");
const { sendResponse } = require("../helper/sendResponse");
const { toTaskAttachment, destroyCloudinaryAssets } = require("../helper/cloudinaryAssets");
const { notifyTaskAssignees } = require("../helper/notifications");

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

const validateAssignees = async (workspaceId, assignees) => {
  if (!Array.isArray(assignees)) return "assignees must be an array of user IDs";
  if (assignees.some((id) => !mongoose.Types.ObjectId.isValid(id))) return "assignees contains an invalid user ID";
  const uniqueIds = [...new Set(assignees.map((id) => id.toString()))];
  if (uniqueIds.length !== assignees.length) return "assignees must not contain duplicate users";
  if (!assignees.length) return null;
  const activeCount = await WorkspaceMembership.countDocuments({
    workspace: workspaceId,
    user: { $in: assignees },
    status: "Active",
  });
  return activeCount === uniqueIds.length ? null : "All assignees must be active members of this workspace";
};

const updateCompletionAttribution = (task, previousStatus, userId) => {
  if (task.status === "done" && previousStatus !== "done") {
    task.completedBy = userId;
    task.completedAt = new Date();
  } else if (task.status !== "done") {
    task.completedBy = null;
    task.completedAt = null;
  }
};

const getTasks = async (req, res) => {
  const userId = req.user.id;
  const { status } = req.query;
  const { workspaceId } = req.params;
  try {
    const mongooseWorkspaceId = mongoose.Types.ObjectId.isValid(workspaceId);

    if (!mongooseWorkspaceId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Workspace Id"))
    };

    const workspaceMembership = await WorkspaceMembership.findOne({
      workspace: workspaceId,
      user: userId,
      status: "Active"
    });

    if (!workspaceMembership) {
      return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    };

    let filter = { workspace: workspaceId, isDeleted: false };

    if (status && ["in-progress", "paused", "done"].includes(status)) {
      filter.status = status;
    };

    const tasks = await Task.find(filter)
      .populate("assignees", "name profile_picture")
      .populate("completedBy", "name profile_picture")
      .lean(); // lean to modify objects

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
  const userId = req.user.id;
  const taskId = req.params.id;
  const { workspaceId } = req.params;
  try {
    const mongooseWorkspaceId = mongoose.Types.ObjectId.isValid(workspaceId);
    const mongooseTaskId = mongoose.Types.ObjectId.isValid(taskId);

    if (!mongooseWorkspaceId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Workspace Id"))
    };

    if (!mongooseTaskId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Task Id"))
    };

    const workspaceMembership = await WorkspaceMembership.findOne({
      workspace: workspaceId,
      user: userId,
      status: "Active"
    });

    if (!workspaceMembership) {
      return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    };

    const task = await Task.findOne({
      _id: taskId,
      workspace: workspaceId,
      isDeleted: false
    }).populate(
      "assignees", "name profile_picture email"
    ).populate(
      "completedBy", "name profile_picture"
    ).populate(
      "project"
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
      "Task fetched successfully"
    ));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  }
};

const createTask = async (req, res) => {
  const userId = req.user.id;
  const { workspaceId } = req.params;
  let taskSaved = false;
  try {
    const mongooseWorkspaceId = mongoose.Types.ObjectId.isValid(workspaceId);

    if (!mongooseWorkspaceId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Workspace Id"))
    };

    let { title, project, description, dueDate, priority, status, assignees, subTasks } = req.body;

    const formattedDueDate = new Date(dueDate);

    if (!dueDate || Number.isNaN(formattedDueDate.getTime())) {
      return res.status(400).send(sendResponse(false, null, "Invalid date type"));
    };

    const mongooseProjectId = mongoose.Types.ObjectId.isValid(project);

    if (!mongooseProjectId) {
      return res.status(400).send(sendResponse(false, null, "Invalid project Id"));
    };

    const workspaceMembership = await WorkspaceMembership.findOne({
      workspace: workspaceId,
      user: userId,
      status: "Active"
    });

    if (!workspaceMembership) {
      return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    };

    const projectExists = await Project.findOne({
      _id: project,
      workspace: workspaceId,
      isDeleted: false
    });

    if (!projectExists) {
      return res.status(404).send(sendResponse(false, null, "Project not found"));
    };

    // assignees and subTasks might be sent as JSON strings
    if (typeof assignees === "string") {
      try {
        assignees = JSON.parse(assignees);
      } catch {
        return res.status(400).send(sendResponse(false, null, "assignees must be valid JSON"));
      }
    };

    if (typeof subTasks === "string") {
      try {
        subTasks = JSON.parse(subTasks);
      } catch {
        subTasks = [];
      }
    };

    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).send(sendResponse(false, null, "Title is required"));
    };

    if (!["in-progress", "paused", "done"].includes(status)) {
      return res.status(400).send(sendResponse(false, null, "Invaild status value"));
    };

    if (!["low", "medium", "high"].includes(priority)) {
      return res.status(400).send(sendResponse(false, null, "Invaild priority value"));
    };

    if (assignees === undefined) assignees = [];
    const assigneeError = await validateAssignees(workspaceId, assignees);
    if (assigneeError) return res.status(400).send(sendResponse(false, null, assigneeError));

    const attachments = (req.files || []).map(toTaskAttachment);

    const newTask = new Task({
      createdBy: userId,
      title: title.trim(),
      project,
      description: description || "",
      dueDate: formattedDueDate,
      priority: priority,
      status: status,
      completedBy: status === "done" ? userId : null,
      completedAt: status === "done" ? new Date() : null,
      assignees,
      assignmentVersion: assignees.length ? 1 : 0,
      subTasks: subTasks || [],
      attachments,
      workspace: workspaceId
    });

    await newTask.save();
    taskSaved = true;
    if (assignees.length) {
      await notifyTaskAssignees({ io: req.app.get("io"), task: newTask, recipientIds: assignees, actor: userId });
    }

    await newTask.populate("assignees", "name profile_picture email");
    await newTask.populate("completedBy", "name profile_picture");
    await newTask.populate("comments.user", "name profile_picture");

    return res.status(201).send(
      sendResponse(true, { ...newTask.toObject(), ...getTaskProgressData(newTask) }, "Task created")
    );
  } catch (error) {
    console.error(error);
    return res.status(500).send(sendResponse(false, null, error.message));
  } finally {
    if (!taskSaved && req.files?.length > 0) {
      const { failures } = await destroyCloudinaryAssets(req.files);
      if (failures.length > 0) console.error("Failed to clean up task upload files:", failures);
    }
  }
};

const addSubTask = async (req, res) => {
  const userId = req.user.id;
  const { id, workspaceId } = req.params;
  const { title } = req.body
  try {
    const mongooseWorkspaceId = mongoose.Types.ObjectId.isValid(workspaceId);
    const mongooseTaskId = mongoose.Types.ObjectId.isValid(id);

    if (!mongooseWorkspaceId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Workspace Id"))
    };

    if (!mongooseTaskId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Task Id"))
    };

    const workspaceMembership = await WorkspaceMembership.findOne({
      workspace: workspaceId,
      user: userId,
      status: "Active"
    });

    if (!workspaceMembership) {
      return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    };

    if (typeof title !== "string") {
      return res.status(400).send(sendResponse(false, null, "Invalid subtask title type"));
    };

    if (!title.trim()) {
      return res.status(400).send(sendResponse(false, null, "Subtask title is required"));
    };

    const task = await Task.findOne({
      _id: id,
      workspace: workspaceId,
      isDeleted: false
    });

    if (!task) {
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    };

    const previousStatus = task.status;

    task.subTasks.push({ title: title.trim() });

    // A completed task becomes active when new work is added.
    if (task.status === "done") {
      task.status = "in-progress";
    };
    updateCompletionAttribution(task, previousStatus, userId);

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
  const userId = req.user.id;
  const taskId = req.params.id;
  const { workspaceId } = req.params;
  let { title, project, description, dueDate, priority, status, assignees, subTasks, removeAttachments } = req.body;
  const newlyUploadedFiles = req.files || [];
  let taskSaved = false;
  try {
    const mongooseWorkspaceId = mongoose.Types.ObjectId.isValid(workspaceId);
    const mongooseTaskId = mongoose.Types.ObjectId.isValid(taskId);

    if (!mongooseWorkspaceId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Workspace Id"))
    };

    if (!mongooseTaskId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Task Id"))
    };

    const workspaceMembership = await WorkspaceMembership.findOne({
      workspace: workspaceId,
      user: userId,
      status: "Active"
    });

    if (!workspaceMembership) {
      return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    };

    const task = await Task.findOne({
      _id: taskId,
      workspace: workspaceId,
      isDeleted: false
    });

    if (!task) {
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    };

    const previousStatus = task.status;
    const previousAssigneeIds = new Set(task.assignees.map((assignee) => assignee.toString()));
    let newlyAssignedIds = [];

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
      return res.status(400).send(sendResponse(false, null, err.message));
    }

    if (removeAttachments !== undefined && !Array.isArray(removeAttachments)) {
      return res.status(400).send(sendResponse(false, null, "removeAttachments must be an array"));
    };

    let attachmentsToDelete = [];

    if (Array.isArray(removeAttachments)) {
      const removeIds = removeAttachments.filter(
        id => typeof id === "string"
      );

      attachmentsToDelete = task.attachments.filter(att =>
        removeIds.includes(att._id.toString())
      );

      task.attachments = task.attachments.filter(
        att => !removeIds.includes(att._id.toString())
      );
    }

    if (req.files && req.files.length > 0) {
      const newAttachments = req.files.map(toTaskAttachment);
      task.attachments.push(...newAttachments);
    }

    // --- Update other fields ---
    if (title !== undefined) {
      if (typeof title !== "string") {
        return res.status(400).send(sendResponse(false, null, "Invalid title type"));
      };
      if (!title.trim()) {
        return res.status(400).send(sendResponse(false, null, "Title cannot be empty"));
      }
      task.title = title.trim();
    };
    if (description !== undefined) {
      if (typeof description !== "string") {
        return res.status(400).send(sendResponse(false, null, "Invalid description type"));
      };
      task.description = description.trim();
    };
    if (project !== undefined) {
      const mongooseProjectId = mongoose.Types.ObjectId.isValid(project);
      if (!mongooseProjectId) {
        return res.status(400).send(sendResponse(false, null, "Invalid project Id"));
      };
      const projectExists = await Project.findOne({
        _id: project,
        workspace: workspaceId,
        isDeleted: false
      });
      if (!projectExists) {
        return res.status(404).send(sendResponse(false, null, "Project not found"));
      };
      task.project = project
    };
    if (dueDate !== undefined) {
      const newDate = new Date(dueDate);
      if (Number.isNaN(newDate.getTime())) {
        return res.status(400).send(sendResponse(false, null, "Invalid date type"));
      }
      task.dueDate = newDate
    };
    if (priority !== undefined) {
      if (!["low", "medium", "high"].includes(priority)) {
        return res.status(400).send(sendResponse(false, null, "Invalid priority value"));
      };
      task.priority = priority
    };
    if (status !== undefined) {
      if (!["in-progress", "paused", "done"].includes(status)) {
        return res.status(400).send(sendResponse(false, null, "Invalid status value"));
      };
      task.status = status
    };
    if (assignees !== undefined) {
      const assigneeError = await validateAssignees(workspaceId, assignees);
      if (assigneeError) return res.status(400).send(sendResponse(false, null, assigneeError));
      newlyAssignedIds = assignees.map((assignee) => assignee.toString()).filter((assignee) => !previousAssigneeIds.has(assignee));
      if (newlyAssignedIds.length) task.assignmentVersion = (task.assignmentVersion || 0) + 1;
      task.assignees = assignees;
    }
    if (subTasks !== undefined) task.subTasks = subTasks;
    updateCompletionAttribution(task, previousStatus, userId);

    const { failures: attachmentDeleteFailures } = await destroyCloudinaryAssets(attachmentsToDelete);
    if (attachmentDeleteFailures.length > 0) {
      console.error("Task attachment cleanup failed:", attachmentDeleteFailures);
      return res.status(502).send(sendResponse(false, null, "One or more removed files could not be deleted. The task was not updated; retry the change."));
    }

    await task.save();
    taskSaved = true;
    if (newlyAssignedIds.length) {
      await notifyTaskAssignees({ io: req.app.get("io"), task, recipientIds: newlyAssignedIds, actor: userId });
    }
    await task.populate("assignees", "name profile_picture email");
    await task.populate("completedBy", "name profile_picture");
    await task.populate("comments.user", "name profile_picture");

    return res.status(200).send(
      sendResponse(true, { ...task.toObject(), ...getTaskProgressData(task) }, "Task updated")
    );
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  } finally {
    if (!taskSaved && newlyUploadedFiles.length > 0) {
      const { failures } = await destroyCloudinaryAssets(newlyUploadedFiles);
      if (failures.length > 0) console.error("Failed to clean up task update uploads:", failures);
    }
  };
};

const updateSubTask = async (req, res) => {
  const userId = req.user.id;
  const { id, subTaskId, workspaceId } = req.params;
  const { title, isCompleted } = req.body;
  try {
    const mongooseWorkspaceId = mongoose.Types.ObjectId.isValid(workspaceId);
    const mongooseTaskId = mongoose.Types.ObjectId.isValid(id);
    const mongooseSubTaskId = mongoose.Types.ObjectId.isValid(subTaskId);

    if (!mongooseWorkspaceId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Workspace Id"))
    };

    if (!mongooseTaskId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Task Id"))
    };

    if (!mongooseSubTaskId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Subtask Id"))
    };

    const workspaceMembership = await WorkspaceMembership.findOne({
      workspace: workspaceId,
      user: userId,
      status: "Active"
    });

    if (!workspaceMembership) {
      return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    };

    const task = await Task.findOne({
      _id: id,
      workspace: workspaceId,
      isDeleted: false
    });

    if (!task) {
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    };

    const previousStatus = task.status;

    const subTask = task.subTasks.id(subTaskId);

    if (!subTask) {
      return res.status(404).send(sendResponse(false, null, "Subtask not found"));
    };

    if (title !== undefined) {
      if (typeof title !== "string") {
        return res.status(400).send(sendResponse(false, null, "Invalid title type"));
      };
      if (!title.trim()) {
        return res.status(400).send(sendResponse(false, null, "Title is required"));
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

    updateCompletionAttribution(task, previousStatus, userId);

    await task.save();
    await task.populate("completedBy", "name profile_picture");

    return res.status(200).send(sendResponse(true, getTaskProgressData(task), "Subtask updated successfully"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, error.message));
  };
};

const deleteTask = async (req, res) => {
  const userId = req.user.id;
  const { id: taskId, workspaceId } = req.params;
  try {
    const mongooseWorkspaceId = mongoose.Types.ObjectId.isValid(workspaceId);
    const mongooseTaskId = mongoose.Types.ObjectId.isValid(taskId);

    if (!mongooseWorkspaceId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Workspace Id"))
    };

    if (!mongooseTaskId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Task Id"))
    };

    const workspaceMembership = await WorkspaceMembership.findOne({
      workspace: workspaceId,
      user: userId,
      status: "Active"
    });

    if (!workspaceMembership) {
      return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    };

    const task = await Task.findOne({
      _id: taskId,
      workspace: workspaceId,
      isDeleted: false
    });

    if (!task) {
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    };

    const attachments = task.attachments || [];
    const { failures } = await destroyCloudinaryAssets(attachments);
    if (failures.length > 0) {
      console.error("Task attachment cleanup failed:", failures);
      return res.status(502).send(sendResponse(false, null, "Task files could not all be deleted. The task was kept; retry the deletion."));
    }

    await task.deleteOne();

    return res.status(200).send(sendResponse(true, null, "Task deleted"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, error.message));
  }
};

const deleteSubTask = async (req, res) => {
  const userId = req.user.id;
  const { id, subTaskId, workspaceId } = req.params;
  try {
    const mongooseWorkspaceId = mongoose.Types.ObjectId.isValid(workspaceId);
    const mongooseTaskId = mongoose.Types.ObjectId.isValid(id);
    const mongooseSubTaskId = mongoose.Types.ObjectId.isValid(subTaskId);

    if (!mongooseWorkspaceId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Workspace Id"))
    };

    if (!mongooseTaskId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Task Id"))
    };

    if (!mongooseSubTaskId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Subtask Id"))
    };

    const workspaceMembership = await WorkspaceMembership.findOne({
      workspace: workspaceId,
      user: userId,
      status: "Active"
    });

    if (!workspaceMembership) {
      return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    };

    const task = await Task.findOne({
      _id: id,
      workspace: workspaceId,
      isDeleted: false
    });

    if (!task) {
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    };

    const previousStatus = task.status;

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

    updateCompletionAttribution(task, previousStatus, userId);

    await task.save();
    await task.populate("completedBy", "name profile_picture");

    return res.status(200).send(sendResponse(true, getTaskProgressData(task), "Subtask deleted successfully"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, error.message));
  }
};

const addComment = async (req, res) => {
  const userId = req.user.id;
  const { id: taskId, workspaceId } = req.params;
  const { text } = req.body;
  try {
    const mongooseWorkspaceId = mongoose.Types.ObjectId.isValid(workspaceId);
    const mongooseTaskId = mongoose.Types.ObjectId.isValid(taskId);

    if (!mongooseWorkspaceId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Workspace Id"))
    };

    if (!mongooseTaskId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Task Id"))
    };

    const workspaceMembership = await WorkspaceMembership.findOne({
      workspace: workspaceId,
      user: userId,
      status: "Active"
    });

    if (!workspaceMembership) {
      return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    };

    if (typeof text !== "string") {
      return res.status(400).send(sendResponse(false, null, "Invalid text type"));
    };

    if (!text.trim()) {
      return res.status(400).send(sendResponse(false, null, "Comment text required"));
    };

    const task = await Task.findOne({
      _id: taskId,
      workspace: workspaceId,
      isDeleted: false
    });

    if (!task) {
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    };

    task.comments.push({
      user: userId,
      text: text.trim(),
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
  const userId = req.user.id;
  const { id: taskId, workspaceId } = req.params;
  const newlyUploadedFiles = req.files || [];
  let taskSaved = false;
  try {
    const mongooseWorkspaceId = mongoose.Types.ObjectId.isValid(workspaceId);
    const mongooseTaskId = mongoose.Types.ObjectId.isValid(taskId);

    if (!mongooseWorkspaceId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Workspace Id"))
    };

    if (!mongooseTaskId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Task Id"))
    };

    const workspaceMembership = await WorkspaceMembership.findOne({
      workspace: workspaceId,
      user: userId,
      status: "Active"
    });

    if (!workspaceMembership) {
      return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    };

    const task = await Task.findOne({
      _id: taskId,
      workspace: workspaceId,
      isDeleted: false
    });

    if (!task) {
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    }

    // Build new attachments from uploaded files
    const newAttachments = (req.files || []).map(toTaskAttachment);

    if (newAttachments.length === 0) {
      return res.status(400).send(sendResponse(false, null, "No files uploaded"));
    }

    // Add them to the task's attachments array
    task.attachments.push(...newAttachments);
    await task.save();
    taskSaved = true;

    return res.status(201).send(sendResponse(true, task.attachments, "Attachments added"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "INternal server error"));
  } finally {
    if (!taskSaved && newlyUploadedFiles.length > 0) {
      const { failures } = await destroyCloudinaryAssets(newlyUploadedFiles);
      if (failures.length > 0) console.error("Failed to clean up attachment uploads:", failures);
    }
  }
};

const deleteAttachment = async (req, res) => {
  const userId = req.user.id;
  const { id: taskId, attachmentId, workspaceId } = req.params;
  try {
    const mongooseWorkspaceId = mongoose.Types.ObjectId.isValid(workspaceId);
    const mongooseTaskId = mongoose.Types.ObjectId.isValid(taskId);
    const mongooseAttachmentId = mongoose.Types.ObjectId.isValid(attachmentId);

    if (!mongooseWorkspaceId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Workspace Id"))
    };

    if (!mongooseTaskId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Task Id"))
    };

    if (!mongooseAttachmentId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Attachment Id"));
    };

    const workspaceMembership = await WorkspaceMembership.findOne({
      workspace: workspaceId,
      user: userId,
      status: "Active"
    });

    if (!workspaceMembership) {
      return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    };

    const task = await Task.findOne({
      _id: taskId,
      workspace: workspaceId,
      isDeleted: false
    });

    if (!task) {
      return res.status(404).send(sendResponse(false, null, "Task not found"));
    };

    const attachment = task.attachments.id(attachmentId);

    if (!attachment) {
      return res.status(404).send(sendResponse(false, null, "Attachment not found"));
    };

    const { failures } = await destroyCloudinaryAssets([attachment]);
    if (failures.length > 0) {
      console.error("Attachment cleanup failed:", failures);
      return res.status(502).send(sendResponse(false, null, "Attachment could not be deleted from storage. It was kept on the task; retry the deletion."));
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
  const userId = req.user.id;
  const { id: taskId, attachmentId, workspaceId } = req.params;
  try {
    const mongooseWorkspaceId = mongoose.Types.ObjectId.isValid(workspaceId);
    const mongooseTaskId = mongoose.Types.ObjectId.isValid(taskId);
    const mongooseAttachmentId = mongoose.Types.ObjectId.isValid(attachmentId);

    if (!mongooseWorkspaceId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Workspace Id"))
    };

    if (!mongooseTaskId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Task Id"))
    };

    if (!mongooseAttachmentId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Attachment Id"));
    };

    const workspaceMembership = await WorkspaceMembership.findOne({
      workspace: workspaceId,
      user: userId,
      status: "Active"
    });

    if (!workspaceMembership) {
      return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    };

    const task = await Task.findOne({
      _id: taskId,
      workspace: workspaceId,
      isDeleted: false
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
