const express = require('express');
const mongoose = require('mongoose');
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
require('dotenv').config();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
app.set("io", io);
require("./src/realtime/chat-socket")(io);

const fileRoute = require("./src/routes/files-routes");
const authRoute = require("./src/routes/auth-routes");
const taskRoute = require("./src/routes/task-routes");
const projectRoute = require("./src/routes/project-routes");
const workspaceRoute = require("./src/routes/workspace-routes");
const membersRoute = require("./src/routes/members-routes")
const chatRoute = require("./src/routes/chat-routes");
const notificationRoute = require("./src/routes/notification-routes");

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoute);
app.use("/api", fileRoute);
app.use("/api/tasks", taskRoute);
app.use("/api/projects", projectRoute);
app.use("/api/workspaces", workspaceRoute);
app.use("/api/workspace-members", membersRoute);
app.use("/api/chats", chatRoute);
app.use("/api/notifications", notificationRoute);

mongoose.connect(process.env.MONGO_URI).then((
  server.listen(process.env.PORT, () => {
    console.log(`Database connected successfully and server connected on Port ${process.env.PORT}`);
  })
)).catch((err) => {
  console.log(err);
});
