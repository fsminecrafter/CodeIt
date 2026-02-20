// ═══════════════════════════════════════════════════════════
//  CodeIt IDE — app.js (ES Module, CodeMirror 6)
// ═══════════════════════════════════════════════════════════

import { EditorView, keymap, highlightActiveLine, lineNumbers,
         highlightActiveLineGutter, drawSelection, dropCursor,
         rectangularSelection, crosshairCursor, ViewUpdate } from "@codemirror/view";
import { EditorState, StateEffect, StateField, RangeSetBuilder, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches, SearchQuery,
         setSearchQuery, findNext, findPrevious, getSearchQuery,
         SearchCursor } from "@codemirror/search";
import { indentOnInput, bracketMatching, foldGutter,
         syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion,
         completionKeymap } from "@codemirror/autocomplete";
import { lintKeymap } from "@codemirror/lint";
import { python }     from "@codemirror/lang-python";
import { cpp }        from "@codemirror/lang-cpp";
import { javascript } from "@codemirror/lang-javascript";
import { html }       from "@codemirror/lang-html";
import { css }        from "@codemirror/lang-css";
import { json }       from "@codemirror/lang-json";
import { markdown }   from "@codemirror/lang-markdown";
import { oneDark }    from "@codemirror/theme-one-dark";
import { tags }       from "@lezer/highlight";

// ─── Compartments (reconfigurable extensions) ───────────────
const langCompartment = new Compartment();

// ─── Persistent editor view ─────────────────────────────────
let editorView = null;

function buildEditorExtensions(langExt) {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    foldGutter(),
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    rectangularSelection(),
    crosshairCursor(),
    autocompletion(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    oneDark,
    langCompartment.of(langExt || []),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...completionKeymap,
      ...lintKeymap,
      ...searchKeymap,
      indentWithTab,
      { key: "Ctrl-s", run: () => { saveFile(); return true; } },
      { key: "Ctrl-f", run: () => { toggleFind(true); return true; } },
      { key: "Escape", run: () => { if (findBarVisible) { toggleFind(false); return true; } return false; } },
    ]),
    EditorView.updateListener.of(update => {
      if (update.docChanged) {
        const f = getCurrentFile();
        if (f) {
          f.content = update.state.doc.toString();
          f.modified = true;
          markTabModified(current, true);
        }
      }
    }),
    EditorView.lineWrapping,
    EditorView.theme({
      "&": { background: "var(--bg)", color: "var(--text)", height: "100%" },
      ".cm-content": { caretColor: "var(--accent2)", padding: "4px 0" },
      ".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "14px", overflow: "auto" },
    })
  ];
}

function initEditor() {
  const container = document.getElementById("cm-editor");
  container.style.height = "100%";

  const startState = EditorState.create({
    doc: '',
    extensions: buildEditorExtensions(python())
  });

  editorView = new EditorView({ state: startState, parent: container });
}

function setEditorContent(content, langExt) {
  if (!editorView) return;
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: content || '' },
    effects: langCompartment.reconfigure(langExt || [])
  });
}

function getEditorContent() {
  return editorView ? editorView.state.doc.toString() : '';
}

function getLangExtension(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  const map = { py: python(), c: cpp(), cpp: cpp(), h: cpp(), js: javascript(),
                html: html(), css: css(), json: json(), md: markdown(), ts: javascript({ typescript: true }) };
  return map[ext] || [];
}

// ═══════════════════════════════════════════════════════════
//  PROJECT DATA
// ═══════════════════════════════════════════════════════════

// files: Map of "path" → { content, handle, modified }
// Paths are relative to root, e.g. "main.py" or "src/utils.py"
// folders: Set of folder paths (for display in tree)
const files   = new Map();
const folders = new Set();
let current = null;  // currently open file path, or "__run__"

// Folder access handle for autosave
let rootDirHandle = null;
let autosaveFolderHandle = null;
let autosaveEnabled = false;
let autosaveInterval = null;

function getCurrentFile() {
  return (current && current !== "__run__") ? files.get(current) : null;
}

// ═══════════════════════════════════════════════════════════
//  MENU SYSTEM
// ═══════════════════════════════════════════════════════════

document.querySelectorAll(".menu").forEach(menu => {
  menu.querySelector(".menu-label").addEventListener("click", e => {
    e.stopPropagation();
    const isOpen = menu.classList.contains("open");
    document.querySelectorAll(".menu").forEach(m => m.classList.remove("open"));
    if (!isOpen) menu.classList.add("open");
  });
});
document.addEventListener("click", () => {
  document.querySelectorAll(".menu").forEach(m => m.classList.remove("open"));
});
// Prevent dropdown clicks from closing menu
document.querySelectorAll(".dropdown").forEach(d =>
  d.addEventListener("click", e => e.stopPropagation())
);

function closeMenus() {
  document.querySelectorAll(".menu").forEach(m => m.classList.remove("open"));
}

// ═══════════════════════════════════════════════════════════
//  FILE TREE
// ═══════════════════════════════════════════════════════════

// treeState: which folder paths are open
const treeExpanded = new Set();

function getFileIcon(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  const icons = { py:'🐍', c:'🔵', cpp:'🔷', h:'📄', js:'📜', ts:'📘', html:'🌐', css:'🎨', json:'{}', md:'📝', txt:'📄', gitignore:'🔒', toml:'⚙', yaml:'⚙', yml:'⚙' };
  return icons[ext] || '📄';
}

