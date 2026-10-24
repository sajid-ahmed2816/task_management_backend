const mongoose = require("mongoose");
const Project = require("../models/ProjectModel");
const Task = require("../models/TaskModel");
const WorkspaceMembership = require("../models/WorkspaceMembershipModel");
const { sendResponse } = require("../helper/sendResponse");
const paginate = require("../helper/paginate");

const createProject = async (req, res) => {
  const userId = req.user.id
  const { workspaceId } = req.params;
  console.log("🚀 ~ createProject ~ workspaceId:", workspaceId)
  try {
    const mongooseWorkspaceId = mongoose.Types.ObjectId.isValid(workspaceId);

    if (!mongooseWorkspaceId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Workspace Id"))
    };

    const { name, description, startDate, dueDate, status, priority, color, link } = req.body;

    if (typeof name !== "string" || typeof description !== "string") {
      return res.status(400).send(sendResponse(false, null, "Invalid data type"));
    };

    const obj = { name: name.trim(), description: description.trim(), startDate, dueDate };
    const reqArr = ["name", "description", "startDate", "dueDate"];
    const errArr = [];

    reqArr.forEach((el) => {
      if (!obj[el]) {
        errArr.push(el);
      };
    });

    if (errArr.length > 0) {
      return res.status(400).send(sendResponse(false, null, "Missing required data"));
    };


    const formattedStartDate = new Date(startDate);
    const formattedDueDate = new Date(dueDate);

    if (Number.isNaN(formattedStartDate.getTime()) || Number.isNaN(formattedDueDate.getTime())) {
      return res.status(400).send(sendResponse(false, null, "Invalid date"))
    };

    if (formattedDueDate < formattedStartDate) {
      return res.status(400).send(sendResponse(false, null, "Due date cannot be before start date"));
    };

    const workspaceMembership = await WorkspaceMembership.findOne({
      workspace: workspaceId,
      user: userId,
      status: "Active"
    });

    if (!workspaceMembership) {
      return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    };

    const project = new Project({
      name: obj.name,
      description: obj.description,
      startDate: formattedStartDate,
      dueDate: formattedDueDate,
      status,
      priority,
      createdBy: userId,
      color,
      link,
      workspace: workspaceId
    });

    await project.save();

    return res.status(201).send(sendResponse(true, project, "Project created successfully"));
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).send(sendResponse(false, null, "Invalid input"));
    }
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  };
};

const getProjects = async (req, res) => {
  const userId = req.user.id;
  const { workspaceId } = req.params;
  try {
    const mongooseWorkspaceId = mongoose.Types.ObjectId.isValid(workspaceId);

    if (!mongooseWorkspaceId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Workspace Id"))
    };

    const normalizeArray = (value) => {
      if (!value) return [];
      return Array.isArray(value) ? value : [value];
    };

    const { page = 1, limit = 10, startDate, dueDate, search = "" } = req.query;
    const status = normalizeArray(req.query.status ?? req.query["status[]"]);
    const priority = normalizeArray(req.query.priority ?? req.query["priority[]"]);
    const formattedPage = Number(page);
    const formattedLimit = limit === "all" ? limit : Number(limit);

    if (typeof search !== "string") {
      return res.status(400).send(sendResponse(false, null, "Invalid input type"))
    };

    if (status.some((st) => !["planning", "active", "on_hold", "completed", "cancelled"].includes(st))) {
      return res.status(400).send(sendResponse(false, null, "Invalid status value"))
    };

    if (priority.some((pr) => !["urgent", "high", "medium", "low"].includes(pr))) {
      return res.status(400).send(sendResponse(false, null, "Invalid priority value"))
    };

    let formattedStartDate;
    let formattedDueDate;

    if (startDate) {
      formattedStartDate = new Date(startDate);
    };

    if (dueDate) {
      formattedDueDate = new Date(dueDate);
    };

    if (startDate && Number.isNaN(formattedStartDate.getTime())) {
      return res.status(400).send(sendResponse(false, null, "Invalid date type"));
    };

    if (dueDate && Number.isNaN(formattedDueDate.getTime())) {
      return res.status(400).send(sendResponse(false, null, "Invalid date type"));
    };

    if (startDate && dueDate) {
      if (formattedDueDate < formattedStartDate) {
        return res.status(400).send(sendResponse(false, null, "Due date cannot be before start date"));
      };
    };

    let filter = { workspace: workspaceId, isDeleted: false };

    // Filter by project start date
    if (startDate) {
      formattedStartDate.setHours(0, 0, 0, 0);

      filter.startDate = {
        $gte: formattedStartDate,
      };
    };

    // Filter by project due date
    if (dueDate) {
      formattedDueDate.setHours(23, 59, 59, 999);

      filter.dueDate = {
        $lte: formattedDueDate,
      };
    };

    // Filter by multiple statuses
    if (status.length > 0) {
      filter.status = {
        $in: status,
      };
    };

    // Filter by multiple priorities
    if (priority.length > 0) {
      filter.priority = {
        $in: priority,
      };
    };

    // Filter by name search
    if (search.trim()) {
      filter.name = {
        $regex: search.trim(),
        $options: "i",
      };
    };

    const workspaceMembership = await WorkspaceMembership.findOne({
      workspace: workspaceId,
      user: userId,
      status: "Active"
    });

    if (!workspaceMembership) {
      return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    };

    if (!Number.isInteger(formattedPage) || (!Number.isInteger(formattedLimit) && formattedLimit !== "all" && formattedLimit <= 0) || formattedPage <= 0) {
      return res.status(400).send(sendResponse(false, null, "Invalid page or limit type"));
    };

    const finalLimit = formattedLimit === "all" ? Number.MAX_SAFE_INTEGER : formattedLimit;

    const result = await paginate({
      query: filter,
      model: Project,
      page: formattedPage,
      limit: finalLimit,
      populate: [{
        path: "createdBy",
        select: "name email phone_number profile_picture"
      }]
    });

    return res.status(200).send(sendResponse(
      true,
      {
        projects: result.data,
        pagination: result.pagination
      },
      "Projects fetched successfully"
    ));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  };
};

