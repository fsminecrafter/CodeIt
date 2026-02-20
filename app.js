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
const terminalEl = document.getElementById("terminal");
const term = new Terminal({cols:80, rows:20, theme:{background:'#1e1e1e', foreground:'#ffffff'}});
term.open(terminalEl);
term.focus();

// Scroll helper (optional)
function termWrite(text){ term.writeln(text); }

//// ===== EDITOR =====
const editor = CodeMirror.fromTextArea(document.getElementById("editor"),{
  mode:"python",
  theme:"material-darker",
  lineNumbers:true
});
editor.on("change",()=>{ const f=getCurrentFile(); if(f) f.content=editor.getValue(); });

//// ===== PYODIDE WORKER =====
let pyVersion="0.27.2";
let worker=createWorker();

function createWorker(){ return new Worker("worker.js?v="+pyVersion); }

worker.onmessage = e => {
  if(e.data.type === "output") termWrite(e.data.text);
};

term.onData(data => {
  worker.postMessage({type:"input", text:data});
});

async function runCurrent(){
  const f = getCurrentFile();
  if(!f) return;

  terminalEl.innerHTML = ""; // clear terminal

  const lang = langSelect.value;

  if(lang === "Python"){
    worker.postMessage({type:"run", code:f.content});
  } else {
    termWrite("Building "+lang+" code on server...");

    // Send code to server API for compilation
    const res = await fetch("/build", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({lang, code:f.content})
    });

    const data = await res.json();
    if(data.error){
      termWrite("Build failed:\n"+data.error);
      return;
    }

    // Server returns executable path
    const exe = data.executable;

    termWrite("Running executable in temp account...");
    await fetch("/run", {method:"POST", body: JSON.stringify({exe})});
    termWrite("Execution finished.");
  }
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
  current = name;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  const tab = [...tabsEl.children].find(t => t.dataset.name === name);
  if(tab) tab.classList.add("active");

  if(name === "Run"){
    document.getElementById("editorWrap").classList.add("hidden");
    terminalEl.style.flex = "1";
  } else {
    const f = files.get(name);
    editor.setValue(f.content || "");
    document.getElementById("editorWrap").classList.remove("hidden");
    terminalEl.style.flex = "";
  }
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

//// Uhh info
about.onclick=()=>{
  alert("Made by Fsminecrafter (:");
}

support.onclick=()=>{
  alert("Supports: Chrome. Doesnt support: Firefox.")
}

//// ===== RUN TAB =====
const runTab=document.createElement("div");
runTab.className="tab"; runTab.dataset.name="Run";
const runTitle=document.createElement("span"); runTitle.textContent="Run ▶";
runTab.append(runTitle);
runTab.onclick=()=>activateTab("Run");
tabsEl.appendChild(runTab);

const langSelect=document.createElement("select");
["Python","C","C++"].forEach(l=>{ const opt=document.createElement("option"); opt.value=l; opt.textContent=l; langSelect.appendChild(opt); });
runTab.appendChild(langSelect);

const runBtn=document.createElement("div"); runBtn.textContent="Run ▶"; runBtn.onclick=runCurrent;
runTab.appendChild(runBtn);

//// ===== PYTHON MENU =====
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