function buildTree() {
  // Build a tree structure from file paths and folder paths
  const tree = {}; // node = { type:'file'|'folder', children:{} }

  function ensureFolder(parts, node) {
    if (!parts.length) return node;
    const name = parts[0];
    if (!node[name]) node[name] = { type:'folder', children:{} };
    return ensureFolder(parts.slice(1), node[name].children);
  }

  // Add explicit folders
  for (const folderPath of folders) {
    const parts = folderPath.split('/');
    ensureFolder(parts, tree);
  }

  // Add files
  for (const [path] of files) {
    const parts = path.split('/');
    const filename = parts.pop();
    const parent = ensureFolder(parts, tree);
    parent[filename] = { type:'file', path };
  }

  return tree;
}

function renderTree() {
  const treeEl = document.getElementById("file-tree");
  treeEl.innerHTML = '';

  const tree = buildTree();

  function renderNode(node, name, depth, parentPath) {
    const path = parentPath ? parentPath + '/' + name : name;
    const el = document.createElement("div");

    if (node.type === 'folder') {
      el.className = "tree-item folder-item";
      el.style.paddingLeft = (depth * 16 + 4) + "px";

      const toggle = document.createElement("span");
      toggle.className = "tree-toggle" + (treeExpanded.has(path) ? " open" : "");
      toggle.textContent = "▶";

      const icon = document.createElement("span");
      icon.className = "tree-icon";
      icon.textContent = treeExpanded.has(path) ? "📂" : "📁";

      const label = document.createElement("span");
      label.className = "tree-label";
      label.textContent = name;

      el.append(toggle, icon, label);

      el.addEventListener("click", e => {
        e.stopPropagation();
        if (treeExpanded.has(path)) treeExpanded.delete(path);
        else treeExpanded.add(path);
        renderTree();
      });

      el.addEventListener("contextmenu", e => {
        e.preventDefault();
        showCtxMenu(e.clientX, e.clientY, { type:'folder', path });
      });

      treeEl.appendChild(el);

      if (treeExpanded.has(path)) {
        const sorted = Object.entries(node.children).sort(([an, a], [bn, b]) => {
          if (a.type === b.type) return an.localeCompare(bn);
          return a.type === 'folder' ? -1 : 1;
        });
        for (const [childName, childNode] of sorted) {
          renderNode(childNode, childName, depth + 1, path);
        }
      }
    } else {
      // file
      el.className = "tree-item" + (node.path === current ? " active" : "");
      el.style.paddingLeft = (depth * 16 + 20) + "px";

      const icon = document.createElement("span");
      icon.className = "tree-icon";
      icon.textContent = getFileIcon(name);

      const label = document.createElement("span");
      label.className = "tree-label";
      label.textContent = name;

      el.append(icon, label);
      el.addEventListener("click", () => openTab(node.path));
      el.addEventListener("contextmenu", e => {
        e.preventDefault();
        showCtxMenu(e.clientX, e.clientY, { type:'file', path: node.path });
      });

      treeEl.appendChild(el);
    }
  }

  // Sort top-level: folders first
  const sorted = Object.entries(tree).sort(([an, a], [bn, b]) => {
    if (a.type === b.type) return an.localeCompare(bn);
    return a.type === 'folder' ? -1 : 1;
  });

  if (sorted.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:16px 12px;color:var(--text3);font-size:12px;text-align:center;";
    empty.textContent = "No files yet. Create or open a file.";
    treeEl.appendChild(empty);
    return;
  }

  for (const [name, node] of sorted) {
    renderNode(node, name, 0, '');
  }
}

// ═══════════════════════════════════════════════════════════
//  CONTEXT MENU
// ═══════════════════════════════════════════════════════════

const ctxMenu = document.getElementById("ctx-menu");
let ctxTarget = null;

function showCtxMenu(x, y, target) {
  ctxTarget = target;
  ctxMenu.style.left = x + "px";
  ctxMenu.style.top  = y + "px";
  ctxMenu.classList.add("visible");
}

function hideCtxMenu() { ctxMenu.classList.remove("visible"); }

document.addEventListener("click", hideCtxMenu);
document.addEventListener("contextmenu", e => {
  if (!e.target.closest("#file-tree") && !e.target.closest("#ctx-menu")) hideCtxMenu();
});

document.getElementById("ctx-rename").addEventListener("click", () => {
  hideCtxMenu();
  if (!ctxTarget) return;
  const parts = ctxTarget.path.split('/');
  const oldName = parts[parts.length - 1];
  const newName = prompt("Rename to:", oldName);
  if (!newName || newName === oldName) return;
  parts[parts.length - 1] = newName;
  const newPath = parts.join('/');

  if (ctxTarget.type === 'file') {
    const f = files.get(ctxTarget.path);
    files.delete(ctxTarget.path);
    files.set(newPath, f);
    if (current === ctxTarget.path) {
      // update tab
      const tab = [...document.getElementById("tabs").children].find(t => t.dataset.name === ctxTarget.path);
      if (tab) { tab.dataset.name = newPath; tab.querySelector("span:nth-child(2)").textContent = newName; }
      current = newPath;
    }
  } else {
    folders.delete(ctxTarget.path);
    folders.add(newPath);
    // rename all files under that folder
    for (const [p, f] of [...files.entries()]) {
      if (p.startsWith(ctxTarget.path + '/')) {
        files.delete(p);
        files.set(newPath + p.slice(ctxTarget.path.length), f);
      }
    }
  }
  renderTree();
});

