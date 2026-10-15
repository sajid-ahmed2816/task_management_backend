const Project = require("../models/ProjectModel");
const { sendResponse } = require("../helper/sendResponse");

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
  try {
    const userId = req.user.id
    let filter = { user: userId };

    const projects = await Project.find(filter).populate("user", "name email phone_number profile_picture").lean();

    return res.status(200).send(sendResponse(true, { projects }, "Projects fetched successfully"));
  } catch (error) {
    console.log("getProjects ~ error:", error)
    return res.status(500).send(sendResponse(false, null, "Internal server error", error));
  };
};

const getProjectById = async (req, res) => {
  try {
    const userId = req.user.id;
    const projectId = req.params.id;

    const project = await Project.findOne({
      _id: projectId,
      user: userId
    }).populate("user", "name email phone_number profile_picture");

    if (!project) {
      return res.status(404).send(sendResponse(false, null, "Project not found"));
    };

    return res.status(200).send(sendResponse(true, project, "Project fetched successfully"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error", error));
  };
};

const updateProject = async (req, res) => {
  try {
    const userId = req.user.id;
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
  try {
    const userId = req.user.id;
    const projectId = req.params.id;

    const project = await Project.findOne({ _id: projectId, user: userId });

    if (!project) {
      return res.status(404).send(sendResponse(false, null, "Project not found"));
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