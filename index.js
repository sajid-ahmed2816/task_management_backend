const express = require('express');
const mongoose = require('mongoose');
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
require('dotenv').config();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

let databaseConnection;
const connectToDatabase = async () => {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!databaseConnection) {
    databaseConnection = mongoose.connect(process.env.MONGO_URI).catch((error) => {
      databaseConnection = null;
      throw error;
    });
  }
  return databaseConnection;
};

app.set("io", io);
io.use(async (_socket, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (error) {
    console.error("Socket database connection failed:", error);
    next(new Error("Database unavailable"));
  }
});
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
app.use(async (_req, _res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (error) {
    next(error);
  }
});
app.use("/api/auth", authRoute);
app.use("/api", fileRoute);
app.use("/api/tasks", taskRoute);
app.use("/api/projects", projectRoute);
app.use("/api/workspaces", workspaceRoute);
app.use("/api/workspace-members", membersRoute);
app.use("/api/chats", chatRoute);
app.use("/api/notifications", notificationRoute);

app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  console.error("Unhandled request error:", error);
  return res.status(500).json({ status: false, data: null, message: "Internal server error" });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  connectToDatabase().then(() => {
    server.listen(port, () => {
      console.log(`Database connected successfully and server listening on port ${port}`);
    });
  }).catch((error) => {
    console.error("Database connection failed:", error);
    process.exitCode = 1;
  });
}

module.exports = server;
