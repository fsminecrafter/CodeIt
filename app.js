const output = document.getElementById("output");
const status = document.getElementById("status");

const editor = CodeMirror.fromTextArea(
  document.getElementById("editor"),
  {
    mode: "python",
    lineNumbers: true,
    theme: "default"
  }
);

const worker = new Worker("worker.js");

worker.onmessage = e => {
  if (e.data.type === "output") {
    output.textContent += e.data.text;
  }
};

document.getElementById("run").onclick = () => {
  output.textContent = "";
  worker.postMessage({
    type: "run",
    code: editor.getValue()
  });
};

let dirHandle = null;
let fileHandle = null;

document.getElementById("pickFolder").onclick = async () => {
  dirHandle = await window.showDirectoryPicker();

  fileHandle = await dirHandle.getFileHandle("main.py", {
    create: true
  });

  status.textContent = "Folder selected";
};

async function saveFile() {
  if (!fileHandle) return;

  const writable = await fileHandle.createWritable();
  await writable.write(editor.getValue());
  await writable.close();

  status.textContent = "Saved " + new Date().toLocaleTimeString();
}

setInterval(saveFile, 5000);
