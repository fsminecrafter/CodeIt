//// ================= MENU =================

document.querySelectorAll(".menu").forEach(menu=>{
  menu.onclick=e=>{
    e.stopPropagation();
    document.querySelectorAll(".menu")
      .forEach(m=>m.classList.remove("open"));
    menu.classList.add("open");
  };
});

document.body.onclick=()=>{
  document.querySelectorAll(".menu")
    .forEach(m=>m.classList.remove("open"));
};

//// ================= TERMINAL =================

const terminal = document.getElementById("terminal");

function term(text){
  terminal.textContent += text + "\n";
  terminal.scrollTop = terminal.scrollHeight;
}

//// ================= EDITOR =================

const editor = CodeMirror.fromTextArea(
  document.getElementById("editor"),
  { mode:"python", theme:"material-darker", lineNumbers:true }
);

//// ================= PYODIDE WORKER =================

let pyVersion = "0.27.2";

function createWorker(){
  return new Worker("worker.js?v="+pyVersion);
}

let worker = createWorker();

worker.onmessage = e=>{
  if(e.data.type === "output")
    term(e.data.text);
};

function runCurrent(){
  if(!currentFile) return;

  terminal.textContent = "";

  worker.postMessage({
    type:"run",
    code: editor.getValue()
  });
}

//// ================= FILE DATA =================

const files = {};          // name → content
const openTabs = {};       // name → tabElement
let currentFile = null;

const tabs = document.getElementById("tabs");
const fileList = document.getElementById("fileList");

//// ---------- FILE TREE ----------

function refreshTree(){

  fileList.innerHTML = "";

  for(const name in files){

    const item = document.createElement("div");
    item.textContent = name;
    item.style.cursor = "pointer";

    item.onclick = ()=> openTab(name);

    fileList.appendChild(item);
  }
}

//// ---------- TAB SYSTEM ----------

function openTab(name){

  if(!files[name]) return;

  // Already open → just switch
  if(openTabs[name]){
    activateTab(name);
    return;
  }

  const tab = document.createElement("div");
  tab.className = "tab";

  const title = document.createElement("span");
  title.textContent = name;

  const close = document.createElement("span");
  close.textContent = " ×";
  close.style.color = "#aaa";
  close.style.cursor = "pointer";

  close.onclick = e=>{
    e.stopPropagation();
    closeTab(name);
  };

  tab.append(title, close);

  tab.onclick = ()=> activateTab(name);

  tabs.appendChild(tab);
  openTabs[name] = tab;

  activateTab(name);
}

function activateTab(name){

  if(!files[name]) return;

  currentFile = name;

  document.querySelectorAll(".tab")
    .forEach(t=>t.classList.remove("active"));

  openTabs[name].classList.add("active");

  editor.setValue(files[name]);
  editor.focus();
}

function closeTab(name){

  const tab = openTabs[name];
  if(!tab) return;

  tab.remove();
  delete openTabs[name];

  if(currentFile === name){

    const remaining = Object.keys(openTabs);

    if(remaining.length){
      activateTab(remaining[remaining.length - 1]);
    }else{
      currentFile = null;
      editor.setValue("");
    }
  }
}

editor.on("change", ()=>{
  if(currentFile)
    files[currentFile] = editor.getValue();
});

//// ---------- FILE OPERATIONS ----------

function createFile(name, content=""){

  if(files[name]) return;

  files[name] = content;

  refreshTree();
  openTab(name);
}

newFile.onclick = ()=>{
  const name = prompt("File name:", "new.py");
  if(name) createFile(name, "");
};

openFile.onclick = async ()=>{

  const [file] = await window.showOpenFilePicker();
  const text = await (await file.getFile()).text();

  createFile(file.name, text);
};

openFolder.onclick = async ()=>{

  const dir = await window.showDirectoryPicker();

  for await (const entry of dir.values()){
    if(entry.kind === "file"){
      const f = await entry.getFile();
      createFile(f.name, await f.text());
    }
  }
};

//// ---------- SAVE ----------

let saveHandle = null;
let autosave = false;

saveAs.onclick = async ()=>{

  saveHandle = await window.showSaveFilePicker({
    suggestedName: currentFile || "file.py"
  });

  const w = await saveHandle.createWritable();
  await w.write(editor.getValue());
  await w.close();
};

toggleAutosave.onclick = ()=>{
  autosave = !autosave;
  toggleAutosave.textContent =
    "Auto save: " + (autosave ? "ON" : "OFF");
};

setInterval(async ()=>{
  if(autosave && saveHandle && currentFile){

    const w = await saveHandle.createWritable();
    await w.write(editor.getValue());
    await w.close();
  }
}, 5000);

//// ---------- EDIT MENU ----------

undo.onclick = ()=> editor.undo();
redo.onclick = ()=> editor.redo();

findReplace.onclick = ()=>{
  const f = prompt("Find:");
  if(!f) return;

  const r = prompt("Replace with:");
  if(r === null) return;

  editor.setValue(
    editor.getValue().replaceAll(f, r)
  );
};

document.addEventListener("keydown", e=>{

  if(e.ctrlKey && e.key === "z"){
    e.preventDefault();
    editor.undo();
  }

  if(e.ctrlKey && e.key === "y"){
    e.preventDefault();
    editor.redo();
  }
});

//// ---------- PACKAGE MANAGER ----------

packageManager.onclick = ()=>{
  const pkg = prompt("Install package:");
  if(pkg)
    worker.postMessage({type:"install", package:pkg});
};

//// ---------- PYTHON MENU ----------

// RUN BUTTON
const runBtn = document.createElement("div");
runBtn.textContent = "Run ▶";
runBtn.onclick = runCurrent;
pyVersions.prepend(runBtn);

// VERSION SELECTOR
const versions = [
 "0.27.2","0.26.4","0.25.1",
 "0.24.1","0.23.4","0.22.1"
];

versions.forEach(v=>{

  const d = document.createElement("div");
  d.textContent = "Pyodide " + v;

  d.onclick = ()=>{
    pyVersion = v;
    worker.terminate();
    worker = createWorker();
    term("Switched to Pyodide " + v);
  };

  pyVersions.appendChild(d);
});

//// ---------- START ----------

createFile("main.py", 'print("Hello from Pydiode!")');
