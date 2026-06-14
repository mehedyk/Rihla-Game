// ─── Player ────────────────────────────────────────────────────────────────────
// Ported from: Performer.java, Scarf.java, GravityAction.java
//
// States: INIT → SLIDING → INAIR → DUCKING → CRASHED → DROPPED
// Poses:  RIDE, DUCK, JUMP, CRASH_ASS, CRASH_NOSE

const PERFORMER_WIDTH = 1.85;   // world units  (from Performer.java)
const PERFORMER_H     = 1.80;
const MIN_SPEED       = 9.3;    // m/s
const MAX_SPEED       = 29.3;
const JUMP_FORCE      = PERFORMER_WIDTH * 1.9;   // ≈ 3.515
const ROTATION_SPEED  = 180;    // deg/sec while in air
const GRAVITY         = 9.80665;
const MIN_CAM_OFFSET  = 10;
const MAX_CAM_OFFSET  = 24;
const CAM_MAX_SPEED   = 3.3;    // world units/sec camera can move

const PState = { INIT:0, SLIDING:1, INAIR:2, DUCKING:3, CRASHED:4, DROPPED:5 };
const PPose  = { RIDE:0, DUCK:1, JUMP:2, CRASH_ASS:3, CRASH_NOSE:4 };

const SCARF_SEGS     = 20;
const SCARF_SEG_LEN  = 0.14;  // world units per segment
const SCARF_COLOR_A  = [0xbc/255, 0x6d/255, 0x56/255];
const SCARF_COLOR_B  = [0xa8/255, 0x3c/255, 0x40/255];

