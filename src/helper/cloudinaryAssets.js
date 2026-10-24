const path = require("path");
const cloudinary = require("../config/cloudinaryConfig");

const RESOURCE_TYPES = new Set(["image", "raw", "video"]);

const getCloudinaryResourceType = (url) => {
  if (typeof url !== "string" || !url) return null;

  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const uploadIndex = segments.indexOf("upload");
    const resourceType = segments[uploadIndex - 1];
    return RESOURCE_TYPES.has(resourceType) ? resourceType : null;
  } catch (error) {
    return null;
  }
};

const getCloudinaryPublicIdFromUrl = (url, resourceType) => {
  if (typeof url !== "string" || !url) return null;

  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const uploadIndex = segments.indexOf("upload");
    if (uploadIndex === -1 || !RESOURCE_TYPES.has(resourceType)) return null;

    const afterUpload = segments.slice(uploadIndex + 1);
    const versionIndex = afterUpload.findIndex((segment) => /^v\d+$/.test(segment));
    const publicIdSegments = versionIndex === -1
      ? afterUpload
      : afterUpload.slice(versionIndex + 1);
    if (publicIdSegments.length === 0) return null;

    let publicId = decodeURIComponent(publicIdSegments.join("/"));
    if (resourceType !== "raw") {
      publicId = publicId.replace(/\.[^/.]+$/, "");
    }
    return publicId || null;
  } catch (error) {
    return null;
  }
};

const getCloudinaryAssetDetails = (asset = {}) => {
  const url = asset.url || asset.path;
  const resourceType = RESOURCE_TYPES.has(asset.resource_type)
    ? asset.resource_type
    : getCloudinaryResourceType(url);
  if (!resourceType) return null;

  let publicId = asset.public_id
    || (asset.path ? asset.filename : null)
    || getCloudinaryPublicIdFromUrl(url, resourceType);
  if (resourceType === "raw" && publicId && !path.posix.extname(publicId)) {
    const originalExtension = path.posix.extname(asset.originalname || asset.filename || "");
    if (originalExtension) publicId += originalExtension;
  }

  if (!publicId) return null;
  return { public_id: publicId, resource_type: resourceType };
};

const toTaskAttachment = (file) => ({
  filename: file.originalname,
  url: file.path,
  public_id: file.filename,
  resource_type: getCloudinaryResourceType(file.path),
});

const destroyCloudinaryAssets = async (assets = []) => {
  const results = await Promise.allSettled(assets.map(async (asset) => {
    const details = getCloudinaryAssetDetails(asset);
    if (!details) {
      throw new Error("Cloudinary resource type or public ID could not be determined");
    }

    const result = await cloudinary.uploader.destroy(details.public_id, {
      resource_type: details.resource_type,
      invalidate: true,
    });
    if (!result || !["ok", "not found"].includes(result.result)) {
      throw new Error(`Cloudinary deletion failed for ${details.public_id}`);
    }
    return result;
  }));

  return {
    results,
    failures: results.filter((result) => result.status === "rejected"),
  };
};

module.exports = {
  getCloudinaryResourceType,
  getCloudinaryAssetDetails,
  toTaskAttachment,
  destroyCloudinaryAssets,
};
