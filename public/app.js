const DEFAULT_TYPES = ["application", "video", "scene", "other"];
const STORAGE_KEYS = {
  pageSize: "wallpaperExplorerPageSize",
  selectedTypes: "wallpaperExplorerSelectedTypes",
};

const state = {
  rootPath: "",
  page: 1,
  pageSize: 12,
  totalPages: 1,
  totalFolders: 0,
  totalUnfilteredFolders: 0,
  availableTypes: [],
  selectedTypes: new Set(DEFAULT_TYPES),
  loading: false,
  shutdownRequested: false,
  scanRequestId: 0,
};

const elements = {
  form: document.querySelector("#scanForm"),
  rootPath: document.querySelector("#rootPath"),
  closeAppButton: document.querySelector("#closeAppButton"),
  pageSize: document.querySelector("#pageSize"),
  filterButton: document.querySelector("#filterButton"),
  filterPanel: document.querySelector("#filterPanel"),
  filterOptions: document.querySelector("#filterOptions"),
  statusText: document.querySelector("#statusText"),
  grid: document.querySelector("#grid"),
  pagination: document.querySelector("#pagination"),
  toast: document.querySelector("#toast"),
};

let toastTimer;

function loadSavedPageSize() {
  const saved = Number.parseInt(localStorage.getItem(STORAGE_KEYS.pageSize), 10);
  const validValues = Array.from(elements.pageSize.options).map((option) =>
    Number(option.value)
  );
  return validValues.includes(saved) ? saved : state.pageSize;
}

function loadSavedSelectedTypes() {
  const saved = localStorage.getItem(STORAGE_KEYS.selectedTypes);
  if (saved === null) return new Set(DEFAULT_TYPES);

  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return new Set(DEFAULT_TYPES);
    return new Set(
      parsed
        .map((type) => String(type).toLowerCase())
        .filter((type) => DEFAULT_TYPES.includes(type))
    );
  } catch (error) {
    return new Set(DEFAULT_TYPES);
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.pageSize, String(state.pageSize));
  localStorage.setItem(
    STORAGE_KEYS.selectedTypes,
    JSON.stringify(Array.from(state.selectedTypes))
  );
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 2600);
}

function setLoading(isLoading) {
  state.loading = isLoading;
  elements.form.querySelector("button").disabled = isLoading;
  elements.pageSize.disabled = isLoading;
  elements.filterButton.disabled = isLoading;
}

function folderCard(item) {
  const card = document.createElement("article");
  card.className = "card";

  const header = document.createElement("div");
  header.className = "card-header";

  const title = document.createElement("h2");
  title.className = "folder-name";
  title.textContent = item.displayName || item.name;
  title.title = `${item.name}\n${item.folderPath}`;

  const typeBadge = document.createElement("span");
  typeBadge.className = "type-badge";
  typeBadge.textContent = item.type || "unknown";
  typeBadge.title = `Project type: ${typeBadge.textContent}`;

  header.append(title, typeBadge);

  const preview = document.createElement("div");
  preview.className = item.hasPreview ? "preview-window" : "preview-window error";

  if (item.hasPreview) {
    const image = document.createElement("img");
    image.src = item.previewUrl;
    image.alt = `${item.displayName || item.name} preview`;
    image.loading = "lazy";
    preview.append(image);
  } else {
    const errorBlock = document.createElement("div");

    const errorTitle = document.createElement("p");
    errorTitle.className = "error-title";
    errorTitle.textContent = "No preview available";

    const errorDetail = document.createElement("p");
    errorDetail.className = "error-detail";
    errorDetail.textContent = item.error || "No supported image or GIF was found.";

    errorBlock.append(errorTitle, errorDetail);
    preview.append(errorBlock);
  }

  const footer = document.createElement("div");
  footer.className = "card-footer";

  const previewName = document.createElement("div");
  previewName.className = "preview-name";
  previewName.textContent = item.hasPreview ? item.previewName : "Supported: jpg, jpeg, png, webp, bmp, gif";
  previewName.title = previewName.textContent;

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "secondary-button";
  openButton.textContent = "Open Folder";
  openButton.addEventListener("click", () => openFolder(item.folderPath));

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "danger-button";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => deleteFolder(item));

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(openButton, deleteButton);

  footer.append(previewName, actions);
  card.append(header, preview, footer);
  return card;
}

