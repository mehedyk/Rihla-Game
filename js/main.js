// ─── Main ──────────────────────────────────────────────────────────────────────
// Game loop, state machine, input, audio, asset loading
// States: LOADING → TITLE → PLAYING → GAMEOVER

const GameState = { LOADING:0, TITLE:1, PLAYING:2, GAMEOVER:3 };

const Game = {
  state:  GameState.LOADING,
  canvas: null,
  ctx:    null,
  W: 0, H: 0,
  PPU: 0,                    // pixels-per-world-unit

  atlasImg: null,

  camera: { x: 5, y: 0 },   // synced from Player.camera each frame

  score: { distance: 0, coins: 0 },

  _lastTime: 0,
  _holdTimer: 0,
  _isHolding: false,
  _crashFadeTimer: 0,

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  async start() {
    this.canvas = document.getElementById('game');
    this.ctx    = this.canvas.getContext('2d');

    this._resize();
    window.addEventListener('resize', () => this._resize());

    // Input
    this.canvas.addEventListener('pointerdown', e => this._onDown(e));
    this.canvas.addEventListener('pointerup',   e => this._onUp(e));
    this.canvas.addEventListener('pointermove', e => this._onMove(e));
    window.addEventListener('keydown', e => {
      if (e.code === 'Space' || e.code === 'ArrowUp') this._onDown(e);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'ArrowDown') this._onDuck();
    });
    window.addEventListener('keyup', e => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'ArrowDown') this._onDuckRelease();
    });

    await this._loadAssets();

    // Init all systems
    Weather.init();
    Sky.init();
    Terrain.init();
    Objects.init();
    Player.init();
    UI.init();
    UI.resize(this.W, this.H);

    document.getElementById('loading').style.display = 'none';

    this.state    = GameState.TITLE;
    this._lastTime = performance.now();
    requestAnimationFrame(t => this._loop(t));
  },

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width  = this.W * dpr;
    this.canvas.height = this.H * dpr;
    this.canvas.style.width  = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Scale: viewport = 25 world units tall
    this.PPU = this.H / 25;
    if (UI) UI.resize(this.W, this.H);
  },

  async _loadAssets() {
    // Atlas image
    this.atlasImg = await this._loadImage('assets/scene.png');

    // Audio (non-blocking — just attempt)
    await Audio.init();
  },

  _loadImage(src) {
    return new Promise((res, rej) => {
      const img  = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src    = src;
    });
  },

  // ── Game Loop ──────────────────────────────────────────────────────────────
  _loop(timestamp) {
    const dt = Math.min((timestamp - this._lastTime) / 1000, 0.05);
    this._lastTime = timestamp;

    this._update(dt);
    this._render();

    requestAnimationFrame(t => this._loop(t));
  },

  _update(dt) {
    Weather.update(dt);
    Sky.update(dt);
    UI.update(dt);

    if (this.state === GameState.TITLE) {
      // Keep weather ticking on title
      return;
    }
    if (this.state === GameState.PLAYING || this.state === GameState.GAMEOVER) {
      Terrain.update(Player.x);
      Player.update(dt);

      // Sync camera
      this.camera.x = Player.camera.x;
      this.camera.y = Player.camera.y;

      Objects.update(dt, Player.x, Player.y, PERFORMER_WIDTH);

      // Distance score
      this.score.distance = Math.max(0, Math.round(Player.x - 5));

      // Hold duck timer
      if (this._isHolding) {
        this._holdTimer += dt;
        if (this._holdTimer > 0.18) Player.onHold();
      }
    }
  },

  _render() {
    const { ctx, W, H, PPU, atlasImg } = this;

    ctx.clearRect(0, 0, W, H);

    if (this.state === GameState.TITLE) {
      UI.drawTitle(ctx, W, H, atlasImg);
      return;
    }

    // ── Sky ──────────────────────────────────────────────────────────────────
    Sky.draw(ctx, W, H, atlasImg);

    // ── Precipitation (behind terrain) ───────────────────────────────────────
    Weather.drawPrecip(ctx, W, H);

    // ── Terrain ──────────────────────────────────────────────────────────────
    Terrain.draw(ctx, W, H, this.camera, PPU, atlasImg);

    // ── Objects (trees, houses behind; cliffs) ────────────────────────────────
    // Trees and houses pass cam for parallax
    const camObj = { x: this.camera.x, y: this.camera.y };
    Objects.draw(ctx, W, H, camObj, PPU, atlasImg);

    // ── Player ────────────────────────────────────────────────────────────────
    Player.draw(ctx, W, H, PPU, atlasImg);

    // ── HUD ────────────────────────────────────────────────────────────────────
    UI.drawHUD(ctx, W, H, this.score.distance, this.score.coins);

    // ── Game-over overlay ──────────────────────────────────────────────────────
    if (this.state === GameState.GAMEOVER || UI._gameOverAlpha > 0) {
      UI.drawGameOver(ctx, W, H, this.score.distance, this.score.coins, atlasImg);
    }
  },

  // ── Game flow ──────────────────────────────────────────────────────────────
  _startGame() {
    this.score      = { distance: 0, coins: 0 };
    Terrain.init();
    Objects.init();
    Player.init();
    UI.reset();
    this.state = GameState.PLAYING;
    Audio.startBg();
  },

  triggerGameOver() {
    if (this.state !== GameState.PLAYING) return;
    this.state = GameState.GAMEOVER;
    UI.triggerGameOver(this.score.distance, this.score.coins);
    Audio.stopBg();
  },

  // ── Input ──────────────────────────────────────────────────────────────────
  _onDown(e) {
    const { clientX, clientY } = e;
    e.preventDefault?.();

    if (this.state === GameState.TITLE) {
      this._startGame();
      return;
    }
    if (this.state === GameState.GAMEOVER) {
      if (UI.hitTestRestart(clientX, clientY)) {
        Audio.stopSad();
        this._startGame();
      }
      return;
    }
    if (this.state === GameState.PLAYING) {
      this._holdTimer  = 0;
      this._isHolding  = true;
      Player.onTap();
    }
  },

  _onUp(e) {
    e.preventDefault?.();
    this._isHolding = false;
    this._holdTimer = 0;
    Player.onRelease();
  },

  _onMove(e) {
    // No action needed for move – hold is handled by timer
  },

  _onDuck() {
    if (this.state === GameState.PLAYING) Player.onHold();
  },
  _onDuckRelease() {
    if (this.state === GameState.PLAYING) Player.onRelease();
  },
};

