// ─── Game Objects ──────────────────────────────────────────────────────────────
// Stones, Coins, Spruce Trees, Farmhouses, Canyon Cliffs
// Ported from: Stone.java, Coin.java, Spruce.java, actors3/ package

const Objects = {
  visibleItems: [],  // items currently visible / active
  coinSpin: 0,       // global coin spin angle (degrees)
  coinsPicked: [],   // set of "sectionIdx-itemIdx" already collected

  init() {
    this.visibleItems = [];
    this.coinSpin     = 0;
    this.coinsPicked  = new Set();
  },

  update(dt, playerX, playerY, playerW) {
    this.coinSpin = (this.coinSpin + dt * 180) % 360; // 180 deg/sec spin

    // Collect visible items from active sections
    this.visibleItems = [];
    for (let si = 0; si < Terrain.sections.length; si++) {
      const sec = Terrain.sections[si];
      for (let ii = 0; ii < sec.items.length; ii++) {
        const item = sec.items[ii];
        if (!item || item.type === 'abyss') continue;
        const key = `${si}-${ii}`;
        if (item.type === 'coin' && this.coinsPicked.has(key)) continue;
        item._key = key;
        this.visibleItems.push(item);
      }
    }

    // Coin collection collision
    const cr = playerW * 0.5;
    for (const item of this.visibleItems) {
      if (item.type !== 'coin') continue;
      const dx = playerX - item.x;
      const dy = playerY - item.y;
      if (Math.sqrt(dx*dx + dy*dy) < cr + 0.6) {
        this.coinsPicked.add(item._key);
        Audio.play('coindrop');
        Game.score.coins++;
      }
    }
  },

  // Check stone collision with player bounding box
  checkStoneCollision(playerX, playerY, playerW, playerH) {
    for (const item of this.visibleItems) {
      if (item.type !== 'stone') continue;
      const sw = playerW * 0.85;
      const sh = sw * 0.55;
      // Stone occupies [item.x - sw/2, item.x + sw/2] x [item.y, item.y + sh]
      const ox = item.x, oy = item.y;
      const px = playerX, py = playerY;
      // Simple AABB (player center vs stone rect)
      if (Math.abs(px - ox) < (sw * 0.5 + playerW * 0.28) &&
          py < oy + sh + 0.1 &&
          py + playerH * 0.4 > oy) {
        return true;
      }
    }
    return false;
  },

  draw(ctx, W, H, cam, PPU, atlasImg) {
    const toSX = wx => W * 0.5 + (wx - cam.x) * PPU;
    const toSY = wy => H * 0.55 - (wy - cam.y) * PPU;
    const screenW = W / PPU;

    for (const item of this.visibleItems) {
      const sx = toSX(item.x);
      const sy = toSY(item.y);
      // Cull off-screen
      if (sx < -W * 0.1 || sx > W * 1.1) continue;

      switch (item.type) {
        case 'stone':  this._drawStone(ctx, item, sx, sy, PPU, atlasImg); break;
        case 'coin':   this._drawCoin(ctx, item, sx, sy, PPU);            break;
        case 'tree':   this._drawTree(ctx, item, sx, sy, PPU, W, H, cam); break;
        case 'house':  this._drawHouse(ctx, item, sx, sy, PPU, W, H, cam); break;
        case 'cliff':  this._drawCliff(ctx, item, sx, sy, PPU, atlasImg); break;
      }
    }
  },

  _drawStone(ctx, item, sx, sy, PPU, atlasImg) {
    const idx = item.index ?? 0;
    const spr = ATLAS.stones[idx % 12];
    const worldW = 1.1;  // stones are ~1 world unit wide
    const pw = worldW * PPU;
    const ph = pw * (spr.h / spr.w);
    ctx.drawImage(atlasImg, spr.x, spr.y, spr.w, spr.h,
      sx - pw * 0.5, sy - ph, pw, ph);
  },

  _drawCoin(ctx, item, sx, sy, PPU) {
    // Original: 3D spinning coin. We simulate with horizontal squish.
    const r    = 0.35 * PPU;
    const squish = Math.abs(Math.cos(this.coinSpin * Math.PI / 180));
    const amb  = Weather.ambient;
    // Gold color tinted by ambient
    const cr = Math.min(255, Math.round((0.9 + amb[0]*0.1) * 255));
    const cg = Math.min(255, Math.round((0.75 + amb[1]*0.1) * 230));
    const cb = Math.min(255, Math.round(amb[2] * 80));

    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(squish, 1);
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r, 0, 0, Math.PI * 2);
    ctx.fillStyle   = `rgb(${cr},${cg},${cb})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(80,50,0,0.4)`;
    ctx.lineWidth   = 0.8;
    ctx.stroke();
    ctx.restore();
  },

  _drawTree(ctx, item, sx, sy, PPU, W, H, cam) {
    // Spruce tree: thin dark diamond silhouette
    // Original: 1x1px colored with rgb(48,105,105), scaled & rotated to make a spike
    // Color shifts with ambient
    const amb   = Weather.ambient;
    const layer = item.layer ?? 'back';
    const parallaxFactor = layer === 'back' ? 0.12 : 0.22;
    const worldParallaxX = (item.x - cam.x) * parallaxFactor;

    // Apply parallax to screen X
    const parallaxSX = W * 0.5 + (item.x - cam.x - worldParallaxX) * PPU;
    const parallaxSY = sy;

    const scale  = layer === 'back' ? 0.7 : 1.0;
    const treeH  = 3.5 * PPU * scale;
    const treeW  = 0.55 * PPU * scale;

    // Tree color: deep teal, tinted by ambient
    const tr = Math.round((48/255  * 0.4 + amb[0] * 0.6) * 255);
    const tg = Math.round((105/255 * 0.4 + amb[1] * 0.6) * 255);
    const tb = Math.round((105/255 * 0.4 + amb[2] * 0.6) * 255);
    const alpha = layer === 'back' ? 0.55 : 0.75;
    ctx.fillStyle = `rgba(${tr},${tg},${tb},${alpha})`;

    // Draw 3 overlapping triangles (spruce tiers)
    const tiers = [
      { yOff: 0,       wMul: 1.0,  hMul: 0.55 },
      { yOff: -0.3,    wMul: 0.75, hMul: 0.50 },
      { yOff: -0.55,   wMul: 0.5,  hMul: 0.45 },
    ];
    for (const tier of tiers) {
      const bw = treeW  * tier.wMul;
      const bh = treeH  * tier.hMul;
      const ty = parallaxSY + tier.yOff * treeH;
      ctx.beginPath();
      ctx.moveTo(parallaxSX,      ty - bh);
      ctx.lineTo(parallaxSX - bw, ty);
      ctx.lineTo(parallaxSX + bw, ty);
      ctx.closePath();
      ctx.fill();
    }
    // Trunk
    ctx.fillStyle = `rgba(40,25,15,${alpha * 0.8})`;
    ctx.fillRect(parallaxSX - treeW * 0.08, parallaxSY - treeH * 0.12,
                 treeW * 0.16, treeH * 0.13);
  },

  _drawHouse(ctx, item, sx, sy, PPU, W, H, cam) {
    // Farmhouse: simple parallax silhouette
    const parallaxFactor = 0.08;
    const parallaxSX = W * 0.5 + (item.x - cam.x) * (1 - parallaxFactor) * PPU;
    const parallaxSY = sy - 0.5 * PPU;

    const amb   = Weather.ambient;
    const tr    = Math.round(amb[0] * 60);
    const tg    = Math.round(amb[1] * 62);
    const tb    = Math.round(amb[2] * 65);
    ctx.fillStyle = `rgba(${tr},${tg},${tb},0.4)`;

    const hw = 2.2 * PPU, hh = 1.4 * PPU;
    // Body
    ctx.fillRect(parallaxSX - hw/2, parallaxSY - hh, hw, hh);
    // Roof
    ctx.beginPath();
    ctx.moveTo(parallaxSX - hw * 0.65, parallaxSY - hh);
    ctx.lineTo(parallaxSX,             parallaxSY - hh - hh * 0.7);
    ctx.lineTo(parallaxSX + hw * 0.65, parallaxSY - hh);
    ctx.closePath();
    ctx.fill();
  },

  _drawCliff(ctx, item, sx, sy, PPU, atlasImg) {
    const sprKey = item.side === 'left' ? 'cliff_left' : 'cliff_right';
    const spr    = ATLAS[sprKey];
    const worldH = 30;   // canyon is 30 units deep
    const ph     = worldH * PPU;
    const pw     = ph * (spr.w / spr.h);
    const drawX  = item.side === 'left' ? sx - pw : sx;
    ctx.drawImage(atlasImg, spr.x, spr.y, spr.w, spr.h,
      drawX, sy - ph * 0.1, pw, ph);
  },

  resetCoins() {
    this.coinsPicked = new Set();
  }
};
