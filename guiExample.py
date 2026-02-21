# ── CodeIt GUI — Full Example ────────────────────────────────
# This file demonstrates every widget in codeit_gui.
# Run it, then interact with the panel on the right.
# Buttons call Python functions; inputs/sliders fire on_change_<id>.
from codeit_gui import *

# ── Shared state ──────────────────────────────────────────────
_s = {
    "name":    "",
    "r": 99, "g": 60, "b": 180,
    "items":   [],
    "counter": 0,
    "unit":    "km/h",
    "speed":   72,
}

# ══════════════════════════════════════════════════════════════
#  SECTION 1 — HELLO CARD  (label, input, button)
# ══════════════════════════════════════════════════════════════
def on_change_name(val):
    _s["name"] = val

def greet():
    n = _s["name"].strip() or "stranger"
    update_label("greeting", f"👋 Hello, {n}!")

def clear_greeting():
    update_label("greeting", "")
    update_input("name", "")
    _s["name"] = ""

# ══════════════════════════════════════════════════════════════
#  SECTION 2 — COUNTER  (button, label, progress)
# ══════════════════════════════════════════════════════════════
def count_up():
    _s["counter"] = min(100, _s["counter"] + 10)
    update_label("count_lbl",  str(_s["counter"]))
    update_progress("count_bar", _s["counter"])

def count_down():
    _s["counter"] = max(0, _s["counter"] - 10)
    update_label("count_lbl",  str(_s["counter"]))
    update_progress("count_bar", _s["counter"])

def count_reset():
    _s["counter"] = 0
    update_label("count_lbl",  "0")
    update_progress("count_bar", 0)

# ══════════════════════════════════════════════════════════════
#  SECTION 3 — COLOUR MIXER  (slider × 3, live preview label)
# ══════════════════════════════════════════════════════════════
def _refresh_colour():
    r, g, b = _s["r"], _s["g"], _s["b"]
    hex_col = f"#{r:02x}{g:02x}{b:02x}"
    update_label("col_preview",
                 f"  {hex_col}  ",
                 )
    # We can inject inline style via a fresh label emit
    show(label(f"▮  {hex_col}",
               id="col_preview",
               style={"background": hex_col,
                      "color": "#fff" if (r*0.299+g*0.587+b*0.114) < 128 else "#000",
                      "padding": "6px 14px",
                      "borderRadius": "6px",
                      "fontFamily": "monospace",
                      "fontWeight": "600"}))

def on_change_red(val):
    _s["r"] = int(val)
    _refresh_colour()

def on_change_green(val):
    _s["g"] = int(val)
    _refresh_colour()

def on_change_blue(val):
    _s["b"] = int(val)
    _refresh_colour()

# ══════════════════════════════════════════════════════════════
#  SECTION 4 — TODO LIST  (input, button, dynamic labels)
# ══════════════════════════════════════════════════════════════
def on_change_todo_input(val):
    _s["_todo_draft"] = val

def add_todo():
    item = _s.get("_todo_draft", "").strip()
    if not item:
        return
    _s["items"].append(item)
    _s["_todo_draft"] = ""
    update_input("todo_input", "")
    _render_todo()

def clear_todos():
    _s["items"] = []
    _render_todo()

def _render_todo():
    if not _s["items"]:
        update_label("todo_list", "No items yet.")
    else:
        text = "\n".join(f"• {i}" for i in _s["items"])
        update_label("todo_list", text)

# ══════════════════════════════════════════════════════════════
#  SECTION 5 — UNIT CONVERTER  (input, select, label)
# ══════════════════════════════════════════════════════════════
_CONVERSIONS = {
    "km/h → mph":  lambda v: v * 0.621371,
    "mph → km/h":  lambda v: v * 1.60934,
    "°C → °F":     lambda v: v * 9/5 + 32,
    "°F → °C":     lambda v: (v - 32) * 5/9,
    "kg → lbs":    lambda v: v * 2.20462,
    "lbs → kg":    lambda v: v * 0.453592,
    "m → ft":      lambda v: v * 3.28084,
    "ft → m":      lambda v: v * 0.3048,
}