const getProjectById = async (req, res) => {
  const userId = req.user.id;
  const projectId = req.params.id;
  const { workspaceId } = req.params;
  try {
    const mongooseWorkspaceId = mongoose.Types.ObjectId.isValid(workspaceId);
    const mongooseProjectId = mongoose.Types.ObjectId.isValid(projectId);

    if (!mongooseWorkspaceId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Workspace Id"));
    };

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

    const projectData = await Project.findOne({
      _id: projectId,
      workspace: workspaceId,
      isDeleted: false
    }).populate("createdBy", "name email phone_number profile_picture");

    if (!projectData) {
      return res.status(404).send(sendResponse(false, null, "Project not found"));
    };

    const task = await Task.find({ isDeleted: false, project: projectId, workspace: workspaceId }).lean();
    const project = projectData.toObject();
    const obj = { ...project, task };

    return res.status(200).send(sendResponse(true, obj, "Project fetched successfully"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error", error));
  };
};

const updateProject = async (req, res) => {
  const userId = req.user.id;
  const projectId = req.params.id;
  const { workspaceId } = req.params;
  try {
    const mongooseWorkspaceId = mongoose.Types.ObjectId.isValid(workspaceId);
    const mongooseProjectId = mongoose.Types.ObjectId.isValid(projectId);

    if (!mongooseWorkspaceId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Workspace Id"))
    };

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

    const project = await Project.findOne({
      _id: projectId,
      workspace: workspaceId,
      isDeleted: false
    });

    if (!project) {
      return res.status(404).send(sendResponse(false, null, "Project not found"));
    };

    const { name, description, startDate, dueDate, status, priority, color, link } = req.body;

    let formattedStartDate = project.startDate;
    let formattedDueDate = project.dueDate;

    if (name !== undefined) {
      if (typeof name !== "string") {
        return res.status(400).send(sendResponse(false, null, "Invalid name data type"));
      };
      const trimmedName = name.trim();
      if (!trimmedName) {
        return res.status(400).send(sendResponse(false, null, "Name should not be empty"));
      };
      project.name = trimmedName;
    };
    if (description !== undefined) {
      if (typeof description !== "string") {
        return res.status(400).send(sendResponse(false, null, "Invalid description data type"));
      };
      const trimmedDescription = description.trim();
      if (!trimmedDescription) {
        return res.status(400).send(sendResponse(false, null, "description should not be empty"));
      };
      project.description = trimmedDescription
    };
    if (startDate !== undefined) {
      const newDate = new Date(startDate);
      project.startDate = newDate;
      formattedStartDate = newDate;
    };
    if (dueDate !== undefined) {
      const newDate = new Date(dueDate);
      project.dueDate = newDate;
      formattedDueDate = newDate;
    };
    if (status !== undefined) {
      const isValidStatusValue = ["planning", "active", "on_hold", "completed", "cancelled"].includes(status);
      if (!isValidStatusValue) {
        return res.status(400).send(sendResponse(false, null, "Invalid status value"));
      };
      project.status = status;
    };
    if (priority !== undefined) {
      const isValidPriorityValue = ["urgent", "high", "medium", "low"].includes(priority);
      if (!isValidPriorityValue) {
        return res.status(400).send(sendResponse(false, null, "Invalid priority value"));
      };
      project.priority = priority
    };
    if (color !== undefined) project.color = color;
    if (link !== undefined) project.link = link;

    if (Number.isNaN(formattedStartDate.getTime()) || Number.isNaN(formattedDueDate.getTime())) {
      return res.status(400).send(sendResponse(false, null, "Invalid date type"));
    };

    if (formattedDueDate < formattedStartDate) {
      return res.status(400).send(sendResponse(false, null, "Due date cannot be before start date"));
    };

    await project.save();
    await project.populate("createdBy", "name email phone_number profile_picture");

    return res.status(200).send(sendResponse(true, project, "Project updated successfully"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error", error));
  };
};

const deleteProject = async (req, res) => {
  const userId = req.user.id;
  const projectId = req.params.id;
  const { workspaceId } = req.params;
  try {
    const mongooseWorkspaceId = mongoose.Types.ObjectId.isValid(workspaceId);
    const mongooseProjectId = mongoose.Types.ObjectId.isValid(projectId);

    if (!mongooseWorkspaceId) {
      return res.status(400).send(sendResponse(false, null, "Invalid Workspace Id"))
    };

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

    const project = await Project.findOne({
      _id: projectId,
      workspace: workspaceId,
      isDeleted: false
    });

    if (!project) {
      return res.status(404).send(sendResponse(false, null, "Project not found"));
    };

    const task = await Task.exists({ workspace: workspaceId, project: projectId, isDeleted: false });

    if (task) {
      await Task.updateMany(
        { workspace: workspaceId, project: projectId, isDeleted: false },
        {
          $set: {
            isDeleted: true
          }
        }
      );
      project.isDeleted = true;
      await project.save();
      return res.status(200).send(sendResponse(true, null, "Project and its task deleted successfully"));
    };

    await project.deleteOne();

    return res.status(200).send(sendResponse(true, null, "Project deleted successfully"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error", error));
  };
};

module.exports = {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject
};