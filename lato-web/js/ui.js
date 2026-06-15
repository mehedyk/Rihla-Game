// ─── UI ────────────────────────────────────────────────────────────────────────
// Title screen, distance HUD, game-over dialog with radial blur
// Matches original title atlas sprite, "sad" music fade, restart button

const UI = {
  _gameOverAlpha: 0,
  _gameOverActive: false,
  _blurCanvas: null,
  _blurCtx: null,
  _bestDistance: 0,

  init() {
    this._gameOverAlpha  = 0;
    this._gameOverActive = false;
    this._bestDistance   = parseInt(localStorage.getItem('lato_best') || '0');
    // Off-screen canvas for blur/vignette on game-over
    this._blurCanvas = document.createElement('canvas');
    this._blurCtx    = this._blurCanvas.getContext('2d');
  },

  resize(W, H) {
    if (!this._blurCanvas) return;   // not yet init'd — _resize() fires before init()
    this._blurCanvas.width  = W;
    this._blurCanvas.height = H;
  },

  update(dt) {
    if (this._gameOverActive) {
      this._gameOverAlpha = Math.min(1, this._gameOverAlpha + dt * 1.2);
    } else {
      this._gameOverAlpha = Math.max(0, this._gameOverAlpha - dt * 2);
    }
  },

  triggerGameOver(distance, coins) {
    this._gameOverActive = true;
    if (distance > this._bestDistance) {
      this._bestDistance = distance;
      localStorage.setItem('lato_best', distance.toString());
    }
  },

  reset() {
    this._gameOverActive = false;
    this._gameOverAlpha  = 0;
  },

  // ── Draw title screen ────────────────────────────────────────────────────
  drawTitle(ctx, W, H, atlasImg) {
    // Full-screen gradient matching DAY sky
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, rgbStr(ENV.DAY.skyTop));
    grd.addColorStop(1, rgbStr(ENV.DAY.skyBot));
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    // Terrain silhouette
    const amb = ENV.DAY.ambient;
    ctx.fillStyle = `rgb(${r(Math.min(1,amb[0]*1.3))},${r(Math.min(1,amb[1]*1.3))},${r(Math.min(1,amb[2]*1.3))})`;
    ctx.beginPath();
    ctx.moveTo(0, H);
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * W;
      const t = i / steps;
      // Simple sine hill for title bg
      const y = H * 0.72 - Math.sin(t * Math.PI) * H * 0.12
                         - Math.sin(t * Math.PI * 2.5) * H * 0.04;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    // Title sprite from atlas — centered, with padding
    const spr = ATLAS.titlescreen;
    const maxW = Math.min(W * 0.72, 520);
    const sw   = maxW;
    const sh   = sw * (spr.h / spr.w);
    const sx   = (W - sw) / 2;
    const sy   = H * 0.19;
    ctx.drawImage(atlasImg, spr.x, spr.y, spr.w, spr.h, sx, sy, sw, sh);

    // Tap to play prompt
    const alpha = 0.5 + 0.5 * Math.sin(Date.now() / 400);
    ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
    ctx.font      = `${Math.round(W * 0.038)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('TAP TO PLAY', W / 2, H * 0.78);

    // Best distance
    if (this._bestDistance > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font      = `${Math.round(W * 0.024)}px sans-serif`;
      ctx.fillText(`BEST  ${this._bestDistance}m`, W / 2, H * 0.84);
    }
  },

  // ── Draw HUD (during gameplay) ────────────────────────────────────────────
  drawHUD(ctx, W, H, distance, coins) {
    const pad = W * 0.04;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';

    // Distance
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font      = `bold ${Math.round(W * 0.042)}px sans-serif`;
    ctx.fillText(`${Math.round(distance)}m`, pad, pad);

    // Coin count
    ctx.font      = `${Math.round(W * 0.030)}px sans-serif`;
    ctx.fillStyle = 'rgba(255,220,60,0.9)';
    ctx.fillText(`● ${coins}`, pad, pad + W * 0.052);

    ctx.textBaseline = 'alphabetic';
  },

  // ── Draw game over overlay ────────────────────────────────────────────────
  drawGameOver(ctx, W, H, distance, coins, atlasImg) {
    if (this._gameOverAlpha < 0.01) return;

    const a = this._gameOverAlpha;

    // Radial vignette blur overlay
    const grd = ctx.createRadialGradient(W/2, H/2, H*0.1, W/2, H/2, H*0.75);
    grd.addColorStop(0,   `rgba(0,0,0,0)`);
    grd.addColorStop(1,   `rgba(0,0,0,${(a * 0.72).toFixed(3)})`);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    if (a < 0.4) return;  // wait for vignette to build before showing card

    const cardW  = Math.min(W * 0.82, 400);
    const cardH  = cardW * 1.08;
    const cardX  = (W - cardW) / 2;
    const cardY  = (H - cardH) / 2;
    const radius = 16;
    const cardA  = Math.min(1, (a - 0.4) / 0.6);

    // Card background
    ctx.save();
    ctx.globalAlpha = cardA;
    this._roundRect(ctx, cardX, cardY, cardW, cardH, radius);
    const amb  = Weather.ambient;
    ctx.fillStyle = `rgba(${r(amb[0]*0.15)},${r(amb[1]*0.18)},${r(amb[2]*0.22)},0.95)`;
    ctx.fill();

    // Card border
    ctx.strokeStyle = `rgba(255,255,255,0.12)`;
    ctx.lineWidth   = 1.5;
    this._roundRect(ctx, cardX, cardY, cardW, cardH, radius);
    ctx.stroke();

    const cxc  = W / 2;
    ctx.textAlign = 'center';

    // "Game Over" heading
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font      = `bold ${Math.round(cardW * 0.12)}px sans-serif`;
    ctx.fillText('GAME OVER', cxc, cardY + cardH * 0.18);

    // Distance
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font      = `${Math.round(cardW * 0.072)}px sans-serif`;
    ctx.fillText('DISTANCE', cxc, cardY + cardH * 0.34);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font      = `bold ${Math.round(cardW * 0.16)}px sans-serif`;
    ctx.fillText(`${Math.round(distance)}m`, cxc, cardY + cardH * 0.46);

    // Best
    if (distance >= this._bestDistance) {
      ctx.fillStyle = 'rgba(255,210,40,0.9)';
      ctx.font      = `bold ${Math.round(cardW * 0.07)}px sans-serif`;
      ctx.fillText('NEW BEST!', cxc, cardY + cardH * 0.55);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font      = `${Math.round(cardW * 0.06)}px sans-serif`;
      ctx.fillText(`BEST  ${this._bestDistance}m`, cxc, cardY + cardH * 0.55);
    }

    // Coins
    ctx.fillStyle = 'rgba(255,200,40,0.85)';
    ctx.font      = `${Math.round(cardW * 0.065)}px sans-serif`;
    ctx.fillText(`● ${coins} COINS`, cxc, cardY + cardH * 0.65);

    // Restart button
    const btnW = cardW * 0.68, btnH = cardH * 0.115;
    const btnX = cxc - btnW / 2, btnY = cardY + cardH * 0.76;
    const btnRadius = btnH / 2;
    this._roundRect(ctx, btnX, btnY, btnW, btnH, btnRadius);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fill();

    ctx.fillStyle = `rgb(${r(amb[0]*0.15)},${r(amb[1]*0.18)},${r(amb[2]*0.22)})`;
    ctx.font      = `bold ${Math.round(cardW * 0.085)}px sans-serif`;
    ctx.fillText('PLAY AGAIN', cxc, btnY + btnH * 0.68);

    // Store btn bounds for click detection
    this._btnBounds = { x: btnX, y: btnY, w: btnW, h: btnH };

    ctx.restore();
  },

  hitTestRestart(px, py) {
    if (!this._gameOverActive || this._gameOverAlpha < 0.8) return false;
    if (!this._btnBounds) return false;
    const b = this._btnBounds;
    return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
  },

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y,     x + w, y + r,     r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x,     y + h, x, y + h - r,     r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x,     y,     x + r, y,          r);
    ctx.closePath();
  }
};
