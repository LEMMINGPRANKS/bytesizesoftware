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

    // Hunger bar above hotbar.
    this.hungerRow = document.createElement("div");
    this.hungerRow.id = "hunger-row";
    this.hungerRow.style.cssText = "position:absolute;bottom:80px;left:50%;transform:translateX(-50%);display:flex;gap:2px;";
    this.hungerRow.style.pointerEvents = "none";
    this.pips = [];
    for (let i = 0; i < 10; i++) {
      const p = document.createElement("div");
      p.style.cssText = "width:14px;height:14px;background:#5a2a2a;border:1px solid #000;border-radius:50%;";
      this.hungerRow.appendChild(p);
      this.pips.push(p);
    }
    document.body.appendChild(this.hungerRow);

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
  setHunger(v) {
    const filled = Math.round((v / 20) * 10);
    for (let i = 0; i < 10; i++) {
      this.pips[i].style.background = i < filled ? "#e06060" : "#3a1818";
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
