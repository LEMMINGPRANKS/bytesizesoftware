// Portal frame detection. A portal is a hollow rectangle of PLATINUM_BLOCK
// with interior 2 wide × 3 tall (so the full frame is 4 wide × 5 tall). When
// the interior is filled with LAVA (or contains a LAVA block just placed),
// the interior cells are converted to PORTAL blocks.
//
// Both orientations (X-axis and Z-axis) are checked from the placed-lava
// cell. Returns true if a portal was lit.
import { B } from "./blocks.js";

const INTERIOR_W = 2;
const INTERIOR_H = 3;

// Walk the four possible directions the interior can extend from a seed cell,
// then verify the full frame. `world` is the World instance.
export function tryLightPortal(world, sx, sy, sz) {
  if (world.getBlock(sx, sy, sz) !== B.LAVA) return false;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    // The seed lava cell may sit at either of the 2 interior columns and any
    // of the 3 interior rows. Try every offset along the axis + downward so
    // we find the true bottom-interior corner.
    for (let back = 0; back < INTERIOR_W; back++) {
      for (let drop = 0; drop < INTERIOR_H; drop++) {
        const x0 = sx - dx * back;
        const z0 = sz - dz * back;
        const y0 = sy - drop;
        if (_checkFrame(world, x0, y0, z0, dx, dz)) {
          _fillPortal(world, x0, y0, z0, dx, dz);
          return true;
        }
      }
    }
  }
  return false;
}

function _checkFrame(world, x0, y0, z0, dx, dz) {
  // (x0, y0, z0) is the bottom-left INTERIOR corner. Interior spans
  // INTERIOR_W along (dx, dz), INTERIOR_H up. Frame = platinum on the
  // perimeter OUTSIDE the interior.
  // 1. Interior cells: must all be AIR, LAVA, or PORTAL (no stragglers).
  for (let iy = 0; iy < INTERIOR_H; iy++) {
    for (let iw = 0; iw < INTERIOR_W; iw++) {
      const ix = x0 + dx * iw;
      const iz = z0 + dz * iw;
      const cell = world.getBlock(ix, y0 + iy, iz);
      if (cell !== B.AIR && cell !== B.LAVA && cell !== B.PORTAL) return false;
    }
  }
  // 2. Bottom rail: platinum under every interior column.
  for (let iw = 0; iw < INTERIOR_W; iw++) {
    if (world.getBlock(x0 + dx * iw, y0 - 1, z0 + dz * iw) !== B.PLATINUM_BLOCK) return false;
  }
  // 3. Top rail: platinum above every interior column.
  for (let iw = 0; iw < INTERIOR_W; iw++) {
    if (world.getBlock(x0 + dx * iw, y0 + INTERIOR_H, z0 + dz * iw) !== B.PLATINUM_BLOCK) return false;
  }
  // 4. Left rail: platinum at the -axis side for each interior row.
  for (let iy = 0; iy < INTERIOR_H; iy++) {
    if (world.getBlock(x0 - dx, y0 + iy, z0 - dz) !== B.PLATINUM_BLOCK) return false;
  }
  // 5. Right rail: platinum at the +axis side for each interior row.
  for (let iy = 0; iy < INTERIOR_H; iy++) {
    if (world.getBlock(x0 + dx * INTERIOR_W, y0 + iy, z0 + dz * INTERIOR_W) !== B.PLATINUM_BLOCK) return false;
  }
  return true;
}

function _fillPortal(world, x0, y0, z0, dx, dz) {
  for (let iy = 0; iy < INTERIOR_H; iy++) {
    for (let iw = 0; iw < INTERIOR_W; iw++) {
      world.setBlock(x0 + dx * iw, y0 + iy, z0 + dz * iw, B.PORTAL);
    }
  }
}

// If a PORTAL block's frame is no longer complete (a platinum block was
// broken), extinguish the portal — convert interior PORTAL back to AIR.
export function tryExtinguishPortal(world, x, y, z) {
  if (world.getBlock(x, y, z) !== B.PORTAL) return false;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let back = 0; back < INTERIOR_W; back++) {
      for (let drop = 0; drop < INTERIOR_H; drop++) {
        const x0 = x - dx * back;
        const z0 = z - dz * back;
        const y0 = y - drop;
        // Verify the interior is currently all-PORTAL — that's the only
        // state we'd want to douse. If it is, AND any frame cell is missing,
        // clear the interior.
        let allPortal = true;
        for (let iy = 0; iy < INTERIOR_H && allPortal; iy++) {
          for (let iw = 0; iw < INTERIOR_W && allPortal; iw++) {
            if (world.getBlock(x0 + dx * iw, y0 + iy, z0 + dz * iw) !== B.PORTAL) {
              allPortal = false;
            }
          }
        }
        if (!allPortal) continue;
        const ok = _checkFrame(world, x0, y0, z0, dx, dz);
        if (!ok) {
          for (let iy = 0; iy < INTERIOR_H; iy++) {
            for (let iw = 0; iw < INTERIOR_W; iw++) {
              world.setBlock(x0 + dx * iw, y0 + iy, z0 + dz * iw, B.AIR);
            }
          }
          return true;
        }
      }
    }
  }
  return false;
}