const Player = {
  x: 5, y: 0,
  vx: 0, vy: 0,
  rotation: 0,    // degrees (for airtime backflip)
  speed: MIN_SPEED,
  state: PState.INIT,
  pose: PPose.RIDE,

  // Camera
  camera: { x: 5, y: 0 },
  camOffset: MIN_CAM_OFFSET,

  // Jump state
  _jumping: false,
  _jumpT: 0,
  _jumpFromY: 0,
  _jumpPeakY: 0,
  _fallVY: 0,

  // Scarf verlet chain — 20 segments
  _scarfPts: [],

  // Snow spray particles
  _spray: [],

  // Crash state
  _crashTimer: 0,
  _crashType: 0,  // 0 = ass, 1 = nose

  init() {
    this.x        = 5;
    this.y        = Terrain.heightAt(5) + PERFORMER_H * 0.5;
    this.vx       = 0;
    this.vy       = 0;
    this.rotation = 0;
    this.speed    = MIN_SPEED;
    this.state    = PState.INIT;
    this.pose     = PPose.RIDE;
    this._jumping = false;
    this._jumpT   = 0;
    this._fallVY  = 0;
    this._crashTimer = 0;
    this.camera.x = this.x;
    this.camera.y = this.y;
    this._initScarf();
    this._spray = [];
  },

  // ── Input ─────────────────────────────────────────────────────────────────
  onTap() {
    if (this.state === PState.INIT || this.state === PState.SLIDING) {
      this._doJump();
    } else if (this.state === PState.INAIR) {
      this._doDuck(); // duck in air = early land / speed duck (like Alto's tuck)
    } else if (this.state === PState.DUCKING) {
      // already ducking — ignore until land
    }
  },

  onHold() {
    if (this.state === PState.SLIDING) {
      this.state = PState.DUCKING;
      this.pose  = PPose.DUCK;
    }
  },

  onRelease() {
    if (this.state === PState.DUCKING) {
      this.state = PState.SLIDING;
      this.pose  = PPose.RIDE;
    }
  },

  // ── Update ────────────────────────────────────────────────────────────────
  update(dt) {
    if (this.state === PState.INIT) {
      // Sit on terrain waiting for first tap — covered by UI
      this._snapToTerrain();
      this._updateCamera(dt);
      return;
    }
    if (this.state === PState.CRASHED || this.state === PState.DROPPED) {
      this._updateCrash(dt);
      this._updateCamera(dt);
      return;
    }

    // ── Advance X by current speed ──────────────────────────────────────
    this.x += this.speed * dt;

    // ── Speed from slope ────────────────────────────────────────────────
    // Steeper downslope = faster. Upslope = slow down.
    if (this.state !== PState.INAIR) {
      const angle = Terrain.angleAt(this.x);  // degrees, positive = uphill
      // sin(angle) component: negative when going downhill → increases speed
      const slopeAccel = -Math.sin(angle * Math.PI / 180) * 18;
      const duck        = this.state === PState.DUCKING ? 3 : 0;
      this.speed += (slopeAccel + duck) * dt;
      this.speed  = Math.max(MIN_SPEED, Math.min(MAX_SPEED, this.speed));
    }

    // ── Vertical: in air vs on ground ──────────────────────────────────
    if (this.state === PState.INAIR) {
      this._updateAir(dt);
    } else {
      this._snapToTerrain();
      this._updateSpray(dt);
    }

    // ── Abyss kill ──────────────────────────────────────────────────────
    if (Terrain.inAbyss(this.x, this.y)) {
      this._doDrop();
    }

    // ── Stone collision ──────────────────────────────────────────────────
    if (this.state !== PState.CRASHED && this.state !== PState.DROPPED) {
      if (Objects.checkStoneCollision(this.x, this.y, PERFORMER_WIDTH, PERFORMER_H)) {
        this._doCrash();
      }
    }

    // ── Pose driven by state ─────────────────────────────────────────────
    if (this.state === PState.SLIDING) this.pose = PPose.RIDE;
    if (this.state === PState.INAIR)   this.pose = PPose.JUMP;
    if (this.state === PState.DUCKING) this.pose = PPose.DUCK;

    // ── Scarf ────────────────────────────────────────────────────────────
    this._updateScarf(dt);
    this._updateCamera(dt);
  },

  _snapToTerrain() {
    const groundY = Terrain.heightAt(this.x);
    this.y = groundY + PERFORMER_H * 0.25;
  },

  // ── Jump (exp5Out arc up, then gravity fall) ──────────────────────────
  _doJump() {
    if (this.state === PState.CRASHED || this.state === PState.DROPPED) return;
    this.state    = PState.INAIR;
    this.pose     = PPose.JUMP;
    this._jumping = true;
    this._jumpT   = 0;
    this._jumpFromY = this.y;
    this._jumpPeakY = this.y + JUMP_FORCE;
    this._fallVY  = 0;
    this.rotation = 0;
    Audio.play('whizz_0');
  },

  _doDuck() {
    // Tuck in air — slightly different pose, no physics change
    this.pose = PPose.DUCK;
  },

  _updateAir(dt) {
    if (this._jumping) {
      // Phase 1: exp5Out arc upward over ~0.35 seconds
      this._jumpT += dt / 0.35;
      if (this._jumpT >= 1) {
        this._jumpT   = 1;
        this._jumping = false;
        this._fallVY  = 0;
      }
      this.y = Interp.exp5Out(this._jumpFromY, this._jumpPeakY, this._jumpT);
    } else {
      // Phase 2: gravity fall
      this._fallVY -= GRAVITY * dt * 1.2;
      this.y       += this._fallVY * dt;
    }

    // Backflip rotation while in air
    this.rotation = (this.rotation + ROTATION_SPEED * dt) % 360;

    // Land check
    const groundY = Terrain.heightAt(this.x);
    if (this.y <= groundY + PERFORMER_H * 0.25 && !this._jumping) {
      this.y        = groundY + PERFORMER_H * 0.25;
      this.rotation = 0;
      this.state    = PState.SLIDING;
      this.pose     = PPose.RIDE;
      Audio.play('bell');
    }
  },

  _doCrash() {
    if (this.state === PState.CRASHED) return;
    // Crash type: if moving fast → nose-dive, else ass-slide
    this._crashType = this.speed > (MIN_SPEED + MAX_SPEED) / 2 ? 1 : 0;
    this.state    = PState.CRASHED;
    this.pose     = this._crashType === 1 ? PPose.CRASH_NOSE : PPose.CRASH_ASS;
    this._crashTimer = 0;
    this.speed    = MIN_SPEED * 0.3;
    Audio.play('whizz_1');
    Audio.startSad();
  },

  _doDrop() {
    if (this.state === PState.DROPPED || this.state === PState.CRASHED) return;
    this.state       = PState.DROPPED;
    this.pose        = PPose.CRASH_ASS;
    this._fallVY     = 0;
    this._crashTimer = 0;
    this.speed       = 0;
    Audio.startSad();
  },

  _updateCrash(dt) {
    this._crashTimer += dt;
    // Decelerate
    this.speed = Math.max(0, this.speed - 20 * dt);
    this.x    += this.speed * dt;

    if (this.state === PState.DROPPED) {
      this._fallVY -= GRAVITY * dt * 2;
      this.y       += this._fallVY * dt;
    } else {
      this._snapToTerrain();
    }

    if (this._crashTimer > 1.5) {
      Game.triggerGameOver();
    }
  },

  // ── Snow Spray Particles ─────────────────────────────────────────────
  _updateSpray(dt) {
    // Emit while sliding
    if (this.state === PState.SLIDING && Math.random() < dt * 30) {
      for (let i = 0; i < 3; i++) {
        this._spray.push({
          x: this.x - 0.4,
          y: this.y,
          vx: -(3 + Math.random() * 4),
          vy: (Math.random() - 0.3) * 3,
          life: 1, maxLife: 0.5 + Math.random() * 0.5,
          r: 1 + Math.random() * 2
        });
      }
    }
    // Update particles
    for (const p of this._spray) {
      p.x   += p.vx * dt;
      p.y   += p.vy * dt;
      p.vy  -= 2 * dt;
      p.life -= dt / p.maxLife;
    }
    this._spray = this._spray.filter(p => p.life > 0);
  },

  // ── Scarf Verlet ────────────────────────────────────────────────────
  _initScarf() {
    this._scarfPts = [];
    for (let i = 0; i < SCARF_SEGS + 1; i++) {
      this._scarfPts.push({ x: this.x, y: this.y, px: this.x, py: this.y });
    }
  },

  _updateScarf(dt) {
    const pts  = this._scarfPts;
    const head = pts[0];
    // Anchor to player neck/shoulder
    head.x = this.x - 0.1;
    head.y = this.y + PERFORMER_H * 0.3;
    head.px = head.x;
    head.py = head.y;

    const substeps = 3;
    const subDt    = dt / substeps;
    for (let s = 0; s < substeps; s++) {
      // Verlet integration
      for (let i = 1; i < pts.length; i++) {
        const p   = pts[i];
        const vx  = (p.x - p.px) * 0.85;
        const vy  = (p.y - p.py) * 0.85;
        p.px = p.x;
        p.py = p.y;
        p.x += vx - this.speed * subDt * 0.35;  // drag from movement
        p.y += vy - GRAVITY * subDt * subDt * 0.4;
      }
      // Constraints: keep segments at SCARF_SEG_LEN
      for (let i = 0; i < pts.length - 1; i++) {
        const a  = pts[i], b = pts[i+1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d  = Math.sqrt(dx*dx + dy*dy) || 0.001;
        const diff = (d - SCARF_SEG_LEN) / d * 0.5;
        if (i > 0) { a.x += dx * diff; a.y += dy * diff; }
        b.x -= dx * diff; b.y -= dy * diff;
      }
    }
  },

  // ── Camera ─────────────────────────────────────────────────────────
  _updateCamera(dt) {
    const speedPct = (this.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
    const targetOffset = MIN_CAM_OFFSET + (MAX_CAM_OFFSET - MIN_CAM_OFFSET) * speedPct;

    const targetX = this.x + targetOffset;
    const targetY = this.y;

    const dx = targetX - this.camera.x;
    const dy = targetY - this.camera.y;
    const dist = Math.sqrt(dx*dx + dy*dy);

    if (dist > 0) {
      const move = Math.min(dist, CAM_MAX_SPEED * dt * 60);
      this.camera.x += (dx / dist) * move;
      this.camera.y += (dy / dist) * move;
    }
  },

  // ── Draw ─────────────────────────────────────────────────────────────
  draw(ctx, W, H, PPU, atlasImg) {
    const cam = this.camera;
    const toSX = wx => W * 0.5 + (wx - cam.x) * PPU;
    const toSY = wy => H * 0.55 - (wy - cam.y) * PPU;

    // ── Snow spray ────────────────────────────────────────────────────
    this._drawSpray(ctx, toSX, toSY, W, H);

    // ── Scarf ─────────────────────────────────────────────────────────
    this._drawScarf(ctx, toSX, toSY);

    // ── Player sprite ─────────────────────────────────────────────────
    const poseNames = ['p1_ride','p1_duck','p1_jump','p1_crash_ass','p1_crash_nose'];
    const sprName   = poseNames[this.pose];
    const spr       = ATLAS[sprName];
    const pw        = PERFORMER_WIDTH * PPU;
    const ph        = pw;

    const sx = toSX(this.x) - pw * 0.5;
    const sy = toSY(this.y) - ph * 0.65;

    ctx.save();
    if (this.rotation !== 0 && this.state === PState.INAIR) {
      ctx.translate(toSX(this.x), toSY(this.y));
      ctx.rotate(this.rotation * Math.PI / 180);
      ctx.drawImage(atlasImg, spr.x, spr.y, spr.w, spr.h,
        -pw * 0.5, -ph * 0.5, pw, ph);
    } else {
      ctx.drawImage(atlasImg, spr.x, spr.y, spr.w, spr.h, sx, sy, pw, ph);
    }
    ctx.restore();
  },

  _drawSpray(ctx, toSX, toSY, W, H) {
    const amb = Weather.ambient;
    ctx.save();
    for (const p of this._spray) {
      const alpha = p.life * 0.7;
      ctx.fillStyle = `rgba(${r(amb[0])},${r(amb[1])},${r(amb[2])},${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(toSX(p.x), toSY(p.y), p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },

  _drawScarf(ctx, toSX, toSY) {
    const pts = this._scarfPts;
    if (pts.length < 2) return;
    ctx.save();
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    for (let i = 0; i < pts.length - 1; i++) {
      const col = i % 2 === 0 ? SCARF_COLOR_A : SCARF_COLOR_B;
      const amb = Weather.ambient;
      ctx.strokeStyle = `rgb(${r(col[0]*0.5+amb[0]*0.5)},${r(col[1]*0.5+amb[1]*0.5)},${r(col[2]*0.5+amb[2]*0.5)})`;
      ctx.beginPath();
      ctx.moveTo(toSX(pts[i].x),   toSY(pts[i].y));
      ctx.lineTo(toSX(pts[i+1].x), toSY(pts[i+1].y));
      ctx.stroke();
    }
    ctx.restore();
  },

  get isCrashed() {
    return this.state === PState.CRASHED || this.state === PState.DROPPED;
  },

  getSpeedPct() {
    return (this.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
  }
};