document.getElementById("ctx-new-file").addEventListener("click", () => {
  hideCtxMenu();
  const folder = ctxTarget?.type === 'folder' ? ctxTarget.path : (ctxTarget?.path ? ctxTarget.path.split('/').slice(0,-1).join('/') : '');
  createNewFile(folder);
});

document.getElementById("ctx-new-folder").addEventListener("click", () => {
  hideCtxMenu();
  const parent = ctxTarget?.type === 'folder' ? ctxTarget.path : (ctxTarget?.path ? ctxTarget.path.split('/').slice(0,-1).join('/') : '');
  createNewFolder(parent);
});

document.getElementById("ctx-delete").addEventListener("click", () => {
  hideCtxMenu();
  if (!ctxTarget) return;
  if (!confirm(`Delete "${ctxTarget.path}"?`)) return;
  if (ctxTarget.type === 'file') {
    files.delete(ctxTarget.path);
    if (current === ctxTarget.path) {
      closeTab(ctxTarget.path);
    }
  } else {
    folders.delete(ctxTarget.path);
    for (const p of [...files.keys()]) {
      if (p.startsWith(ctxTarget.path + '/')) {
        files.delete(p);
        if (current === p) closeTab(p);
      }
    }
  }
  renderTree();
});

// ═══════════════════════════════════════════════════════════
//  FILE / FOLDER CREATION
// ═══════════════════════════════════════════════════════════

function createNewFile(inFolder) {
  const name = prompt("File name:", "new.py");
  if (!name || !name.trim()) return;
  const path = inFolder ? inFolder + '/' + name.trim() : name.trim();
  if (inFolder) treeExpanded.add(inFolder);
  files.set(path, { handle: null, content: '', modified: false });
  renderTree();
  openTab(path);
}

function createNewFolder(parent) {
  const name = prompt("Folder name:", "folder");
  if (!name || !name.trim()) return;
  const path = parent ? parent + '/' + name.trim() : name.trim();
  folders.add(path);
  treeExpanded.add(path);
  renderTree();
}

// ═══════════════════════════════════════════════════════════
//  TABS
// ═══════════════════════════════════════════════════════════

const tabsEl = document.getElementById("tabs");
let dragSrc = null;

function openTab(path) {
  if (!files.has(path)) return;
  const existing = [...tabsEl.children].find(t => t.dataset.name === path);
  if (existing) { activateTab(path); return; }

  const tab = document.createElement("div");
  tab.className = "tab";
  tab.dataset.name = path;

  const icon = document.createElement("span");
  icon.className = "tab-icon";
  icon.textContent = getFileIcon(path);

  const title = document.createElement("span");
  title.textContent = path.split('/').pop();

  const close = document.createElement("span");
  close.className = "tab-close";
  close.textContent = "×";
  close.addEventListener("click", e => { e.stopPropagation(); closeTab(path); });

  tab.append(icon, title, close);
  tab.addEventListener("click", () => activateTab(path));

  // Draggable
  tab.draggable = true;
  tab.addEventListener("dragstart", e => {
    dragSrc = tab;
    e.dataTransfer.effectAllowed = "move";
    setTimeout(() => tab.classList.add("dragging"), 0);
  });
  tab.addEventListener("dragend", () => {
    tab.classList.remove("dragging");
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("drag-over"));
    dragSrc = null;
  });
  tab.addEventListener("dragover", e => {
    e.preventDefault();
    if (!dragSrc || dragSrc === tab || tab.id === "runTab") return;
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("drag-over"));
    tab.classList.add("drag-over");
  });
  tab.addEventListener("drop", e => {
    e.preventDefault();
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("drag-over"));
    if (!dragSrc || dragSrc === tab || tab.id === "runTab") return;
    const all = [...tabsEl.children];
    const si = all.indexOf(dragSrc), ti = all.indexOf(tab);
    tabsEl.insertBefore(dragSrc, si < ti ? tab.nextSibling : tab);
  });

  tabsEl.insertBefore(tab, document.getElementById("runTab"));
  activateTab(path);
}

function activateTab(name) {
  current = name;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  const tab = [...tabsEl.children].find(t => t.dataset.name === name);
  if (tab) tab.classList.add("active");

  if (name === "__run__") {
    document.getElementById("editor-wrap").classList.add("hidden");
  } else {
    document.getElementById("editor-wrap").classList.remove("hidden");
    const f = files.get(name);
    if (f !== undefined) {
      setEditorContent(f.content || '', getLangExtension(name));
    }
    editorView?.focus();
  }
  renderTree();
}

function closeTab(path) {
  const tab = [...tabsEl.children].find(t => t.dataset.name === path);
  if (tab) tab.remove();
  if (current === path) {
    current = null;
    setEditorContent('', []);
    const next = [...tabsEl.children].find(t => t.dataset.name && t.dataset.name !== "__run__");
    if (next) activateTab(next.dataset.name);
  }
  renderTree();
}

function markTabModified(path, modified) {
  const tab = [...tabsEl.children].find(t => t.dataset.name === path);
  if (!tab) return;
  if (modified) tab.classList.add("tab-modified");
  else tab.classList.remove("tab-modified");
}

// ─── Run tab ────────────────────────────────────────────────
const runTabEl = document.createElement("div");
runTabEl.className = "tab run-tab";
runTabEl.id = "runTab";
runTabEl.dataset.name = "__run__";

