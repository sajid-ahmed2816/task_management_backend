const jwt = require("jsonwebtoken");
const { sendResponse } = require("../helper/sendResponse");

const JWT_SECRET = process.env.JWT_SECRET;

const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).send(sendResponse(false, null, "No token provided"));
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).send(sendResponse(false, null, "Invalid or expired token"));
  }
};

module.exports = authenticate;