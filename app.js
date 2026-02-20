//// ===== MENU =====
document.querySelectorAll(".menu").forEach(menu => {
  menu.onclick = e => {
    e.stopPropagation();
    document.querySelectorAll(".menu").forEach(m => m.classList.remove("open"));
    menu.classList.add("open");
  };
});
document.body.onclick = () => document.querySelectorAll(".menu").forEach(m => m.classList.remove("open"));

//// ===== TERMINAL =====
const terminalEl = document.getElementById("terminal");
const term = new Terminal({ cols: 80, rows: 20, theme: { background: '#1e1e1e', foreground: '#ffffff' } });
term.open(terminalEl);
term.focus();

function termWrite(text) { term.writeln(text); }
function termClear() { term.clear(); }

//// ===== PROJECT DATA =====
const files = new Map();
let current = null;

const tabsEl = document.getElementById("tabs");
const fileList = document.getElementById("fileList");

function getCurrentFile() { return current ? files.get(current) : null; }

//// ===== EDITOR =====
const editor = CodeMirror.fromTextArea(document.getElementById("editor"), {
  mode: "python",
  theme: "material-darker",
  lineNumbers: true
});
editor.on("change", () => { const f = getCurrentFile(); if (f) f.content = editor.getValue(); });

//// ===== FILE TREE =====
function refreshTree() {
  fileList.innerHTML = "";
  for (const [name] of files) {
    const d = document.createElement("div");
    d.textContent = name;
    d.className = "fileItem";
    d.onclick = () => openTab(name);
    fileList.appendChild(d);
  }
}

//// ===== TABS =====
function openTab(name) {
  if (!files.has(name)) return;

  // If tab already exists in bar, just activate
  const existing = [...tabsEl.children].find(t => t.dataset.name === name);
  if (existing) { activateTab(name); return; }

  const tab = document.createElement("div");
  tab.className = "tab";
  tab.dataset.name = name;

  const title = document.createElement("span");
  title.textContent = name;

  const close = document.createElement("span");
  close.textContent = "×";
  close.onclick = e => { e.stopPropagation(); closeTab(name); };

  tab.append(title, close);
  tab.onclick = () => activateTab(name);

  // Insert before the Run tab
  const runTab = document.getElementById("runTab");
  tabsEl.insertBefore(tab, runTab);

  activateTab(name);
}

function activateTab(name) {
  current = name;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  const tab = [...tabsEl.children].find(t => t.dataset.name === name);
  if (tab) tab.classList.add("active");

  if (name === "__run__") {
    document.getElementById("editorWrap").classList.add("hidden");
    terminalEl.style.flex = "1";
  } else {
    const f = files.get(name);
    if (f) editor.setValue(f.content || "");
    document.getElementById("editorWrap").classList.remove("hidden");
    terminalEl.style.flex = "";
    editor.refresh();
    editor.focus();
  }
}

function closeTab(name) {
  const tab = [...tabsEl.children].find(t => t.dataset.name === name);
  if (tab) tab.remove();

  if (current === name) {
    current = null;
    editor.setValue("");
    // Try to activate another file tab
    const next = [...tabsEl.children].find(t => t.dataset.name && t.dataset.name !== "__run__");
    if (next) activateTab(next.dataset.name);
  }
}

//// ===== RUN TAB (permanent) =====
const runTabEl = document.createElement("div");
runTabEl.className = "tab";
runTabEl.id = "runTab";
runTabEl.dataset.name = "__run__";

const runTitle = document.createElement("span");
runTitle.textContent = "Run ▶";
runTabEl.append(runTitle);
runTabEl.onclick = () => activateTab("__run__");
tabsEl.appendChild(runTabEl);

const langSelect = document.createElement("select");
langSelect.id = "langSelect";
["Python", "C", "C++"].forEach(l => {
  const opt = document.createElement("option");
  opt.value = l; opt.textContent = l;
  langSelect.appendChild(opt);
});
runTabEl.appendChild(langSelect);

const runBtn = document.createElement("button");
runBtn.textContent = "▶ Run";
runBtn.style.cssText = "margin-left:6px;padding:2px 10px;cursor:pointer;background:#0e639c;color:white;border:none;border-radius:3px;";
runBtn.onclick = runCurrent;
runTabEl.appendChild(runBtn);

