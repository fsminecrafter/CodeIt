const terminal = document.getElementById("terminal");
const tabsEl = document.getElementById("tabs");

function term(text) {
  terminal.textContent += text;
  terminal.scrollTop = terminal.scrollHeight;
}

const editor = CodeMirror.fromTextArea(
  document.getElementById("editor"),
  { mode:"python", lineNumbers:true }
);

const worker = new Worker("worker.js");

worker.onmessage = e => {
  if (e.data.type === "output")
    term(e.data.text);
};

document.getElementById("run").onclick = () => {
  terminal.textContent = "";
  worker.postMessage({
    type:"run",
    code: editor.getValue()
  });
};

document.getElementById("toggleTerm").onclick = () => {
  terminal.classList.toggle("hidden");
};

//// MULTI TAB SYSTEM

let files = {};
let current = null;

function createTab(name, content="") {
  files[name] = content;

  const tab = document.createElement("div");
  tab.className = "tab";
  tab.textContent = name;

  tab.onclick = () => switchTab(name, tab);

  tabsEl.appendChild(tab);

  switchTab(name, tab);
}

function switchTab(name, tabEl) {
  current = name;

  document.querySelectorAll(".tab")
    .forEach(t => t.classList.remove("active"));

  tabEl.classList.add("active");

  editor.setValue(files[name]);
}

editor.on("change", () => {
  if (current)
    files[current] = editor.getValue();
});

//// OPEN FILE FROM DISK

document.getElementById("openFile").onclick = async () => {
  const [file] = await window.showOpenFilePicker();

  const text = await (await file.getFile()).text();

  createTab(file.name, text);
};

//// START WITH DEFAULT FILE

createTab("main.py", 'print("Hello!")');
