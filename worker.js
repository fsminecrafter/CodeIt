/**
 * CodeIt IDE — worker.js
 * Pyodide web worker.
 *
 * GUI protocol: Python prints lines starting with __GUI__: followed by JSON.
 * The worker forwards them to the main thread as { type:"gui", widget:{...} }
 *
 * Key design decisions:
 *  - All user code runs in a PERSISTENT namespace (_user_ns) so that functions
 *    defined in one run are still callable from GUI callbacks in later events.
 *  - Widgets are plain dicts — they never emit themselves; only window(), clear(),
 *    alert(), update_label(), update_input(), plot_line(), plot_bar() emit directly.
 *    This means plots and charts can be nested inside vbox/card/window as children.
 *  - Every widget that might need updating accepts an optional id= kwarg.
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

    // Create a persistent namespace for user code and inject codeit_gui
    pyodide.runPython(`
import sys, json as _json, builtins as _builtins

# ── Persistent user namespace ─────────────────────────────────────────────────
# All user scripts run in this dict so functions survive between runs/callbacks.
_user_ns = {}

# ── GUI module ────────────────────────────────────────────────────────────────
class _GUI:
    """
    CodeIt GUI toolkit.  Import with:  from codeit_gui import *

    LAYOUT CONTAINERS (return widget dicts, can be nested):
        vbox(*children, gap=8)
        hbox(*children, gap=8, align="center")
        grid(*children, cols=2, gap=8)
        card(*children, title=None)

    WIDGETS (return widget dicts):
        label(text, id=None, style=None)
        button(text, onclick=None, color=None, id=None)
        input_box(id, value="", label=None, placeholder="")
        text_area(id, value="", rows=4, label=None, placeholder="")
        slider(id, min=0, max=100, value=50, label=None)
        checkbox(id, text, checked=False)
        select(id, options, value=None, label=None)
        image(src, width=None, height=None, alt="", id=None)
        canvas(id, width=300, height=200)
        progress(value, max=100, color=None, id=None)
        separator()
        spacer(h=8)
        plot_line(data, title="", xlabel="", ylabel="", color="#3b82f6", id=None)
        plot_bar(labels, values, title="", color="#3b82f6", id=None)

    EMITTERS (render immediately to the panel):
        window(title, *children)   — clears panel and renders a titled window
        clear()                    — clears panel
        alert(msg)                 — toast notification
        show(*widgets)             — append widget(s) without clearing
        update_label(id, text)     — update a label's text in-place
        update_input(id, value)    — update an input's value in-place
        update_progress(id, value) — update a progress bar in-place

    CALLBACKS:
        Button onclick="fn_name"  → Python function fn_name() is called on click.
        Input/slider/checkbox/select: define on_change_<id>(value) to react.
        Functions must be defined at module level (not inside if __name__==...).

    EXAMPLE:
        from codeit_gui import *

        def greet():
            name = _state.get("name", "World")
            update_label("greeting", f"Hello, {name}!")

        def on_change_name(val):
            _state["name"] = val

        _state = {}
        window("Greeter",
            vbox(
                input_box("name", placeholder="Your name", label="Name"),
                button("Greet", onclick="greet"),
                label("", id="greeting"),
                plot_line([1,4,9,16,25], title="Squares"),
            )
        )
    """

    def _emit(self, w):
        print("__GUI__:" + _json.dumps(w, default=str))

    # ── Widget constructors (return dicts) ─────────────────────────────────────
    def label(self, text, id=None, style=None):
        w = {"type": "label", "text": str(text)}
        if id:    w["id"]    = id
        if style: w["style"] = style
        return w

    def button(self, text, onclick=None, color=None, id=None):
        w = {"type": "button", "text": str(text)}
        if onclick: w["onclick"] = onclick
        if color:   w["color"]   = color
        if id:      w["id"]      = id
        return w

    def input_box(self, id, value="", label=None, placeholder=""):
        w = {"type": "input", "id": id, "value": str(value), "placeholder": placeholder}
        if label: w["label"] = label
        return w

    def text_area(self, id, value="", rows=4, label=None, placeholder=""):
        w = {"type": "textarea", "id": id, "value": str(value), "rows": rows,
             "placeholder": placeholder}
        if label: w["label"] = label
        return w

    def slider(self, id, min=0, max=100, value=50, label=None):
        w = {"type": "slider", "id": id, "min": min, "max": max, "value": value}
        if label: w["label"] = label
        return w

    def checkbox(self, id, text, checked=False):
        return {"type": "checkbox", "id": id, "text": str(text), "checked": bool(checked)}

    def select(self, id, options, value=None, label=None):
        w = {"type": "select", "id": id, "options": list(options)}
        if value: w["value"] = value
        if label: w["label"] = label
        return w

    def image(self, src, width=None, height=None, alt="", id=None):
        w = {"type": "image", "src": str(src), "alt": alt}
        if width:  w["width"]  = width
        if height: w["height"] = height
        if id:     w["id"]     = id
        return w

    def canvas(self, id, width=300, height=200):
        return {"type": "canvas", "id": id, "width": width, "height": height}

    def progress(self, value, max=100, color=None, id=None):
        w = {"type": "progress", "value": value, "max": max}
        if color: w["color"] = color
        if id:    w["id"]    = id
        return w

    def separator(self):
        return {"type": "separator"}

    def spacer(self, h=8):
        return {"type": "spacer", "height": h}

    # ── Chart widgets (return dicts so they can be nested) ─────────────────────
    def plot_line(self, data, title="", xlabel="", ylabel="",
                  color="#3b82f6", id=None):
        w = {"type": "plot", "plot_type": "line", "data": list(data),
             "title": title, "xlabel": xlabel, "ylabel": ylabel, "color": color}
        if id: w["id"] = id
        return w

    def plot_bar(self, labels, values, title="", color="#3b82f6", id=None):
        w = {"type": "plot", "plot_type": "bar",
             "labels": list(labels), "values": list(values),
             "title": title, "color": color}
        if id: w["id"] = id
        return w

    # ── Layout containers (return dicts) ───────────────────────────────────────
    def vbox(self, *children, gap=8):
        return {"type": "vbox", "children": [c for c in children if c is not None], "gap": gap}

    def hbox(self, *children, gap=8, align="center"):
        return {"type": "hbox", "children": [c for c in children if c is not None],
                "gap": gap, "align": align}

    def grid(self, *children, cols=2, gap=8):
        return {"type": "grid", "children": [c for c in children if c is not None],
                "cols": cols, "gap": gap}

    def card(self, *children, title=None):
        w = {"type": "card", "children": [c for c in children if c is not None]}
        if title: w["title"] = title
        return w

    # ── Emitters (render to panel immediately) ─────────────────────────────────
    def window(self, title, *children):
        """Clear panel and render a titled window with the given children."""
        self._emit({"type": "window", "title": title,
                    "children": [c for c in children if c is not None]})

    def show(self, *widgets):
        """Append one or more widgets to the panel without clearing."""
        for w in widgets:
            if w is not None:
                self._emit({"type": "append", "widget": w})

    def clear(self):
        """Clear the entire GUI panel."""
        self._emit({"type": "clear"})

    def alert(self, msg):
        """Show a toast notification."""
        self._emit({"type": "alert", "message": str(msg)})

    def update_label(self, id, text):
        """Update a label's text content in-place by id."""
        self._emit({"type": "update_label", "id": id, "text": str(text)})

    def update_input(self, id, value):
        """Update an input/textarea's value in-place by id."""
        self._emit({"type": "update_input", "id": id, "value": str(value)})

    def update_progress(self, id, value):
        """Update a progress bar's value in-place by id."""
        self._emit({"type": "update_progress", "id": id, "value": value})


# ── Install as module ──────────────────────────────────────────────────────────
import types as _types
_gui_instance = _GUI()
_mod = _types.ModuleType("codeit_gui")
_mod.__all__ = [m for m in dir(_gui_instance) if not m.startswith("_")]
for _n in _mod.__all__:
    setattr(_mod, _n, getattr(_gui_instance, _n))
sys.modules["codeit_gui"] = _mod

# Also put the instance in builtins so update_label etc. work inside callbacks
# without needing a re-import (the callback runs in _user_ns which already has
# the functions from "from codeit_gui import *" if the user did that import).
_builtins._codeit_gui = _gui_instance
del _n, _mod
`);

    postMessage({ type: "ready", version: v });
}

boot();

// ── Message handler ───────────────────────────────────────────────────────────
self.onmessage = async ({ data }) => {
    if (!pyodide) return;
    const { type } = data;

    if (type === "run") {
        try {
            // Run in the persistent user namespace so definitions survive
            await pyodide.runPythonAsync(data.code, { globals: pyodide.globals.get("_user_ns") });
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

    // GUI callback: button click / input change → call function in user namespace
    else if (type === "gui_event") {
        try {
            const fnName  = data.name.replace(/[^\w]/g, "");   // sanitise
            const args    = data.args ?? [];
            const userNs  = pyodide.globals.get("_user_ns");
            const fn      = userNs.get(fnName);
            if (fn && fn.constructor && typeof fn.__call__ !== "undefined") {
                // It's a Python callable — call it with the JS args
                const pyArgs = args.map(a => a);
                const result = fn(...pyArgs);
                // Handle coroutines
                if (result && typeof result.then === "function") {
                    await result;
                }
                if (fn.destroy) fn.destroy();
            } else {
                // Fallback: run a tiny snippet in the user namespace
                const argsJson = JSON.stringify(args);
                await pyodide.runPythonAsync(
                    `import json as _j\n_fn=locals().get("${fnName}") or globals().get("${fnName}")\nif callable(_fn):\n    _r=_fn(*_j.loads(${JSON.stringify(argsJson)}))\n    import asyncio\n    if asyncio.iscoroutine(_r): await _r`,
                    { globals: userNs }
                );
            }
        } catch (err) {
            postMessage({ type: "output", text: "\x1b[31mGUI callback error: " + String(err) + "\x1b[0m" });
        }
    }
};
