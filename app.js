// ═══════════════════════════════════════════════════════════
//  CodeIt IDE — app.js (ES Module, CodeMirror 6)
// ═══════════════════════════════════════════════════════════

import { EditorView, keymap, highlightActiveLine, lineNumbers,
         highlightActiveLineGutter, drawSelection, dropCursor,
         rectangularSelection, crosshairCursor } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches, SearchQuery,
         setSearchQuery, findNext, findPrevious } from "@codemirror/search";
import { indentOnInput, bracketMatching, foldGutter,
         syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
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

  const startState = EditorState.create({
    doc: '',
    extensions: buildEditorExtensions(python())
  });

  editorView = new EditorView({
    state: startState,
    parent: container
  });
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
    toast("Open Folder requires Chrome/Edge over https://", 'err'); return;
  }
  try {
    // Request readwrite up-front so autosave works without a second prompt
    const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    rootDirHandle = dir;
    document.getElementById("folder-root-name").textContent = dir.name;

    // Clear existing
    files.clear(); folders.clear(); treeExpanded.clear();

    // Close all file tabs (keep Run tab)
    [...tabsEl.children].forEach(t => {
      if (t.dataset.name && t.dataset.name !== "__run__") t.remove();
    });
    current = null;
    setEditorContent('', []);

    await loadDirRecursive(dir, '');
    renderTree();

    // Open first relevant file
    const prio = ['main.py','index.py','main.cpp','main.c','index.js','index.html'];
    let picked = null;
    for (const p of prio) { if (files.has(p)) { picked = p; break; } }
    if (!picked) picked = files.keys().next().value;
    if (picked) openTab(picked);

    toast(`Opened folder: ${dir.name}`, 'ok');
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error(e);
      toast("Failed to open folder: " + e.message, 'err');
    }
  }
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
    else if (e.data.type === "gui")   handleGuiMessage(e.data.widget);
    else if (e.data.type === "ready") tw(`\x1b[32mPyodide ${e.data.version} ready\x1b[0m`);
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
//  GUI PANEL ENGINE
//  Python code outputs __GUI__:{...} lines which are parsed
//  by the worker and sent here as { type:"gui", widget:{...} }
//  The GUI panel renders next to the terminal.
// ═══════════════════════════════════════════════════════════

const guiPanel = document.getElementById("gui-panel");
const guiContent = document.getElementById("gui-content");

function handleGuiMessage(widget) {
  if (!widget) return;

  // Show the panel + resize bar if hidden
  if (guiPanel.classList.contains("hidden")) {
    guiPanel.classList.remove("hidden");
    document.getElementById("gui-panel-resize").style.display = "";
  }

  if (widget.type === "clear") {
    guiContent.innerHTML = '';
    return;
  }
  if (widget.type === "alert") {
    toast(widget.message, 'info');
    return;
  }
  if (widget.type === "update") {
    const el = guiContent.querySelector(`[data-id="${widget.id}"]`);
    if (el) el.textContent = widget.text;
    return;
  }
  if (widget.type === "update_input") {
    const el = guiContent.querySelector(`[data-id="${widget.id}"] input, [data-id="${widget.id}"]`);
    if (el) el.value = widget.value;
    return;
  }

  // Full render
  if (widget.type === "window") {
    guiContent.innerHTML = '';
    if (widget.title) {
      const title = document.createElement("div");
      title.className = "gui-window-title";
      title.textContent = widget.title;
      guiContent.appendChild(title);
    }
    for (const child of (widget.children || [])) {
      guiContent.appendChild(renderWidget(child));
    }
    return;
  }

  if (widget.type === "plot") {
    guiContent.innerHTML = '';
    guiContent.appendChild(renderWidget(widget));
    return;
  }

  // Otherwise append
  guiContent.appendChild(renderWidget(widget));
}

