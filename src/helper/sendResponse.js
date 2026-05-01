const sendResponse = (status, data, message, error) => {
  const responseObj = {
    status: null,
    data: null,
    message: "",
    error: "",
  };

  responseObj.status = status;
  responseObj.data = data;
  responseObj.message = message;
  responseObj.error = error;

  if (Array.isArray(data)) {
    responseObj.count = data.length;
  }
  return responseObj;
};

module.exports = { sendResponse };