def on_change_conv_val(val):
    _s["_conv_val"] = val
    _do_convert()

def on_change_conv_type(val):
    _s["_conv_type"] = val
    _do_convert()

def _do_convert():
    try:
        v   = float(_s.get("_conv_val", "0") or "0")
        fn  = _CONVERSIONS.get(_s.get("_conv_type", "km/h → mph"))
        res = fn(v) if fn else 0
        update_label("conv_result", f"= {res:.4f}")
    except Exception:
        update_label("conv_result", "—")

# ══════════════════════════════════════════════════════════════
#  SECTION 6 — CHARTS
# ══════════════════════════════════════════════════════════════
import math
_xs   = list(range(0, 37, 3))
_sine = [round(math.sin(math.radians(x)) * 100) / 100 for x in _xs]
_months  = ["Jan","Feb","Mar","Apr","May","Jun"]
_revenue = [38, 52, 47, 71, 65, 83]

# ══════════════════════════════════════════════════════════════
#  RENDER EVERYTHING
# ══════════════════════════════════════════════════════════════
window("🧪 CodeIt GUI — Full Demo",
    vbox(

        # ── 1. Hello card ──────────────────────────────────
        card(title="👋 Greeter",
            input_box("name", label="Your name:", placeholder="Type your name…"),
            hbox(
                button("Greet",  onclick="greet",         color="#166534"),
                button("Clear",  onclick="clear_greeting"),
            ),
            label("", id="greeting"),
        ),

        # ── 2. Counter ─────────────────────────────────────
        card(title="🔢 Counter",
            hbox(
                button("− 10",  onclick="count_down"),
                label("0", id="count_lbl",
                      style={"fontSize":"22px","fontWeight":"700",
                             "minWidth":"40px","textAlign":"center"}),
                button("+ 10",  onclick="count_up",  color="#1e40af"),
                button("Reset", onclick="count_reset"),
            ),
            progress(0, id="count_bar"),
        ),

        # ── 3. Colour mixer ────────────────────────────────
        card(title="🎨 RGB Colour Mixer",
            slider("red",   0, 255, 99,  label="Red"),
            slider("green", 0, 255, 60,  label="Green"),
            slider("blue",  0, 255, 180, label="Blue"),
            label("▮  #633cb4",
                  id="col_preview",
                  style={"background":"#633cb4","color":"#fff",
                         "padding":"6px 14px","borderRadius":"6px",
                         "fontFamily":"monospace","fontWeight":"600"}),
        ),

        # ── 4. Todo list ───────────────────────────────────
        card(title="✅ To-Do List",
            hbox(
                input_box("todo_input", placeholder="New item…"),
                button("Add",   onclick="add_todo",    color="#166534"),
                button("Clear", onclick="clear_todos"),
            ),
            label("No items yet.", id="todo_list",
                  style={"whiteSpace":"pre-line","lineHeight":"1.8"}),
        ),

        # ── 5. Unit converter ──────────────────────────────
        card(title="📐 Unit Converter",
            hbox(
                input_box("conv_val", placeholder="Value", value="100"),
                select("conv_type",
                       list(_CONVERSIONS.keys()),
                       value="km/h → mph"),
            ),
            label("= 62.1371", id="conv_result",
                  style={"fontSize":"18px","fontWeight":"700","color":"#60a5fa"}),
        ),

        # ── 6. Charts ──────────────────────────────────────
        card(title="📊 Charts",
            plot_line(_sine, title="sin(x°)", xlabel="degrees", ylabel="sin",
                      color="#f472b6"),
            spacer(8),
            plot_bar(_months, _revenue, title="Monthly Revenue ($k)",
                     color="#3b82f6"),
        ),

    )
)

# Prime the converter result on load
_s["_conv_val"]  = "100"
_s["_conv_type"] = "km/h → mph"
_do_convert()
