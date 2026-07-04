// Keyboard + mouse state. Pointer lock for first-person look.
export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.mouseDown = [false, false, false]; // left, middle, right
    this.mouseJust = [false, false, false];
    this.dx = 0; this.dy = 0;
    this.locked = false;
    this.justPressed = new Set();

    window.addEventListener("keydown", (e) => {
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
      // Stop Tab from moving focus away from the canvas.
      if (e.code === "Tab") e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));

    domElement.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      this.mouseDown[e.button] = true;
      this.mouseJust[e.button] = true;
    });
    window.addEventListener("mouseup", (e) => { this.mouseDown[e.button] = false; });

    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === domElement;
    });
    domElement.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
  }
  requestLock() { this.dom.requestPointerLock?.(); }
  endFrame() {
    this.dx = 0; this.dy = 0;
    this.mouseJust = [false, false, false];
    this.justPressed.clear();
  }
}