function renderWidget(w) {
  if (!w || typeof w !== 'object') {
    const t = document.createElement("span");
    t.textContent = String(w);
    return t;
  }

  switch (w.type) {

    case "label": {
      const el = document.createElement("div");
      el.className = "gui-label";
      el.textContent = w.text || '';
      if (w.id) { el.dataset.id = w.id; el.setAttribute('data-id', w.id); }
      if (w.style) Object.assign(el.style, w.style);
      return el;
    }

    case "button": {
      const el = document.createElement("button");
      el.className = "gui-button";
      el.textContent = w.text || 'Button';
      if (w.color) el.style.background = w.color;
      el.addEventListener("click", () => {
        if (w.onclick) worker.postMessage({ type: "gui_event", name: w.onclick, args: [] });
      });
      return el;
    }

    case "input": {
      const wrap = document.createElement("div");
      wrap.className = "gui-field";
      wrap.setAttribute('data-id', w.id || '');
      if (w.label) {
        const lbl = document.createElement("label");
        lbl.className = "gui-field-label";
        lbl.textContent = w.label;
        wrap.appendChild(lbl);
      }
      const inp = document.createElement("input");
      inp.className = "gui-input";
      inp.type = "text";
      inp.placeholder = w.placeholder || '';
      inp.value = w.value || '';
      inp.addEventListener("change", () => {
        if (w.id) worker.postMessage({ type: "gui_event", name: `on_change_${w.id}`, args: [inp.value] });
      });
      wrap.appendChild(inp);
      return wrap;
    }

    case "textarea": {
      const wrap = document.createElement("div");
      wrap.className = "gui-field";
      if (w.label) {
        const lbl = document.createElement("label");
        lbl.className = "gui-field-label";
        lbl.textContent = w.label;
        wrap.appendChild(lbl);
      }
      const ta = document.createElement("textarea");
      ta.className = "gui-textarea";
      ta.rows = w.rows || 4;
      ta.placeholder = w.placeholder || '';
      ta.value = w.value || '';
      ta.addEventListener("change", () => {
        if (w.id) worker.postMessage({ type: "gui_event", name: `on_change_${w.id}`, args: [ta.value] });
      });
      wrap.appendChild(ta);
      return wrap;
    }

    case "slider": {
      const wrap = document.createElement("div");
      wrap.className = "gui-field";
      if (w.label) {
        const lbl = document.createElement("label");
        lbl.className = "gui-field-label";
        lbl.textContent = w.label;
        wrap.appendChild(lbl);
      }
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:10px;";
      const slider = document.createElement("input");
      slider.type = "range";
      slider.className = "gui-slider";
      slider.min = w.min ?? 0; slider.max = w.max ?? 100; slider.value = w.value ?? 50;
      const val = document.createElement("span");
      val.className = "gui-slider-val";
      val.textContent = slider.value;
      slider.addEventListener("input", () => {
        val.textContent = slider.value;
        if (w.id) worker.postMessage({ type: "gui_event", name: `on_change_${w.id}`, args: [Number(slider.value)] });
      });
      row.append(slider, val);
      wrap.appendChild(row);
      return wrap;
    }

    case "checkbox": {
      const wrap = document.createElement("label");
      wrap.className = "gui-checkbox";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = !!w.checked;
      cb.addEventListener("change", () => {
        if (w.id) worker.postMessage({ type: "gui_event", name: `on_change_${w.id}`, args: [cb.checked] });
      });
      const span = document.createElement("span");
      span.textContent = w.text || '';
      wrap.append(cb, span);
      return wrap;
    }

    case "select": {
      const wrap = document.createElement("div");
      wrap.className = "gui-field";
      if (w.label) {
        const lbl = document.createElement("label");
        lbl.className = "gui-field-label";
        lbl.textContent = w.label;
        wrap.appendChild(lbl);
      }
      const sel = document.createElement("select");
      sel.className = "gui-select";
      for (const opt of (w.options || [])) {
        const o = document.createElement("option");
        o.value = opt; o.textContent = opt;
        if (opt === w.value) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => {
        if (w.id) worker.postMessage({ type: "gui_event", name: `on_change_${w.id}`, args: [sel.value] });
      });
      wrap.appendChild(sel);
      return wrap;
    }

    case "image": {
      const img = document.createElement("img");
      img.className = "gui-image";
      img.src = w.src; img.alt = w.alt || '';
      if (w.width)  img.style.width  = typeof w.width  === 'number' ? w.width  + 'px' : w.width;
      if (w.height) img.style.height = typeof w.height === 'number' ? w.height + 'px' : w.height;
      return img;
    }

    case "canvas": {
      const canvas = document.createElement("canvas");
      canvas.className = "gui-canvas";
      canvas.id = w.id || ('canvas_' + Math.random().toString(36).slice(2));
      canvas.width  = w.width  || 300;
      canvas.height = w.height || 200;
      return canvas;
    }

    case "progress": {
      const wrap = document.createElement("div");
      wrap.className = "gui-progress-wrap";
      const bar = document.createElement("div");
      bar.className = "gui-progress-bar";
      const pct = Math.min(100, Math.max(0, ((w.value || 0) / (w.max || 100)) * 100));
      bar.style.width = pct + '%';
      if (w.color) bar.style.background = w.color;
      const label = document.createElement("span");
      label.className = "gui-progress-label";
      label.textContent = Math.round(pct) + '%';
      wrap.append(bar, label);
      return wrap;
    }

    case "separator": {
      const hr = document.createElement("hr");
      hr.className = "gui-separator";
      return hr;
    }

    case "spacer": {
      const sp = document.createElement("div");
      sp.style.height = (w.height || 8) + 'px';
      return sp;
    }

    case "hbox": {
      const el = document.createElement("div");
      el.className = "gui-hbox";
      el.style.gap = (w.gap || 8) + 'px';
      el.style.alignItems = w.align || 'center';
      for (const c of (w.children || [])) el.appendChild(renderWidget(c));
      return el;
    }

    case "vbox": {
      const el = document.createElement("div");
      el.className = "gui-vbox";
      el.style.gap = (w.gap || 8) + 'px';
      for (const c of (w.children || [])) el.appendChild(renderWidget(c));
      return el;
    }

    case "grid": {
      const el = document.createElement("div");
      el.className = "gui-grid";
      el.style.gridTemplateColumns = `repeat(${w.cols || 2}, 1fr)`;
      el.style.gap = (w.gap || 8) + 'px';
      for (const c of (w.children || [])) el.appendChild(renderWidget(c));
      return el;
    }

    case "card": {
      const el = document.createElement("div");
      el.className = "gui-card";
      if (w.title) {
        const t = document.createElement("div");
        t.className = "gui-card-title";
        t.textContent = w.title;
        el.appendChild(t);
      }
      for (const c of (w.children || [])) el.appendChild(renderWidget(c));
      return el;
    }

    case "plot": {
      return renderPlot(w);
    }

    default: {
      const el = document.createElement("div");
      el.textContent = JSON.stringify(w);
      el.style.cssText = "font-family:monospace;font-size:11px;color:var(--text3);";
      return el;
    }
  }
}

