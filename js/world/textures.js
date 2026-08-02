// Procedural canvas textures. Each block face gets a 16x16 texture made from
// noise patterns. Cached per block id.
import * as THREE from "three";
import { BLOCKS, B } from "./blocks.js";

const SIZE = 16;
const cache = new Map(); // key: `${id}:${face}` -> THREE.Texture

function makeCtx() {
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgb(r, g, b, a = 1) {
  return `rgba(${r|0},${g|0},${b|0},${a})`;
}
// Global brightness lift — pushes every base colour up so the world reads
// as daylight rather than overcast. Tuned to keep saturated ores bright
// without blowing out highlights.
const BRIGHT_LIFT = 22;
function lift(rgbIn) {
  return rgbIn.map((v) => Math.max(0, Math.min(255, v + BRIGHT_LIFT)));
}
function vary(rgbIn, amt) {
  return rgbIn.map((v) => Math.max(0, Math.min(255, v + BRIGHT_LIFT + (Math.random() * 2 - 1) * amt)));
}

function fillNoise(ctx, base, amp = 30, spec = SIZE) {
  const b = lift(base);
  for (let y = 0; y < spec; y++) {
    for (let x = 0; x < spec; x++) {
      const c = b.map((v, i) => Math.max(0, Math.min(255, v + (Math.random() * 2 - 1) * amp)));
      ctx.fillStyle = rgb(c[0], c[1], c[2]);
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function specks(ctx, color, count) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = (Math.random() * SIZE) | 0, y = (Math.random() * SIZE) | 0;
    ctx.fillRect(x, y, 1 + (Math.random() * 2 | 0), 1);
  }
}

function drawTexture(id, face) {
  const def = BLOCKS[id];
  const { c, ctx } = makeCtx();
  let baseColor = def.color;
  if (face === "top" && def.top) baseColor = def.top;
  else if (face === "side" && def.side) baseColor = def.side;
  else if (face === "bottom" && def.bottom) baseColor = def.bottom;
  const base = hexToRgb(baseColor || "#888");

  switch (id) {
    case B.GRASS: {
      if (face === "top") { fillNoise(ctx, hexToRgb(def.top), 25); }
      else if (face === "side") {
        fillNoise(ctx, hexToRgb("#8a6a3a"), 20);
        ctx.fillStyle = "#5fa83a";
        for (let x = 0; x < SIZE; x++) {
          const h = 2 + ((Math.random() * 3) | 0);
          ctx.fillRect(x, 0, 1, h);
        }
      } else fillNoise(ctx, hexToRgb(def.bottom), 20);
      break;
    }
    case B.DIRT: fillNoise(ctx, base, 25); specks(ctx, "#5a3a1a", 12); break;
    case B.STONE: fillNoise(ctx, base, 20); specks(ctx, "#666", 10); break;
    case B.COBBLE: {
      fillNoise(ctx, base, 30);
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      for (let i = 0; i < 4; i++) {
        ctx.strokeRect(Math.random() * SIZE, Math.random() * SIZE, 4 + Math.random() * 4, 4 + Math.random() * 4);
      }
      break;
    }
    case B.SAND: fillNoise(ctx, base, 15); specks(ctx, "#c9bd7a", 18); break;
    case B.WOOD: {
      if (face === "top" || face === "bottom") {
        fillNoise(ctx, hexToRgb(def.top), 14);
        ctx.strokeStyle = "rgba(60,40,20,0.5)";
        for (let r = 2; r < 8; r += 2) {
          ctx.beginPath(); ctx.arc(8, 8, r, 0, Math.PI * 2); ctx.stroke();
        }
      } else {
        fillNoise(ctx, hexToRgb(def.side), 12);
        ctx.fillStyle = "rgba(40,28,12,0.5)";
        for (let y = 0; y < SIZE; y += 3) ctx.fillRect(0, y, SIZE, 1);
      }
      break;
    }
    case B.PLANKS: {
      fillNoise(ctx, base, 14);
      ctx.strokeStyle = "rgba(70,40,15,0.7)";
      ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(SIZE, 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(8, 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, SIZE); ctx.stroke();
      break;
    }
    case B.BEAM: {
      fillNoise(ctx, base, 12);
      ctx.strokeStyle = "rgba(50,30,10,0.7)";
      ctx.strokeRect(1, 1, SIZE - 2, SIZE - 2);
      ctx.beginPath(); ctx.moveTo(SIZE / 2, 0); ctx.lineTo(SIZE / 2, SIZE); ctx.stroke();
      break;
    }
    case B.LEAVES: fillNoise(ctx, base, 40); specks(ctx, "#2a5a1a", 20); break;
    case B.WALL_STONE: {
      fillNoise(ctx, base, 18);
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      for (let y = 0; y < SIZE; y += 8) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(SIZE, y); ctx.stroke(); }
      for (let x = 0; x < SIZE; x += 8) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, SIZE); ctx.stroke(); }
      break;
    }
    case B.WALL_WOOD: {
      fillNoise(ctx, base, 16);
      ctx.strokeStyle = "rgba(40,20,10,0.6)";
      ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
      ctx.strokeRect(2, 2, SIZE - 4, SIZE - 4);
      break;
    }
    case B.BRICK: {
      fillNoise(ctx, base, 16);
      ctx.strokeStyle = "rgba(200,200,200,0.6)";
      for (let y = 0; y < SIZE; y += 4) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(SIZE, y); ctx.stroke();
        const offset = (y / 4) % 2 === 0 ? 0 : 4;
        for (let x = offset; x < SIZE; x += 8) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 4); ctx.stroke(); }
      }
      break;
    }
    case B.FIREPLACE: {
      fillNoise(ctx, base, 18);
      ctx.fillStyle = "#ff8a30";
      ctx.fillRect(4, 4, SIZE - 8, SIZE - 8);
      specks(ctx, "#ffd060", 8);
      specks(ctx, "#aa3010", 6);
      break;
    }
    case B.GLASS: {
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = "rgba(188,216,232,0.35)";
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
      break;
    }
    case B.IRON_ORE: case B.GOLD_ORE: case B.DIAMOND_ORE: case B.PLATINUM_ORE: {
      // Stone base — same neutral grey as regular stone, so the ore reads as
      // flecks embedded in rock rather than a glowing cluster.
      fillNoise(ctx, hexToRgb("#888"), 18);
      const ore = hexToRgb(baseColor);
      // Scatter small (mostly 1x1) darker flecks with brightness jitter so
      // each fleck looks like a mineral grain, not a flat painted square.
      // Flecks are darkened toward the ore colour so they read as "darker
      // stone with a hint of [iron/gold/diamond]" rather than bright paint.
      for (let i = 0; i < 16; i++) {
        const x = (Math.random() * SIZE) | 0, y = (Math.random() * SIZE) | 0;
        const w = Math.random() < 0.75 ? 1 : 2;
        const j = (Math.random() * 2 - 1) * 18;
        // Blend 70% ore / 30% stone so the fleck stays stony.
        const stone = 130;
        const r = (ore[0] * 0.7 + stone * 0.3) + j;
        const g = (ore[1] * 0.7 + stone * 0.3) + j;
        const b = (ore[2] * 0.7 + stone * 0.3) + j;
        ctx.fillStyle = rgb(r, g, b);
        ctx.fillRect(x, y, w, w);
      }
      break;
    }
    case B.IRON_BLOCK: case B.GOLD_BLOCK: case B.DIAMOND_BLOCK: case B.PLATINUM_BLOCK: {
      fillNoise(ctx, base, 12);
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.strokeRect(2, 2, SIZE - 4, SIZE - 4);
      break;
    }
    case B.ARCH: {
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = "#c89656";
      ctx.fillRect(0, 0, 3, SIZE);
      ctx.fillRect(SIZE - 3, 0, 3, SIZE);
      ctx.fillRect(0, 0, SIZE, 3);
      ctx.fillRect(0, SIZE - 3, SIZE, 3);
      break;
    }
    case B.TORCH: {
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = "#8a5f28";
      ctx.fillRect(7, 6, 2, SIZE - 6);
      ctx.fillStyle = "#ffaa33";
      ctx.fillRect(6, 3, 4, 4);
      ctx.fillStyle = "#ffe070";
      ctx.fillRect(7, 4, 2, 2);
      break;
    }
    case B.TWIG: {
      // Two crossed small sticks, brown with darker knots.
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.save();
      ctx.translate(SIZE / 2, SIZE / 2);
      for (const ang of [-0.6, 0.7]) {
        ctx.save();
        ctx.rotate(ang);
        ctx.fillStyle = "#7a4f1f";
        ctx.fillRect(-10, -1, 20, 3);
        ctx.fillStyle = "#5a3a14";
        ctx.fillRect(-10, -1, 20, 1);
        // little side bumps
        ctx.fillStyle = "#6a4519";
        ctx.fillRect(-6, -3, 2, 2);
        ctx.fillRect(3, 1, 2, 2);
        ctx.restore();
      }
      ctx.restore();
      break;
    }
    case B.BEDROCK: fillNoise(ctx, base, 10); specks(ctx, "#000", 20); break;
    case B.SEAGRASS: {
      ctx.clearRect(0, 0, SIZE, SIZE);
      const rng = mulberry(7);
      // Wavy green blades
      for (let i = 0; i < 6; i++) {
        const bx = (rng() * SIZE) | 0;
        ctx.strokeStyle = i % 2 ? "#3a8a4a" : "#2a6a3a";
        ctx.lineWidth = 1 + ((rng() * 2) | 0);
        ctx.beginPath();
        let yy = SIZE;
        ctx.moveTo(bx, yy);
        for (let s = 0; s < 6; s++) {
          yy -= 2 + (rng() * 2);
          ctx.lineTo(bx + Math.sin(s + i) * 2, yy);
        }
        ctx.stroke();
      }
      break;
    }
    case B.RAW_FISH: {
      fillNoise(ctx, base, 12);
      ctx.strokeStyle = "rgba(120,150,160,0.6)";
      ctx.beginPath();
      ctx.moveTo(2, 8); ctx.bezierCurveTo(5, 4, 11, 4, 13, 8);
      ctx.bezierCurveTo(11, 12, 5, 12, 2, 8); ctx.stroke();
      ctx.fillStyle = "#3a4a5a";
      ctx.fillRect(13, 6, 2, 4); // tail
      ctx.fillStyle = "#1a2a3a";
      ctx.fillRect(4, 7, 1, 1); // eye
      break;
    }
    case B.COOKED_FISH: {
      fillNoise(ctx, base, 14);
      ctx.strokeStyle = "rgba(140,90,40,0.6)";
      ctx.beginPath();
      ctx.moveTo(2, 8); ctx.bezierCurveTo(5, 4, 11, 4, 13, 8);
      ctx.bezierCurveTo(11, 12, 5, 12, 2, 8); ctx.stroke();
      ctx.fillStyle = "#7a4a1a";
      ctx.fillRect(13, 6, 2, 4);
      ctx.fillStyle = "#2a1a08";
      ctx.fillRect(4, 7, 1, 1);
      break;
    }
    case B.CHEST: {
      // Wood-plank base
      fillNoise(ctx, base, 12);
      ctx.strokeStyle = "rgba(60,40,15,0.7)";
      ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
      ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(SIZE, 8); ctx.stroke();
      // Iron bands
      ctx.fillStyle = "#4a4a4a";
      ctx.fillRect(0, 2, SIZE, 1);
      ctx.fillRect(0, SIZE - 3, SIZE, 1);
      // Lock
      ctx.fillStyle = "#d8b340";
      ctx.fillRect(7, 7, 2, 4);
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(7, 9, 2, 1);
      break;
    }
    case B.DOOR:
    case B.DOOR_TOP: {
      // Plank vertical grain door.
      fillNoise(ctx, base, 12);
      ctx.fillStyle = "rgba(60,40,15,0.7)";
      ctx.fillRect(0, 0, 1, SIZE);
      ctx.fillRect(SIZE - 1, 0, 1, SIZE);
      // Vertical plank seams
      ctx.fillStyle = "rgba(40,25,10,0.5)";
      ctx.fillRect(5, 0, 1, SIZE);
      ctx.fillRect(10, 0, 1, SIZE);
      // Handle on bottom half only
      if (id === B.DOOR) {
        ctx.fillStyle = "#d8b340";
        ctx.fillRect(12, 8, 2, 2);
      }
      break;
    }
    case B.TRADER: {
      // Market stall front: striped awning over a wooden counter.
      fillNoise(ctx, hexToRgb("#7a4a1a"), 14);          // wood base
      // Striped awning across the top half.
      const stripeCols = ["#d84030", "#f0e8c0"];
      for (let x = 0; x < SIZE; x++) {
        ctx.fillStyle = stripeCols[(x / 2) | 0 % 2 === (x % 2 < 1) ? 0 : 1];
        ctx.fillStyle = (x >> 1) % 2 === 0 ? "#d84030" : "#f0e8c0";
        ctx.fillRect(x, 0, 1, 6);
      }
      // Counter line
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 7, SIZE, 1);
      // Gold coin emblem in the centre.
      ctx.fillStyle = "#ffd040";
      ctx.beginPath();
      ctx.arc(SIZE / 2, 11, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#b88800";
      ctx.beginPath();
      ctx.arc(SIZE / 2, 11, 1.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case B.RAW_BEEF: {
      fillNoise(ctx, base, 22);
      specks(ctx, "#f0c0c0", 10); // fat
      specks(ctx, "#7a3a3a", 6);  // dark patches
      break;
    }
    case B.COOKED_BEEF: {
      fillNoise(ctx, base, 18);
      specks(ctx, "#5a3010", 6);
      specks(ctx, "#a8703a", 4);
      break;
    }
    case B.PICKAXE_WOOD:
    case B.PICKAXE_STONE:
    case B.PICKAXE_IRON:
    case B.PICKAXE_DIAMOND:
    case B.PICKAXE_PLATINUM: {
      ctx.clearRect(0, 0, SIZE, SIZE);
      // Pickaxe head color = block color
      const head = baseColor || "#888";
      // Handle (wood)
      ctx.strokeStyle = "#6a4a2a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(3, 13);
      ctx.lineTo(13, 3);
      ctx.stroke();
      // Head
      ctx.fillStyle = head;
      ctx.beginPath();
      ctx.moveTo(2, 4);
      ctx.lineTo(7, 2);
      ctx.lineTo(9, 5);
      ctx.lineTo(7, 7);
      ctx.lineTo(4, 6);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(11, 4);
      ctx.lineTo(14, 6);
      ctx.lineTo(13, 9);
      ctx.lineTo(10, 7);
      ctx.closePath();
      ctx.fill();
      // Highlight
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillRect(3, 3, 1, 1);
      ctx.fillRect(12, 5, 1, 1);
      break;
    }
    case B.SHOVEL_WOOD:
    case B.SHOVEL_STONE:
    case B.SHOVEL_IRON:
    case B.SHOVEL_DIAMOND:
    case B.SHOVEL_PLATINUM: {
      ctx.clearRect(0, 0, SIZE, SIZE);
      const head = baseColor || "#888";
      // Handle (wood)
      ctx.strokeStyle = "#6a4a2a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(3, 13);
      ctx.lineTo(13, 3);
      ctx.stroke();
      // Shovel head — spade shape (wider than pick, single scoop).
      ctx.fillStyle = head;
      ctx.beginPath();
      ctx.moveTo(10, 4);
      ctx.lineTo(14, 5);
      ctx.lineTo(13, 11);
      ctx.lineTo(10, 12);
      ctx.lineTo(9, 7);
      ctx.closePath();
      ctx.fill();
      // Highlight on scoop.
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(11, 5, 1, 2);
      break;
    }
    case B.WATER: {
      ctx.clearRect(0, 0, SIZE, SIZE);
      // Depth gradient: lighter near surface, darker depths.
      const grad = ctx.createLinearGradient(0, 0, 0, SIZE);
      grad.addColorStop(0, "rgba(96,168,224,0.78)");
      grad.addColorStop(0.5, "rgba(48,108,184,0.82)");
      grad.addColorStop(1, "rgba(28,72,140,0.85)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, SIZE, SIZE);
      // Wavy ripple lines with varying opacity.
      const rng = mulberry(42);
      for (let i = 0; i < 8; i++) {
        const baseY = rng() * SIZE;
        const amp = 0.6 + rng() * 1.4;
        const freq = 0.4 + rng() * 0.6;
        const phase = rng() * Math.PI * 2;
        const alpha = 0.15 + rng() * 0.35;
        ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= SIZE; x++) {
          const y = baseY + Math.sin(x * freq + phase) * amp;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Tiny sparkle highlights (sun glints).
      for (let i = 0; i < 6; i++) {
        const x = (rng() * SIZE) | 0, y = (rng() * SIZE) | 0;
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillRect(x, y, 1, 1);
      }
      // Dark specks for underwater depth feel.
      ctx.fillStyle = "rgba(0,16,40,0.25)";
      for (let i = 0; i < 8; i++) {
        ctx.fillRect((rng() * SIZE) | 0, (rng() * SIZE) | 0, 1, 1);
      }
      break;
    }
    case B.ICE: {
      // Translucent pale-blue sheet with bright cracks so glaciers read as
      // ice rather than blue glass.
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = "rgba(170,210,235,0.62)";
      ctx.fillRect(0, 0, SIZE, SIZE);
      // Subtle internal shading.
      specks(ctx, "rgba(255,255,255,0.20)", 14);
      specks(ctx, "rgba(120,170,210,0.25)", 10);
      // Cracks: thin white lines drawn from random points.
      const rng = mulberry(7);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(rng() * SIZE, rng() * SIZE);
        ctx.lineTo(rng() * SIZE, rng() * SIZE);
        ctx.stroke();
      }
      break;
    }
    case B.LAVA: {
      // Bright orange-red with bright cracks + dark crust islands so it
      // reads as molten, not just a flat red square. Emits light.
      ctx.fillStyle = "#3a0a04";
      ctx.fillRect(0, 0, SIZE, SIZE);
      const grad = ctx.createRadialGradient(SIZE/2, SIZE/2, 4, SIZE/2, SIZE/2, SIZE/1.4);
      grad.addColorStop(0, "#ffc060");
      grad.addColorStop(0.4, "#ff5018");
      grad.addColorStop(1, "#a01800");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, SIZE, SIZE);
      // Dark crust islands for texture.
      const rng = mulberry(91);
      ctx.fillStyle = "rgba(40,8,0,0.55)";
      for (let i = 0; i < 6; i++) {
        const r = 2 + rng() * 4;
        ctx.beginPath();
        ctx.arc(rng() * SIZE, rng() * SIZE, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // Bright hairline cracks.
      ctx.strokeStyle = "rgba(255,220,120,0.7)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(rng() * SIZE, rng() * SIZE);
        ctx.lineTo(rng() * SIZE, rng() * SIZE);
        ctx.stroke();
      }
      break;
    }
    case B.SNOW: {
      // Near-white with faint blue speckle for a frosty feel.
      fillNoise(ctx, hexToRgb("#eef2f6"), 6);
      specks(ctx, "rgba(200,220,235,0.4)", 8);
      break;
    }
    case B.CACTUS: {
      // Green body with darker spine line down the middle + faint speckle.
      fillNoise(ctx, hexToRgb("#3a7a3a"), 14);
      ctx.fillStyle = "#2a5a2a";
      ctx.fillRect(7, 0, 2, SIZE);
      ctx.fillStyle = "rgba(180,220,160,0.4)";
      ctx.fillRect(7, 0, 1, SIZE);
      break;
    }
    case B.KELP: {
      // Tall translucent olive fronds reaching up.
      ctx.clearRect(0, 0, SIZE, SIZE);
      const rng = mulberry(11);
      for (let i = 0; i < 5; i++) {
        const bx = 2 + ((rng() * (SIZE - 4)) | 0);
        ctx.strokeStyle = i % 2 ? "#3a5a2a" : "#23451a";
        ctx.lineWidth = 2 + ((rng() * 2) | 0);
        ctx.beginPath();
        let yy = SIZE, x = bx;
        ctx.moveTo(x, yy);
        for (let s = 0; s < 10; s++) {
          yy -= 2;
          x += Math.sin(s * 0.6 + i) * 1.5;
          ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      // Small leafy nodules.
      ctx.fillStyle = "#4a7a2a";
      for (let i = 0; i < 6; i++) {
        ctx.fillRect((rng() * SIZE) | 0, (rng() * SIZE) | 0, 2, 1);
      }
      break;
    }
    case B.CORAL: {
      // Knobby pink/red coral branches with cream tips.
      ctx.clearRect(0, 0, SIZE, SIZE);
      const rng = mulberry(13);
      const palette = ["#ff7a8a", "#ff5a6a", "#e83a55"];
      for (let i = 0; i < 4; i++) {
        const sx = 2 + ((rng() * (SIZE - 4)) | 0);
        ctx.strokeStyle = palette[i % palette.length];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx, SIZE);
        let x = sx, y = SIZE;
        for (let s = 0; s < 5; s++) {
          y -= 3;
          x += (rng() - 0.5) * 4;
          ctx.lineTo(x, y);
          // Side branch.
          ctx.moveTo(x, y);
          ctx.lineTo(x + (rng() < 0.5 ? -2 : 2), y - 1);
          ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      // Bright tips.
      ctx.fillStyle = "#ffe0c0";
      for (let i = 0; i < 8; i++) {
        ctx.fillRect((rng() * SIZE) | 0, (rng() * (SIZE - 3)) | 0, 1, 1);
      }
      break;
    }
    case B.PORTAL: {
      // Swirly purple vortex with brighter flecks — moon-dimension doorway.
      ctx.clearRect(0, 0, SIZE, SIZE);
      const rng = mulberry(17);
      const grad = ctx.createRadialGradient(SIZE/2, SIZE/2, 1, SIZE/2, SIZE/2, SIZE/1.4);
      grad.addColorStop(0, "#d0a8ff");
      grad.addColorStop(0.4, "#7a4ad8");
      grad.addColorStop(1, "#2a1050");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, SIZE, SIZE);
      // Wispy swirl arcs.
      ctx.strokeStyle = "rgba(220,200,255,0.55)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        const cx = SIZE/2, cy = SIZE/2;
        const r = 2 + i * 1.5;
        const a0 = rng() * Math.PI * 2;
        ctx.arc(cx + Math.cos(a0) * 1, cy + Math.sin(a0) * 1, r, a0, a0 + Math.PI * 1.4);
        ctx.stroke();
      }
      // Sparkles.
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < 10; i++) {
        ctx.fillRect((rng() * SIZE) | 0, (rng() * SIZE) | 0, 1, 1);
      }
      break;
    }
    case B.BUCKET:
    case B.WATER_BUCKET:
    case B.LAVA_BUCKET: {
      // Iron pail with handle. Water/lava versions tint the interior.
      ctx.clearRect(0, 0, SIZE, SIZE);
      const wall = id === B.BUCKET ? "#b0b0b0"
                 : id === B.WATER_BUCKET ? "#88a8d8"
                 : "#e87850";
      ctx.fillStyle = wall;
      // Tapered body: wider at top.
      ctx.beginPath();
      ctx.moveTo(3, 4); ctx.lineTo(12, 4);
      ctx.lineTo(11, 14); ctx.lineTo(4, 14);
      ctx.closePath(); ctx.fill();
      // Rim highlight.
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillRect(3, 4, 9, 1);
      // Handle arc.
      ctx.strokeStyle = "#6a6a6a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(7.5, 4, 4, Math.PI, 0, false);
      ctx.stroke();
      // Interior contents (skip for empty bucket).
      if (id !== B.BUCKET) {
        ctx.fillStyle = id === B.WATER_BUCKET ? "#2a5acc" : "#e04020";
        ctx.fillRect(4, 6, 7, 6);
        // Shimmer on liquid surface.
        ctx.fillStyle = id === B.WATER_BUCKET ? "rgba(180,210,255,0.5)"
                                                : "rgba(255,200,80,0.6)";
        ctx.fillRect(4, 6, 7, 1);
      }
      break;
    }
    case B.MOON_ROCK: {
      // Pitted grey regolith — noise + dark craters.
      fillNoise(ctx, hexToRgb("#7a7a82"), 30);
      ctx.fillStyle = "rgba(40,40,50,0.5)";
      const rng = mulberry(19);
      for (let i = 0; i < 6; i++) {
        const cx = (rng() * SIZE) | 0, cy = (rng() * SIZE) | 0;
        const r = 1 + (rng() * 2) | 0;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case B.MOON_DUST: {
      // Soft pale grey powder.
      fillNoise(ctx, hexToRgb("#b0b0b8"), 10);
      specks(ctx, "#888892", 8);
      break;
    }
    case B.MOON_STONE: {
      // Darker sub-regolith basalt.
      fillNoise(ctx, hexToRgb("#5a5a62"), 22);
      specks(ctx, "#3a3a42", 12);
      break;
    }
    case B.PLATINUM_TROPHY: {
      // Shiny cup on a base — victory trophy.
      ctx.clearRect(0, 0, SIZE, SIZE);
      // Base plinth
      ctx.fillStyle = "#3a2a4a";
      ctx.fillRect(3, 13, 10, 2);
      // Stem
      ctx.fillStyle = "#f0f0f8";
      ctx.fillRect(7, 9, 2, 4);
      // Cup bowl
      ctx.beginPath();
      ctx.moveTo(4, 4); ctx.lineTo(12, 4); ctx.lineTo(11, 9); ctx.lineTo(5, 9);
      ctx.closePath(); ctx.fill();
      // Handles
      ctx.strokeStyle = "#f0f0f8"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(4, 6, 2, -Math.PI/2, Math.PI/2, false); ctx.stroke();
      ctx.beginPath(); ctx.arc(12, 6, 2, Math.PI/2, -Math.PI/2, false); ctx.stroke();
      // Sparkle highlight
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(5, 5, 1, 2);
      break;
    }
    case B.WIRE: {
      // Flat red wire cross — the mesher draws multiple rotated copies to
      // build dot/line/T/cross shapes depending on neighbours.
      ctx.clearRect(0, 0, SIZE, SIZE);
      const on = face === "powered";
      const wire = on ? "#ff2020" : "#a01010";
      const glow = on ? "#ffa040" : "#601010";
      // Central node
      ctx.fillStyle = wire;
      ctx.fillRect(SIZE/2 - 2, SIZE/2 - 2, 4, 4);
      // Arms extending to each edge.
      ctx.fillRect(SIZE/2 - 1, 0, 2, SIZE/2);
      ctx.fillRect(SIZE/2 - 1, SIZE/2, 2, SIZE/2);
      ctx.fillRect(0, SIZE/2 - 1, SIZE/2, 2);
      ctx.fillRect(SIZE/2, SIZE/2 - 1, SIZE/2, 2);
      // Glow highlight down the middle of each arm.
      ctx.fillStyle = glow;
      ctx.fillRect(SIZE/2, 2, 1, SIZE/2 - 2);
      ctx.fillRect(SIZE/2, SIZE/2 + 1, 1, SIZE/2 - 3);
      ctx.fillRect(2, SIZE/2, SIZE/2 - 2, 1);
      ctx.fillRect(SIZE/2 + 1, SIZE/2, SIZE/2 - 3, 1);
      break;
    }
    case B.LEVER: {
      // Wooden base plate + a stick that tilts (drawn neutral; the mesher
      // rotates based on the face it's mounted to).
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = "#6a4a2a";
      ctx.fillRect(3, 10, 10, 3);
      ctx.fillStyle = "#8a6a3a";
      ctx.fillRect(4, 11, 8, 1);
      ctx.strokeStyle = "#c0c0c0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(SIZE/2, 10); ctx.lineTo(SIZE/2 + 4, 3);
      ctx.stroke();
      ctx.fillStyle = "#c0c0c0";
      ctx.fillRect(SIZE/2 + 3, 2, 3, 3);
      break;
    }
    case B.LAMP: {
      // Lantern-style lamp — gold rim, pale centre. Two variants via face.
      const on = face === "powered";
      ctx.fillStyle = on ? "#fff0a0" : "#666670";
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = on ? "#ffe060" : "#3a3a44";
      ctx.fillRect(2, 2, SIZE - 4, SIZE - 4);
      ctx.fillStyle = on ? "#ffffd0" : "#2a2a32";
      ctx.fillRect(5, 5, SIZE - 10, SIZE - 10);
      ctx.strokeStyle = on ? "#ff9020" : "#1a1a22";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
      break;
    }
    case B.GRANITE: {
      // Pink-tinged coarse stone with dark speckles.
      fillNoise(ctx, hexToRgb("#9a5a4a"), 28);
      specks(ctx, "#3a1a10", 18);
      specks(ctx, "#d0a090", 8);
      break;
    }
    case B.MARBLE: {
      // Pale stone with sweeping dark veins.
      fillNoise(ctx, hexToRgb("#e8e4d8"), 10);
      ctx.strokeStyle = "rgba(60,60,80,0.55)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 4 + i * 8);
        for (let x = 0; x <= SIZE; x += 2) {
          ctx.lineTo(x, 4 + i * 8 + Math.sin(x * 0.6 + i) * 2);
        }
        ctx.stroke();
      }
      break;
    }
    case B.BASALT: {
      // Very dark volcanic stone with subtle grey mottling.
      fillNoise(ctx, hexToRgb("#2a2a32"), 24);
      specks(ctx, "#1a1a22", 16);
      specks(ctx, "#4a4a55", 6);
      break;
    }
    case B.CRYSTAL: {
      // Glowing cyan crystal cluster — faceted shards radiating from a base.
      ctx.clearRect(0, 0, SIZE, SIZE);
      // Base cluster shadow
      ctx.fillStyle = "rgba(20,80,90,0.6)";
      ctx.fillRect(2, 13, 12, 2);
      // Crystals: angled shards pointing up
      const shards = [
        { x: 4, w: 2, h: 8, tint: "#5affe0" },
        { x: 7, w: 3, h: 11, tint: "#9afce8" },
        { x: 11, w: 2, h: 7, tint: "#3ad6c0" },
        { x: 2, w: 2, h: 5, tint: "#7af0d8" },
        { x: 13, w: 2, h: 6, tint: "#5affe0" },
      ];
      for (const s of shards) {
        ctx.fillStyle = s.tint;
        ctx.beginPath();
        ctx.moveTo(s.x, 13);
        ctx.lineTo(s.x + s.w / 2, 13 - s.h);
        ctx.lineTo(s.x + s.w, 13);
        ctx.closePath();
        ctx.fill();
        // Bright facet line
        ctx.strokeStyle = "#d0fff0";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.x + s.w / 2, 13 - s.h);
        ctx.lineTo(s.x + s.w / 2, 13);
        ctx.stroke();
      }
      break;
    }
    case B.GLOW_MUSHROOM: {
      // Soft pale-blue mushroom with a glowing cap.
      ctx.clearRect(0, 0, SIZE, SIZE);
      // Stem
      ctx.fillStyle = "#e8e8d8";
      ctx.fillRect(7, 8, 2, 6);
      // Cap (dome)
      ctx.fillStyle = "#a0e0ff";
      ctx.beginPath();
      ctx.arc(8, 8, 5, Math.PI, 0);
      ctx.fill();
      // Glow highlights
      ctx.fillStyle = "#e0f5ff";
      ctx.fillRect(5, 6, 2, 1);
      ctx.fillRect(10, 5, 2, 1);
      // Underside gills
      ctx.fillStyle = "#8090a8";
      ctx.fillRect(4, 8, 8, 1);
      break;
    }
    case B.PISTON: {
      // Wooden piston base. Top = head face (visible when retracted and aimed
      // at you); side = planks with rivets; bottom = plain wood.
      if (face === "top") {
        // Head face — a metallic plate with four bolts.
        fillNoise(ctx, hexToRgb("#b8a070"), 10);
        ctx.fillStyle = "#888";
        ctx.fillRect(2, 2, 2, 2);
        ctx.fillRect(12, 2, 2, 2);
        ctx.fillRect(2, 12, 2, 2);
        ctx.fillRect(12, 12, 2, 2);
        ctx.fillStyle = "#5a4a2a";
        ctx.fillRect(6, 6, 4, 4);
      } else if (face === "bottom") {
        fillNoise(ctx, hexToRgb("#6a4a1a"), 14);
      } else {
        // Side: planks + iron bands top and bottom.
        fillNoise(ctx, hexToRgb("#9c7a4a"), 12);
        ctx.fillStyle = "#7a6a3a";
        ctx.fillRect(0, 0, SIZE, 2);
        ctx.fillRect(0, SIZE - 2, SIZE, 2);
        ctx.strokeStyle = "rgba(60,40,15,0.6)";
        ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(SIZE, 8); ctx.stroke();
      }
      break;
    }
    case B.STICKY_PISTON: {
      // Same body as piston, but the top face has a green slime layer.
      if (face === "top") {
        fillNoise(ctx, hexToRgb("#b8a070"), 10);
        // Slime cap covering most of the face
        ctx.fillStyle = "#4e8050";
        ctx.fillRect(2, 2, SIZE - 4, SIZE - 4);
        ctx.fillStyle = "#5ea060";
        ctx.fillRect(3, 3, SIZE - 6, SIZE - 6);
        // Slime speckle highlights
        ctx.fillStyle = "#80c080";
        ctx.fillRect(5, 5, 1, 1);
        ctx.fillRect(10, 7, 1, 1);
        ctx.fillRect(7, 10, 1, 1);
      } else if (face === "bottom") {
        fillNoise(ctx, hexToRgb("#6a4a1a"), 14);
      } else {
        fillNoise(ctx, hexToRgb("#9c7a4a"), 12);
        ctx.fillStyle = "#4e8050"; // green band — marks it as the sticky one
        ctx.fillRect(0, 0, SIZE, 2);
        ctx.fillStyle = "#7a6a3a";
        ctx.fillRect(0, SIZE - 2, SIZE, 2);
        ctx.strokeStyle = "rgba(60,40,15,0.6)";
        ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(SIZE, 8); ctx.stroke();
      }
      break;
    }
    case B.PISTON_HEAD: {
      // The extended piston head — iron shaft + plate.
      ctx.fillStyle = "#c8b070";
      ctx.fillRect(0, 0, SIZE, SIZE);
      // Central plate
      ctx.fillStyle = "#9a8050";
      ctx.fillRect(2, 2, SIZE - 4, SIZE - 4);
      // Bolts
      ctx.fillStyle = "#5a4a2a";
      ctx.fillRect(3, 3, 1, 1);
      ctx.fillRect(SIZE - 4, 3, 1, 1);
      ctx.fillRect(3, SIZE - 4, 1, 1);
      ctx.fillRect(SIZE - 4, SIZE - 4, 1, 1);
      break;
    }
    case B.ROTTEN_FLESH: {
      // Sickly pink-red meat with dark patches + a couple of maggots.
      fillNoise(ctx, hexToRgb("#7a4a4a"), 24);
      ctx.fillStyle = "#4a2020";
      for (let i = 0; i < 5; i++) {
        ctx.fillRect(Math.random() * SIZE, Math.random() * SIZE, 2 + Math.random() * 3, 2);
      }
      // Maggot specks (cream).
      ctx.fillStyle = "#e8e0c0";
      ctx.fillRect(4, 11, 1, 1);
      ctx.fillRect(11, 6, 1, 1);
      break;
    }
    case B.BONE: {
      // Off-white with a couple of grey pits + a thin shadow line.
      fillNoise(ctx, hexToRgb("#e8e0c8"), 8);
      ctx.fillStyle = "#807050";
      ctx.fillRect(3, 4, 1, 1);
      ctx.fillRect(11, 9, 1, 1);
      ctx.fillRect(7, 12, 1, 1);
      ctx.strokeStyle = "rgba(80,70,50,0.4)";
      ctx.beginPath(); ctx.moveTo(2, 8); ctx.lineTo(SIZE - 2, 8); ctx.stroke();
      break;
    }
    default: fillNoise(ctx, base, 20); break;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Get a texture for a block face.
export function getTexture(id, face = "side") {
  const key = `${id}:${face}`;
  if (cache.has(key)) return cache.get(key);
  const t = drawTexture(id, face);
  cache.set(key, t);
  return t;
}

// Crack overlay textures (10 stages, Minecraft-style).
const crackCache = [];
export function getCrackTexture(stage) {
  stage = Math.max(0, Math.min(9, stage | 0));
  if (crackCache[stage]) return crackCache[stage];
  const { c, ctx } = makeCtx();
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.lineWidth = 1;
  // More cracks as stage increases.
  const rng = mulberry(stage * 31 + 7);
  const cracks = 2 + stage * 2;
  for (let i = 0; i < cracks; i++) {
    let x = rng() * SIZE, y = rng() * SIZE;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 2 + ((rng() * 3) | 0);
    for (let s = 0; s < segs; s++) {
      x += (rng() * 2 - 1) * 5;
      y += (rng() * 2 - 1) * 5;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.transparent = true;
  crackCache[stage] = tex;
  return tex;
}
function mulberry(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Single material per block (cross-face) — simpler meshing. Each block uses
// its "side" texture; grass/wood get per-face variants via material array.
export function getMaterials(id) {
  return [
    new THREE.MeshLambertMaterial({ map: getTexture(id, "side") }), // +x
    new THREE.MeshLambertMaterial({ map: getTexture(id, "side") }), // -x
    new THREE.MeshLambertMaterial({ map: getTexture(id, "top")  }),
    new THREE.MeshLambertMaterial({ map: getTexture(id, "bottom") }),
    new THREE.MeshLambertMaterial({ map: getTexture(id, "side") }),
    new THREE.MeshLambertMaterial({ map: getTexture(id, "side") }),
  ];
}

// === Texture atlas ===
// One big canvas with all block-face tiles in a 16x16 grid; each block face
// gets a slot. Lets us merge chunk geometry into a single mesh per chunk.
const ATLAS_TILES = 16;            // 16x16 grid
const ATLAS_TILE_PX = SIZE;        // 16
const ATLAS_PX = ATLAS_TILES * ATLAS_TILE_PX; // 256
let atlasTexture = null;
const slotIndex = new Map();        // `${id}:${face}` -> tileIndex 0..255
let nextSlot = 0;

function faceName(idx) {
  if (typeof idx === "string") return idx;
  return idx === 2 ? "top" : idx === 3 ? "bottom" : "side";
}

function ensureAtlasSlot(id, faceIdx) {
  const face = faceName(faceIdx);
  const key = `${id}:${face}`;
  if (slotIndex.has(key)) return slotIndex.get(key);
  const slot = nextSlot++;
  slotIndex.set(key, slot);

  // Render the per-tile canvas into the atlas at (col, row).
  const col = slot % ATLAS_TILES, row = Math.floor(slot / ATLAS_TILES);
  const tx = col * ATLAS_TILE_PX, ty = row * ATLAS_TILE_PX;

  // Create a temp canvas to draw via existing drawTexture, then copy pixels.
  const tmp = drawTexture(id, face);
  const tmpCanvas = tmp.image;
  // Also cache as a regular texture for HUD use.
  cache.set(key, tmp);
  // Get the atlas canvas (create lazily).
  if (!atlasTexture) {
    const c = document.createElement("canvas");
    c.width = c.height = ATLAS_PX;
    atlasTexture = new THREE.CanvasTexture(c);
    atlasTexture.magFilter = THREE.NearestFilter;
    atlasTexture.minFilter = THREE.NearestMipmapNearestFilter;
    atlasTexture.colorSpace = THREE.SRGBColorSpace;
    atlasTexture.generateMipmaps = true;
  }
  const ctx = atlasTexture.image.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmpCanvas, 0, 0, ATLAS_TILE_PX, ATLAS_TILE_PX, tx, ty, ATLAS_TILE_PX, ATLAS_TILE_PX);
  atlasTexture.needsUpdate = true;
  return slot;
}

// Returns [u0, v0, u1, v1] for the tile of (id, faceIdx), allocating as needed.
export function atlasUV(id, faceIdx) {
  const slot = ensureAtlasSlot(id, faceIdx);
  const col = slot % ATLAS_TILES, row = Math.floor(slot / ATLAS_TILES);
  // Inset slightly to avoid bleeding between tiles.
  const eps = 0.001;
  const u0 = (col + eps) / ATLAS_TILES;
  const u1 = (col + 1 - eps) / ATLAS_TILES;
  // Three.js textures have origin at bottom-left, canvas at top-left → flip V.
  const v0 = (ATLAS_TILES - row - 1 + eps) / ATLAS_TILES;
  const v1 = (ATLAS_TILES - row - eps) / ATLAS_TILES;
  return [u0, v0, u1, v1];
}

export function getAtlasTexture() {
  // Force-create atlas with one call so it always exists.
  if (!atlasTexture) atlasUV(1, 0);
  return atlasTexture;
}