const runTabTitle = document.createElement("span");
runTabTitle.textContent = "▶ Run";
runTabEl.appendChild(runTabTitle);

const langSelect = document.createElement("select");
langSelect.id = "lang-select";
["Python","C","C++"].forEach(l => {
  const o = document.createElement("option");
  o.value = l; o.textContent = l;
  langSelect.appendChild(o);
});
langSelect.addEventListener("click", e => e.stopPropagation());
runTabEl.appendChild(langSelect);

const runBtn = document.createElement("button");
runBtn.id = "run-btn";
runBtn.textContent = "▶ Run";
runBtn.addEventListener("click", e => { e.stopPropagation(); runCurrent(); });
runTabEl.appendChild(runBtn);

runTabEl.addEventListener("click", () => activateTab("__run__"));
tabsEl.appendChild(runTabEl);

// ═══════════════════════════════════════════════════════════
//  TERMINAL
// ═══════════════════════════════════════════════════════════

const terminalEl = document.getElementById("terminal");
const term = new Terminal({
  cols: 80, rows: 12,
  theme: { background: '#141414', foreground: '#e2e8f0', cursor: '#60a5fa', selectionBackground: 'rgba(59,130,246,0.3)' },
  fontFamily: "'IBM Plex Mono', 'Fira Code', Consolas, monospace",
  fontSize: 13,
  convertEol: true,
  scrollback: 2000
});
term.open(terminalEl);
term.focus();

function tw(text) { term.writeln(text); }
function tc() { term.clear(); }

document.getElementById("btn-term-clear").addEventListener("click", tc);
document.getElementById("btn-term-kill").addEventListener("click", () => {
  worker?.terminate();
  worker = createWorker();
  tw("\x1b[33m[Process killed]\x1b[0m");
});

// ─── Terminal resize ─────────────────────────────────────────
const termResizeBar = document.getElementById("terminal-resize");
let termResizing = false, termResizeStartY = 0, termResizeStartH = 0;
termResizeBar.addEventListener("mousedown", e => {
  termResizing = true;
  termResizeStartY = e.clientY;
  termResizeStartH = terminalEl.offsetHeight;
  termResizeBar.classList.add("dragging");
  e.preventDefault();
});
document.addEventListener("mousemove", e => {
  if (!termResizing) return;
  const delta = termResizeStartY - e.clientY;
  terminalEl.style.height = Math.max(60, Math.min(600, termResizeStartH + delta)) + "px";
});
document.addEventListener("mouseup", () => {
  if (termResizing) { termResizing = false; termResizeBar.classList.remove("dragging"); }
});

// ─── Sidebar resize ──────────────────────────────────────────
const sidebarResizeBar = document.getElementById("sidebar-resize");
const sidebarEl = document.getElementById("sidebar");
let sbResizing = false, sbResizeStartX = 0, sbResizeStartW = 0;
sidebarResizeBar.addEventListener("mousedown", e => {
  sbResizing = true;
  sbResizeStartX = e.clientX;
  sbResizeStartW = sidebarEl.offsetWidth;
  sidebarResizeBar.classList.add("dragging");
  e.preventDefault();
});
document.addEventListener("mousemove", e => {
  if (!sbResizing) return;
  const w = Math.max(140, Math.min(500, sbResizeStartW + e.clientX - sbResizeStartX));
  sidebarEl.style.width = w + "px";
});
document.addEventListener("mouseup", () => {
  if (sbResizing) { sbResizing = false; sidebarResizeBar.classList.remove("dragging"); }
});

// ═══════════════════════════════════════════════════════════
//  FIND BAR
// ═══════════════════════════════════════════════════════════

const findBar = document.getElementById("find-bar");
const findInput = document.getElementById("find-input");
const findInfo = document.getElementById("find-info");
let findBarVisible = false;
let currentQuery = "";

function toggleFind(show) {
  findBarVisible = show !== undefined ? show : !findBarVisible;
  if (findBarVisible) {
    findBar.classList.add("visible");
    findInput.focus();
    findInput.select();
    // Pre-fill with selection
    const sel = editorView?.state.selection.main;
    if (sel && sel.from !== sel.to) {
      findInput.value = editorView.state.sliceDoc(sel.from, sel.to).split('\n')[0];
    }
    doFind(findInput.value);
  } else {
    findBar.classList.remove("visible");
    // Clear search highlights
    if (editorView) {
      editorView.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) });
    }
    findInfo.textContent = '';
    findInput.classList.remove("no-match");
    editorView?.focus();
  }
}

function doFind(query) {
  currentQuery = query;
  if (!editorView) return;

  if (!query) {
    editorView.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) });
    findInfo.textContent = '';
    findInput.classList.remove("no-match");
    return;
  }

  editorView.dispatch({
    effects: setSearchQuery.of(new SearchQuery({ search: query, caseSensitive: false }))
  });

  // Count matches
  const doc = editorView.state.doc.toString().toLowerCase();
  const q = query.toLowerCase();
  let count = 0, pos = 0;
  while ((pos = doc.indexOf(q, pos)) !== -1) { count++; pos += q.length; }

  if (count === 0) {
    findInfo.textContent = "No results";
    findInput.classList.add("no-match");
  } else {
    findInfo.textContent = `${count} match${count !== 1 ? 'es' : ''}`;
    findInput.classList.remove("no-match");
  }
}

