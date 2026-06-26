const DEFAULT_TYPES = ["application", "video", "scene", "other"];
const STORAGE_KEYS = {
  pageSize: "wallpaperExplorerPageSize",
  selectedTypes: "wallpaperExplorerSelectedTypes",
  selectedTags: "wallpaperExplorerSelectedTags",
  sortMode: "wallpaperExplorerSortMode",
};
const SORT_LABELS = {
  default: "Default (time)",
  size: "Size",
};

const state = {
  rootPath: "",
  page: 1,
  pageSize: 12,
  sortMode: "default",
  totalPages: 1,
  totalFolders: 0,
  totalUnfilteredFolders: 0,
  availableTypes: [],
  availableTags: [],
  selectedTypes: new Set(DEFAULT_TYPES),
  selectedTags: new Set(),
  loading: false,
  adding: false,
  addFile: null,
  editItem: null,
  editTags: new Set(),
  editAvailableTags: [],
  shutdownRequested: false,
  scanRequestId: 0,
};

const elements = {
  form: document.querySelector("#scanForm"),
  rootPath: document.querySelector("#rootPath"),
  closeAppButton: document.querySelector("#closeAppButton"),
  showAddDialogButton: document.querySelector("#showAddDialogButton"),
  addDialogOverlay: document.querySelector("#addDialogOverlay"),
  addItemForm: document.querySelector("#addItemForm"),
  addFileInput: document.querySelector("#addFileInput"),
  fileDropZone: document.querySelector("#fileDropZone"),
  selectedFileName: document.querySelector("#selectedFileName"),
  addTitleInput: document.querySelector("#addTitleInput"),
  addTypeSelect: document.querySelector("#addTypeSelect"),
  cancelAddButton: document.querySelector("#cancelAddButton"),
  confirmAddButton: document.querySelector("#confirmAddButton"),
  editDialogOverlay: document.querySelector("#editDialogOverlay"),
  editOpenFolderButton: document.querySelector("#editOpenFolderButton"),
  editTypeSelect: document.querySelector("#editTypeSelect"),
  tagDropdownButton: document.querySelector("#tagDropdownButton"),
  tagDropdownPanel: document.querySelector("#tagDropdownPanel"),
  tagSearchInput: document.querySelector("#tagSearchInput"),
  showNewTagButton: document.querySelector("#showNewTagButton"),
  tagOptions: document.querySelector("#tagOptions"),
  cancelEditButton: document.querySelector("#cancelEditButton"),
  confirmEditButton: document.querySelector("#confirmEditButton"),
  newTagDialogOverlay: document.querySelector("#newTagDialogOverlay"),
  newTagInput: document.querySelector("#newTagInput"),
  cancelNewTagButton: document.querySelector("#cancelNewTagButton"),
  confirmNewTagButton: document.querySelector("#confirmNewTagButton"),
  pageSize: document.querySelector("#pageSize"),
  filterButton: document.querySelector("#filterButton"),
  filterPanel: document.querySelector("#filterPanel"),
  filterOptions: document.querySelector("#filterOptions"),
  filterTagOptions: document.querySelector("#filterTagOptions"),
  sortButton: document.querySelector("#sortButton"),
  sortPanel: document.querySelector("#sortPanel"),
  sortOptions: document.querySelectorAll(".sort-option"),
  statusText: document.querySelector("#statusText"),
  grid: document.querySelector("#grid"),
  pagination: document.querySelector("#pagination"),
  toast: document.querySelector("#toast"),
};

let toastTimer;
let titleFitTimer;

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

function loadSavedSelectedTags() {
  const saved = localStorage.getItem(STORAGE_KEYS.selectedTags);
  if (saved === null) return new Set();

  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(normalizeTagList(parsed));
  } catch (error) {
    return new Set();
  }
}

