// ─── Weather & Day/Night cycle ────────────────────────────────────────────────
// Ported from: WeatherProvider.java, EnvColors.java
// All color values are exact copies from the Java source.

const ENV = {
  DAY: {
    ambient: [222/255, 216/255, 201/255],
    fog:     [128/255, 175/255, 163/255],
    skyTop:  [10/255,  87/255,  94/255 ],
    skyBot:  [126/255, 174/255, 162/255],
    sun:     [255/255, 255/255, 211/255],
    next: 'DUSK'
  },
  DUSK: {
    ambient: [73/255,  48/255,  35/255 ],
    fog:     [170/255, 116/255, 77/255 ],
    skyTop:  [46/255,  61/255,  83/255 ],
    skyBot:  [168/255, 115/255, 77/255 ],
    sun:     [255/255, 115/255, 77/255 ],
    next: 'NIGHT'
  },
  NIGHT: {
    ambient: [25/255,  33/255,  41/255 ],
    fog:     [43/255,  56/255,  69/255 ],
    skyTop:  [10/255,  15/255,  19/255 ],
    skyBot:  [78/255,  105/255, 122/255],
    sun:     [78/255,  105/255, 122/255],
    next: 'DAWN'
  },
  DAWN: {
    ambient: [56/255,  33/255,  30/255 ],
    fog:     [150/255, 106/255, 98/255 ],
    skyTop:  [36/255,  45/255,  76/255 ],
    skyBot:  [148/255, 105/255, 97/255 ],
    sun:     [255/255, 105/255, 97/255 ],
    next: 'DAY'
  }
};

// Day cycle constants (from WeatherProvider.java)
const SECONDS_PER_DAY  = 7 * 60 + 20;   // 440 seconds
const DAY_HOURS        = 24;
const DAYTIME_HOURS    = 16;
const NIGHT_HOURS      = 8;
const DUSK_HOURS       = 1.84;
const DAWN_HOURS       = 0.92;
const SECONDS_PER_HOUR = SECONDS_PER_DAY / DAY_HOURS;
const DAYTIME_SECONDS  = DAYTIME_HOURS * SECONDS_PER_HOUR;
const NIGHT_SECONDS    = NIGHT_HOURS   * SECONDS_PER_HOUR;
const DUSK_SECONDS     = DUSK_HOURS    * SECONDS_PER_HOUR;
const DAWN_SECONDS     = DAWN_HOURS    * SECONDS_PER_HOUR;

// Precipitation constants
const PRECIP = { CLEAR: 0, RAIN: 1, SNOW: 2, FOG: 3 };
const MIN_PRECIP_SECS = 15;
const MAX_PRECIP_SECS = 35;

