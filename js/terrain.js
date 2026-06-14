// ─── Terrain Engine ────────────────────────────────────────────────────────────
// Ported from: TerrainSegList.java, Section.java, TerrainManager.java,
//              HomeHill.java, Downer.java, SteepDowner.java, Hill.java, Canyon.java

// ─── LibGDX Interpolation ports ───────────────────────────────────────────────
const Interp = {
  smooth(a, b, t) {
    const s = t * t * (3 - 2 * t); // smoothstep
    return a + (b - a) * s;
  },
  pow2(a, b, t) {
    // LibGDX Pow(2) in-out
    let s;
    if (t <= 0.5) s = Math.pow(t * 2, 2) / 2;
    else          s = 1 - Math.pow((1 - t) * 2, 2) / 2;
    return a + (b - a) * s;
  },
  exp(a, b, t, value, power) {
    const min   = Math.pow(value, -power);
    const scale = 1 / (1 - min);
    let s;
    if (t <= 0.5) s = (Math.pow(value, power * (t * 2 - 1)) - min) * scale / 2;
    else          s = (2 - (Math.pow(value, -power * (t * 2 - 1)) - min) * scale) / 2;
    return a + (b - a) * s;
  },
  exp5Out(a, b, t) {
    // LibGDX ExpOut(2, 5) – used for jump upswing
    const value = 2, power = 5;
    const min   = Math.pow(value, -power);
    const scale = 1 / (1 - min);
    const s = 1 - (Math.pow(value, -power * t) - min) * scale;
    return a + (b - a) * Math.max(0, Math.min(1, s));
  }
};

// ─── TerrainSeg ───────────────────────────────────────────────────────────────
// fromX, fromY, toX, toY, interpolator function, isAbyss
class TerrainSeg {
  constructor(fx, fy, tx, ty, interp, isAbyss = false) {
    this.fx = fx; this.fy = fy;
    this.tx = tx; this.ty = ty;
    this.interp = interp;
    this.isAbyss = isAbyss;
  }

  heightAt(x) {
    const t = (x - this.fx) / (this.tx - this.fx);
    return this.interp(this.fy, this.ty, Math.max(0, Math.min(1, t)));
  }

  // Returns angle of terrain tangent at x (degrees, 0=right, positive=up-right)
  angleAt(x) {
    const dx = 0.01;
    const y0 = this.heightAt(x - dx);
    const y1 = this.heightAt(x + dx);
    return Math.atan2(y1 - y0, dx * 2) * 180 / Math.PI;
  }
}

// ─── Section ──────────────────────────────────────────────────────────────────
class Section {
  constructor() {
    this.segs  = [];   // [TerrainSeg]
    this.items = [];   // [Stone | Coin | Tree | Cliff | AbyssZone]
    this.worldOffsetX = 0;
    this.worldOffsetY = 0;
  }

  get firstX() { return this.segs[0].fx; }
  get lastX()  { return this.segs[this.segs.length - 1].tx; }
  get firstY() { return this.segs[0].fy; }
  get lastY()  { return this.segs[this.segs.length - 1].ty; }

  heightAt(x) {
    for (const seg of this.segs) {
      if (x >= seg.fx && x <= seg.tx) return seg.heightAt(x);
    }
    if (x < this.firstX) return this.segs[0].fy;
    return this.segs[this.segs.length - 1].ty;
  }

  angleAt(x) {
    for (const seg of this.segs) {
      if (x >= seg.fx && x <= seg.tx) return seg.angleAt(x);
    }
    return 0;
  }
}

// ─── Section factories ────────────────────────────────────────────────────────
function rand(a, b) { return a + Math.random() * (b - a); }
function randBool(p) { return Math.random() < p; }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }

function makeHomeHill(ox, oy) {
  // From HomeHill.java: smooth from (0,0)→(10,3)→(25,3)→(40,0)
  const s = new Section();
  s.segs.push(new TerrainSeg(ox,    oy,    ox+10, oy+3, Interp.smooth));
  s.segs.push(new TerrainSeg(ox+10, oy+3,  ox+25, oy+3, Interp.smooth));
  s.segs.push(new TerrainSeg(ox+25, oy+3,  ox+40, oy,   Interp.smooth));

  // Stone at (12.8, 2.8) from HomeHill.java
  s.items.push({ type: 'stone', index: 2, x: ox+12.8, y: oy+2.8 });
  // Trees
  s.items.push({ type: 'tree', x: ox+12, y: oy+1, layer: 'back' });
  s.items.push({ type: 'tree', x: ox+20, y: oy+3, layer: 'front' });
  // Farmhouses
  s.items.push({ type: 'house', x: ox+10, y: oy+3.1, angle: -170, z: -4 });
  s.items.push({ type: 'house', x: ox+25, y: oy+3.1, angle: -70,  z: -20 });
  return s;
}

function makeDowner(ox, oy) {
  // From Downer.java: Exp(2,5), angle 10-20°, length 120-140
  const len   = rand(120, 140);
  const angle = rand(10, 20);
  const dx    = Math.ceil(Math.cos(-angle * Math.PI/180) * len);
  const dy    = Math.sin(-angle * Math.PI/180) * len;

  const s = new Section();
  s.segs.push(new TerrainSeg(ox, oy, ox+dx, oy+dy, (a,b,t) => Interp.exp(a,b,t,2,5)));
  _addDownerItems(s, ox, oy);
  _scatterCoins(s, ox, oy, dx, dy);
  _scatterStones(s, ox, oy, dx, dy);
  return s;
}

function makeSteepDowner(ox, oy) {
  // From SteepDowner.java: Exp(2, 5-10), angle 38-40°, length 120-190
  const len   = rand(120, 190);
  const angle = rand(38, 40);
  const power = randInt(5, 10);
  const dx    = Math.ceil(Math.cos(-angle * Math.PI/180) * len);
  const dy    = Math.sin(-angle * Math.PI/180) * len;

  const s = new Section();
  s.segs.push(new TerrainSeg(ox, oy, ox+dx, oy+dy, (a,b,t) => Interp.exp(a,b,t,2,power)));
  _addDownerItems(s, ox, oy);
  _scatterCoins(s, ox, oy, dx, dy);
  _scatterStones(s, ox, oy, dx, dy);
  return s;
}

function makeHill(ox, oy) {
  // From Hill.java: pow2 up then pow2 down, angle 5-15°, length 5-15 units
  const len   = rand(5, 15);
  const angle = rand(5, 15);
  const midX  = Math.ceil(Math.cos(-angle * Math.PI/180) * len);
  const midY  = Math.sin(-angle * Math.PI/180) * len;

  const s = new Section();
  s.segs.push(new TerrainSeg(ox,       oy,       ox+midX,    oy+midY, Interp.pow2));
  s.segs.push(new TerrainSeg(ox+midX,  oy+midY,  ox+midX*2,  oy,      Interp.pow2));
  _addDownerItems(s, ox, oy);
  return s;
}

function makeCanyon(ox, oy) {
  // From Canyon.java: smooth up bump, then abyss at y-30, then climb out
  const abyssY = oy - 30;
  const s = new Section();
  s.segs.push(new TerrainSeg(ox,    oy,       ox+10, oy+3,   Interp.smooth));
  s.segs.push(new TerrainSeg(ox+10, oy+3,     ox+25, abyssY, Interp.smooth, true));
  s.segs.push(new TerrainSeg(ox+25, abyssY,   ox+40, oy-7,   Interp.smooth));

  // Abyss kill zone
  s.items.push({ type: 'abyss', x: ox+9, y: abyssY-5, w: 17, h: 50 });
  // Cliff sprites
  s.items.push({ type: 'cliff', side: 'left',  x: ox+3.9,  y: oy-27.7 });
  s.items.push({ type: 'cliff', side: 'right', x: ox+21.5, y: oy-35.5 });
  // Coins above canyon (40% chance)
  if (randBool(0.4)) {
    const cx = ox + 17.5;
    let coinX = cx, coinY = oy + 7;
    const offsets = [[0,-1,cx-0.5],[2,-1,cx-1],[5,-1,cx-1.5],[9,-1,cx-2]];
    let ci = 0;
    for (let i = 0; i < 15; i++) {
      s.items.push({ type: 'coin', x: coinX, y: coinY });
      coinX += 1;
      const off = offsets.find(o => o[0] === i);
      if (off) { coinY += off[1]; coinX = off[2]; }
    }
  }
  return s;
}