findInput.addEventListener("input", () => doFind(findInput.value));
findInput.addEventListener("keydown", e => {
  if (e.key === "Enter") { e.shiftKey ? findPrevious(editorView) : findNext(editorView); }
  if (e.key === "Escape") toggleFind(false);
});

document.getElementById("find-next").addEventListener("click", () => findNext(editorView));
document.getElementById("find-prev").addEventListener("click", () => findPrevious(editorView));
document.getElementById("find-close").addEventListener("click", () => toggleFind(false));

// ═══════════════════════════════════════════════════════════
//  FILE OPERATIONS
// ═══════════════════════════════════════════════════════════

function hasFSAPI() { return typeof window.showOpenFilePicker === 'function'; }

async function openFile() {
  closeMenus();
  if (!hasFSAPI()) {
    const input = Object.assign(document.createElement("input"), { type:"file", multiple:true });
    input.onchange = async () => {
      for (const f of input.files) {
        files.set(f.name, { handle: null, content: await f.text(), modified: false });
      }
      renderTree();
      if (input.files[0]) openTab(input.files[0].name);
    };
    input.click(); return;
  }
  try {
    const handles = await window.showOpenFilePicker({ multiple: true });
    let first = null;
    for (const h of handles) {
      const f = await h.getFile();
      const text = await f.text();
      files.set(f.name, { handle: h, content: text, modified: false });
      if (!first) first = f.name;
    }
    renderTree();
    if (first) openTab(first);
  } catch (e) { if (e.name !== "AbortError") console.error(e); }
}

async function openFolder() {
  closeMenus();
  if (typeof window.showDirectoryPicker !== 'function') {
    toast("Open Folder requires Chrome/Edge over http://", 'err'); return;
  }
  try {
    const dir = await window.showDirectoryPicker();
    rootDirHandle = dir;
    document.getElementById("folder-root-name").textContent = dir.name;

    // Clear existing
    files.clear(); folders.clear(); treeExpanded.clear();

    await loadDirRecursive(dir, '');
    renderTree();
    // Open first relevant file
    const prio = ['main.py','index.py','main.cpp','main.c','index.js','index.html'];
    let picked = null;
    for (const p of prio) { if (files.has(p)) { picked = p; break; } }
    if (!picked) picked = files.keys().next().value;
    if (picked) openTab(picked);
  } catch (e) { if (e.name !== "AbortError") console.error(e); }
}

async function loadDirRecursive(dirHandle, prefix) {
  for await (const entry of dirHandle.values()) {
    const path = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.kind === 'directory') {
      folders.add(path);
      treeExpanded.add(path);
      await loadDirRecursive(entry, path);
    } else if (entry.kind === 'file') {
      const f = await entry.getFile();
      if (f.size < 2 * 1024 * 1024) {
        try {
          files.set(path, { handle: entry, content: await f.text(), modified: false });
        } catch(_) {}
      }
    }
  }
}

async function setAutosaveFolder() {
  closeMenus();
  if (typeof window.showDirectoryPicker !== 'function') {
    toast("Requires Chrome/Edge over http://", 'err'); return;
  }
  try {
    autosaveFolderHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    toast(`AutoSave folder: ${autosaveFolderHandle.name}`, 'ok');
    updateAutosaveIndicator();
  } catch (e) { if (e.name !== "AbortError") console.error(e); }
}

// ═══════════════════════════════════════════════════════════
//  SAVE
// ═══════════════════════════════════════════════════════════

async function saveFile() {
  const f = getCurrentFile();
  if (!f) return;

  // Try to write to handle
  if (f.handle) {
    try {
      const perm = await f.handle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") await f.handle.requestPermission({ mode: "readwrite" });
      const w = await f.handle.createWritable();
      await w.write(f.content); await w.close();
      f.modified = false;
      markTabModified(current, false);
      toast("Saved", 'ok'); return;
    } catch(_) {}
  }
  await saveAs();
}

async function saveAs() {
  closeMenus();
  const f = getCurrentFile();
  if (!f) return;
  if (!hasFSAPI() || typeof window.showSaveFilePicker !== 'function') {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([f.content], { type:"text/plain" }));
    a.download = current.split('/').pop() || "file.py";
    a.click();
    return;
  }
  try {
    const handle = await window.showSaveFilePicker({ suggestedName: current.split('/').pop() || "file.py" });
    const w = await handle.createWritable();
    await w.write(f.content); await w.close();
    f.handle = handle; f.modified = false;
    markTabModified(current, false);
    toast("Saved", 'ok');
  } catch (e) { if (e.name !== "AbortError") console.error(e); }
}

// ─── Autosave ────────────────────────────────────────────────
async function doAutosave() {
  if (!autosaveEnabled) return;

  for (const [path, f] of files) {
    if (!f.modified) continue;

    // Try to save via file handle
    if (f.handle) {
      try {
        const perm = await f.handle.queryPermission({ mode: "readwrite" });
        if (perm === "granted") {
          const w = await f.handle.createWritable();
          await w.write(f.content); await w.close();
          f.modified = false;
          markTabModified(path, false);
        }
      } catch(_) {}
    }
    // Save to autosave folder
    else if (autosaveFolderHandle) {
      try {
        // Create subdirs if needed
        const parts = path.split('/');
        const fname = parts.pop();
        let dir = autosaveFolderHandle;
        for (const p of parts) {
          dir = await dir.getDirectoryHandle(p, { create: true });
        }
        const fileHandle = await dir.getFileHandle(fname, { create: true });
        const w = await fileHandle.createWritable();
        await w.write(f.content); await w.close();
        f.modified = false;
        markTabModified(path, false);
      } catch(_) {}
    }
  }
  updateAutosaveIndicator();
}