function renderItems(items) {
  elements.grid.textContent = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent =
      state.totalUnfilteredFolders > 0
        ? "No folders match the selected type filters."
        : "No direct subfolders were found in this root folder.";
    elements.grid.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach((item) => fragment.append(folderCard(item)));
  elements.grid.append(fragment);
}

function renderTypeFilters(availableTypes, selectedTypes) {
  elements.filterOptions.textContent = "";

  if (!availableTypes.length) {
    const empty = document.createElement("div");
    empty.className = "filter-empty";
    empty.textContent = "No project types found.";
    elements.filterOptions.append(empty);
    elements.filterButton.textContent = "Filter";
    return;
  }

  const availableSet = new Set(availableTypes);
  state.selectedTypes = new Set(
    Array.from(selectedTypes).filter((type) => availableSet.has(type))
  );

  availableTypes.forEach((type) => {
    const option = document.createElement("label");
    option.className = "filter-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = type;
    checkbox.checked = state.selectedTypes.has(type);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.selectedTypes.add(type);
      } else {
        state.selectedTypes.delete(type);
      }
      saveSettings();
      state.page = 1;
      loadPage();
    });

    const text = document.createElement("span");
    text.textContent = type;
    option.append(checkbox, text);
    elements.filterOptions.append(option);
  });

  const count = state.selectedTypes.size;
  elements.filterButton.textContent =
    count === availableTypes.length ? "Filter" : `Filter (${count})`;
}

function pageWindow(current, total) {
  const pages = new Set([1, total, current]);
  for (let page = current - 2; page <= current + 2; page += 1) {
    if (page >= 1 && page <= total) pages.add(page);
  }
  return Array.from(pages).sort((a, b) => a - b);
}

function addPageButton(label, page, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.disabled = Boolean(options.disabled);
  if (options.active) button.classList.add("active");
  button.addEventListener("click", () => {
    if (page !== state.page) {
      state.page = page;
      loadPage();
    }
  });
  elements.pagination.append(button);
}

function addPageJumpControl() {
  const form = document.createElement("form");
  form.className = "page-jump";

  const label = document.createElement("label");
  label.textContent = "Go to";

  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.max = String(state.totalPages);
  input.value = String(state.page);
  input.inputMode = "numeric";
  input.ariaLabel = "Page number";

  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Go";

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const page = Number.parseInt(input.value, 10);

    if (!Number.isFinite(page)) {
      showToast("Enter a valid page number.");
      input.focus();
      return;
    }

    if (page < 1 || page > state.totalPages) {
      showToast(`Enter a page from 1 to ${state.totalPages}.`);
      input.focus();
      return;
    }

    if (page !== state.page) {
      state.page = page;
      loadPage();
    }
  });

  label.append(input);
  form.append(label, button);
  elements.pagination.append(form);
}

function renderPagination() {
  elements.pagination.textContent = "";

  if (state.totalPages <= 1) return;

  addPageButton("Prev", Math.max(1, state.page - 1), {
    disabled: state.page === 1,
  });

  let previousPage = 0;
  for (const page of pageWindow(state.page, state.totalPages)) {
    if (previousPage && page - previousPage > 1) {
      const gap = document.createElement("span");
      gap.textContent = "...";
      gap.className = "pagination-gap";
      elements.pagination.append(gap);
    }
    addPageButton(String(page), page, { active: page === state.page });
    previousPage = page;
  }

  addPageButton("Next", Math.min(state.totalPages, state.page + 1), {
    disabled: state.page === state.totalPages,
  });

  addPageJumpControl();
}

