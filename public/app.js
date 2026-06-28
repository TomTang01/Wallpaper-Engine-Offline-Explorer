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
  pageSize: 20,
  sortMode: "default",
  searchQuery: "",
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
  addTags: new Set(),
  addAvailableTags: [],
  addTagDisplayOrder: [],
  editItem: null,
  editTags: new Set(),
  editAvailableTags: [],
  editTagDisplayOrder: [],
  activeTagContext: "edit",
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
  addTagDropdownButton: document.querySelector("#addTagDropdownButton"),
  addTagDropdownPanel: document.querySelector("#addTagDropdownPanel"),
  addTagSearchInput: document.querySelector("#addTagSearchInput"),
  addShowNewTagButton: document.querySelector("#addShowNewTagButton"),
  addTagOptions: document.querySelector("#addTagOptions"),
  cancelAddButton: document.querySelector("#cancelAddButton"),
  confirmAddButton: document.querySelector("#confirmAddButton"),
  editDialogOverlay: document.querySelector("#editDialogOverlay"),
  editDialogTitle: document.querySelector("#editDialogTitle"),
  editOpenFolderButton: document.querySelector("#editOpenFolderButton"),
  editTypeSelect: document.querySelector("#editTypeSelect"),
  tagDropdownButton: document.querySelector("#tagDropdownButton"),
  tagDropdownPanel: document.querySelector("#tagDropdownPanel"),
  tagSearchInput: document.querySelector("#tagSearchInput"),
  showNewTagButton: document.querySelector("#showNewTagButton"),
  tagOptions: document.querySelector("#tagOptions"),
  cancelEditButton: document.querySelector("#cancelEditButton"),
  confirmEditButton: document.querySelector("#confirmEditButton"),
  editDeleteButton: document.querySelector("#editDeleteButton"),
  newTagDialogOverlay: document.querySelector("#newTagDialogOverlay"),
  newTagInput: document.querySelector("#newTagInput"),
  cancelNewTagButton: document.querySelector("#cancelNewTagButton"),
  confirmNewTagButton: document.querySelector("#confirmNewTagButton"),
  titleSearchInput: document.querySelector("#titleSearchInput"),
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
let searchTimer;

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
  state.addTags = new Set();
  state.addAvailableTags = normalizeTagList(state.availableTags);
  state.addTagDisplayOrder = [];
  elements.addItemForm.reset();
  elements.addTagSearchInput.value = "";
  elements.selectedFileName.textContent = "or click to choose one";
  elements.fileDropZone.classList.remove("drag-over");
  elements.confirmAddButton.textContent = "Add";
  setTagDropdownOpen("add", false);
  updateTagDropdownButton("add");
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

function checkedTagsFirst(tags, selectedTags) {
  return [
    ...tags.filter((tag) => selectedTags.has(tag)),
    ...tags.filter((tag) => !selectedTags.has(tag)),
  ];
}

function getTagPicker(context) {
  if (context === "add") {
    return {
      tagsKey: "addTags",
      availableKey: "addAvailableTags",
      displayOrderKey: "addTagDisplayOrder",
      button: elements.addTagDropdownButton,
      panel: elements.addTagDropdownPanel,
      searchInput: elements.addTagSearchInput,
      options: elements.addTagOptions,
    };
  }

  return {
    tagsKey: "editTags",
    availableKey: "editAvailableTags",
    displayOrderKey: "editTagDisplayOrder",
    button: elements.tagDropdownButton,
    panel: elements.tagDropdownPanel,
    searchInput: elements.tagSearchInput,
    options: elements.tagOptions,
  };
}

function findExistingTag(tag, context) {
  const picker = getTagPicker(context);
  const key = tag.trim().toLowerCase();
  return state[picker.availableKey].find((existing) => existing.toLowerCase() === key);
}

function refreshTagDisplayOrder(context) {
  const picker = getTagPicker(context);
  state[picker.displayOrderKey] = checkedTagsFirst(
    state[picker.availableKey],
    state[picker.tagsKey]
  );
}

function getTagDisplayOrder(context) {
  const picker = getTagPicker(context);
  const available = new Set(state[picker.availableKey]);
  const ordered = state[picker.displayOrderKey].filter((tag) => available.has(tag));
  const orderedSet = new Set(ordered);
  const missing = state[picker.availableKey].filter((tag) => !orderedSet.has(tag));

  if (missing.length || ordered.length !== state[picker.displayOrderKey].length) {
    state[picker.displayOrderKey] = [...ordered, ...missing];
  }

  return state[picker.displayOrderKey];
}

function updateTagDropdownButton(context) {
  const picker = getTagPicker(context);
  const count = state[picker.tagsKey].size;
  picker.button.textContent =
    count === 0 ? "Choose tags" : `${count} tag${count === 1 ? "" : "s"} selected`;
}

function renderTagOptions(context = state.activeTagContext) {
  const picker = getTagPicker(context);
  picker.options.textContent = "";
  const query = picker.searchInput.value.trim().toLowerCase();
  const tags = getTagDisplayOrder(context).filter((tag) =>
    tag.toLowerCase().includes(query)
  );

  if (!tags.length) {
    const empty = document.createElement("div");
    empty.className = "tag-empty";
    empty.textContent = query ? "No matching tags." : "No tags yet.";
    picker.options.append(empty);
    updateTagDropdownButton(context);
    return;
  }

  const fragment = document.createDocumentFragment();
  tags.forEach((tag) => {
    const option = document.createElement("label");
    option.className = "tag-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = tag;
    checkbox.checked = state[picker.tagsKey].has(tag);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state[picker.tagsKey].add(tag);
      } else {
        state[picker.tagsKey].delete(tag);
      }
      updateTagDropdownButton(context);
    });

    const text = document.createElement("span");
    text.textContent = tag;
    option.append(checkbox, text);
    fragment.append(option);
  });

  picker.options.append(fragment);
  updateTagDropdownButton(context);
}

