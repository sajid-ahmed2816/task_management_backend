const dns = require("node:dns").promises;
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");
const axios = require("axios");
const WorkspaceMembership = require("../models/WorkspaceMembershipModel");
const { sendResponse } = require("../helper/sendResponse");

const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const PRIVATE_V4_RANGES = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
  [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
  [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24], [0xcb007100, 24],
  [0xe0000000, 4], [0xf0000000, 4],
];

const ipv4ToInt = (address) => address.split(".").reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0);
const isPublicIpv4 = (address) => {
  if (net.isIP(address) !== 4) return false;
  const value = ipv4ToInt(address);
  return !PRIVATE_V4_RANGES.some(([network, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (network & mask);
  });
};

const resolvePublicIpv4 = async (hostname) => {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) {
    throw new Error("Local hostnames are not allowed");
  }
  if (net.isIP(normalized)) {
    if (!isPublicIpv4(normalized)) throw new Error("Private addresses are not allowed");
    return normalized;
  }
  const addresses = await dns.lookup(normalized, { all: true, family: 4, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicIpv4(address))) {
    throw new Error("Hostname does not resolve exclusively to public IPv4 addresses");
  }
  return addresses[0].address;
};

const pinDns = (address) => (hostname, options, callback) => {
  if (typeof options === "function") callback = options;
  else if (options?.all) return callback(null, [{ address, family: 4 }]);
  return callback(null, address, 4);
};

const requestHtml = async (url, address, timeoutMs) => {
  const agentOptions = { keepAlive: false, lookup: pinDns(address) };
  const response = await axios.get(url.href, {
    responseType: "stream",
    timeout: 5000,
    signal: AbortSignal.timeout(timeoutMs),
    maxRedirects: 0,
    maxContentLength: MAX_BYTES,
    httpAgent: url.protocol === "http:" ? new http.Agent(agentOptions) : undefined,
    httpsAgent: url.protocol === "https:" ? new https.Agent(agentOptions) : undefined,
    headers: { Accept: "text/html", "User-Agent": "WorkspaceLinkPreview/1.0" },
    validateStatus: () => true,
  });
  const contentType = String(response.headers["content-type"] || "").toLowerCase();
  if (response.status >= 300 && response.status < 400) {
    response.data.destroy();
    return { redirect: response.headers.location };
  }
  if (response.status < 200 || response.status >= 300 || !contentType.includes("text/html")) {
    response.data.destroy();
    return { html: "" };
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.data) {
    size += chunk.length;
    if (size > MAX_BYTES) {
      response.data.destroy();
      throw new Error("Preview page exceeds the size limit");
    }
    chunks.push(chunk);
  }
  return { html: Buffer.concat(chunks).toString("utf8") };
};

const decodeHtml = (value) => value
  .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const metaContent = (html, keys) => {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrs = {};
    tag.replace(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g, (_, key, doubleQuoted, singleQuoted, bare) => {
      attrs[key.toLowerCase()] = doubleQuoted ?? singleQuoted ?? bare ?? "";
      return "";
    });
    if (keys.includes((attrs.property || attrs.name || "").toLowerCase()) && attrs.content) return decodeHtml(attrs.content);
  }
  return "";
};

const parseMetadata = (html, pageUrl) => {
  const rawTitle = metaContent(html, ["og:title", "twitter:title"])
    || decodeHtml((html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i) || [])[1] || "");
  const description = metaContent(html, ["og:description", "twitter:description", "description"]);
  let image = metaContent(html, ["og:image", "twitter:image"]);
  try {
    image = image ? new URL(image, pageUrl).href : null;
    if (image) {
      const imageUrl = new URL(image);
      if (imageUrl.hostname.toLowerCase() !== pageUrl.hostname.toLowerCase() || !["http:", "https:"].includes(imageUrl.protocol)) image = null;
    }
  } catch (error) { image = null; }
  return {
    url: pageUrl.href,
    domain: pageUrl.hostname,
    title: rawTitle.slice(0, 300) || pageUrl.hostname,
    description: description.slice(0, 1000),
    image,
  };
};

const fetchPreview = async (initialUrl) => {
  let currentUrl = initialUrl;
  const deadline = Date.now() + 8000;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!["http:", "https:"].includes(currentUrl.protocol) || currentUrl.username || currentUrl.password) {
      throw new Error("Only credential-free HTTP and HTTPS URLs are allowed");
    }
    const expectedPort = currentUrl.protocol === "https:" ? "443" : "80";
    if (currentUrl.port && currentUrl.port !== expectedPort) throw new Error("Only standard web ports are allowed");
    const timeoutMs = Math.min(5000, deadline - Date.now());
    if (timeoutMs <= 0) throw new Error("Preview request timed out");
    const address = await resolvePublicIpv4(currentUrl.hostname);
    const result = await requestHtml(currentUrl, address, timeoutMs);
    if (!result.redirect) return parseMetadata(result.html || "", currentUrl);
    if (redirectCount === MAX_REDIRECTS) throw new Error("Too many redirects");
    currentUrl = new URL(result.redirect, currentUrl);
  }
  throw new Error("Could not load link preview");
};

const getLinkPreview = async (req, res) => {
  const { workspaceId } = req.params;
  if (!/^[a-f\d]{24}$/i.test(workspaceId)) return res.status(400).send(sendResponse(false, null, "Invalid workspace ID"));
  if (typeof req.query.url !== "string" || req.query.url.length > 2048) return res.status(400).send(sendResponse(false, null, "A valid URL is required"));
  try {
    const member = await WorkspaceMembership.exists({ workspace: workspaceId, user: req.user?.id, status: "Active" });
    if (!member) return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    let url;
    try { url = new URL(req.query.url); } catch (error) { return res.status(400).send(sendResponse(false, null, "Invalid URL")); }
    const preview = await fetchPreview(url);
    return res.status(200).send(sendResponse(true, preview, "Link preview fetched"));
  } catch (error) {
    console.warn("Link preview unavailable:", error.message);
    return res.status(422).send(sendResponse(false, null, "Preview is unavailable for this URL"));
  }
};

module.exports = { getLinkPreview };
