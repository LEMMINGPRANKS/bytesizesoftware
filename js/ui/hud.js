import { BLOCKS } from "../world/blocks.js";
import { getTexture } from "../world/textures.js";

const $ = (s) => document.querySelector(s);

export class HUD {
  constructor(inventory) {
    this.inv = inventory;
    this.el = $("#hud");
    this.hotbar = $("#hotbar");
    this.status = $("#status");
    this.fps = $("#fps");
    this.pos = $("#pos");
    this.target = $("#target-info");
    this.slots = [];
    for (let i = 0; i < 9; i++) {
      const s = document.createElement("div");
      s.className = "slot";
      const k = document.createElement("div"); k.className = "key"; k.textContent = (i + 1) % 10; s.appendChild(k);
      const c = document.createElement("div"); c.className = "count"; s.appendChild(c);
      this.hotbar.appendChild(s);
      this.slots.push({ el: s, count: c });
    }
  }
  refresh() {
    for (let i = 0; i < 9; i++) {
      const id = this.inv.hotbar[i];
      const s = this.slots[i];
      if (id === null) {
        s.el.style.backgroundImage = "";
        s.count.textContent = "";
      } else {
        const tex = getTexture(id, "side");
        s.el.style.backgroundImage = `url(${tex.image.toDataURL?.() || tex.image.src})`;
        s.count.textContent = this.inv.count(id);
      }
      s.el.classList.toggle("active", i === this.inv.active);
    }
  }
  setFps(v) { this.fps.textContent = v; }
  setPos(p) { this.pos.textContent = `${p.x|0},${p.y|0},${p.z|0}`; }
  setTarget(text) {
    if (!text) { this.target.classList.add("hidden"); return; }
    this.target.classList.remove("hidden");
    this.target.textContent = text;
  }
  show(v) { this.el.classList.toggle("hidden", !v); }
}