function setTagDropdownOpen(context, isOpen) {
  const picker = getTagPicker(context);
  picker.panel.hidden = !isOpen;
  picker.button.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) {
    state.activeTagContext = context;
    refreshTagDisplayOrder(context);
    picker.searchInput.focus();
    renderTagOptions(context);
  } else {
    refreshTagDisplayOrder(context);
  }
}

function trapTagDropdownWheel(context, event) {
  const picker = getTagPicker(context);
  if (picker.panel.hidden || !picker.panel.contains(event.target)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (picker.options.scrollHeight <= picker.options.clientHeight) {
    return;
  }

  picker.options.scrollTop += event.deltaY;
}

function setEditDialogOpen(isOpen) {
  elements.editDialogOverlay.hidden = !isOpen;
  if (!isOpen) {
    state.editItem = null;
    state.editTags = new Set();
    state.editAvailableTags = [];
    state.editTagDisplayOrder = [];
    elements.tagSearchInput.value = "";
    elements.editDialogTitle.textContent = "Edit item";
    setTagDropdownOpen("edit", false);
  }
}

function openEditDialog(item) {
  state.editItem = item;
  elements.editDialogTitle.textContent = item.displayName || item.name;
  state.editTags = new Set(normalizeTagList(item.tags || []));
  state.editAvailableTags = normalizeTagList([
    ...state.availableTags,
    ...state.editTags,
  ]);
  refreshTagDisplayOrder("edit");
  elements.editTypeSelect.value = DEFAULT_TYPES.includes(item.type) ? item.type : "other";
  elements.tagSearchInput.value = "";
  setEditDialogOpen(true);
  renderTagOptions("edit");
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

  const context = state.activeTagContext;
  const picker = getTagPicker(context);
  const existing = findExistingTag(newTag, context);
  const tag = existing || newTag;
  if (!existing) {
    state[picker.availableKey] = normalizeTagList([...state[picker.availableKey], tag]);
  }
  state[picker.tagsKey].add(tag);
  refreshTagDisplayOrder(context);
  picker.searchInput.value = "";
  setNewTagDialogOpen(false);
  setTagDropdownOpen(context, true);
  renderTagOptions(context);
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
  const tags = state.addTags.size ? Array.from(state.addTags) : ["Untagged"];
  tags.forEach((tag) => params.append("tag", tag));

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
  preview.role = "button";
  preview.tabIndex = 0;
  preview.title = "Edit item";
  preview.ariaLabel = `Edit ${item.displayName || item.name}`;
  preview.addEventListener("click", () => openEditDialog(item));
  preview.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openEditDialog(item);
    }
  });

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

  card.append(header, preview);
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

function scrollToPageTop() {
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
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

  checkedTagsFirst(availableTags, state.selectedTags).forEach((tag) => {
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
      loadPage({ scrollToTop: true });
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
      loadPage({ scrollToTop: true });
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

async function loadPage(options = {}) {
  const requestId = ++state.scanRequestId;
  setLoading(true);
  elements.statusText.textContent = "Scanning folders...";

  const params = new URLSearchParams({
    rootPath: state.rootPath,
    page: String(state.page),
    pageSize: String(state.pageSize),
    sortMode: state.sortMode,
  });
  if (state.searchQuery) {
    params.set("search", state.searchQuery);
  }
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
    state.searchQuery = data.searchQuery || "";
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
    const hasSearch = state.searchQuery.length > 0;
    const filterText =
      allTypesSelected && !hasTagFilter && !hasSearch
        ? ""
        : ` (${state.totalFolders} matching ${state.totalUnfilteredFolders} total)`;
    elements.statusText.textContent = `${state.totalFolders} folders found${filterText}. Page ${state.page} of ${state.totalPages}.`;
    renderSortControl();
    renderTypeFilters(state.availableTypes, state.selectedTypes);
    renderTagFilters(state.availableTags, state.selectedTags);
    renderItems(data.items);
    setLoading(false);
    renderPagination();
    if (options.scrollToTop) {
      scrollToPageTop();
    }
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

  elements.titleSearchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.searchQuery = elements.titleSearchInput.value.trim();
      state.page = 1;
      loadPage({ scrollToTop: true });
    }, 120);
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
  elements.addTagDropdownButton.addEventListener("click", () => {
    setTagDropdownOpen("add", elements.addTagDropdownPanel.hidden);
  });
  elements.addTagSearchInput.addEventListener("input", () => renderTagOptions("add"));
  elements.addTagDropdownPanel.addEventListener(
    "wheel",
    (event) => trapTagDropdownWheel("add", event),
    { passive: false }
  );
  elements.addShowNewTagButton.addEventListener("click", () => {
    state.activeTagContext = "add";
    setNewTagDialogOpen(true);
  });
  elements.editOpenFolderButton.addEventListener("click", () => {
    if (state.editItem) openFolder(state.editItem.folderPath);
  });
  elements.editDeleteButton.addEventListener("click", () => {
    if (!state.editItem) return;
    const item = state.editItem;
    setEditDialogOpen(false);
    deleteFolder(item);
  });
  elements.tagDropdownButton.addEventListener("click", () => {
    setTagDropdownOpen("edit", elements.tagDropdownPanel.hidden);
  });
  elements.tagSearchInput.addEventListener("input", () => renderTagOptions("edit"));
  elements.tagDropdownPanel.addEventListener(
    "wheel",
    (event) => trapTagDropdownWheel("edit", event),
    { passive: false }
  );
  elements.showNewTagButton.addEventListener("click", () => {
    state.activeTagContext = "edit";
    setNewTagDialogOpen(true);
  });
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
