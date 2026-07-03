// Lightweight 2D/3D value-gradient noise. No deps — we don't need full simplex
// to get smooth, deformable terrain. Seeded so worlds are reproducible.

function hash(x, y, z, seed) {
  let h = (x * 374761393 + y * 668265263 + z * 362437 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}
function smooth(t) { return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }

function noise2(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const tl = hash(xi, yi, 0, seed);
  const tr = hash(xi + 1, yi, 0, seed);
  const bl = hash(xi, yi + 1, 0, seed);
  const br = hash(xi + 1, yi + 1, 0, seed);
  const sx = smooth(xf), sy = smooth(yf);
  return lerp(lerp(tl, tr, sx), lerp(bl, br, sx), sy);
}
function noise3(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const c000 = hash(xi, yi, zi, seed),     c100 = hash(xi + 1, yi, zi, seed);
  const c010 = hash(xi, yi + 1, zi, seed), c110 = hash(xi + 1, yi + 1, zi, seed);
  const c001 = hash(xi, yi, zi + 1, seed), c101 = hash(xi + 1, yi, zi + 1, seed);
  const c011 = hash(xi, yi + 1, zi + 1, seed), c111 = hash(xi + 1, yi + 1, zi + 1, seed);
  const sx = smooth(xf), sy = smooth(yf), sz = smooth(zf);
  const a = lerp(lerp(c000, c100, sx), lerp(c010, c110, sx), sy);
  const b = lerp(lerp(c001, c101, sx), lerp(c011, c111, sx), sy);
  return lerp(a, b, sz);
}

export class Noise {
  constructor(seed = 1234) { this.seed = seed; }
  // Fractal 2D noise → smooth heightmap in [0,1].
  height(x, z, octaves = 4) {
    let f = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      f += noise2(x * freq, z * freq, this.seed + i * 101) * amp;
      max += amp; amp *= 0.5; freq *= 2;
    }
    return f / max;
  }
  // 3D noise for ore veins / caves, returns [0,1].
  noise3(x, y, z) { return noise3(x, y, z, this.seed); }
  hash(x, y, z) { return hash(x, y, z, this.seed); }
}