function toggleAutosave() {
  closeMenus();
  autosaveEnabled = !autosaveEnabled;
  document.getElementById("autosave-label").textContent = `Auto Save: ${autosaveEnabled ? "ON" : "OFF"}`;
  updateAutosaveIndicator();

  if (autosaveEnabled && !autosaveFolderHandle) {
    // Check if any file has a handle — that's enough
    const hasHandles = [...files.values()].some(f => f.handle);
    if (!hasHandles) {
      toast("Tip: Set an AutoSave folder for files without handles", 'info');
    }
  }
}

function updateAutosaveIndicator() {
  const ind = document.getElementById("autosave-indicator");
  const txt = document.getElementById("autosave-status-text");
  if (autosaveEnabled) {
    ind.classList.add("active");
    txt.textContent = autosaveFolderHandle ? `Saving to: ${autosaveFolderHandle.name}` : "Autosave on";
  } else {
    ind.classList.remove("active");
    txt.textContent = "Autosave off";
  }
}

setInterval(doAutosave, 5000);

// ═══════════════════════════════════════════════════════════
//  PACKAGE AS ZIP
// ═══════════════════════════════════════════════════════════

async function packageZip() {
  closeMenus();
  if (!window.JSZip) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
      s.onload = res; s.onerror = () => rej(new Error("Failed to load JSZip"));
      document.head.appendChild(s);
    }).catch(e => { toast("Could not load JSZip: " + e.message, 'err'); });
  }
  if (!window.JSZip) return;

  const zip = new window.JSZip();
  for (const [path, f] of files) zip.file(path, f.content);
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "codeit-project.zip";
  a.click();
  toast("Project packaged as .zip", 'ok');
}

// ═══════════════════════════════════════════════════════════
//  RUN
// ═══════════════════════════════════════════════════════════

async function runCurrent() {
  let code = null, filename = null;

  if (current && current !== "__run__" && files.has(current)) {
    code = files.get(current).content;
    filename = current;
  } else {
    const lang = langSelect.value;
    const ext = lang === "Python" ? ".py" : lang === "C++" ? ".cpp" : ".c";
    for (const [p, f] of files) {
      if (p.endsWith(ext)) { code = f.content; filename = p; break; }
    }
    if (!code) {
      const first = files.entries().next().value;
      if (first) { code = first[1].content; filename = first[0]; }
    }
  }

  if (code === null) { tw("\x1b[31mNo file to run.\x1b[0m"); return; }

  tc();
  tw(`\x1b[36m─── ${filename} [${langSelect.value}] ───\x1b[0m`);

  if (langSelect.value === "Python") {
    worker.postMessage({ type: "run", code });
  } else {
    await runCpp(code, langSelect.value);
  }
}

async function runCpp(code, lang) {
  const btn = document.getElementById("run-btn");
  btn.disabled = true; btn.textContent = "⏳";
  try {
    const buildRes = await fetch("/build", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang, code })
    });
    const buildData = await buildRes.json();
    if (buildData.error) {
      tw("\x1b[31m── Compile Error ──\x1b[0m");
      buildData.error.split('\n').forEach(l => l && tw("\x1b[31m" + l + "\x1b[0m")); return;
    }
    tw("\x1b[32m✓ Compiled\x1b[0m");
    const runRes = await fetch("/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exe: buildData.executable })
    });
    const runData = await runRes.json();
    if (runData.stdout) runData.stdout.split('\n').forEach(l => term.writeln(l));
    if (runData.stderr?.trim()) {
      tw("\x1b[31m── stderr ──\x1b[0m");
      runData.stderr.split('\n').forEach(l => l && tw("\x1b[31m" + l + "\x1b[0m"));
    }
    const ec = runData.exit_code ?? 0;
    tw(`\x1b[90m─── exit ${ec === 0 ? "\x1b[32m" : "\x1b[31m"}${ec}\x1b[90m ───\x1b[0m`);
  } catch (e) {
    tw("\x1b[31mFetch failed: " + e.message + "\x1b[0m");
    tw("\x1b[90mIs the server running?  python launch.py\x1b[0m");
  } finally {
    btn.disabled = false; btn.textContent = "▶ Run";
  }
}

// ═══════════════════════════════════════════════════════════
//  PYODIDE WORKER
// ═══════════════════════════════════════════════════════════

let pyVersion = "0.27.2";
let worker = createWorker();

function createWorker() {
  const w = new Worker("worker.js?v=" + pyVersion);
  w.onmessage = e => {
    if (e.data.type === "output") tw(e.data.text);
  };
  return w;
}
term.onData(data => worker?.postMessage({ type: "input", text: data }));

["0.27.2","0.26.4","0.25.1","0.24.1"].forEach(v => {
  const d = document.createElement("div");
  d.className = "dropdown-item";
  d.innerHTML = `<span>🐍</span><span>Pyodide ${v}</span>`;
  d.addEventListener("click", () => {
    pyVersion = v; worker.terminate(); worker = createWorker();
    tw(`\x1b[33mSwitched to Pyodide ${v}\x1b[0m`);
    closeMenus();
  });
  document.getElementById("py-versions").appendChild(d);
});

