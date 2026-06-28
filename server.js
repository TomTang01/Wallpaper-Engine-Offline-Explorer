const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { pipeline } = require("stream/promises");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 43196);
const DEFAULT_ROOT =
  process.env.GALLERY_ROOT || "F:\\Download\\[WE data]";
const PUBLIC_DIR = path.join(__dirname, "public");
const SUPPORTED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".gif",
]);
const PROJECT_TYPES = ["application", "video", "scene", "other"];
const PROJECT_TYPE_SET = new Set(PROJECT_TYPES);
const SORT_MODES = new Set(["default", "size"]);
const MAX_JSON_BODY_SIZE = 1024 * 1024;
const MAX_UPLOAD_BODY_SIZE = 100 * 1024 * 1024;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

function comparePath(left, right) {
  return path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();
}

function isSupportedPreview(filePath) {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isInside(parent, child) {
  const parentPath = path.resolve(parent);
  const childPath = path.resolve(child);
  const relative = path.relative(parentPath, childPath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isDirectChildFolder(rootPath, folderPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedFolder = path.resolve(folderPath);
  return (
    isInside(resolvedRoot, resolvedFolder) &&
    comparePath(path.dirname(resolvedFolder), resolvedRoot)
  );
}

function clampInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function sortByName(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

async function getFolderSize(folderPath) {
  let total = 0;
  let entries;

  try {
    entries = await fsp.readdir(folderPath, { withFileTypes: true });
  } catch (error) {
    return 0;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(folderPath, entry.name);
      try {
        if (entry.isFile()) {
          const stats = await fsp.stat(entryPath);
          total += stats.size;
        } else if (entry.isDirectory()) {
          total += await getFolderSize(entryPath);
        }
      } catch (error) {
        total += 0;
      }
    })
  );

  return total;
}

function splitBuffer(buffer, delimiter) {
  const chunks = [];
  let start = 0;
  let index = buffer.indexOf(delimiter, start);

  while (index !== -1) {
    chunks.push(buffer.slice(start, index));
    start = index + delimiter.length;
    index = buffer.indexOf(delimiter, start);
  }

  chunks.push(buffer.slice(start));
  return chunks;
}

function parseHeaderBlock(text) {
  return text.split("\r\n").reduce((headers, line) => {
    const separator = line.indexOf(":");
    if (separator === -1) return headers;
    headers[line.slice(0, separator).trim().toLowerCase()] = line
      .slice(separator + 1)
      .trim();
    return headers;
  }, {});
}

function parseDisposition(value) {
  const result = {};
  for (const part of value.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawValue.length) continue;
    result[rawKey.toLowerCase()] = rawValue
      .join("=")
      .trim()
      .replace(/^"|"$/g, "");
  }
  return result;
}

function parseMultipartForm(buffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const headerDelimiter = Buffer.from("\r\n\r\n");
  const fields = {};
  const files = {};

  for (const rawPart of splitBuffer(buffer, delimiter).slice(1)) {
    if (rawPart.slice(0, 2).toString("latin1") === "--") break;

    let part = rawPart;
    if (part.slice(0, 2).toString("latin1") === "\r\n") {
      part = part.slice(2);
    }
    if (part.slice(-2).toString("latin1") === "\r\n") {
      part = part.slice(0, -2);
    }

    const headerEnd = part.indexOf(headerDelimiter);
    if (headerEnd === -1) continue;

    const headers = parseHeaderBlock(part.slice(0, headerEnd).toString("utf8"));
    const disposition = parseDisposition(headers["content-disposition"] || "");
    const name = disposition.name;
    if (!name) continue;

    const body = part.slice(headerEnd + headerDelimiter.length);
    if (disposition.filename !== undefined) {
      files[name] = {
        filename: path.basename(disposition.filename),
        contentType: headers["content-type"] || "application/octet-stream",
        buffer: body,
      };
    } else {
      fields[name] = body.toString("utf8");
    }
  }

  return { fields, files };
}

function sanitizeFileName(fileName) {
  const cleaned = path
    .basename(fileName)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  if (!cleaned || cleaned.toLowerCase() === "project.json") {
    return "uploaded-file";
  }

  return cleaned.slice(0, 180);
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value
      .map((tag) => String(tag).trim())
      .filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function uniqueTags(tags) {
  const seen = new Set();
  const result = [];

  for (const tag of tags) {
    const normalized = String(tag).trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result.sort(sortByName);
}

async function createNextNumberedFolder(rootPath) {
  const entries = await fsp.readdir(rootPath, { withFileTypes: true });
  const largestNumber = entries.reduce((largest, entry) => {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) return largest;
    const value = Number.parseInt(entry.name, 10);
    return Number.isSafeInteger(value) ? Math.max(largest, value) : largest;
  }, 0);

  for (let offset = 1; offset <= 1000; offset += 1) {
    const folderName = String(largestNumber + offset);
    const folderPath = path.join(rootPath, folderName);
    if (!isDirectChildFolder(rootPath, folderPath)) {
      const error = new Error("The generated folder path is not allowed.");
      error.statusCode = 400;
      throw error;
    }

    try {
      await fsp.mkdir(folderPath);
      return folderPath;
    } catch (error) {
      if (error.code === "EEXIST") continue;
      throw error;
    }
  }

  const error = new Error("Could not create the next numbered folder.");
  error.statusCode = 409;
  throw error;
}

async function readProjectMetadata(folderPath) {
  try {
    const projectPath = path.join(folderPath, "project.json");
    const text = await fsp.readFile(projectPath, "utf8");
    const project = JSON.parse(text.replace(/^\uFEFF/, ""));
    let type = "other";
    if (typeof project.type === "string" && project.type.trim()) {
      const normalizedType = project.type.trim().toLowerCase();
      type =
        PROJECT_TYPE_SET.has(normalizedType) && normalizedType !== "other"
          ? normalizedType
          : "other";
    }

    const title =
      typeof project.title === "string" && project.title.trim()
        ? project.title.trim()
        : null;

    return {
      type,
      title,
      tags: uniqueTags([
        ...normalizeTags(project.tag),
        ...normalizeTags(project.tags),
      ]),
    };
  } catch (error) {
    return { type: "other", title: null, tags: [] };
  }
}

async function findPreviewFile(folderPath) {
  const entries = await fsp.readdir(folderPath, { withFileTypes: true });
  const candidates = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        path.basename(entry.name, path.extname(entry.name)).toLowerCase() ===
          "preview" &&
        isSupportedPreview(entry.name)
    )
    .map((entry) => entry.name)
    .sort(sortByName);

  if (candidates.length === 0) {
    return null;
  }

  return path.join(folderPath, candidates[0]);
}

async function scanRoot(
  rootPath,
  page,
  pageSize,
  selectedTypes,
  hasExplicitTypeFilter,
  selectedTags,
  hasExplicitTagFilter,
  sortMode,
  searchQuery
) {
  const resolvedRoot = path.resolve(rootPath);
  const rootStats = await fsp.stat(resolvedRoot);
  if (!rootStats.isDirectory()) {
    const error = new Error("The root path is not a folder.");
    error.statusCode = 400;
    throw error;
  }

  const entries = await fsp.readdir(resolvedRoot, { withFileTypes: true });
  const folders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      folderPath: path.join(resolvedRoot, entry.name),
    }))
    .sort((a, b) => sortByName(b.name, a.name));

  const foldersWithTypes = await Promise.all(
    folders.map(async (folder) => {
      const metadata = await readProjectMetadata(folder.folderPath);
      return {
        ...folder,
        type: metadata.type,
        displayName: metadata.title || folder.name,
        tags: metadata.tags,
      };
    })
  );
  const trimmedSearch = searchQuery.trim();
  const normalizedSearch = trimmedSearch.toLowerCase();
  const searchedFolders = normalizedSearch
    ? foldersWithTypes.filter((folder) =>
        (folder.displayName || "").toLowerCase().includes(normalizedSearch)
      )
    : foldersWithTypes;
  const availableTypes = PROJECT_TYPES;
  const availableTags = uniqueTags(
    searchedFolders.flatMap((folder) => folder.tags || [])
  );
  const activeTypeSet = hasExplicitTypeFilter
    ? new Set(selectedTypes.filter((type) => PROJECT_TYPE_SET.has(type)))
    : new Set(PROJECT_TYPES);
  const availableTagKeys = new Map(
    availableTags.map((tag) => [tag.toLowerCase(), tag])
  );
  const activeTagSet = hasExplicitTagFilter
    ? new Set(
        selectedTags
          .map((tag) => availableTagKeys.get(tag.toLowerCase()))
          .filter(Boolean)
      )
    : new Set();
  const activeTagKeys = new Set(
    Array.from(activeTagSet).map((tag) => tag.toLowerCase())
  );
  const filteredFolders = searchedFolders.filter((folder) => {
    if (!activeTypeSet.has(folder.type)) return false;
    if (!activeTagKeys.size) return true;
    return (folder.tags || []).some((tag) => activeTagKeys.has(tag.toLowerCase()));
  });
  const sortedFolders =
    sortMode === "size"
      ? (
          await Promise.all(
            filteredFolders.map(async (folder) => ({
              ...folder,
              size: await getFolderSize(folder.folderPath),
            }))
          )
        ).sort((a, b) => b.size - a.size || sortByName(b.name, a.name))
      : filteredFolders;

  const totalFolders = sortedFolders.length;
  const totalPages = Math.max(1, Math.ceil(totalFolders / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageFolders = sortedFolders.slice(start, start + pageSize);

  const items = await Promise.all(
    pageFolders.map(async (folder) => {
      try {
        const previewPath = await findPreviewFile(folder.folderPath);
        if (!previewPath) {
          return {
            ...folder,
            hasPreview: false,
            error: "No supported image or GIF found in this folder.",
          };
        }

        return {
          ...folder,
          hasPreview: true,
          previewPath,
          previewName: path.basename(previewPath),
          previewUrl: `/api/preview?rootPath=${encodeURIComponent(
            resolvedRoot
          )}&previewPath=${encodeURIComponent(previewPath)}`,
        };
      } catch (error) {
        return {
          ...folder,
          hasPreview: false,
          error: "This folder could not be read.",
        };
      }
    })
  );

  return {
    rootPath: resolvedRoot,
    page: safePage,
    pageSize,
    sortMode,
    searchQuery: trimmedSearch,
    totalFolders,
    totalUnfilteredFolders: searchedFolders.length,
    totalPages,
    availableTypes,
    availableTags,
    selectedTypes: Array.from(activeTypeSet),
    selectedTags: Array.from(activeTagSet),
    items,
  };
}

async function readRawRequestBody(req, maxSize) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxSize) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function readRequestBody(req) {
  const body = await readRawRequestBody(req, MAX_JSON_BODY_SIZE);
  if (body.length === 0) return {};
  return JSON.parse(body.toString("utf8"));
}