// ─── Lightweight canvas chart renderer ──────────────────────
function renderPlot(w) {
  const wrap = document.createElement("div");
  wrap.className = "gui-plot";

  if (w.title) {
    const title = document.createElement("div");
    title.className = "gui-plot-title";
    title.textContent = w.title;
    wrap.appendChild(title);
  }

  const canvas = document.createElement("canvas");
  canvas.width  = 320;
  canvas.height = 180;
  canvas.style.cssText = "width:100%;height:auto;display:block;";
  wrap.appendChild(canvas);

  // Draw after appended (needs layout)
  requestAnimationFrame(() => {
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const PAD = 32;
    ctx.clearRect(0, 0, W, H);

    const accent = w.color || "#3b82f6";
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;

    if (w.plot_type === "line") {
      const raw = w.data || [];
      const pts = raw.map((d, i) => Array.isArray(d) ? d : [i, d]);
      if (!pts.length) return;
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;

      const toCanv = ([x, y]) => [
        PAD + ((x - minX) / rangeX) * (W - 2*PAD),
        (H - PAD) - ((y - minY) / rangeY) * (H - 2*PAD)
      ];

      // Axes
      ctx.beginPath();
      ctx.moveTo(PAD, PAD); ctx.lineTo(PAD, H - PAD);
      ctx.lineTo(W - PAD, H - PAD);
      ctx.strokeStyle = "#444"; ctx.stroke();

      // Line
      ctx.beginPath();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      pts.forEach((p, i) => {
        const [cx, cy] = toCanv(p);
        i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
      });
      ctx.stroke();

      // Dots
      ctx.fillStyle = accent;
      pts.forEach(p => {
        const [cx, cy] = toCanv(p);
        ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI*2); ctx.fill();
      });

      // Labels
      ctx.fillStyle = "#94a3b8"; ctx.font = "10px 'IBM Plex Mono',monospace"; ctx.textAlign = "center";
      if (w.xlabel) { ctx.fillText(w.xlabel, W/2, H - 4); }
      ctx.textAlign = "right";
      if (w.ylabel) { ctx.save(); ctx.translate(12, H/2); ctx.rotate(-Math.PI/2); ctx.fillText(w.ylabel, 0, 0); ctx.restore(); }

    } else if (w.plot_type === "bar") {
      const labels = w.labels || [], values = w.values || [];
      if (!values.length) return;
      const maxV = Math.max(...values, 1);
      const barW = (W - 2*PAD) / values.length;

      ctx.beginPath();
      ctx.moveTo(PAD, PAD); ctx.lineTo(PAD, H - PAD);
      ctx.lineTo(W - PAD, H - PAD);
      ctx.strokeStyle = "#444"; ctx.stroke();

      values.forEach((v, i) => {
        const x = PAD + i * barW + barW * 0.1;
        const bw = barW * 0.8;
        const bh = ((v / maxV) * (H - 2*PAD));
        const y = H - PAD - bh;
        ctx.fillStyle = accent;
        ctx.fillRect(x, y, bw, bh);

        ctx.fillStyle = "#94a3b8";
        ctx.font = "9px 'IBM Plex Mono',monospace";
        ctx.textAlign = "center";
        if (labels[i]) ctx.fillText(String(labels[i]).slice(0, 6), x + bw/2, H - PAD + 12);
      });

      if (w.title) {}  // already rendered above
    }
  });

  return wrap;
}

