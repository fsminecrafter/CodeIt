/**
 * CodeIt IDE — worker.js
 * Pyodide web worker.
 *
 * GUI protocol: Python prints lines starting with __GUI__: followed by JSON.
 * The worker forwards them to the main thread as { type:"gui", widget:{...} }
 *
 * Python usage:
 *   from codeit_gui import *
 *   window("My App",
 *     vbox(
 *       label("Hello!"),
 *       button("Click me", onclick="on_click"),
 *       slider("vol", 0, 100, 50, label="Volume"),
 *     )
 *   )
 *   def on_click(): alert("Hi!")
 */

let pyodide = null;

async function boot() {
    const v = new URL(self.location.href).searchParams.get("v") || "0.27.2";
    importScripts(`https://cdn.jsdelivr.net/pyodide/v${v}/full/pyodide.js`);

    pyodide = await loadPyodide({
        stdout: text => {
            if (text.startsWith("__GUI__:")) {
                try {
                    const w = JSON.parse(text.slice(8));
                    postMessage({ type: "gui", widget: w });
                    return;
                } catch (_) {}
            }
            postMessage({ type: "output", text });
        },
        stderr: text => {
            postMessage({ type: "output", text: "\x1b[31m" + text + "\x1b[0m" });
        }
    });

    // Inject codeit_gui helper module
    pyodide.runPython(`
import sys, json as _json

class _GUI:
    """
    CodeIt GUI toolkit.

    Usage:
        from codeit_gui import *

        clear()
        window("My App",
            vbox(
                label("Hello World", style={"color":"#60a5fa","fontSize":"18px"}),
                hbox(
                    button("OK",     onclick="do_ok",  color="#166534"),
                    button("Cancel", onclick="do_cancel"),
                ),
                input_box("name", label="Your name:", placeholder="Enter name"),
                slider("speed", 0, 200, 60, label="Speed"),
                checkbox("dark", "Dark mode", checked=True),
                select("lang", ["Python","C","C++"], label="Language"),
                progress(75),
                plot_line([1,4,9,16,25], title="Squares"),
            )
        )

        def do_ok():
            alert("OK pressed!")

    Button callbacks: define a Python function with the same name as onclick=.
    Input/slider/checkbox/select callbacks: define on_change_<id>(value).
    """

    def _emit(self, w):
        print("__GUI__:" + _json.dumps(w))

    # ── Layout containers ──────────────────────────────────
    def window(self, title, *children):
        self._emit({"type":"window","title":title,"children":list(children)})

    def vbox(self, *children, gap=8):
        return {"type":"vbox","children":list(children),"gap":gap}

    def hbox(self, *children, gap=8, align="center"):
        return {"type":"hbox","children":list(children),"gap":gap,"align":align}

    def grid(self, *children, cols=2, gap=8):
        return {"type":"grid","children":list(children),"cols":cols,"gap":gap}

    def card(self, *children, title=None):
        w = {"type":"card","children":list(children)}
        if title: w["title"] = title
        return w

    # ── Basic widgets ──────────────────────────────────────
    def label(self, text, id=None, style=None):
        w = {"type":"label","text":str(text)}
        if id:    w["id"]    = id
        if style: w["style"] = style
        return w

    def button(self, text, onclick=None, color=None):
        w = {"type":"button","text":str(text)}
        if onclick: w["onclick"] = onclick
        if color:   w["color"]   = color
        return w

    def input_box(self, id, value="", label=None, placeholder=""):
        w = {"type":"input","id":id,"value":str(value),"placeholder":placeholder}
        if label: w["label"] = label
        return w

    def text_area(self, id, value="", rows=4, label=None, placeholder=""):
        w = {"type":"textarea","id":id,"value":str(value),"rows":rows,"placeholder":placeholder}
        if label: w["label"] = label
        return w

    def slider(self, id, min=0, max=100, value=50, label=None):
        w = {"type":"slider","id":id,"min":min,"max":max,"value":value}
        if label: w["label"] = label
        return w

    def checkbox(self, id, text, checked=False):
        return {"type":"checkbox","id":id,"text":str(text),"checked":bool(checked)}

    def select(self, id, options, value=None, label=None):
        w = {"type":"select","id":id,"options":list(options)}
        if value: w["value"] = value
        if label: w["label"] = label
        return w

    def image(self, src, width=None, height=None, alt=""):
        w = {"type":"image","src":str(src),"alt":alt}
        if width:  w["width"]  = width
        if height: w["height"] = height
        return w

    def canvas(self, id, width=300, height=200):
        return {"type":"canvas","id":id,"width":width,"height":height}

    def progress(self, value, max=100, color=None):
        w = {"type":"progress","value":value,"max":max}
        if color: w["color"] = color
        return w

    def separator(self): return {"type":"separator"}
    def spacer(self, h=8): return {"type":"spacer","height":h}

    # ── Imperatives ────────────────────────────────────────
    def clear(self):
        self._emit({"type":"clear"})

    def alert(self, msg):
        self._emit({"type":"alert","message":str(msg)})

    def update_label(self, id, text):
        self._emit({"type":"update","id":id,"text":str(text)})

    def update_input(self, id, value):
        self._emit({"type":"update_input","id":id,"value":str(value)})

    # ── Charts ─────────────────────────────────────────────
    def plot_line(self, data, title="", xlabel="", ylabel="", color="#3b82f6"):
        self._emit({"type":"plot","plot_type":"line","data":data,
                    "title":title,"xlabel":xlabel,"ylabel":ylabel,"color":color})

    def plot_bar(self, labels, values, title="", color="#3b82f6"):
        self._emit({"type":"plot","plot_type":"bar","labels":labels,
                    "values":values,"title":title,"color":color})


_g = _GUI()

# Make "from codeit_gui import *" export every method as a top-level function
import types as _types
_mod = _types.ModuleType("codeit_gui")
_mod.__all__ = [m for m in dir(_g) if not m.startswith("_")]
for _name in _mod.__all__:
    setattr(_mod, _name, getattr(_g, _name))
sys.modules["codeit_gui"] = _mod
del _g, _mod, _name
`);

    postMessage({ type: "ready", version: v });
}

boot();

// ── Message handler ──────────────────────────────────────────────────────────
self.onmessage = async ({ data }) => {
    if (!pyodide) return;
    const { type } = data;

    if (type === "run") {
        try {
            await pyodide.runPythonAsync(data.code);
        } catch (err) {
            postMessage({ type: "output", text: "\x1b[31m" + String(err) + "\x1b[0m" });
        }
    }

    else if (type === "install") {
        try {
            await pyodide.loadPackage("micropip");
            const micropip = pyodide.pyimport("micropip");
            await micropip.install(data.package);
            postMessage({ type: "output",    text: "\x1b[32mInstalled " + data.package + "\x1b[0m" });
            postMessage({ type: "installed", package: data.package });
        } catch (err) {
            postMessage({ type: "output", text: "\x1b[31m" + String(err) + "\x1b[0m" });
        }
    }

    // GUI event: button click or input change from browser → call Python function
    else if (type === "gui_event") {
        try {
            const argsJson = JSON.stringify(data.args ?? []);
            const fnName   = data.name.replace(/['"\\]/g, "");
            await pyodide.runPythonAsync(`
import json as _j, asyncio as _a
_fn = globals().get("${fnName}")
if callable(_fn):
    _args = _j.loads('''${argsJson}''')
    _r = _fn(*_args)
    if _a.iscoroutine(_r): await _r
`);
        } catch (err) {
            postMessage({ type: "output", text: "\x1b[31mGUI callback error: " + String(err) + "\x1b[0m" });
        }
    }
};