// ─── Audio ────────────────────────────────────────────────────────────────────
const Audio = {
  _ctx: null,
  _bg: null,
  _bgSrc: null,
  _sad: null,
  _sadSrc: null,
  _sfx: {},
  _bgGain: null,
  _sadGain: null,

  async init() {
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._bgGain  = this._ctx.createGain();  this._bgGain.connect(this._ctx.destination);
      this._sadGain = this._ctx.createGain(); this._sadGain.connect(this._ctx.destination);
      this._bgGain.gain.value  = 0;
      this._sadGain.gain.value = 0;

      const [bgBuf, sadBuf, bell, coindrop, whizz0, whizz1] = await Promise.all([
        this._load('assets/bg.mp3'),
        this._load('assets/sad.mp3'),
        this._load('assets/sounds/bell.mp3'),
        this._load('assets/sounds/coindrop.mp3'),
        this._load('assets/sounds/whizz_0.mp3'),
        this._load('assets/sounds/whizz_1.mp3'),
      ]);

      this._sfx = { bell, coindrop, whizz_0: whizz0, whizz_1: whizz1 };
      this._bgBuf  = bgBuf;
      this._sadBuf = sadBuf;
    } catch(e) {
      console.warn('Audio init failed:', e);
    }
  },

  async _load(url) {
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    return this._ctx.decodeAudioData(arr);
  },

  _resume() {
    if (this._ctx && this._ctx.state === 'suspended') this._ctx.resume();
  },

  startBg() {
    this._resume();
    if (!this._bgBuf) return;
    if (this._bg) { try { this._bg.stop(); } catch(e){} }
    this._bg         = this._ctx.createBufferSource();
    this._bg.buffer  = this._bgBuf;
    this._bg.loop    = true;
    this._bg.connect(this._bgGain);
    this._bg.start();
    this._bgGain.gain.setTargetAtTime(0.65, this._ctx.currentTime, 0.5);
    this._sadGain.gain.setTargetAtTime(0,   this._ctx.currentTime, 0.5);
  },

  stopBg() {
    this._bgGain?.gain.setTargetAtTime(0, this._ctx?.currentTime ?? 0, 0.8);
  },

  startSad() {
    this._resume();
    if (!this._sadBuf) return;
    if (this._sad) { try { this._sad.stop(); } catch(e){} }
    this._sad        = this._ctx.createBufferSource();
    this._sad.buffer = this._sadBuf;
    this._sad.loop   = false;
    this._sad.connect(this._sadGain);
    this._sad.start();
    this._sadGain.gain.setTargetAtTime(0.7, this._ctx.currentTime, 0.3);
  },

  stopSad() {
    this._sadGain?.gain.setTargetAtTime(0, this._ctx?.currentTime ?? 0, 0.4);
  },

  play(name) {
    this._resume();
    const buf = this._sfx[name];
    if (!buf || !this._ctx) return;
    const src   = this._ctx.createBufferSource();
    src.buffer  = buf;
    const gain  = this._ctx.createGain();
    gain.gain.value = name === 'coindrop' ? 0.5 : 0.7;
    src.connect(gain);
    gain.connect(this._ctx.destination);
    src.start();
  }
};

// ─── Boot ─────────────────────────────────────────────────────────────────────
window.addEventListener('load', () => Game.start());
