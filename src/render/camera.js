/**
 * Orbit camera.
 *
 * Deliberately conventional. The interaction designer's point stands: a camera
 * that behaves like every other 3D viewer costs the user nothing to learn, and
 * novelty here buys nothing. What is NOT conventional is that this camera always
 * knows its distance in kpc, so the scale bar can be honest at any zoom.
 */

import { perspective, lookAt, multiply, add, scale } from './mat4.js';

export class OrbitCamera {
  constructor({ distance = 60, theta = 0.6, phi = 1.1, target = [0, 0, 0], fov = 45 } = {}) {
    this.distance = distance;
    this.theta = theta;       // azimuth
    this.phi = phi;           // polar, clamped away from the poles
    this.target = target.slice();
    this.fov = (fov * Math.PI) / 180;
    this.near = 0.05;
    this.far = 5000;
    this.damping = 0.15;
    this._want = { distance, theta, phi, target: target.slice() };
  }

  get eye() {
    const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
    return add(this.target, [
      this.distance * sp * Math.sin(this.theta),
      this.distance * cp,
      this.distance * sp * Math.cos(this.theta),
    ]);
  }

  orbit(dx, dy) {
    this._want.theta -= dx * 0.005;
    this._want.phi = Math.min(Math.PI - 0.02, Math.max(0.02, this._want.phi - dy * 0.005));
  }

  zoom(delta) {
    this._want.distance = Math.min(4000, Math.max(0.5, this._want.distance * Math.exp(delta * 0.0015)));
  }

  pan(dx, dy, viewportH) {
    // pan in the camera plane, scaled so a drag moves the same screen distance
    // regardless of zoom
    const s = (2 * this.distance * Math.tan(this.fov / 2)) / viewportH;
    const sp = Math.sin(this.theta), cp = Math.cos(this.theta);
    const right = [cp, 0, -sp];
    const upish = [0, 1, 0];
    this._want.target = add(this._want.target, add(scale(right, -dx * s), scale(upish, dy * s)));
  }

  setTarget(t) { this._want.target = t.slice(); }

  /** Exponential smoothing towards the wanted state. Called once per frame. */
  update() {
    const k = this.damping;
    this.distance += (this._want.distance - this.distance) * k;
    this.theta += (this._want.theta - this.theta) * k;
    this.phi += (this._want.phi - this.phi) * k;
    for (let i = 0; i < 3; i++) this.target[i] += (this._want.target[i] - this.target[i]) * k;
  }

  viewProjection(aspect) {
    return multiply(perspective(this.fov, aspect, this.near, this.far), lookAt(this.eye, this.target, [0, 1, 0]));
  }

  /**
   * World units per pixel at the target plane. This is what makes an honest
   * scale bar possible, and it is why the bar is drawn from the camera rather
   * than hard-coded per scene.
   */
  worldPerPixel(viewportH) {
    return (2 * this.distance * Math.tan(this.fov / 2)) / viewportH;
  }

  /** Attach mouse, wheel and touch handling to a canvas. */
  attach(canvas) {
    let dragging = 0, lx = 0, ly = 0;
    canvas.addEventListener('pointerdown', (e) => {
      dragging = e.shiftKey || e.button === 1 ? 2 : 1;
      lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (dragging === 2) this.pan(dx, dy, canvas.clientHeight); else this.orbit(dx, dy);
    });
    const end = (e) => { dragging = 0; try { canvas.releasePointerCapture(e.pointerId); } catch {} };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(e.deltaY); }, { passive: false });
    return this;
  }
}