function loadSavedSortMode() {
  const saved = localStorage.getItem(STORAGE_KEYS.sortMode);
  return Object.prototype.hasOwnProperty.call(SORT_LABELS, saved) ? saved : "default";
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.pageSize, String(state.pageSize));
  localStorage.setItem(
    STORAGE_KEYS.selectedTypes,
    JSON.stringify(Array.from(state.selectedTypes))
  );
  localStorage.setItem(
    STORAGE_KEYS.selectedTags,
    JSON.stringify(Array.from(state.selectedTags))
  );
  localStorage.setItem(STORAGE_KEYS.sortMode, state.sortMode);
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
  elements.sortButton.disabled = isLoading;
  elements.showAddDialogButton.disabled = isLoading;
}

function renderSortControl() {
  elements.sortButton.textContent = SORT_LABELS[state.sortMode] || SORT_LABELS.default;
  elements.sortOptions.forEach((button) => {
    button.classList.toggle("active", button.dataset.sortMode === state.sortMode);
  });
}

function setSortPanelOpen(isOpen) {
  elements.sortPanel.hidden = !isOpen;
  elements.sortButton.setAttribute("aria-expanded", String(isOpen));
}

function updateAddButtonState() {
  const hasTitle = elements.addTitleInput.value.trim().length > 0;
  const hasType = elements.addTypeSelect.value.trim().length > 0;
  elements.confirmAddButton.disabled =
    state.adding || !state.addFile || !hasTitle || !hasType;
}

function resetAddDialog() {
  state.adding = false;
  state.addFile = null;
  elements.addItemForm.reset();
  elements.selectedFileName.textContent = "or click to choose one";
  elements.fileDropZone.classList.remove("drag-over");
  elements.confirmAddButton.textContent = "Add";
  updateAddButtonState();
}

function setAddDialogOpen(isOpen) {
  if (isOpen) {
    resetAddDialog();
    elements.addDialogOverlay.hidden = false;
    elements.addTitleInput.focus();
    return;
  }

  elements.addDialogOverlay.hidden = true;
  resetAddDialog();
}

function setAddFile(file) {
  if (!file) return;
  state.addFile = file;
  elements.selectedFileName.textContent = file.name;
  updateAddButtonState();
}

function tagSort(left, right) {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function normalizeTagList(tags) {
  const seen = new Set();
  const result = [];

  tags.forEach((tag) => {
    const normalized = String(tag).trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  });

  return result.sort(tagSort);
}

function findExistingTag(tag) {
  const key = tag.trim().toLowerCase();
  return state.editAvailableTags.find((existing) => existing.toLowerCase() === key);
}

function updateTagDropdownButton() {
  const count = state.editTags.size;
  elements.tagDropdownButton.textContent =
    count === 0 ? "Choose tags" : `${count} tag${count === 1 ? "" : "s"} selected`;
}

function renderTagOptions() {
  elements.tagOptions.textContent = "";
  const query = elements.tagSearchInput.value.trim().toLowerCase();
  const tags = state.editAvailableTags.filter((tag) =>
    tag.toLowerCase().includes(query)
  );

  if (!tags.length) {
    const empty = document.createElement("div");
    empty.className = "tag-empty";
    empty.textContent = query ? "No matching tags." : "No tags yet.";
    elements.tagOptions.append(empty);
    updateTagDropdownButton();
    return;
  }

  const fragment = document.createDocumentFragment();
  tags.forEach((tag) => {
    const option = document.createElement("label");
    option.className = "tag-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = tag;
    checkbox.checked = state.editTags.has(tag);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.editTags.add(tag);
      } else {
        state.editTags.delete(tag);
      }
      updateTagDropdownButton();
    });

    const text = document.createElement("span");
    text.textContent = tag;
    option.append(checkbox, text);
    fragment.append(option);
  });

  elements.tagOptions.append(fragment);
  updateTagDropdownButton();
}

function setTagDropdownOpen(isOpen) {
  elements.tagDropdownPanel.hidden = !isOpen;
  elements.tagDropdownButton.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) {
    elements.tagSearchInput.focus();
    renderTagOptions();
  }
}

