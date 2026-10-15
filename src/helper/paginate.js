const paginate = async ({
  model,
  query = {},
  page = 1,
  limit = 10,
  sort = { createdAt: -1 },
  populate = null
}) => {
  const pageNumber = parseInt(page);
  const limitNumber = parseInt(limit);
  const skip = (pageNumber - 1) * limitNumber;

  let dbQuery = model.find(query).skip(skip).limit(limitNumber).sort(sort);

  if (populate) {
    dbQuery = dbQuery.populate(populate);
  };

  const [data, total] = await Promise.all([dbQuery, model.countDocuments(query)]);

  return {
    data,
    pagination: {
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber)
    }
  };
};

module.exports = paginate;