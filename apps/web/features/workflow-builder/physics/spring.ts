/** Damped spring (semi-implicit Euler). Units are whatever the caller uses (px, deg, 0..1). */
export class Spring {
  x: number;
  v = 0;
  target: number;

  constructor(
    public k: number,
    public c: number,
    initial = 0,
    private eps = 0.01,
  ) {
    this.x = initial;
    this.target = initial;
  }

  /** Advance by dt seconds. Returns true while still moving. */
  step(dt: number): boolean {
    if (this.x === this.target && this.v === 0) return false;
    const a = -this.k * (this.x - this.target) - this.c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    if (Math.abs(this.v) < this.eps && Math.abs(this.x - this.target) < this.eps) {
      this.x = this.target;
      this.v = 0;
      return false;
    }
    return true;
  }

  set(value: number) {
    this.x = value;
    this.target = value;
    this.v = 0;
  }

  get resting(): boolean {
    return this.x === this.target && this.v === 0;
  }
}
