export class Loop {
  constructor(update) {
    this.update = update;
    this.last = performance.now();
    this.running = false;
    this._frame = this._frame.bind(this);
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._frame);
  }
  stop() { this.running = false; }
  _frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt, now);
    requestAnimationFrame(this._frame);
  }
}
