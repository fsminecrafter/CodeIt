const terminal = document.getElementById("terminal");
const tabsEl = document.getElementById("tabs");
const fileList = document.getElementById("fileList");

function term(text){
  terminal.textContent += text;
  terminal.scrollTop = terminal.scrollHeight;
}

const editor = CodeMirror.fromTextArea(
  document.getElementById("editor"),
  {
    mode:"python",
    theme:"material-darker",
    lineNumbers:true
  }
);

const worker = new Worker("worker.js");

worker.onmessage = e=>{
  if(e.data.type==="output")
    term(e.data.text);
};

document.getElementById("run").onclick = ()=>{
  terminal.textContent="";
  worker.postMessage({
    type:"run",
    code:editor.getValue()
  });
};

document.getElementById("toggleTerm").onclick = ()=>{
  terminal.classList.toggle("hidden");
};

//// FILE SYSTEM (in-memory)

let files = {};
let current = null;

function refreshFileList(){
  fileList.innerHTML="";
  for(const name in files){
    const div=document.createElement("div");
    div.textContent=name;
    div.style.cursor="pointer";
    div.onclick=()=>switchTo(name);
    fileList.appendChild(div);
  }
}

function createFile(name,content=""){
  files[name]=content;
  createTab(name);
  refreshFileList();
}

function createTab(name){
  const tab=document.createElement("div");
  tab.className="tab";
  tab.textContent=name;

  tab.onclick=()=>switchTo(name);

  tabsEl.appendChild(tab);
  switchTo(name);
}

function switchTo(name){
  current=name;

  document.querySelectorAll(".tab")
    .forEach(t=>t.classList.remove("active"));

  [...tabsEl.children]
    .find(t=>t.textContent===name)
    .classList.add("active");

  editor.setValue(files[name]);
}

editor.on("change",()=>{
  if(current)
    files[current]=editor.getValue();
});

//// OPEN FILE

document.getElementById("openFile").onclick = async ()=>{
  const [file] = await window.showOpenFilePicker();
  const text = await (await file.getFile()).text();
  createFile(file.name,text);
};

//// START FILE

createFile("main.py",'print("Hello from Pydiode!")');