//// ===== RUN LOGIC =====
async function runCurrent() {
  const f = getCurrentFile();
  const lang = langSelect.value;
  const code = f ? f.content : (current === "__run__" ? null : null);

  // If we're on the run tab with no file, use last known file
  const activeCode = f ? f.content : null;
  if (!activeCode && current === "__run__") {
    termWrite("No file selected. Open a file first.");
    return;
  }

  const codeToRun = activeCode || (getCurrentFile() ? getCurrentFile().content : "");

  termClear();

  if (lang === "Python") {
    worker.postMessage({ type: "run", code: codeToRun });
  } else {
    termWrite("Building " + lang + " code on server...");
    try {
      const res = await fetch("/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang, code: codeToRun })
      });
      const data = await res.json();
      if (data.error) { termWrite("Build failed:\n" + data.error); return; }
      termWrite("Running executable...");
      await fetch("/run", { method: "POST", body: JSON.stringify({ exe: data.executable }) });
      termWrite("Execution finished.");
    } catch (err) {
      termWrite("Error: " + err.message);
    }
  }
}

//// ===== FILE OPS =====
async function openFile() {
  try {
    const [h] = await window.showOpenFilePicker();
    const file = await h.getFile();
    const text = await file.text();
    files.set(file.name, { handle: h, content: text });
    refreshTree();
    openTab(file.name);
  } catch (e) { if (e.name !== "AbortError") console.error(e); }
}

async function openFolder() {
  try {
    const dir = await window.showDirectoryPicker();
    let mainFound = false;
    for await (const entry of dir.values()) {
      if (entry.kind === "file") {
        const f = await entry.getFile();
        const text = await f.text();
        files.set(f.name, { handle: entry, content: text });
        if (f.name === "main.py") mainFound = true;
      }
    }
    refreshTree();
    if (mainFound) openTab("main.py");
    else {
      const first = files.keys().next().value;
      if (first) openTab(first);
    }
  } catch (e) { if (e.name !== "AbortError") console.error(e); }
}

async function newFile() {
  const name = prompt("File name:", "new.py");
  if (!name) return;
  files.set(name, { handle: null, content: "" });
  refreshTree();
  openTab(name);
}

//// ===== SAVE =====
async function saveAs() {
  const f = getCurrentFile();
  if (!f) return;
  try {
    const handle = await window.showSaveFilePicker({ suggestedName: current });
    const w = await handle.createWritable();
    await w.write(f.content);
    await w.close();
    f.handle = handle;
  } catch (e) { if (e.name !== "AbortError") console.error(e); }
}

let autosave = false;
document.getElementById("toggleAutosave").onclick = () => {
  autosave = !autosave;
  document.getElementById("toggleAutosave").textContent = "Auto save: " + (autosave ? "ON" : "OFF");
};

setInterval(async () => {
  if (!autosave) return;
  const f = getCurrentFile();
  if (!f || !f.handle) return;
  const w = await f.handle.createWritable();
  await w.write(f.content);
  await w.close();
}, 5000);

//// ===== EDIT =====
document.getElementById("undo").onclick = () => editor.undo();
document.getElementById("redo").onclick = () => editor.redo();

//// ===== FIND & REPLACE =====
document.getElementById("findReplace").onclick = () => {
  const find = prompt("Find:");
  if (!find) return;
  const replace = prompt("Replace with:");
  if (replace === null) return;
  const f = getCurrentFile();
  if (!f) return;
  f.content = f.content.split(find).join(replace);
  editor.setValue(f.content);
};

//// ===== PACKAGE MANAGER =====
document.getElementById("packageManager").onclick = () => {
  const pkg = prompt("Install package:");
  if (pkg) worker.postMessage({ type: "install", package: pkg });
};

//// ===== INFO =====
document.getElementById("about").onclick = () => alert("Made by Fsminecrafter (:");
document.getElementById("support").onclick = () => alert("Supports: Chrome. Doesn't support: Firefox.");

//// ===== FILE MENU HOOKS =====
document.getElementById("openFile").onclick = openFile;
document.getElementById("openFolder").onclick = openFolder;
document.getElementById("newFile").onclick = newFile;
document.getElementById("saveAs").onclick = saveAs;

//// ===== PYODIDE WORKER =====
let pyVersion = "0.27.2";
let worker = createWorker();

function createWorker() {
  const w = new Worker("worker.js?v=" + pyVersion);
  w.onmessage = e => { if (e.data.type === "output") termWrite(e.data.text); };
  return w;
}

term.onData(data => worker.postMessage({ type: "input", text: data }));

//// ===== PYODIDE VERSION MENU =====
["0.27.2", "0.26.4", "0.25.1", "0.24.1"].forEach(v => {
  const d = document.createElement("div");
  d.textContent = "Pyodide " + v;
  d.onclick = () => {
    pyVersion = v;
    worker.terminate();
    worker = createWorker();
    termWrite("Switched to Pyodide " + v);
  };
  document.getElementById("pyVersions").appendChild(d);
});

//// ===== START =====
files.set("main.py", { handle: null, content: 'print("Hello from Pyodide!")' });
refreshTree();
openTab("main.py");
