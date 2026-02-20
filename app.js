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
const term = new Terminal({
  cols: 80, rows: 20,
  theme: { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#ffffff' },
  fontFamily: "'Fira Code', Consolas, monospace",
  fontSize: 13,
  convertEol: true,
  scrollback: 1000
});
term.open(terminalEl);
term.focus();

function termWrite(text) { term.writeln(text); }
function termClear() { term.clear(); }

//// ===== PROJECT DATA =====
const files = new Map(); // name → { handle, content }
let current = null;
const tabsEl = document.getElementById("tabs");
const fileList = document.getElementById("fileList");
function getCurrentFile() { return (current && current !== "__run__") ? files.get(current) : null; }

//// ===== EDITOR =====
const editor = CodeMirror.fromTextArea(document.getElementById("editor"), {
  mode: "python",
  theme: "material-darker",
  lineNumbers: true,
  indentUnit: 4,
  tabSize: 4,
  indentWithTabs: false,
  lineWrapping: false,
  extraKeys: {
    "Ctrl-S": () => saveFile(),
    "Cmd-S":  () => saveFile(),
    "Tab": cm => {
      if (cm.somethingSelected()) cm.indentSelection("add");
      else cm.replaceSelection("    ");
    }
  }
});
editor.on("change", () => { const f = getCurrentFile(); if (f) f.content = editor.getValue(); });

function setEditorMode(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const modes = { py:'python', c:'text/x-csrc', cpp:'text/x-c++src', h:'text/x-csrc', js:'javascript', html:'htmlmixed', css:'css', json:'application/json' };
  editor.setOption("mode", modes[ext] || 'text/plain');
}

//// ===== FILE TREE =====
function refreshTree() {
  fileList.innerHTML = "";
  for (const [name] of files) {
    const d = document.createElement("div");
    d.className = "fileItem" + (name === current ? " active" : "");
    d.textContent = getFileIcon(name) + " " + name;
    d.onclick = () => openTab(name);
    fileList.appendChild(d);
  }
}

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const icons = { py:'🐍', c:'🔵', cpp:'🔷', h:'📄', js:'📜', html:'🌐', css:'🎨', json:'{}', md:'📝', txt:'📄' };
  return icons[ext] || '📄';
}

//// ===== DRAGGABLE TABS =====
let dragSrc = null;

function makeDraggable(tab) {
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
    if (si < ti) tabsEl.insertBefore(dragSrc, tab.nextSibling);
    else tabsEl.insertBefore(dragSrc, tab);
  });
}

//// ===== TABS =====
function openTab(name) {
  if (!files.has(name)) return;
  const existing = [...tabsEl.children].find(t => t.dataset.name === name);
  if (existing) { activateTab(name); return; }

  const tab = document.createElement("div");
  tab.className = "tab";
  tab.dataset.name = name;

  const icon = document.createElement("span");
  icon.style.cssText = "font-size:11px;margin-right:4px";
  icon.textContent = getFileIcon(name);

  const title = document.createElement("span");
  title.textContent = name;

  const close = document.createElement("span");
  close.className = "tabClose";
  close.textContent = "×";
  close.onclick = e => { e.stopPropagation(); closeTab(name); };

  tab.append(icon, title, close);
  tab.onclick = () => activateTab(name);
  makeDraggable(tab);

  tabsEl.insertBefore(tab, document.getElementById("runTab"));
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
    terminalEl.style.height = "";
  } else {
    const f = files.get(name);
    if (f !== undefined) {
      editor.setValue(f.content || "");
      setEditorMode(name);
    }
    document.getElementById("editorWrap").classList.remove("hidden");
    terminalEl.style.flex = "";
    terminalEl.style.height = "200px";
    setTimeout(() => { editor.refresh(); editor.focus(); }, 10);
  }
  refreshTree();
}

function closeTab(name) {
  const tab = [...tabsEl.children].find(t => t.dataset.name === name);
  if (tab) tab.remove();
  if (current === name) {
    current = null;
    editor.setValue("");
    const next = [...tabsEl.children].find(t => t.dataset.name && t.dataset.name !== "__run__");
    if (next) activateTab(next.dataset.name);
  }
}

//// ===== RUN TAB (permanent) =====
const runTabEl = document.createElement("div");
runTabEl.className = "tab run-tab";
runTabEl.id = "runTab";
runTabEl.dataset.name = "__run__";
const runTitle = document.createElement("span");
runTitle.textContent = "▶ Run";
runTabEl.append(runTitle);
runTabEl.onclick = () => activateTab("__run__");
tabsEl.appendChild(runTabEl);

const langSelect = document.createElement("select");
langSelect.id = "langSelect";
["Python","C","C++"].forEach(l => {
  const opt = document.createElement("option"); opt.value = l; opt.textContent = l;
  langSelect.appendChild(opt);
});
langSelect.onclick = e => e.stopPropagation();
runTabEl.appendChild(langSelect);

const runBtn = document.createElement("button");
runBtn.id = "runBtn";
runBtn.textContent = "▶ Run";
runBtn.onclick = e => { e.stopPropagation(); runCurrent(); };
runTabEl.appendChild(runBtn);

