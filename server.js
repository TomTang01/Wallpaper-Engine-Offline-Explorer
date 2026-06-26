const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

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

    return { type, title };
  } catch (error) {
    return { type: "other", title: null };
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

async function scanRoot(rootPath, page, pageSize, selectedTypes, hasExplicitTypeFilter) {
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
      };
    })
  );
  const availableTypes = PROJECT_TYPES;
  const activeTypeSet = hasExplicitTypeFilter
    ? new Set(selectedTypes.filter((type) => PROJECT_TYPE_SET.has(type)))
    : new Set(PROJECT_TYPES);
  const filteredFolders = foldersWithTypes.filter((folder) =>
    activeTypeSet.has(folder.type)
  );

  const totalFolders = filteredFolders.length;
  const totalPages = Math.max(1, Math.ceil(totalFolders / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageFolders = filteredFolders.slice(start, start + pageSize);

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
    totalFolders,
    totalUnfilteredFolders: foldersWithTypes.length,
    totalPages,
    availableTypes,
    selectedTypes: Array.from(activeTypeSet),
    items,
  };
}

async function readRequestBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
      const pageSize = clampInteger(reqUrl.searchParams.get("pageSize"), 12, 1, 60);
      const selectedTypes = reqUrl.searchParams
        .getAll("type")
        .map((type) => type.trim().toLowerCase())
        .filter(Boolean);
      const hasExplicitTypeFilter = reqUrl.searchParams.has("typeFilter");
      const result = await scanRoot(
        rootPath,
        page,
        pageSize,
        selectedTypes,
        hasExplicitTypeFilter
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