async function servePreview(reqUrl, res) {
  const rootPath = reqUrl.searchParams.get("rootPath");
  const previewPath = reqUrl.searchParams.get("previewPath");
  if (!rootPath || !previewPath) {
    sendJson(res, 400, { error: "Missing rootPath or previewPath." });
    return;
  }

  const resolvedRoot = path.resolve(rootPath);
  const resolvedPreview = path.resolve(previewPath);
  const folderPath = path.dirname(resolvedPreview);

  if (
    !isSupportedPreview(resolvedPreview) ||
    !isDirectChildFolder(resolvedRoot, folderPath)
  ) {
    sendJson(res, 403, { error: "Preview path is not allowed." });
    return;
  }

  try {
    const stats = await fsp.stat(resolvedPreview);
    if (!stats.isFile()) {
      sendJson(res, 404, { error: "Preview file was not found." });
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentTypes[path.extname(resolvedPreview).toLowerCase()],
      "Content-Length": stats.size,
      "Cache-Control": "private, max-age=120",
    });
    fs.createReadStream(resolvedPreview).pipe(res);
  } catch (error) {
    sendJson(res, 404, { error: "Preview file was not found." });
  }
}

async function openFolder(req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, error.statusCode || 400, { error: "Invalid JSON request." });
    return;
  }

  const rootPath = body.rootPath;
  const folderPath = body.folderPath;
  if (!rootPath || !folderPath) {
    sendJson(res, 400, { error: "Missing rootPath or folderPath." });
    return;
  }

  const resolvedRoot = path.resolve(rootPath);
  const resolvedFolder = path.resolve(folderPath);
  if (!isDirectChildFolder(resolvedRoot, resolvedFolder)) {
    sendJson(res, 403, { error: "Only direct subfolders of the root can be opened." });
    return;
  }

  try {
    const stats = await fsp.stat(resolvedFolder);
    if (!stats.isDirectory()) {
      sendJson(res, 404, { error: "Folder was not found." });
      return;
    }

    let command = "xdg-open";
    let args = [resolvedFolder];
    if (process.platform === "win32") {
      command = "explorer.exe";
    } else if (process.platform === "darwin") {
      command = "open";
    }

    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();

    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { error: "Could not open the folder." });
  }
}

