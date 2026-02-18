//// ===== MENU =====
document.querySelectorAll(".menu").forEach(menu=>{
  menu.onclick=e=>{
    e.stopPropagation();
    document.querySelectorAll(".menu").forEach(m=>m.classList.remove("open"));
    menu.classList.add("open");
  };
});
document.body.onclick=()=> document.querySelectorAll(".menu").forEach(m=>m.classList.remove("open"));

//// ===== TERMINAL =====
const terminal = document.getElementById("terminal");
function term(t){ terminal.textContent += t + "\n"; terminal.scrollTop = terminal.scrollHeight; }

//// ===== EDITOR =====
const editor = CodeMirror.fromTextArea(document.getElementById("editor"),{
  mode:"python", theme:"material-darker", lineNumbers:true
});

//// ===== PYODIDE WORKER =====
let pyVersion="0.27.2";
let worker=createWorker();

function createWorker(){ return new Worker("worker.js?v="+pyVersion); }

worker.onmessage=e=>{
  if(e.data.type==="output") term(e.data.text);
};

function runCurrent(){
  const f = getCurrentFile();
  if(!f) return;
  terminal.textContent="";
  worker.postMessage({type:"run", code:f.content});
}

//// ===== PROJECT DATA =====
const files = new Map();   // name → {handle,content}
let current = null;

const tabsEl = document.getElementById("tabs");
const fileList = document.getElementById("fileList");

function getCurrentFile(){ return current ? files.get(current) : null; }

//// ===== FILE TREE =====
function refreshTree(){
  fileList.innerHTML="";
  for(const [name] of files){
    const d=document.createElement("div");
    d.textContent=name;
    d.className="fileItem";
    d.onclick=()=>openTab(name);
    fileList.appendChild(d);
  }
}

//// ===== TABS =====
function openTab(name){
  if(!files.has(name)) return;

  if(current===name){ activateTab(name); return; }

  const tab=document.createElement("div");
  tab.className="tab";
  tab.dataset.name=name;

  const title=document.createElement("span");
  title.textContent=name;

  const close=document.createElement("span");
  close.textContent="×";
  close.onclick=e=>{ e.stopPropagation(); closeTab(name); };

  tab.append(title,close);
  tab.onclick=()=>activateTab(name);

  tabsEl.appendChild(tab);
  activateTab(name);
}

function activateTab(name){
  current=name;
  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  const tab=[...tabsEl.children].find(t=>t.dataset.name===name);
  if(tab) tab.classList.add("active");

  const f=files.get(name);
  editor.setValue(f.content || "");
}

function closeTab(name){
  const tab=[...tabsEl.children].find(t=>t.dataset.name===name);
  if(tab) tab.remove();

  if(current===name){
    current=null;
    editor.setValue("");
  }
}

editor.on("change",()=>{
  const f=getCurrentFile();
  if(f) f.content=editor.getValue();
});

//// ===== FILE OPS =====

async function openFile(){
  const [h]=await window.showOpenFilePicker();
  const file=await h.getFile();
  const text=await file.text();

  files.set(file.name,{handle:h,content:text});
  refreshTree();
  openTab(file.name);
}

async function openFolder(){
  const dir=await window.showDirectoryPicker();

  let mainFound=false;

  for await (const entry of dir.values()){
    if(entry.kind==="file"){
      const f=await entry.getFile();
      const text=await f.text();

      files.set(f.name,{handle:entry,content:text});
      if(f.name==="main.py") mainFound=true;
    }
  }

  refreshTree();

  if(mainFound) openTab("main.py");
}

async function newFile(){
  const name=prompt("File name","new.py");
  if(!name) return;
  files.set(name,{handle:null,content:""});
  refreshTree();
  openTab(name);
}

//// ===== SAVE =====

async function saveAs(){
  const f=getCurrentFile();
  if(!f) return;

  const handle=await window.showSaveFilePicker({suggestedName:current});
  const w=await handle.createWritable();
  await w.write(f.content);
  await w.close();

  f.handle=handle;
}

let autosave=false;

toggleAutosave.onclick=()=>{
  autosave=!autosave;
  toggleAutosave.textContent="Auto save: "+(autosave?"ON":"OFF");
};

setInterval(async()=>{
  if(!autosave) return;
  const f=getCurrentFile();
  if(!f || !f.handle) return;

  const w=await f.handle.createWritable();
  await w.write(f.content);
  await w.close();
},5000);

//// ===== EDIT =====
undo.onclick=()=>editor.undo();
redo.onclick=()=>editor.redo();

//// ===== PACKAGE MANAGER =====
packageManager.onclick=()=>{
  const pkg=prompt("Install package:");
  if(pkg) worker.postMessage({type:"install", package:pkg});
};

//// ===== PYTHON MENU =====
const runBtn=document.createElement("div");
runBtn.textContent="Run ▶";
runBtn.onclick=runCurrent;
pyVersions.appendChild(runBtn);

["0.27.2","0.26.4","0.25.1","0.24.1","0.23.4","0.22.1"]
.forEach(v=>{
  const d=document.createElement("div");
  d.textContent="Pyodide "+v;
  d.onclick=()=>{
    pyVersion=v;
    worker.terminate();
    worker=createWorker();
    term("Switched to "+v);
  };
  pyVersions.appendChild(d);
});

//// ===== MENU HOOKS (FIXED) =====

document.getElementById("openFile").onclick = openFile;
document.getElementById("openFolder").onclick = openFolder;
document.getElementById("newFile").onclick = newFile;
document.getElementById("saveAs").onclick = saveAs;
document.getElementById("toggleAutosave").onclick = toggleAutosave;
//// ===== START =====
files.set("main.py",{handle:null,content:'print("Hello from Pydiode!")'});
refreshTree();
openTab("main.py");