//// ===== RUN LOGIC =====
async function runCurrent() {
  let code = null, filename = null;

  if (current && current !== "__run__" && files.has(current)) {
    code = files.get(current).content;
    filename = current;
  } else {
    const lang = langSelect.value;
    const ext = lang === "Python" ? ".py" : lang === "C++" ? ".cpp" : ".c";
    for (const [name, f] of files) {
      if (name.endsWith(ext)) { code = f.content; filename = name; break; }
    }
    if (code === null) {
      const first = files.entries().next().value;
      if (first) { code = first[1].content; filename = first[0]; }
    }
  }

  if (code === null) {
    termWrite("\x1b[31mNo file to run. Create or open a file first.\x1b[0m");
    return;
  }

  termClear();
  termWrite(`\x1b[36m─── ${filename} [${langSelect.value}] ───\x1b[0m`);

  if (langSelect.value === "Python") {
    worker.postMessage({ type: "run", code });
  } else {
    await runCpp(code, langSelect.value);
  }
}

//// ===== C / C++ via Python backend =====
async function runCpp(code, lang) {
  runBtn.disabled = true;
  runBtn.textContent = "⏳ Building...";

  try {
    // 1. Compile
    const buildRes = await fetch("/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang, code })
    });

    if (!buildRes.ok) {
      termWrite(`\x1b[31mServer error ${buildRes.status}: ${buildRes.statusText}\x1b[0m`);
      return;
    }

    const buildData = await buildRes.json();

    if (buildData.error) {
      termWrite("\x1b[31m── Compile Error ──\x1b[0m");
      buildData.error.split('\n').forEach(line => { if (line) termWrite("\x1b[31m" + line + "\x1b[0m"); });
      return;
    }

    termWrite("\x1b[32m✓ Compiled\x1b[0m");
    runBtn.textContent = "⏳ Running...";

    // 2. Run — server returns stdout, stderr, exit_code
    const runRes = await fetch("/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exe: buildData.executable })
    });

    if (!runRes.ok) {
      termWrite(`\x1b[31mRun error ${runRes.status}: ${runRes.statusText}\x1b[0m`);
      return;
    }

    const runData = await runRes.json();

    // stdout
    if (runData.stdout) {
      runData.stdout.split('\n').forEach(line => term.writeln(line));
    }
    // stderr in red
    if (runData.stderr && runData.stderr.trim()) {
      termWrite("\x1b[31m── stderr ──\x1b[0m");
      runData.stderr.split('\n').forEach(line => { if (line) termWrite("\x1b[31m" + line + "\x1b[0m"); });
    }

    const exitCode = runData.exit_code ?? 0;
    const col = exitCode === 0 ? "\x1b[32m" : "\x1b[31m";
    termWrite(`\x1b[90m─── exit ${col}${exitCode}\x1b[90m ───\x1b[0m`);

  } catch (e) {
    termWrite("\x1b[31mFetch failed: " + e.message + "\x1b[0m");
    termWrite("\x1b[90mIs the server running?  python launch.py\x1b[0m");
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = "▶ Run";
  }
}

//// ===== FILE OPS =====
function hasFSAPI() { return typeof window.showOpenFilePicker === 'function'; }

async function openFile() {
  if (!hasFSAPI()) {
    const input = document.createElement("input");
    input.type = "file"; input.multiple = true;
    input.onchange = async () => {
      for (const file of input.files) {
        files.set(file.name, { handle: null, content: await file.text() });
      }
      refreshTree();
      if (input.files[0]) openTab(input.files[0].name);
    };
    input.click();
    return;
  }
  try {
    const handles = await window.showOpenFilePicker({ multiple: true });
    let first = null;
    for (const h of handles) {
      const file = await h.getFile();
      files.set(file.name, { handle: h, content: await file.text() });
      if (!first) first = file.name;
    }
    refreshTree();
    if (first) openTab(first);
  } catch (e) { if (e.name !== "AbortError") console.error(e); }
}

async function openFolder() {
  if (typeof window.showDirectoryPicker !== 'function') {
    termWrite("\x1b[31mOpen Folder requires Chrome/Edge served over http://localhost\x1b[0m");
    return;
  }
  try {
    const dir = await window.showDirectoryPicker();
    let preferred = null;
    for await (const entry of dir.values()) {
      if (entry.kind !== "file") continue;
      const f = await entry.getFile();
      if (f.size > 2 * 1024 * 1024) continue;
      try {
        files.set(f.name, { handle: entry, content: await f.text() });
        if (!preferred && ["main.py","main.cpp","main.c"].includes(f.name)) preferred = f.name;
      } catch(_) {}
    }
    refreshTree();
    const pick = preferred || files.keys().next().value;
    if (pick) openTab(pick);
  } catch (e) { if (e.name !== "AbortError") console.error(e); }
}

async function newFile() {
  const name = prompt("File name:", "new.py");
  if (!name || !name.trim()) return;
  files.set(name.trim(), { handle: null, content: "" });
  refreshTree();
  openTab(name.trim());
}