async function deleteFolder(req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, error.statusCode || 400, { error: "Invalid JSON request." });
    return;
  }

  const rootPath = body.rootPath;
  const folderPath = body.folderPath;
  if (!rootPath || !folderPath) {
    sendJson(res, 400, { error: "Missing rootPath or folderPath." });
    return;
  }

  const resolvedRoot = path.resolve(rootPath);
  const resolvedFolder = path.resolve(folderPath);
  if (!isDirectChildFolder(resolvedRoot, resolvedFolder)) {
    sendJson(res, 403, { error: "Only direct subfolders of the root can be deleted." });
    return;
  }

  try {
    const stats = await fsp.stat(resolvedFolder);
    if (!stats.isDirectory()) {
      sendJson(res, 404, { error: "Folder was not found." });
      return;
    }

    await fsp.rm(resolvedFolder, { recursive: true, force: false });
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { error: "Could not delete the folder." });
  }
}

async function updateProject(req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, error.statusCode || 400, { error: "Invalid JSON request." });
    return;
  }

  const rootPath = body.rootPath;
  const folderPath = body.folderPath;
  const type = String(body.type || "").trim().toLowerCase();
  const tags = uniqueTags(normalizeTags(body.tags));

  if (!rootPath || !folderPath || !type) {
    sendJson(res, 400, { error: "Missing rootPath, folderPath, or type." });
    return;
  }

  if (!PROJECT_TYPE_SET.has(type)) {
    sendJson(res, 400, { error: "Choose a valid project type." });
    return;
  }

  const resolvedRoot = path.resolve(rootPath);
  const resolvedFolder = path.resolve(folderPath);
  if (!isDirectChildFolder(resolvedRoot, resolvedFolder)) {
    sendJson(res, 403, { error: "Only direct subfolders of the root can be edited." });
    return;
  }

  try {
    const stats = await fsp.stat(resolvedFolder);
    if (!stats.isDirectory()) {
      sendJson(res, 404, { error: "Folder was not found." });
      return;
    }

    const projectPath = path.join(resolvedFolder, "project.json");
    let project = {};
    try {
      const text = await fsp.readFile(projectPath, "utf8");
      project = JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    project.type = type;
    if (Object.prototype.hasOwnProperty.call(project, "tags") && !Object.prototype.hasOwnProperty.call(project, "tag")) {
      project.tags = tags;
    } else {
      project.tag = tags;
    }

    await fsp.writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
    sendJson(res, 200, { ok: true, type, tags });
  } catch (error) {
    sendJson(res, 500, { error: "Could not update project.json." });
  }
}

