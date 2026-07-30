#!/usr/bin/env python3
"""Procedural Wildcraft icon: a chunky grass-topped cube with a small sun."""
from PIL import Image, ImageDraw

S = 512
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Sky gradient
for y in range(S):
    t = y / S
    r = int(110 + (255 - 110) * (1 - t) * 0.2 + 130 * (1 - t))
    g = int(150 + (200 - 150) * (1 - t) * 0.2 + 50 * (1 - t))
    b = int(230 + (160 - 230) * t * 0.4)
    # simpler: blend sky-blue to pale
    rr = int(120 * (1 - t) + 200 * t)
    gg = int(180 * (1 - t) + 225 * t)
    bb = int(245 * (1 - t) + 230 * t)
    d.line([(0, y), (S, y)], fill=(rr, gg, bb, 255))

# Sun
sun = (S - 130, 110)
for i in range(6, 0, -1):
    d.ellipse([sun[0]-50-i*4, sun[1]-50-i*4, sun[0]+50+i*4, sun[1]+50+i*4],
              fill=(255, 230, 120, 20))
d.ellipse([sun[0]-50, sun[1]-50, sun[0]+50, sun[1]+50], fill=(255, 235, 140, 255))

# Cube geometry (isometric-ish)
def cube(cx, cy, w, h, depth):
    # front face corners
    fx0, fy0 = cx - w/2, cy - h/2
    fx1, fy1 = cx + w/2, cy + h/2
    # depth offset (up-right)
    dx, dy = depth*0.45, -depth*0.55
    front = [(fx0, fy0), (fx1, fy0), (fx1, fy1), (fx0, fy1)]
    top = [(fx0, fy0), (fx0+dx, fy0+dy), (fx1+dx, fy0+dy), (fx1, fy0)]
    right = [(fx1, fy0), (fx1+dx, fy0+dy), (fx1+dx, fy1+dy), (fx1, fy1)]
    return front, top, right

front, top, right = cube(256, 330, 230, 170, 70)

# Faces
d.polygon(right, fill=(95, 65, 40, 255))      # dirt side (shadowed)
d.polygon(front, fill=(130, 88, 55, 255))     # dirt front
d.polygon(top,   fill=(95, 175, 75, 255))     # grass top

# Grass overhang: little green strip dipping over the front-top edge
overhang = [(front[0][0], front[0][1]),
            (front[1][0], front[1][1]),
            (front[1][0], front[1][1]+14),
            (front[0][0], front[0][1]+14)]
d.polygon(overhang, fill=(75, 150, 60, 255))

# Specks on the grass top
import random
random.seed(7)
tx0 = min(p[0] for p in top); tx1 = max(p[0] for p in top)
ty0 = min(p[1] for p in top); ty1 = max(p[1] for p in top)
for _ in range(14):
    px = random.randint(int(tx0)+8, int(tx1)-8)
    py = random.randint(int(ty0)+6, int(ty1)-6)
    d.rectangle([px, py, px+5, py+3], fill=(60, 130, 50, 255))

# Dirt specks on front
fx0 = min(p[0] for p in front); fx1 = max(p[0] for p in front)
fy0 = min(p[1] for p in front); fy1 = max(p[1] for p in front)
for _ in range(10):
    px = random.randint(int(fx0)+8, int(fx1)-8)
    py = random.randint(int(fy0)+22, int(fy1)-8)
    d.rectangle([px, py, px+4, py+4], fill=(95, 60, 35, 255))

img.save('icon.png')
print('Wrote icon.png')