// ═══════════════════════════════════════════════════════════
//  PACKAGE MANAGER MODAL
// ═══════════════════════════════════════════════════════════

const pkgModal = document.getElementById("pkg-modal");
const pipLog   = document.getElementById("pip-log");
const ghLog    = document.getElementById("gh-log");
let installedPackages = [];
let ghDestHandle = null;

function openPkgModal() { pkgModal.classList.add("visible"); closeMenus(); }
function closePkgModal() { pkgModal.classList.remove("visible"); }

document.getElementById("pkg-modal-close").addEventListener("click", closePkgModal);
pkgModal.addEventListener("click", e => { if (e.target === pkgModal) closePkgModal(); });

// Mode tabs
document.querySelectorAll(".mode-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".mode-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".pkg-pane").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("pane-" + tab.dataset.pane).classList.add("active");
  });
});

function pkgLog(logEl, msg, type = 'info') {
  const span = document.createElement("span");
  span.className = "log-" + type;
  span.textContent = msg;
  logEl.appendChild(span);
  logEl.appendChild(document.createElement("br"));
  logEl.scrollTop = logEl.scrollHeight;
}

// ─── PIP ────────────────────────────────────────────────────
const pipInput = document.getElementById("pip-input");
const pipBtn   = document.getElementById("pip-install-btn");

pipBtn.addEventListener("click", async () => {
  const pkg = pipInput.value.trim();
  if (!pkg) return;
  pipBtn.disabled = true;
  pkgLog(pipLog, `Installing ${pkg}...`, 'info');

  // Send to worker
  worker.postMessage({ type: "install", package: pkg });

  // Listen for response
  const originalHandler = worker.onmessage;
  worker.onmessage = e => {
    if (e.data.type === "output") {
      pkgLog(pipLog, e.data.text, e.data.text.toLowerCase().includes("error") ? 'err' : 'ok');
      tw(e.data.text);
    }
    if (e.data.type === "installed" || (e.data.type === "output" && (e.data.text.includes("Installed") || e.data.text.includes("already installed")))) {
      pipBtn.disabled = false;
      installedPackages.push({ name: pkg, version: '' });
      renderInstalledList();
      pipInput.value = '';
      worker.onmessage = originalHandler;
    }
  };

  // Fallback re-enable after 30s
  setTimeout(() => { pipBtn.disabled = false; worker.onmessage = originalHandler; }, 30000);
});

pipInput.addEventListener("keydown", e => { if (e.key === "Enter") pipBtn.click(); });

function renderInstalledList() {
  const list = document.getElementById("pip-installed-list");
  list.innerHTML = '';
  if (!installedPackages.length) {
    list.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:6px 10px;">No packages tracked yet.</div>';
    return;
  }
  for (const pkg of installedPackages) {
    const item = document.createElement("div");
    item.className = "pkg-item";
    item.innerHTML = `<span class="pkg-item-name">${pkg.name}</span>
      <span class="pkg-item-version">${pkg.version || ''}</span>
      <button class="pkg-item-remove" title="Remove from list">×</button>`;
    item.querySelector(".pkg-item-remove").addEventListener("click", () => {
      installedPackages = installedPackages.filter(p => p.name !== pkg.name);
      renderInstalledList();
    });
    list.appendChild(item);
  }
}

// ─── GITHUB ─────────────────────────────────────────────────
const ghInput  = document.getElementById("gh-input");
const ghBranch = document.getElementById("gh-branch");
const ghBtn    = document.getElementById("gh-fetch-btn");
const ghDest   = document.getElementById("gh-dest-path");

document.getElementById("gh-pick-folder").addEventListener("click", async () => {
  if (typeof window.showDirectoryPicker !== 'function') {
    toast("Requires Chrome/Edge", 'err'); return;
  }
  try {
    ghDestHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    ghDest.textContent = ghDestHandle.name;
    toast(`Will save to: ${ghDestHandle.name}`, 'ok');
  } catch(e) { if (e.name !== "AbortError") console.error(e); }
});