function setEditDialogOpen(isOpen) {
  elements.editDialogOverlay.hidden = !isOpen;
  if (!isOpen) {
    state.editItem = null;
    state.editTags = new Set();
    state.editAvailableTags = [];
    elements.tagSearchInput.value = "";
    setTagDropdownOpen(false);
  }
}

function openEditDialog(item) {
  state.editItem = item;
  state.editTags = new Set(normalizeTagList(item.tags || []));
  state.editAvailableTags = normalizeTagList([
    ...state.availableTags,
    ...state.editTags,
  ]);
  elements.editTypeSelect.value = DEFAULT_TYPES.includes(item.type) ? item.type : "other";
  elements.tagSearchInput.value = "";
  setEditDialogOpen(true);
  renderTagOptions();
  elements.editOpenFolderButton.focus();
}

function setNewTagDialogOpen(isOpen) {
  elements.newTagDialogOverlay.hidden = !isOpen;
  if (isOpen) {
    elements.newTagInput.value = "";
    elements.newTagInput.focus();
  }
}

function confirmNewTag() {
  const newTag = elements.newTagInput.value.trim();
  if (!newTag) {
    setNewTagDialogOpen(false);
    return;
  }

  const existing = findExistingTag(newTag);
  const tag = existing || newTag;
  if (!existing) {
    state.editAvailableTags = normalizeTagList([...state.editAvailableTags, tag]);
  }
  state.editTags.add(tag);
  elements.tagSearchInput.value = "";
  setNewTagDialogOpen(false);
  setTagDropdownOpen(true);
  renderTagOptions();
}

async function confirmProjectEdit() {
  if (!state.editItem) return;
  elements.confirmEditButton.disabled = true;

  try {
    const response = await fetch("/api/update-project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootPath: state.rootPath,
        folderPath: state.editItem.folderPath,
        type: elements.editTypeSelect.value,
        tags: Array.from(state.editTags),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Could not update project.json.");
    }

    showToast("Item updated.");
    setEditDialogOpen(false);
    loadPage();
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.confirmEditButton.disabled = false;
  }
}