// Add background trees and farmhouse (common to Downer, SteepDowner, Hill)
function _addDownerItems(s, ox, oy) {
  s.items.push({ type: 'tree', x: ox+1,  y: oy-2, layer: 'back'  });
  s.items.push({ type: 'tree', x: ox-5,  y: oy,   layer: 'front' });
  s.items.push({ type: 'house', x: ox-1, y: oy,   angle: 0, z: -30 });
}

function _scatterCoins(s, ox, oy, dx, dy) {
  // Place 5-12 coins along the slope, 1-2 units above terrain
  const count = randInt(5, 12);
  for (let i = 0; i < count; i++) {
    const t  = (i + 1) / (count + 1);
    const cx = ox + dx * t;
    const cy = oy + dy * t + 1.5;
    s.items.push({ type: 'coin', x: cx, y: cy });
  }
}

function _scatterStones(s, ox, oy, dx, dy) {
  // 0 or 1 stone per section
  if (!randBool(0.45)) return;
  const t  = rand(0.2, 0.8);
  const cx = ox + dx * t;
  const cy = oy + dy * t;
  // heightAt the section
  const seg = s.segs[0];
  const gy  = seg.heightAt(cx);
  s.items.push({ type: 'stone', index: randInt(0, 11), x: cx, y: gy });
}

