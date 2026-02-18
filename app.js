//// ---------- MENU OPEN/CLOSE ----------

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

//// ---------- TERMINAL ----------

const terminal = document.getElementById("terminal");

function term(t){
  terminal.textContent += t;
  terminal.scrollTop = terminal.scrollHeight;
}

//// ---------- EDITOR ----------

const editor = CodeMirror.fromTextArea(
  document.getElementById("editor"),
  { mode:"python", theme:"material-darker", lineNumbers:true }
);

//// ---------- WORKER ----------

let pyVersion = "0.27.2";

function makeWorker(){
  return new Worker("worker.js?v="+pyVersion);
}

let worker = makeWorker();

worker.onmessage=e=>{
  if(e.data.type==="output")
    term(e.data.text);
};

//// ---------- FILE SYSTEM ----------

let files = {};      // name -> content
let openTabs = {};   // name -> tab element
let current = null;

const tabs = document.getElementById("tabs");
const fileList = document.getElementById("fileList");

//// ----- TAB MANAGEMENT -----

function openFileInTab(name){

  if(openTabs[name]){
    switchTo(name);
    return;
  }

  const tab = document.createElement("div");
  tab.className="tab";

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

  tab.onclick = ()=> switchTo(name);

  tabs.appendChild(tab);

  openTabs[name] = tab;

  switchTo(name);
}

function switchTo(name){
  if(!files[name]) return;

  current = name;

  document.querySelectorAll(".tab")
    .forEach(t=>t.classList.remove("active"));

  openTabs[name].classList.add("active");

  editor.setValue(files[name]);
}

function closeTab(name){

  const tab = openTabs[name];
  if(!tab) return;

  tab.remove();
  delete openTabs[name];

  if(current === name){

    const remaining = Object.keys(openTabs);

    if(remaining.length)
      switchTo(remaining[0]);
    else{
      current = null;
      editor.setValue("");
    }
  }
}

editor.on("change",()=>{
  if(current)
    files[current] = editor.getValue();
});

//// ----- FILE TREE -----

function refreshTree(){

  fileList.innerHTML="";

  for(const name in files){

    const div = document.createElement("div");
    div.textContent = name;
    div.style.cursor="pointer";

    div.onclick = ()=>{
      openFileInTab(name);
    };

    fileList.appendChild(div);
  }
}

function createFile(name,content=""){

  if(files[name]) return;

  files[name] = content;

  refreshTree();
  openFileInTab(name);
}

//// ---------- FILE MENU ----------

newFile.onclick = ()=>{
  const name = prompt("File name:", "new.py");
  if(!name) return;
  createFile(name,"");
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

let saveHandle = null;

saveAs.onclick = async ()=>{

  saveHandle = await window.showSaveFilePicker({
    suggestedName: current || "file.py"
  });

  const w = await saveHandle.createWritable();
  await w.write(editor.getValue());
  await w.close();
};

let autosave = false;

toggleAutosave.onclick = ()=>{
  autosave = !autosave;
  toggleAutosave.textContent =
    "Auto save: " + (autosave ? "ON" : "OFF");
};

setInterval(async ()=>{
  if(autosave && saveHandle && current){

    const w = await saveHandle.createWritable();
    await w.write(editor.getValue());
    await w.close();
  }
}, 5000);

//// ---------- EDIT MENU ----------

undo.onclick = ()=> editor.undo();
redo.onclick = ()=> editor.redo();

findReplace.onclick = ()=>{
  const find = prompt("Find:");
  if(!find) return;

  const rep = prompt("Replace with:");
  if(rep === null) return;

  editor.setValue(
    editor.getValue().replaceAll(find, rep)
  );
};

//// Keyboard shortcuts

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
  if(!pkg) return;

  worker.postMessage({
    type:"install",
    package:pkg
  });
};

//// ---------- PYTHON MENU ----------

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
    worker = makeWorker();

    term(`Switched to Pyodide ${v}\n`);
  };

  pyVersions.appendChild(d);
});

//// ---------- START ----------

createFile("main.py",'print("Hello from Pydiode!")');
