//// MENU OPEN/CLOSE

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

//// TERMINAL

const terminal = document.getElementById("terminal");

function term(t){
  terminal.textContent += t;
  terminal.scrollTop = terminal.scrollHeight;
}

//// EDITOR

const editor = CodeMirror.fromTextArea(
  document.getElementById("editor"),
  { mode:"python", theme:"material-darker", lineNumbers:true }
);

//// WORKER (Pyodide)

let pyVersion = "0.27.2";

function createWorker(){
  return new Worker("worker.js?v="+pyVersion);
}

let worker = createWorker();

worker.onmessage=e=>{
  if(e.data.type==="output")
    term(e.data.text);
};

//// FILE SYSTEM (in-memory)

let files={}, current=null;

function createFile(name,content=""){
  files[name]=content;
  createTab(name);
  refreshList();
}

function createTab(name){
  const tab=document.createElement("div");
  tab.className="tab";
  tab.textContent=name;
  tab.onclick=()=>switchTo(name);
  tabs.appendChild(tab);
  switchTo(name);
}

function switchTo(name){
  current=name;

  document.querySelectorAll(".tab")
    .forEach(t=>t.classList.remove("active"));

  [...tabs.children]
    .find(t=>t.textContent===name)
    .classList.add("active");

  editor.setValue(files[name]);
}

editor.on("change",()=>{
  if(current)
    files[current]=editor.getValue();
});

function refreshList(){
  fileList.innerHTML="";
  for(const f in files){
    const d=document.createElement("div");
    d.textContent=f;
    d.onclick=()=>switchTo(f);
    fileList.appendChild(d);
  }
}

//// FILE MENU ACTIONS

let autosave=false;
let saveHandle=null;

toggleAutosave.onclick=()=>{
  autosave=!autosave;
  toggleAutosave.textContent=
    "Auto save: "+(autosave?"ON":"OFF");
};

setInterval(async ()=>{
  if(autosave && saveHandle){
    const w = await saveHandle.createWritable();
    await w.write(editor.getValue());
    await w.close();
  }
},5000);

saveAs.onclick = async ()=>{
  saveHandle = await window.showSaveFilePicker({
    suggestedName: current || "file.py"
  });

  const w = await saveHandle.createWritable();
  await w.write(editor.getValue());
  await w.close();
};

openFile.onclick = async ()=>{
  const [file] = await window.showOpenFilePicker();
  const text = await (await file.getFile()).text();
  createFile(file.name,text);
};

openFolder.onclick = async ()=>{
  const dir = await window.showDirectoryPicker();
  for await (const entry of dir.values()){
    if(entry.kind==="file"){
      const f = await entry.getFile();
      createFile(f.name, await f.text());
    }
  }
};

//// EDIT MENU

findReplace.onclick=()=>{
  const find = prompt("Find:");
  if(!find) return;
  const rep = prompt("Replace with:");
  editor.setValue(
    editor.getValue().replaceAll(find,rep)
  );
};

packageManager.onclick=()=>{
  const pkg = prompt("Install package:");
  if(!pkg) return;

  worker.postMessage({
    type:"install",
    package:pkg
  });
};

//// PYTHON MENU (versions)

const versions = [
 "0.27.2",
 "0.26.4",
 "0.25.1",
 "0.24.1",
 "0.23.4",
 "0.22.1"
];

versions.forEach(v=>{
  const d=document.createElement("div");
  d.textContent="Pyodide "+v;
  d.onclick=()=>{
    pyVersion=v;
    worker.terminate();
    worker=createWorker();
    term(`Switched to Pyodide ${v}\n`);
  };
  pyVersions.appendChild(d);
});

//// START FILE

createFile("main.py",'print("Hello!")');