// Close GUI panel button
document.getElementById("gui-close").addEventListener("click", () => {
  guiPanel.classList.add("hidden");
  guiContent.innerHTML = '';
  document.getElementById("gui-panel-resize").style.display = "none";
});

// GUI panel resize handle
const guiResizeBar = document.getElementById("gui-panel-resize");
let guiResizing = false, guiResizeStartX = 0, guiResizeStartW = 0;
guiResizeBar.addEventListener("mousedown", e => {
  guiResizing = true;
  guiResizeStartX = e.clientX;
  guiResizeStartW = guiPanel.offsetWidth;
  guiResizeBar.classList.add("dragging");
  e.preventDefault();
});
document.addEventListener("mousemove", e => {
  if (!guiResizing) return;
  const w = Math.max(180, Math.min(600, guiResizeStartW - (e.clientX - guiResizeStartX)));
  guiPanel.style.width = w + "px";
});
document.addEventListener("mouseup", () => {
  if (guiResizing) { guiResizing = false; guiResizeBar.classList.remove("dragging"); }
});

// Show resize bar when panel visible
const _origHandleGui = handleGuiMessage;
// (resize bar visibility handled inside handleGuiMessage via panel show)

// ═══════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════

initEditor();

const GUI_EXAMPLE = `# Run this to see the GUI panel!
from codeit_gui import *

clear()
window("🎛 CodeIt GUI Demo",
    vbox(
        label("Welcome to CodeIt GUI!", style={"fontSize":"15px","fontWeight":"600","color":"#60a5fa"}),
        label("Python can render interactive widgets next to the terminal."),
        separator(),
        card(
            label("Controls", style={"fontWeight":"600"}),
            input_box("name", label="Your name:", placeholder="Enter your name"),
            slider("speed", 0, 200, 60, label="Speed"),
            hbox(
                button("Say Hello", onclick="say_hello", color="#166534"),
                button("Reset",     onclick="do_reset"),
            ),
        ),
        progress(0, id="prog"),
        label("", id="output"),
    )
)

def say_hello():
    import js  # noqa — not real, just demo callback
    name = "World"  # In real use, read input value via on_change_name
    update_label("output", f"Hello, {name}! 👋")

def do_reset():
    update_label("output", "")

plot_line([0,1,4,9,16,25,36,49], title="y = x²", ylabel="y", color="#a78bfa")
`;

// Starter files
files.set("main.py",     { handle: null, content: 'print("Hello from Pyodide!")\n\nfor i in range(5):\n    print(f"  Line {i+1}")\n', modified: false });
files.set("gui_demo.py", { handle: null, content: GUI_EXAMPLE, modified: false });
files.set("hello.cpp",   { handle: null, content: '#include <iostream>\n\nint main() {\n    std::cout << "Hello World!" << std::endl;\n    return 0;\n}\n', modified: false });
files.set("hello.c",     { handle: null, content: '#include <stdio.h>\n\nint main() {\n    printf("Hello from C!\\n");\n    return 0;\n}\n', modified: false });
folders.add("examples");
files.set("examples/fib.py", { handle: null, content: 'def fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        print(a, end=" ")\n        a, b = b, a + b\n    print()\n\nfib(10)\n', modified: false });

renderTree();
openTab("main.py");

tw("\x1b[36m╔══════════════════════════════════════════╗\x1b[0m");
tw("\x1b[36m║   Welcome to CodeIt IDE                  ║\x1b[0m");
tw("\x1b[36m╚══════════════════════════════════════════╝\x1b[0m");
tw("\x1b[90mPython → Pyodide (in-browser)  •  C/C++ → requires launch.py\x1b[0m");
tw("\x1b[90mCtrl+F find  •  Ctrl+S save  •  Ctrl+N new file\x1b[0m");
tw("\x1b[33mTip: open gui_demo.py and run it to see the GUI panel!\x1b[0m");
tw("");