//// ===== SAVE =====
async function saveFile() {
  const f = getCurrentFile();
  if (!f) return;
  if (f.handle) {
    try {
      const perm = await f.handle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") await f.handle.requestPermission({ mode: "readwrite" });
      const w = await f.handle.createWritable();
      await w.write(f.content); await w.close();
      flashSaved(); return;
    } catch(_) {}
  }
  await saveAs();
}

async function saveAs() {
  const f = getCurrentFile();
  if (!f) return;
  if (!hasFSAPI() || typeof window.showSaveFilePicker !== 'function') {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([f.content], { type:"text/plain" }));
    a.download = current || "file.py";
    a.click();
    return;
  }
  try {
    const handle = await window.showSaveFilePicker({ suggestedName: current || "file.py" });
    const w = await handle.createWritable();
    await w.write(f.content); await w.close();
    f.handle = handle;
    flashSaved();
  } catch (e) { if (e.name !== "AbortError") console.error(e); }
}

function flashSaved() {
  const el = document.createElement("div");
  el.textContent = "✓ Saved";
  Object.assign(el.style, { position:"fixed", bottom:"20px", right:"20px", background:"#0e639c", color:"white", padding:"6px 16px", borderRadius:"4px", fontSize:"13px", zIndex:"9999", transition:"opacity 0.4s", pointerEvents:"none" });
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 400); }, 1600);
}

//// ===== AUTOSAVE =====
let autosave = false;
document.getElementById("toggleAutosave").onclick = () => {
  autosave = !autosave;
  document.getElementById("toggleAutosave").textContent = "Auto save: " + (autosave ? "ON ✓" : "OFF");
};
setInterval(async () => {
  if (!autosave) return;
  const f = getCurrentFile();
  if (!f || !f.handle) return;
  try {
    const perm = await f.handle.queryPermission({ mode:"readwrite" });
    if (perm !== "granted") return;
    const w = await f.handle.createWritable();
    await w.write(f.content); await w.close();
  } catch(_) {}
}, 5000);

//// ===== PACKAGE PROJECT — download .zip =====
async function packageProject() {
  if (!window.JSZip) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
      s.onload = res; s.onerror = () => rej(new Error("Failed to load JSZip"));
      document.head.appendChild(s);
    }).catch(e => { alert("Could not load JSZip (needs internet): " + e.message); return null; });
  }
  if (!window.JSZip) return;

  const zip = new window.JSZip();
  for (const [name, f] of files) zip.file(name, f.content);

  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "codeit-project.zip";
  a.click();
}

//// ===== EDIT MENU =====
document.getElementById("undo").onclick = () => editor.undo();
document.getElementById("redo").onclick = () => editor.redo();
document.getElementById("findReplace").onclick = () => {
  const find = prompt("Find:"); if (find === null) return;
  const replace = prompt("Replace with:"); if (replace === null) return;
  const f = getCurrentFile(); if (!f) return;
  f.content = f.content.split(find).join(replace);
  editor.setValue(f.content);
};

//// ===== PACKAGE MANAGER (Pyodide pip) =====
document.getElementById("packageManager").onclick = () => {
  const pkg = prompt("Install Python package:");
  if (pkg) {
    termWrite(`\x1b[33mInstalling ${pkg}...\x1b[0m`);
    worker.postMessage({ type: "install", package: pkg });
  }
};

//// ===== INFO =====
document.getElementById("about").onclick = () => alert("CodeIt IDE\nMade by Fsminecrafter (:\n\nPython → Pyodide (in-browser WASM)\nC/C++  → gcc/g++ via local Python server");
document.getElementById("support").onclick = () => alert("Browser support:\n✅ Chrome / Edge — Full support\n⚠️  Firefox — File System Access API unavailable (fallback dialogs used)");

//// ===== FILE MENU HOOKS =====
document.getElementById("openFile").onclick   = openFile;
document.getElementById("openFolder").onclick = openFolder;
document.getElementById("newFile").onclick    = newFile;
document.getElementById("saveAs").onclick     = saveAs;
document.getElementById("packageProject").onclick = packageProject;

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
["0.27.2","0.26.4","0.25.1","0.24.1"].forEach(v => {
  const d = document.createElement("div");
  d.textContent = "Pyodide " + v;
  d.onclick = () => {
    pyVersion = v; worker.terminate(); worker = createWorker();
    termWrite(`\x1b[33mSwitched to Pyodide ${v}\x1b[0m`);
  };
  document.getElementById("pyVersions").appendChild(d);
});

//// ===== STARTER FILES =====
files.set("main.py",   { handle: null, content: 'print("Hello from Pyodide!")' });
files.set("hello.cpp", { handle: null, content: '#include <iostream>\nint main() {\n    std::cout << "Hello World!" << std::endl;\n    return 0;\n}\n' });
files.set("hello.c",   { handle: null, content: '#include <stdio.h>\nint main() {\n    printf("Hello from C!\\n");\n    return 0;\n}\n' });
refreshTree();
openTab("main.py");
