#!/usr/bin/env python3
"""Bundle the modular Wildcraft source into a single self-contained HTML file
that runs from file:// — no server, no modules, no CDN."""
import re
from pathlib import Path

ROOT = Path(__file__).parent

MODULES = [
    "js/config.js",
    "js/world/blocks.js",
    "js/world/noise.js",
    "js/world/textures.js",
    "js/world/chunk.js",
    "js/world/worldgen.js",
    "js/world/mesher.js",
    "js/world/world.js",
    "js/engine/renderer.js",
    "js/engine/loop.js",
    "js/engine/input.js",
    "js/entities/player.js",
    "js/gameplay/mining.js",
    "js/gameplay/inventory.js",
    "js/gameplay/recipes.js",
    "js/gameplay/crafting.js",
    "js/gameplay/trees.js",
    "js/entities/cow.js",
    "js/gameplay/mobs.js",
    "js/ui/hud.js",
    "js/save/saveManager.js",
    "js/main.js",
]

DECL_RE = re.compile(
    r"^[ \t]*export\s+(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)",
    re.MULTILINE,
)
REEXPORT_RE = re.compile(r"^[ \t]*export\s*\{([^}]*)\};?\s*$", re.MULTILINE)


def find_exports(src: str) -> list[str]:
    names = []
    for m in DECL_RE.finditer(src):
        names.append(m.group(1))
    for m in REEXPORT_RE.finditer(src):
        for piece in m.group(1).split(","):
            piece = piece.strip()
            if not piece:
                continue
            # `foo` or `foo as bar`
            parts = [p.strip() for p in piece.split(" as ")]
            names.append(parts[-1])
    return names


def strip_module_syntax(src: str) -> str:
    # Drop `export { ... };` re-export blocks.
    src = REEXPORT_RE.sub("", src)
    # Drop import statements (single- or multi-line).
    src = re.sub(r"^[ \t]*import\s+[\s\S]*?from\s+['\"][^'\"]+['\"]\s*;?\s*\n", "", src, flags=re.MULTILINE)
    src = re.sub(r"^[ \t]*import\s+['\"][^'\"]+['\"]\s*;?\s*\n", "", src, flags=re.MULTILINE)
    # Strip leading `export ` keyword (keep the declaration).
    src = re.sub(r"^[ \t]*export\s+", "", src, flags=re.MULTILINE)
    return src


def bundle_file(path: Path) -> str:
    src = path.read_text()
    exports = find_exports(src)
    body = strip_module_syntax(src)
    lines = [f"// === {path.relative_to(ROOT)} ===",
             "(function () {"]
    lines.append(body)
    for name in exports:
        lines.append(f"  window.{name} = typeof {name} !== 'undefined' ? {name} : undefined;")
    lines.append("})();")
    return "\n".join(lines)


def main():
    three_path = ROOT / "assets/three.module.js"
    three_src = three_path.read_text()
    three_exports = find_exports(three_src)
    three_body = strip_module_syntax(three_src)
    parts = ["// === Three.js (vendored) ===",
             "window.THREE = {};",
             "(function (THREE) {",
             three_body]
    for name in three_exports:
        parts.append(f"  THREE.{name} = typeof {name} !== 'undefined' ? {name} : undefined;")
    parts.append("})(window.THREE);\n")

    for m in MODULES:
        parts.append(bundle_file(ROOT / m))
        parts.append("")

    bundle = "\n".join(parts)

    html = (ROOT / "index.html").read_text()
    css = (ROOT / "css/style.css").read_text()
    html = html.replace('<link rel="stylesheet" href="css/style.css" />',
                        "<style>" + css + "</style>")
    html = re.sub(r"<script type=\"importmap\">.*?</script>\s*", "", html, flags=re.DOTALL)
    html = re.sub(
        r"<script type=\"module\" src=\"js/main\.js\"></script>",
        lambda m: '<script>\n' + bundle + "\n</script>",
        html, flags=re.DOTALL)

    out = ROOT / "wildcraft.html"
    out.write_text(html)
    print(f"Wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
