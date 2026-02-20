let pyodide = null;

async function load() {

  const v = new URL(self.location).searchParams.get("v") || "0.27.2";

  importScripts(`https://cdn.jsdelivr.net/pyodide/v${v}/full/pyodide.js`);

  pyodide = await loadPyodide({

    stdout: text => {
      postMessage({ type: "output", text });
    },

    stderr: text => {
      postMessage({ type: "output", text });
    }

  });

  postMessage({ type: "output", text: "Pyodide " + v + " ready" });
}

load();


self.onmessage = async e => {

  const { type, code, package: pkg } = e.data;

  if (!pyodide) return;

  //// ===== RUN CODE =====
  if (type === "run") {
    try {
      await pyodide.runPythonAsync(code);

    } catch (err) {
      postMessage({
        type: "output",
        text: String(err)
      });
    }
  }

  //// ===== INSTALL PACKAGE =====
  if (type === "install") {
    try {
      await pyodide.loadPackage("micropip");

      const micropip = pyodide.pyimport("micropip");
      await micropip.install(pkg);

      postMessage({
        type: "output",
        text: "Installed " + pkg
      });

    } catch (err) {
      postMessage({
        type: "output",
        text: String(err)
      });
    }
  }
};