const Weather = {
  // Current second-of-day (SOD). Start at 10:30am like the original.
  sod: SECONDS_PER_HOUR * 10.5,
  phase: 'DAY',       // current ENV phase name
  phaseT: 0,          // 0→1 progress within current phase (for blending)
  nextPhase: 'DUSK',

  // Live blended colors (lerped between current and next phase)
  ambient: [...ENV.DAY.ambient],
  fog:     [...ENV.DAY.fog],
  skyTop:  [...ENV.DAY.skyTop],
  skyBot:  [...ENV.DAY.skyBot],
  sun:     [...ENV.DAY.sun],

  // Precipitation
  precip: PRECIP.CLEAR,
  precipTimer: 0,
  precipTarget: randomBetween(MIN_PRECIP_SECS, MAX_PRECIP_SECS),
  precipIntensity: 0,    // 0→1 fade in/out
  precipFadingIn: false,

  // Rain / snow particles
  particles: [],

  init() {
    this._initPrecipParticles();
    this._recomputeColors();
  },

  update(dt) {
    this.sod += dt;
    if (this.sod >= SECONDS_PER_DAY) this.sod -= SECONDS_PER_DAY;

    this._updatePhase();
    this._recomputeColors();
    this._updatePrecip(dt);
    this._updateParticles(dt);
  },

  _updatePhase() {
    // Map SOD → phase + blend progress
    // Phase boundaries (in hours):
    //   0..DAWN_HOURS       = DAWN
    //   DAWN_HOURS..DAYTIME = DAY
    //   DAYTIME..(DAYTIME+DUSK_HOURS) = DUSK
    //   rest                = NIGHT
    const h = (this.sod / SECONDS_PER_HOUR);

    // Transition durations in seconds (blending time between phases)
    const BLEND = 20; // seconds to blend between phases

    const dawnEnd  = DAWN_HOURS  * SECONDS_PER_HOUR;
    const dayEnd   = DAYTIME_HOURS * SECONDS_PER_HOUR;
    const duskEnd  = dayEnd + DUSK_HOURS * SECONDS_PER_HOUR;

    let phase, t;

    if (this.sod < dawnEnd) {
      phase = 'DAWN'; t = this.sod / dawnEnd;
    } else if (this.sod < dayEnd) {
      phase = 'DAY';  t = (this.sod - dawnEnd) / (dayEnd - dawnEnd);
    } else if (this.sod < duskEnd) {
      phase = 'DUSK'; t = (this.sod - dayEnd) / (duskEnd - dayEnd);
    } else {
      phase = 'NIGHT'; t = (this.sod - duskEnd) / (SECONDS_PER_DAY - duskEnd);
    }

    this.phase = phase;
    this.phaseT = t;
  },

  _recomputeColors() {
    const cur  = ENV[this.phase];
    const next = ENV[cur.next];
    // Blend with next phase during the last 15% of each phase
    const blendStart = 0.85;
    const bt = this.phaseT < blendStart ? 0 : (this.phaseT - blendStart) / (1 - blendStart);

    for (const key of ['ambient','fog','skyTop','skyBot','sun']) {
      for (let i = 0; i < 3; i++) {
        this[key][i] = lerpVal(cur[key][i], next[key][i], bt);
      }
    }
  },

  _updatePrecip(dt) {
    this.precipTimer += dt;
    if (this.precipTimer >= this.precipTarget) {
      this.precipTimer = 0;
      this.precipTarget = randomBetween(MIN_PRECIP_SECS, MAX_PRECIP_SECS);
      // Pick next weather (CLEAR weighted double)
      const choices = [PRECIP.CLEAR, PRECIP.CLEAR, PRECIP.RAIN, PRECIP.SNOW, PRECIP.FOG];
      const next = choices[Math.floor(Math.random() * choices.length)];
      if (next !== this.precip) {
        this.precip = next;
        this._resetParticles();
      }
    }

    // Fade intensity
    const target = this.precip === PRECIP.CLEAR ? 0 : 1;
    this.precipIntensity += (target - this.precipIntensity) * dt * 0.5;
    this.precipIntensity = Math.max(0, Math.min(1, this.precipIntensity));
  },

  _initPrecipParticles() {
    this.particles = [];
    for (let i = 0; i < 80; i++) {
      this.particles.push(this._newParticle(true));
    }
  },

  _resetParticles() {
    for (const p of this.particles) {
      p.x = Math.random();
      p.y = Math.random();
    }
  },

  _newParticle(scatter = false) {
    return {
      x: Math.random(),
      y: scatter ? Math.random() : -0.02,
      vx: (Math.random() - 0.5) * 0.01,
      vy: 0.04 + Math.random() * 0.06,
      r: Math.random() * 2.5 + 0.5,
      alpha: 0.3 + Math.random() * 0.5,
      wobble: Math.random() * Math.PI * 2,
    };
  },

  _updateParticles(dt) {
    for (const p of this.particles) {
      p.wobble += dt * 1.2;
      const speed = this.precip === PRECIP.RAIN ? 5.0 : 1.2;
      const windX = this.precip === PRECIP.RAIN ? 0.008 : 0.002;
      p.x += (p.vx + Math.sin(p.wobble) * 0.002 + windX) * speed * dt * 60;
      p.y += p.vy * speed * dt * 60 / 100;
      if (p.y > 1.05) {
        p.x = Math.random();
        p.y = -0.02;
      }
      if (p.x > 1.05) p.x -= 1.05;
      if (p.x < -0.05) p.x += 1.05;
    }
  },

  // Draw precipitation on canvas (called after sky, before terrain)
  drawPrecip(ctx, W, H) {
    if (this.precipIntensity < 0.01) return;
    const alpha = this.precipIntensity * 0.7;

    if (this.precip === PRECIP.FOG) {
      const fog = this.fog;
      ctx.fillStyle = `rgba(${r(fog[0])},${r(fog[1])},${r(fog[2])},${(alpha*0.6).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
      return;
    }

    ctx.save();
    for (const p of this.particles) {
      const px = p.x * W;
      const py = p.y * H;

      if (this.precip === PRECIP.RAIN) {
        ctx.strokeStyle = `rgba(180,210,220,${(p.alpha * alpha).toFixed(3)})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + 3, py + p.r * 8);
        ctx.stroke();
      } else if (this.precip === PRECIP.SNOW) {
        ctx.fillStyle = `rgba(255,255,255,${(p.alpha * alpha).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(px, py, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
};

// ─── helpers ──────────────────────────────────────────────────────────────────
function lerpVal(a, b, t) { return a + (b - a) * t; }
function randomBetween(a, b) { return a + Math.random() * (b - a); }
function r(v) { return Math.round(v * 255); }
function rgbStr(arr) { return `rgb(${r(arr[0])},${r(arr[1])},${r(arr[2])})`; }
function rgbaStr(arr, a) { return `rgba(${r(arr[0])},${r(arr[1])},${r(arr[2])},${a.toFixed(3)})`; }