async function addItem(req, res, reqUrl) {
  const rootPath = String(reqUrl.searchParams.get("rootPath") || "").trim();
  const title = String(reqUrl.searchParams.get("title") || "").trim();
  const type = String(reqUrl.searchParams.get("type") || "").trim().toLowerCase();
  const fileName = sanitizeFileName(reqUrl.searchParams.get("fileName") || "");
  const requestedTags = uniqueTags(normalizeTags(reqUrl.searchParams.getAll("tag")));
  const tags = requestedTags.length ? requestedTags : ["Untagged"];

  if (!rootPath || !title || !type || !fileName) {
    sendJson(res, 400, { error: "A file, title, and type are required." });
    return;
  }

  if (!PROJECT_TYPE_SET.has(type)) {
    sendJson(res, 400, { error: "Choose a valid project type." });
    return;
  }

  const contentLength = Number.parseInt(req.headers["content-length"] || "0", 10);
  if (Number.isFinite(contentLength) && contentLength <= 0) {
    sendJson(res, 400, { error: "Choose a non-empty file." });
    return;
  }

  const resolvedRoot = path.resolve(rootPath);
  let createdFolder = null;

  try {
    const rootStats = await fsp.stat(resolvedRoot);
    if (!rootStats.isDirectory()) {
      sendJson(res, 400, { error: "The root path is not a folder." });
      return;
    }

    createdFolder = await createNextNumberedFolder(resolvedRoot);
    const uploadPath = path.join(createdFolder, fileName);
    await pipeline(req, fs.createWriteStream(uploadPath, { flags: "wx" }));

    const uploadStats = await fsp.stat(uploadPath);
    if (!uploadStats.isFile() || uploadStats.size === 0) {
      const error = new Error("Choose a non-empty file.");
      error.statusCode = 400;
      throw error;
    }

    await fsp.writeFile(
      path.join(createdFolder, "project.json"),
      `${JSON.stringify({ title, type, tags }, null, 2)}\n`,
      { flag: "wx" }
    );

    sendJson(res, 200, {
      ok: true,
      rootPath: resolvedRoot,
      folderPath: createdFolder,
      fileName,
    });
  } catch (error) {
    if (createdFolder) {
      await fsp.rm(createdFolder, { recursive: true, force: true }).catch(() => {});
    }
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Could not add the item.",
    });
  }
}

