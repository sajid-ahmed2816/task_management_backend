const Project = require("../models/ProjectModel");
const Task = require("../models/TaskModel");
const { sendResponse } = require("../helper/sendResponse");
const paginate = require("../helper/paginate");

const createProject = async (req, res) => {
  const userId = req.user.id
  try {
    const { name, description, startDate, dueDate, status, priority, user, color, link } = req.body;
    const obj = { name, description, startDate, dueDate, user };
    const reqArr = ["name", "description", "startDate", "dueDate", "user"];
    const errArr = [];

    reqArr.forEach((el) => {
      if (!obj[el]) {
        errArr.push(el);
      };
    });

    if (errArr.length > 0) {
      return res.status(400).send(sendResponse(false, null, "Missing required data"));
    };

    const project = new Project({
      name,
      description,
      startDate,
      dueDate,
      status,
      priority,
      user: userId,
      color,
      link
    });

    await project.save();

    return res.status(201).send(sendResponse(true, project, "Project created successfully"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error", error));
  };
};

const getProjects = async (req, res) => {
  const userId = req.user.id
  try {
    const { page = 1, limit = 10, startDate, dueDate, search = "" } = req.query;
    const normalizeArray = (value) => {
      if (!value) return [];
      return Array.isArray(value) ? value : [value];
    };

    const status = normalizeArray(req.query.status ?? req.query["status[]"]);
    const priority = normalizeArray(req.query.priority ?? req.query["priority[]"]);

    let filter = { user: userId };

    // Filter by project start date
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);

      filter.startDate = {
        $gte: start,
      };
    };

    // Filter by project due date
    if (dueDate) {
      const end = new Date(dueDate);
      end.setHours(23, 59, 59, 999);

      filter.dueDate = {
        $lte: end,
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

    const finalLimit = limit === "all" ? Number.MAX_SAFE_INTEGER : parseInt(limit);

    const result = await paginate({
      query: filter,
      model: Project,
      page: parseInt(page),
      limit: finalLimit,
      populate: [{
        path: "user",
        select: "name email phone_number profile_picture"
      }]
    });

    return res.status(200).send(
      sendResponse(
        true,
        {
          projects: result.data,
          pagination: result.pagination
        },
        "Projects fetched successfully"
      )
    );
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error", error));
  };
};

const getProjectById = async (req, res) => {
  const userId = req.user.id;
  try {
    const projectId = req.params.id;

    const projectData = await Project.findOne({
      _id: projectId,
      user: userId
    }).populate("user", "name email phone_number profile_picture");

    if (!projectData) {
      return res.status(404).send(sendResponse(false, null, "Project not found"));
    };

    const task = await Task.find({ isDeleted: false, project: projectId }).lean();
    const project = projectData.toObject();
    const obj = { ...project, task };

    return res.status(200).send(sendResponse(true, obj, "Project fetched successfully"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error", error));
  };
};

const updateProject = async (req, res) => {
  const userId = req.user.id;
  try {
    const projectId = req.params.id;

    const project = await Project.findOne({ _id: projectId, user: userId });

    if (!project) {
      return res.status(404).send(sendResponse(false, null, "Project not found"));
    };

    const { name, description, startDate, dueDate, status, priority, user, color, link } = req.body;

    if (name !== undefined) project.name = name;
    if (description !== undefined) project.description = description;
    if (startDate !== undefined) project.startDate = startDate;
    if (dueDate !== undefined) project.dueDate = dueDate;
    if (status !== undefined) project.status = status;
    if (priority !== undefined) project.priority = priority;
    if (user !== undefined) project.user = user;
    if (color !== undefined) project.color = color;
    if (link !== undefined) project.link = link;

    await project.save();
    await project.populate("user", "user email phone_number profile_picture");

    return res.status(200).send(sendResponse(true, project, "Project updated successfully"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error", error));
  };
};

const deleteProject = async (req, res) => {
  const userId = req.user.id;
  try {
    const projectId = req.params.id;

    const project = await Project.findOne({ _id: projectId, user: userId, isDeleted: false });

    if (!project) {
      return res.status(404).send(sendResponse(false, null, "Project not found"));
    };

    const task = await Task.exists({ user: userId, project: projectId, isDeleted: false });

    if (task) {
      await Task.updateMany(
        { user: userId, project: projectId, isDeleted: false },
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