async function loadPage() {
  const requestId = ++state.scanRequestId;
  setLoading(true);
  elements.statusText.textContent = "Scanning folders...";

  const params = new URLSearchParams({
    rootPath: state.rootPath,
    page: String(state.page),
    pageSize: String(state.pageSize),
  });
  params.set("typeFilter", "1");
  state.selectedTypes.forEach((type) => params.append("type", type));

  try {
    const response = await fetch(`/api/scan?${params}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Scan failed.");
    }
    if (requestId !== state.scanRequestId) return;

    state.rootPath = data.rootPath;
    state.page = data.page;
    state.pageSize = data.pageSize;
    state.totalPages = data.totalPages;
    state.totalFolders = data.totalFolders;
    state.totalUnfilteredFolders = data.totalUnfilteredFolders;
    state.availableTypes = data.availableTypes || [];
    state.selectedTypes = new Set(data.selectedTypes || []);

    elements.rootPath.value = state.rootPath;
    const allTypesSelected = state.selectedTypes.size === state.availableTypes.length;
    const filterText =
      allTypesSelected
        ? ""
        : ` (${state.totalFolders} matching ${state.totalUnfilteredFolders} total)`;
    elements.statusText.textContent = `${state.totalFolders} folders found${filterText}. Page ${state.page} of ${state.totalPages}.`;
    renderTypeFilters(state.availableTypes, state.selectedTypes);
    renderItems(data.items);
    setLoading(false);
    renderPagination();
  } catch (error) {
    if (requestId !== state.scanRequestId) return;
    elements.grid.textContent = "";
    elements.pagination.textContent = "";
    elements.statusText.textContent = "Scan failed.";
    showToast(error.message);
  } finally {
    if (requestId === state.scanRequestId) {
      setLoading(false);
    }
  }
}

async function openFolder(folderPath) {
  try {
    const response = await fetch("/api/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: state.rootPath, folderPath }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Could not open folder.");
    }
    showToast("Folder opened in File Explorer.");
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteFolder(item) {
  const displayName = item.displayName || item.name;
  const confirmed = window.confirm(
    `Delete this subfolder?\n\n${displayName}\n${item.folderPath}\n\nThis cannot be undone from the webpage.`
  );
  if (!confirmed) return;

  try {
    const response = await fetch("/api/delete-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: state.rootPath, folderPath: item.folderPath }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Could not delete folder.");
    }
    showToast("Folder deleted.");
    loadPage();
  } catch (error) {
    showToast(error.message);
  }
}

function requestServerShutdown() {
  if (state.shutdownRequested) return;
  state.shutdownRequested = true;

  const payload = new Blob(["{}"], { type: "application/json" });
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/shutdown", payload);
    return;
  }

  fetch("/api/shutdown", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    keepalive: true,
  }).catch(() => {});
}

function closeAppWithConfirmation() {
  const confirmed = window.confirm(
    "Close Wallpaper Engine Offline Explorer?\n\nThis will close the local server for the app."
  );
  if (!confirmed) return;

  requestServerShutdown();
  document.body.innerHTML =
    '<main class="closed-state"><h1>Wallpaper Engine Offline Explorer is closed</h1><p>The local server is shutting down. You can close this tab.</p></main>';
  window.setTimeout(() => window.close(), 250);
}

async function initialize() {
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    state.rootPath = config.defaultRoot;
    state.pageSize = loadSavedPageSize();
    state.selectedTypes = loadSavedSelectedTypes();
    elements.rootPath.value = state.rootPath;
    elements.pageSize.value = String(state.pageSize);
  } catch (error) {
    elements.statusText.textContent = "Could not load app configuration.";
    return;
  }

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    state.rootPath = elements.rootPath.value.trim();
    state.page = 1;
    loadPage();
  });

  elements.pageSize.addEventListener("change", () => {
    state.pageSize = Number(elements.pageSize.value);
    saveSettings();
    state.page = 1;
    loadPage();
  });

  elements.filterButton.addEventListener("click", () => {
    const isOpen = !elements.filterPanel.hidden;
    elements.filterPanel.hidden = isOpen;
    elements.filterButton.setAttribute("aria-expanded", String(!isOpen));
  });

  elements.closeAppButton.addEventListener("click", closeAppWithConfirmation);

  window.addEventListener("beforeunload", (event) => {
    if (state.shutdownRequested) return;
    event.preventDefault();
    event.returnValue = "Close Wallpaper Engine Offline Explorer and stop the local server?";
    return event.returnValue;
  });

  loadPage();
}

initialize();