function shutdownServer(res) {
  sendJson(res, 200, { ok: true });
  setTimeout(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1200).unref();
  }, 100).unref();
}

function serveStatic(reqUrl, res) {
  const requested = reqUrl.pathname === "/" ? "/index.html" : reqUrl.pathname;
  const decoded = decodeURIComponent(requested);
  const filePath = path.resolve(PUBLIC_DIR, `.${decoded}`);

  if (!isInside(PUBLIC_DIR, filePath) && !comparePath(PUBLIC_DIR, filePath)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  fs.createReadStream(filePath)
    .on("open", () => {
      res.writeHead(200, {
        "Content-Type": contentTypes[extension] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
    })
    .on("error", () => {
      sendText(res, 404, "Not found");
    })
    .pipe(res);
}

async function handleRequest(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  try {
    if (req.method === "GET" && reqUrl.pathname === "/api/config") {
      sendJson(res, 200, {
        defaultRoot: DEFAULT_ROOT,
        supportedExtensions: Array.from(SUPPORTED_EXTENSIONS),
      });
      return;
    }

    if (req.method === "GET" && reqUrl.pathname === "/api/scan") {
      const rootPath = reqUrl.searchParams.get("rootPath") || DEFAULT_ROOT;
      const page = clampInteger(reqUrl.searchParams.get("page"), 1, 1, 100000);
      const pageSize = clampInteger(reqUrl.searchParams.get("pageSize"), 20, 1, 100);
      const requestedSortMode = reqUrl.searchParams.get("sortMode") || "default";
      const sortMode = SORT_MODES.has(requestedSortMode)
        ? requestedSortMode
        : "default";
      const searchQuery = reqUrl.searchParams.get("search") || "";
      const selectedTypes = reqUrl.searchParams
        .getAll("type")
        .map((type) => type.trim().toLowerCase())
        .filter(Boolean);
      const selectedTags = reqUrl.searchParams
        .getAll("tag")
        .map((tag) => tag.trim())
        .filter(Boolean);
      const hasExplicitTypeFilter = reqUrl.searchParams.has("typeFilter");
      const hasExplicitTagFilter = reqUrl.searchParams.has("tagFilter");
      const result = await scanRoot(
        rootPath,
        page,
        pageSize,
        selectedTypes,
        hasExplicitTypeFilter,
        selectedTags,
        hasExplicitTagFilter,
        sortMode,
        searchQuery
      );
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET" && reqUrl.pathname === "/api/preview") {
      await servePreview(reqUrl, res);
      return;
    }

    if (req.method === "POST" && reqUrl.pathname === "/api/open-folder") {
      await openFolder(req, res);
      return;
    }

    if (req.method === "POST" && reqUrl.pathname === "/api/delete-folder") {
      await deleteFolder(req, res);
      return;
    }

    if (req.method === "POST" && reqUrl.pathname === "/api/update-project") {
      await updateProject(req, res);
      return;
    }

    if (req.method === "POST" && reqUrl.pathname === "/api/add-item") {
      await addItem(req, res, reqUrl);
      return;
    }

    if (req.method === "POST" && reqUrl.pathname === "/api/shutdown") {
      shutdownServer(res);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      serveStatic(reqUrl, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Unexpected server error.",
    });
  }
}

const server = http.createServer(handleRequest);
server.listen(PORT, HOST, () => {
  console.log(`Wallpaper Engine Offline Explorer running at http://${HOST}:${PORT}`);
  console.log(`Default root: ${DEFAULT_ROOT}`);
});