ghBtn.addEventListener("click", async () => {
  let repoInput = ghInput.value.trim();
  if (!repoInput) return;

  // Normalize to "user/repo"
  repoInput = repoInput.replace("https://github.com/", "").replace(/\.git$/, "").replace(/\/$/, "");
  const branch = ghBranch.value.trim() || "main";

  ghLog.innerHTML = '';
  pkgLog(ghLog, `Fetching ${repoInput} @ ${branch}…`, 'info');
  ghBtn.disabled = true;

  try {
    // Use GitHub API to get tree
    const treeUrl = `https://api.github.com/repos/${repoInput}/git/trees/${branch}?recursive=1`;
    const treeRes = await fetch(treeUrl);
    if (!treeRes.ok) throw new Error(`GitHub API error: ${treeRes.status} ${treeRes.statusText}`);
    const treeData = await treeRes.json();

    const blobs = (treeData.tree || []).filter(n => n.type === 'blob');
    pkgLog(ghLog, `Found ${blobs.length} files. Downloading…`, 'info');

    let downloaded = 0;
    for (const node of blobs) {
      // Skip huge files
      if (node.size > 512 * 1024) {
        pkgLog(ghLog, `Skipped (too large): ${node.path}`, 'warn'); continue;
      }
      const rawUrl = `https://raw.githubusercontent.com/${repoInput}/${branch}/${node.path}`;
      try {
        const r = await fetch(rawUrl);
        if (!r.ok) { pkgLog(ghLog, `Failed: ${node.path}`, 'err'); continue; }
        const text = await r.text();

        // Save to folder if selected
        if (ghDestHandle) {
          const parts = node.path.split('/');
          const fname = parts.pop();
          let dir = ghDestHandle;
          for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
          const fh = await dir.getFileHandle(fname, { create: true });
          const w = await fh.createWritable();
          await w.write(text); await w.close();
        }

        // Always add to in-memory project
        const prefix = repoInput.split('/').pop() + '/';
        files.set(prefix + node.path, { handle: null, content: text, modified: false });
        if (!node.path.includes('/')) folders.add(prefix.slice(0,-1));
        else folders.add(prefix + node.path.split('/').slice(0,-1).join('/'));

        downloaded++;
        if (downloaded % 5 === 0) pkgLog(ghLog, `Downloaded ${downloaded}/${blobs.length}…`, 'info');
      } catch(e) { pkgLog(ghLog, `Error: ${node.path}: ${e.message}`, 'err'); }
    }

    pkgLog(ghLog, `✓ Done! ${downloaded} files added to project.`, 'ok');
    renderTree();
    toast(`${repoInput} fetched (${downloaded} files)`, 'ok');
  } catch(e) {
    pkgLog(ghLog, `Error: ${e.message}`, 'err');
    toast("GitHub fetch failed: " + e.message, 'err');
  } finally {
    ghBtn.disabled = false;
  }
});

ghInput.addEventListener("keydown", e => { if (e.key === "Enter") ghBtn.click(); });

// ═══════════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════════

function toast(msg, type = 'info') {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 2200);
}

// ═══════════════════════════════════════════════════════════
//  MENU ITEM WIRING
// ═══════════════════════════════════════════════════════════

document.getElementById("mi-new-file").addEventListener("click",         () => { closeMenus(); createNewFile(''); });
document.getElementById("mi-new-folder").addEventListener("click",       () => { closeMenus(); createNewFolder(''); });
document.getElementById("mi-open-file").addEventListener("click",        openFile);
document.getElementById("mi-open-folder").addEventListener("click",      openFolder);
document.getElementById("mi-save").addEventListener("click",             () => { closeMenus(); saveFile(); });
document.getElementById("mi-save-as").addEventListener("click",          () => { closeMenus(); saveAs(); });
document.getElementById("mi-autosave").addEventListener("click",         toggleAutosave);
document.getElementById("mi-set-autosave-folder").addEventListener("click", setAutosaveFolder);
document.getElementById("mi-package-zip").addEventListener("click",      packageZip);
document.getElementById("mi-undo").addEventListener("click",             () => { closeMenus(); if(editorView) undo(editorView); });
document.getElementById("mi-redo").addEventListener("click",             () => { closeMenus(); if(editorView) redo(editorView); });
document.getElementById("mi-find").addEventListener("click",             () => { closeMenus(); toggleFind(true); });
document.getElementById("mi-pkg-manager").addEventListener("click",      openPkgModal);
document.getElementById("mi-about").addEventListener("click",            () => { closeMenus(); alert("CodeIt IDE\nMade by Fsminecrafter (:\n\nPython → Pyodide (in-browser)\nC/C++ → gcc/g++ via local server\nCodeMirror 6"); });
document.getElementById("mi-support").addEventListener("click",          () => { closeMenus(); alert("Browser support:\n✅ Chrome / Edge — Full\n⚠️  Firefox — No File System Access API (fallback dialogs)"); });

// Sidebar quick buttons
document.getElementById("btn-new-file").addEventListener("click",   () => createNewFile(''));
document.getElementById("btn-new-folder").addEventListener("click", () => createNewFolder(''));
document.getElementById("btn-open-folder").addEventListener("click", openFolder);
document.getElementById("btn-change-folder").addEventListener("click", openFolder);

// Keyboard shortcuts
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveFile(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); createNewFile(''); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); toggleFind(true); }
  if (e.key === 'Escape') { closePkgModal(); toggleFind(false); hideCtxMenu(); }
});

// ═══════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════

initEditor();

// Starter files
files.set("main.py",   { handle: null, content: 'print("Hello from Pyodide!")\n\nfor i in range(5):\n    print(f"  Line {i+1}")\n', modified: false });
files.set("hello.cpp", { handle: null, content: '#include <iostream>\n\nint main() {\n    std::cout << "Hello World!" << std::endl;\n    return 0;\n}\n', modified: false });
files.set("hello.c",   { handle: null, content: '#include <stdio.h>\n\nint main() {\n    printf("Hello from C!\\n");\n    return 0;\n}\n', modified: false });
folders.add("examples");
files.set("examples/fib.py", { handle: null, content: 'def fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        print(a, end=" ")\n        a, b = b, a + b\n    print()\n\nfib(10)\n', modified: false });

renderTree();
openTab("main.py");

tw("\x1b[36m╔══════════════════════════════╗\x1b[0m");
tw("\x1b[36m║   Welcome to CodeIt IDE      ║\x1b[0m");
tw("\x1b[36m╚══════════════════════════════╝\x1b[0m");
tw("\x1b[90mPython runs in-browser via Pyodide. C/C++ requires launch.py.\x1b[0m");
tw("\x1b[90mCtrl+F to find  •  Ctrl+S to save  •  Ctrl+N for new file\x1b[0m");
tw("");
