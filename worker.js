importScripts(
  "https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.js"
);

let pyodideReady = loadPyodide();

self.onmessage = async e => {
  const pyodide = await pyodideReady;

  if (e.data.type === "run") {
    try {
      pyodide.setStdout({
        batched: msg =>
          self.postMessage({ type: "output", text: msg })
      });

      await pyodide.runPythonAsync(e.data.code);

    } catch (err) {
      self.postMessage({
        type: "output",
        text: err + "\n"
      });
    }
  }
};
