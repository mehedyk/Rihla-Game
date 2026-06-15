// ─── Sky System ────────────────────────────────────────────────────────────────
// Draws: sky gradient, background mountains, 50 stars, sun/moon on orbital rotor,
// glow and flare effects.
// Matches SkyPlane.java + WaveDrawer.java mountain logic from lato source.

const Sky = {
  stars: [],
  starTime: 0,

  // Sun/moon rotor — orbits center of sky over the day cycle
  // In the original, sun starts at 10:30am position
  // Full orbit = SECONDS_PER_DAY seconds
  rotorAngle: 0,      // radians, 0 = right, π/2 = top (noon), π = left (midnight)

  init() {
    // 50 procedural stars (deterministic by seed index)
    this.stars = [];
    const rng = mulberry32(0xDEADBEEF);
    for (let i = 0; i < 50; i++) {
      this.stars.push({
        nx: rng(),          // normalized screen x
        ny: rng() * 0.55,  // upper 55% of sky
        r:  0.6 + rng() * 1.2,
        phase: rng() * Math.PI * 2,  // flicker offset
        freq:  0.8 + rng() * 1.5,    // flicker speed
      });
    }
    // Initial rotor angle from SOD (10:30am = 10.5/24 of day = ~pi radians past midnight)
    this._updateRotor();
  },

  update(dt) {
    this.starTime += dt;
    this._updateRotor();
  },

  _updateRotor() {
    // Map second-of-day to orbital angle
    // noon (12h) → top of screen (angle = π/2 from right = 90°)
    // midnight (0h) → bottom (angle = -π/2)
    const t = Weather.sod / SECONDS_PER_DAY;  // 0→1 over full day
    // 0.5 = noon, map to π/2 (top)
    this.rotorAngle = ((t - 0.5) * Math.PI * 2) - Math.PI / 2;
  },

  draw(ctx, W, H, atlasImg) {
    // ── Sky gradient ────────────────────────────────────────────────────────
    const grd = ctx.createLinearGradient(0, 0, 0, H * 0.75);
    grd.addColorStop(0,   rgbStr(Weather.skyTop));
    grd.addColorStop(1,   rgbStr(Weather.skyBot));
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    // ── Stars (visible at dusk/night/dawn) ─────────────────────────────────
    const nightness = this._nightness();
    if (nightness > 0.01) {
      for (const s of this.stars) {
        // Flicker: cos(time * freq + phase) mapped to 0.4–1.0
        const flicker = 0.4 + 0.6 * (0.5 + 0.5 * Math.cos(this.starTime * s.freq + s.phase));
        const alpha   = nightness * flicker;
        ctx.fillStyle = `rgba(255,255,240,${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(s.nx * W, s.ny * H, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── Sun / Moon orbit ───────────────────────────────────────────────────
    const orbitR = H * 0.42;               // orbital radius
    const cx = W * 0.5;
    const cy = H * 0.72;                   // orbit center (below visible horizon)

    // Sun position
    const sunX = cx + Math.cos(this.rotorAngle) * orbitR;
    const sunY = cy - Math.sin(this.rotorAngle) * orbitR;

    // Moon is opposite to sun (π offset)
    const moonX = cx + Math.cos(this.rotorAngle + Math.PI) * orbitR;
    const moonY = cy - Math.sin(this.rotorAngle + Math.PI) * orbitR;

    const bodySize = Math.min(W, H) * 0.09;

    // Draw whichever is above horizon
    if (sunY < H * 0.68) {
      this._drawCelestial(ctx, atlasImg, 'sun_shape', sunX, sunY, bodySize, Weather.sun, nightness < 0.5);
    }
    if (moonY < H * 0.68 && nightness > 0.2) {
      this._drawCelestial(ctx, atlasImg, 'moon_shape', moonX, moonY, bodySize * 0.8, [0.9,0.92,0.98], false);
    }

    // ── Background mountains ────────────────────────────────────────────────
    this._drawMountains(ctx, W, H, atlasImg);
  },

  _drawCelestial(ctx, img, spriteName, x, y, size, colorArr, showGlow) {
    const s = ATLAS[spriteName];
    const hs = size / 2;

    // Glow behind sun/moon
    if (showGlow) {
      const gs = ATLAS.glow;
      const glowSize = size * 3.2;
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.drawImage(img, gs.x, gs.y, gs.w, gs.h,
        x - glowSize/2, y - glowSize/2, glowSize, glowSize);
      ctx.restore();
    }

    // Tint the body sprite with the sun/moon color
    ctx.save();
    // Composite trick: draw color rect, then multiply with sprite
    ctx.globalAlpha = 1.0;
    // Draw sprite with color tinting via globalCompositeOperation
    ctx.drawImage(img, s.x, s.y, s.w, s.h, x - hs, y - hs, size, size);

    // Apply color tint (multiply)
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = rgbStr(colorArr);
    ctx.fillRect(x - hs, y - hs, size, size);
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // Flare (lens flare when sun visible)
    if (showGlow) {
      const fs = ATLAS.flare;
      const flareSize = size * 1.5;
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.drawImage(img, fs.x, fs.y, fs.w, fs.h,
        x - flareSize/2, y - flareSize/2, flareSize, flareSize);
      ctx.restore();
    }
  },

  _drawMountains(ctx, W, H, atlasImg) {
    // Three mountain silhouette layers at different parallax depths
    // Colors derived from fog/skyBot (darker/lighter variations)
    const fog = Weather.fog;
    const bot = Weather.skyBot;

    const layers = [
      { alpha: 0.25, scale: 1.0,  yOff: 0.62, tileW: 160, tileH: 90,  sprite: 'mount' },
      { alpha: 0.20, scale: 0.85, yOff: 0.66, tileW: 120, tileH: 70,  sprite: 'mountainfog' },
      { alpha: 0.15, scale: 0.7,  yOff: 0.70, tileW: 100, tileH: 50,  sprite: 'mountainfog' },
    ];

    // Parallax offset based on camera x
    const camX = typeof Game !== 'undefined' ? Game.camera.x : 0;

    for (const L of layers) {
      const sy = H * L.yOff;
      const sh = H * 0.25 * L.scale;
      const sw = L.tileW * (H / 500);
      const spr = ATLAS[L.sprite];

      // Blend mountain color toward fog/ambient
      ctx.save();
      ctx.globalAlpha = L.alpha;

      const parallax = (camX * 0.015 * L.scale) % sw;
      const startX = -sw + (-parallax % sw);
      for (let x = startX; x < W + sw; x += sw) {
        ctx.drawImage(atlasImg, spr.x, spr.y, spr.w, spr.h, x, sy, sw, sh);
      }

      // Tint mountains with fog color
      ctx.globalCompositeOperation = 'multiply';
      const c = fog;
      ctx.fillStyle = rgbStr([c[0]*0.8, c[1]*0.8, c[2]*0.8]);
      ctx.fillRect(0, sy, W, sh + 10);
      ctx.globalCompositeOperation = 'source-over';

      ctx.restore();
    }
  },

  // Returns 0 (full day) → 1 (full night) for star/moon visibility
  _nightness() {
    const p = Weather.phase;
    const t = Weather.phaseT;
    if (p === 'NIGHT')  return 1;
    if (p === 'DAY')    return 0;
    if (p === 'DUSK')   return t;
    if (p === 'DAWN')   return 1 - t;
    return 0;
  }
};

// Simple deterministic PRNG (Mulberry32)
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