// ─── Terrain Manager ──────────────────────────────────────────────────────────
const Terrain = {
  sections: [],   // [Section] – all currently active sections
  segsFlat: [],   // merged flat list of TerrainSegs sorted by x (for fast lookup)

  init() {
    this.sections = [];
    this.segsFlat = [];
    this._addSection(0, 0); // HomeHill at origin
    // Pre-generate a few more sections ahead
    for (let i = 0; i < 4; i++) this._extend();
  },

  // Extend terrain if player is within 200 units of the end
  update(playerX) {
    const lastSec = this.sections[this.sections.length - 1];
    if (playerX > lastSec.lastX - 200) {
      this._extend();
    }
    // Cull sections far behind player
    while (this.sections.length > 2 && this.sections[0].lastX < playerX - 100) {
      this.sections.shift();
    }
    // Rebuild flat seg list
    this._rebuildFlat();
  },

  _extend() {
    const last = this.sections[this.sections.length - 1];
    const ox   = last.lastX;
    const oy   = last.lastY;
    this._addSection(ox, oy);
  },

  _addSection(ox, oy) {
    let sec;
    if (this.sections.length === 0) {
      sec = makeHomeHill(ox, oy);
    } else {
      // Section weights from TerrainManager.java:
      // Canyon 20%, SteepDowner 10%, Hill 10%, Downer default
      const r = Math.random();
      if      (r < 0.20) sec = makeCanyon(ox, oy);
      else if (r < 0.30) sec = makeSteepDowner(ox, oy);
      else if (r < 0.40) sec = makeHill(ox, oy);
      else               sec = makeDowner(ox, oy);
    }
    this.sections.push(sec);
  },

  _rebuildFlat() {
    this.segsFlat = [];
    for (const sec of this.sections) {
      for (const seg of sec.segs) {
        this.segsFlat.push(seg);
      }
    }
  },

  heightAt(x) {
    for (const seg of this.segsFlat) {
      if (x >= seg.fx && x <= seg.tx) return seg.heightAt(x);
    }
    // Fallback: nearest endpoint
    if (this.segsFlat.length === 0) return 0;
    if (x < this.segsFlat[0].fx) return this.segsFlat[0].fy;
    const last = this.segsFlat[this.segsFlat.length - 1];
    return last.ty;
  },

  angleAt(x) {
    for (const seg of this.segsFlat) {
      if (x >= seg.fx && x <= seg.tx) return seg.angleAt(x);
    }
    return 0;
  },

  // Returns true if x,y is inside an abyss zone
  inAbyss(x, y) {
    for (const sec of this.sections) {
      for (const item of sec.items) {
        if (item.type === 'abyss') {
          if (x >= item.x && x <= item.x + item.w && y <= item.y + item.h) return true;
        }
      }
    }
    return false;
  },

  // ── Rendering ────────────────────────────────────────────────────────────
  draw(ctx, W, H, cam, PPU, atlasImg) {
    // Visible world x range
    const leftX  = cam.x - W / PPU * 0.6;
    const rightX = cam.x + W / PPU * 0.6;

    // Sample terrain at ~2px intervals across screen
    const step  = 2 / PPU;
    const pts   = [];
    for (let wx = leftX; wx <= rightX + step; wx += step) {
      pts.push({ wx, wy: this.heightAt(wx) });
    }

    if (pts.length < 2) return;

    const toSX = wx => W * 0.5 + (wx - cam.x) * PPU;
    const toSY = wy => H * 0.55 - (wy - cam.y) * PPU;

    // ── Fill terrain polygon ──────────────────────────────────────────────
    const amb = Weather.ambient;
    // Terrain is slightly lighter than ambient (snow reflects more light)
    const terrainR = Math.min(1, amb[0] * 1.25);
    const terrainG = Math.min(1, amb[1] * 1.28);
    const terrainB = Math.min(1, amb[2] * 1.30);
    ctx.fillStyle = `rgb(${r(terrainR)},${r(terrainG)},${r(terrainB)})`;

    ctx.beginPath();
    ctx.moveTo(toSX(pts[0].wx), H + 10); // start bottom-left
    for (const p of pts) ctx.lineTo(toSX(p.wx), toSY(p.wy));
    ctx.lineTo(toSX(pts[pts.length-1].wx), H + 10); // end bottom-right
    ctx.closePath();
    ctx.fill();

    // ── Terrain top edge line (slightly darker) ───────────────────────────
    ctx.strokeStyle = `rgb(${r(amb[0]*0.85)},${r(amb[1]*0.85)},${r(amb[2]*0.85)})`;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(toSX(pts[0].wx), toSY(pts[0].wy));
    for (const p of pts) ctx.lineTo(toSX(p.wx), toSY(p.wy));
    ctx.stroke();

    // ── Abyss darkness ───────────────────────────────────────────────────
    for (const sec of this.sections) {
      for (const seg of sec.segs) {
        if (!seg.isAbyss) continue;
        // Draw dark fill inside the abyss area
        const ax0 = toSX(seg.fx);
        const ax1 = toSX(seg.tx);
        const ayTop = Math.min(toSY(seg.fy), toSY(seg.ty));
        const grd = ctx.createLinearGradient(0, ayTop, 0, ayTop + H * 0.25);
        grd.addColorStop(0,   'rgba(5,8,12,0.9)');
        grd.addColorStop(1,   'rgba(2,4,8,1.0)');
        ctx.fillStyle = grd;
        ctx.fillRect(ax0, ayTop, ax1 - ax0, H * 0.3);
      }
    }

    // ── Fog gradient at bottom of screen (distance haze) ─────────────────
    const fog = Weather.fog;
    const fogGrd = ctx.createLinearGradient(0, H * 0.65, 0, H);
    fogGrd.addColorStop(0, `rgba(${r(fog[0])},${r(fog[1])},${r(fog[2])},0)`);
    fogGrd.addColorStop(1, `rgba(${r(fog[0])},${r(fog[1])},${r(fog[2])},0.35)`);
    ctx.fillStyle = fogGrd;
    ctx.fillRect(0, H * 0.65, W, H * 0.35);
  }
};