async function submitAddItem(event) {
  event.preventDefault();
  updateAddButtonState();
  if (elements.confirmAddButton.disabled) return;

  const rootPath = elements.rootPath.value.trim() || state.rootPath;
  const params = new URLSearchParams({
    rootPath,
    title: elements.addTitleInput.value.trim(),
    type: elements.addTypeSelect.value,
    fileName: state.addFile.name,
  });

  state.adding = true;
  elements.confirmAddButton.textContent = "Adding...";
  updateAddButtonState();

  try {
    const response = await fetch(`/api/add-item?${params}`, {
      method: "POST",
      headers: { "Content-Type": state.addFile.type || "application/octet-stream" },
      body: state.addFile,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Could not add the item.");
    }

    showToast("Item added.");
    setAddDialogOpen(false);
    state.rootPath = data.rootPath || rootPath;
    elements.rootPath.value = state.rootPath;
    state.page = 1;
    loadPage();
  } catch (error) {
    showToast(
      error instanceof TypeError
        ? "Upload failed. Check that the local app server is running, then try again."
        : error.message
    );
  } finally {
    state.adding = false;
    elements.confirmAddButton.textContent = "Add";
    updateAddButtonState();
  }
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

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "secondary-button";
  editButton.textContent = "Edit";
  editButton.title = "Edit item";
  editButton.addEventListener("click", () => openEditDialog(item));

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "danger-button";
  deleteButton.textContent = "X";
  deleteButton.ariaLabel = "Delete folder";
  deleteButton.title = "Delete folder";
  deleteButton.addEventListener("click", () => deleteFolder(item));

  footer.append(editButton, deleteButton);
  card.append(header, preview, footer);
  return card;
}

function fitFolderTitle(title) {
  const maxSize = 16;
  const minSize = 11;
  let size = maxSize;
  title.style.fontSize = `${maxSize}px`;

  while (
    size > minSize &&
    (title.scrollHeight > title.clientHeight || title.scrollWidth > title.clientWidth)
  ) {
    size -= 1;
    title.style.fontSize = `${size}px`;
  }
}

function fitFolderTitles() {
  window.requestAnimationFrame(() => {
    elements.grid
      .querySelectorAll(".folder-name")
      .forEach((title) => fitFolderTitle(title));
  });
}

function scheduleFolderTitleFit() {
  window.clearTimeout(titleFitTimer);
  titleFitTimer = window.setTimeout(fitFolderTitles, 120);
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
  fitFolderTitles();
}

function updateFilterButtonText() {
  const typeFiltered = state.selectedTypes.size !== state.availableTypes.length;
  const tagCount = state.selectedTags.size;

  if (!typeFiltered && tagCount === 0) {
    elements.filterButton.textContent = "Filter";
    return;
  }

  const parts = [];
  if (typeFiltered) parts.push(`${state.selectedTypes.size} type`);
  if (tagCount > 0) parts.push(`${tagCount} tag${tagCount === 1 ? "" : "s"}`);
  elements.filterButton.textContent = `Filter (${parts.join(", ")})`;
}

function renderTypeFilters(availableTypes, selectedTypes) {
  elements.filterOptions.textContent = "";

  if (!availableTypes.length) {
    const empty = document.createElement("div");
    empty.className = "filter-empty";
    empty.textContent = "No project types found.";
    elements.filterOptions.append(empty);
    updateFilterButtonText();
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

  updateFilterButtonText();
}

function renderTagFilters(availableTags, selectedTags) {
  elements.filterTagOptions.textContent = "";

  if (!availableTags.length) {
    const empty = document.createElement("div");
    empty.className = "filter-empty";
    empty.textContent = "No tags found.";
    elements.filterTagOptions.append(empty);
    state.selectedTags = new Set();
    saveSettings();
    updateFilterButtonText();
    return;
  }

  const availableByLower = new Map(
    availableTags.map((tag) => [tag.toLowerCase(), tag])
  );
  state.selectedTags = new Set(
    Array.from(selectedTags)
      .map((tag) => availableByLower.get(String(tag).toLowerCase()))
      .filter(Boolean)
  );

  availableTags.forEach((tag) => {
    const option = document.createElement("label");
    option.className = "filter-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = tag;
    checkbox.checked = state.selectedTags.has(tag);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.selectedTags.add(tag);
      } else {
        state.selectedTags.delete(tag);
      }
      saveSettings();
      state.page = 1;
      loadPage();
    });

    const text = document.createElement("span");
    text.textContent = tag;
    option.append(checkbox, text);
    elements.filterTagOptions.append(option);
  });

  updateFilterButtonText();
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
    sortMode: state.sortMode,
  });
  params.set("typeFilter", "1");
  state.selectedTypes.forEach((type) => params.append("type", type));
  if (state.selectedTags.size > 0) {
    params.set("tagFilter", "1");
    state.selectedTags.forEach((tag) => params.append("tag", tag));
  }

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
    state.sortMode = data.sortMode || state.sortMode;
    state.totalPages = data.totalPages;
    state.totalFolders = data.totalFolders;
    state.totalUnfilteredFolders = data.totalUnfilteredFolders;
    state.availableTypes = data.availableTypes || [];
    state.availableTags = normalizeTagList(data.availableTags || []);
    state.selectedTypes = new Set(data.selectedTypes || []);
    state.selectedTags = new Set(normalizeTagList(data.selectedTags || []));

    elements.rootPath.value = state.rootPath;
    const allTypesSelected = state.selectedTypes.size === state.availableTypes.length;
    const hasTagFilter = state.selectedTags.size > 0;
    const filterText =
      allTypesSelected && !hasTagFilter
        ? ""
        : ` (${state.totalFolders} matching ${state.totalUnfilteredFolders} total)`;
    elements.statusText.textContent = `${state.totalFolders} folders found${filterText}. Page ${state.page} of ${state.totalPages}.`;
    renderSortControl();
    renderTypeFilters(state.availableTypes, state.selectedTypes);
    renderTagFilters(state.availableTags, state.selectedTags);
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
    state.selectedTags = loadSavedSelectedTags();
    state.sortMode = loadSavedSortMode();
    elements.rootPath.value = state.rootPath;
    elements.pageSize.value = String(state.pageSize);
    renderSortControl();
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
    setSortPanelOpen(false);
  });
  elements.sortButton.addEventListener("click", () => {
    const isOpen = !elements.sortPanel.hidden;
    setSortPanelOpen(!isOpen);
    elements.filterPanel.hidden = true;
    elements.filterButton.setAttribute("aria-expanded", "false");
  });
  elements.sortOptions.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.sortMode;
      if (!Object.prototype.hasOwnProperty.call(SORT_LABELS, mode)) return;
      setSortPanelOpen(false);
      if (mode === state.sortMode) return;
      state.sortMode = mode;
      state.page = 1;
      saveSettings();
      renderSortControl();
      loadPage();
    });
  });

  elements.showAddDialogButton.addEventListener("click", () => setAddDialogOpen(true));
  elements.cancelAddButton.addEventListener("click", () => setAddDialogOpen(false));
  elements.addItemForm.addEventListener("submit", submitAddItem);
  elements.addTitleInput.addEventListener("input", updateAddButtonState);
  elements.addTypeSelect.addEventListener("change", updateAddButtonState);
  elements.addFileInput.addEventListener("change", () => {
    setAddFile(elements.addFileInput.files[0]);
  });
  elements.fileDropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.fileDropZone.classList.add("drag-over");
  });
  elements.fileDropZone.addEventListener("dragleave", () => {
    elements.fileDropZone.classList.remove("drag-over");
  });
  elements.fileDropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.fileDropZone.classList.remove("drag-over");
    setAddFile(event.dataTransfer.files[0]);
  });
  elements.addDialogOverlay.addEventListener("click", (event) => {
    if (event.target === elements.addDialogOverlay) {
      setAddDialogOpen(false);
    }
  });
  elements.editOpenFolderButton.addEventListener("click", () => {
    if (state.editItem) openFolder(state.editItem.folderPath);
  });
  elements.tagDropdownButton.addEventListener("click", () => {
    setTagDropdownOpen(elements.tagDropdownPanel.hidden);
  });
  elements.tagSearchInput.addEventListener("input", renderTagOptions);
  elements.showNewTagButton.addEventListener("click", () => setNewTagDialogOpen(true));
  elements.cancelNewTagButton.addEventListener("click", () => setNewTagDialogOpen(false));
  elements.confirmNewTagButton.addEventListener("click", confirmNewTag);
  elements.newTagInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmNewTag();
    }
  });
  elements.cancelEditButton.addEventListener("click", () => setEditDialogOpen(false));
  elements.confirmEditButton.addEventListener("click", confirmProjectEdit);
  elements.editDialogOverlay.addEventListener("click", (event) => {
    if (event.target === elements.editDialogOverlay) {
      setEditDialogOpen(false);
    }
  });
  elements.newTagDialogOverlay.addEventListener("click", (event) => {
    if (event.target === elements.newTagDialogOverlay) {
      setNewTagDialogOpen(false);
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!elements.newTagDialogOverlay.hidden) {
      setNewTagDialogOpen(false);
    } else if (!elements.editDialogOverlay.hidden) {
      setEditDialogOpen(false);
    } else if (!elements.addDialogOverlay.hidden) {
      setAddDialogOpen(false);
    } else if (!elements.sortPanel.hidden) {
      setSortPanelOpen(false);
    } else if (!elements.filterPanel.hidden) {
      elements.filterPanel.hidden = true;
      elements.filterButton.setAttribute("aria-expanded", "false");
    }
  });
  window.addEventListener("resize", scheduleFolderTitleFit);

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
