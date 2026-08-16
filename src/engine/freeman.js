// Freeman (1970) rotation curve of a razor-thin exponential disc, and an
// INDEPENDENT numerical check of it.
//
// This is the guard for Phase 2 Trap 1. When the disc becomes live particles the
// rigid potential must drop its Plummer disc term, and the circular velocity has
// to be rebuilt from (bulge + halo + the disc's OWN gravity). That last term is
// not the Plummer term it replaces, and getting it wrong produces a disc sitting
// in the wrong gravity that looks completely normal.

// --- modified Bessel functions, Abramowitz & Stegun 9.8 (|err| < 2e-7) -------
const P = (t, c) => c.reduce((s, ci, i) => s + ci * t ** i, 0);

export function I0(x) {
  const a = Math.abs(x);
  if (a < 3.75) return P((x / 3.75) ** 2, [1, 3.5156229, 3.0899424, 1.2067492, 0.2659732, 0.0360768, 0.0045813]);
  const t = 3.75 / a;
  return Math.exp(a) / Math.sqrt(a) * P(t, [0.39894228, 0.01328592, 0.00225319, -0.00157565,
    0.00916281, -0.02057706, 0.02635537, -0.01647633, 0.00392377]);
}
export function I1(x) {
  const a = Math.abs(x);
  let r;
  if (a < 3.75) r = a * P((x / 3.75) ** 2, [0.5, 0.87890594, 0.51498869, 0.15084934, 0.02658733, 0.00301532, 0.00032411]);
  else {
    const t = 3.75 / a;
    r = Math.exp(a) / Math.sqrt(a) * P(t, [0.39894228, -0.03988024, -0.00362018, 0.00163801,
      -0.01031555, 0.02282967, -0.02895312, 0.01787654, -0.00420059]);
  }
  return x < 0 ? -r : r;
}
export function K0(x) {
  if (x <= 2) return -Math.log(x / 2) * I0(x) + P((x / 2) ** 2, [-0.57721566, 0.42278420, 0.23069756,
    0.03488590, 0.00262698, 0.00010750, 0.0000074]);
  const t = 2 / x;
  return Math.exp(-x) / Math.sqrt(x) * P(t, [1.25331414, -0.07832358, 0.02189568, -0.01062446,
    0.00587872, -0.00251540, 0.00053208]);
}
export function K1(x) {
  if (x <= 2) return Math.log(x / 2) * I1(x) + (1 / x) * P((x / 2) ** 2, [1, 0.15443144, -0.67278579,
    -0.18156897, -0.01919402, -0.00110404, -0.00004686]);
  const t = 2 / x;
  return Math.exp(-x) / Math.sqrt(x) * P(t, [1.25331414, 0.23498619, -0.03655620, 0.01504268,
    -0.00780353, 0.00325614, -0.00068245]);
}

// DOMAIN NOTE, measured 2026-08-16: the A&S expansions lose precision when the
// argument is large, because I0(y)K0(y) - I1(y)K1(y) is a cancellation of two
// nearly equal products. v^2 R -> GM holds to 1.2e-3 at R = 50 Rd but only to
// 1.6e-2 at R = 200 Rd. The shipped disc is truncated at rMax = 4.5 scale
// lengths, so this is far outside anything the model asks for; it is recorded
// because a formula that quietly degrades is exactly the kind of thing that gets
// trusted at the wrong radius later.
// --- Freeman 1970 ------------------------------------------------------------
// Sigma(R) = Sigma0 exp(-R/Rd),  M = 2 pi Sigma0 Rd^2
// v^2(R) = 4 pi G Sigma0 Rd y^2 [I0(y)K0(y) - I1(y)K1(y)],  y = R/(2Rd)
export function vcircDiscFreeman(R, M, Rd, G = 1) {
  if (R <= 0) return 0;
  const y = R / (2 * Rd);
  const b = I0(y) * K0(y) - I1(y) * K1(y);
  return Math.sqrt(Math.max(0, 2 * G * M / Rd * y * y * b));
}

// --- independent check: potential by direct 2D quadrature --------------------
// Centre polar coordinates ON the field point, so dA = u du dtheta cancels the
// 1/u in the kernel and the integrand is bounded. No singularity to special-case.
//   Phi(R) = -G int_0^2pi int_0^U Sigma( sqrt(R^2 + 2 R u cos t + u^2) ) du dt
export function phiNumeric(R, M, Rd, G = 1, U = 40, nu = 1200, nt = 600) {
  const S0 = M / (2 * Math.PI * Rd * Rd);
  const du = U / nu, dt = 2 * Math.PI / nt;
  let acc = 0;
  for (let i = 0; i < nt; i++) {
    const th = (i + 0.5) * dt, c = Math.cos(th);
    let inner = 0;
    for (let j = 0; j < nu; j++) {
      const u = (j + 0.5) * du;
      const rp = Math.sqrt(Math.max(0, R * R + 2 * R * u * c + u * u));
      inner += S0 * Math.exp(-rp / Rd);
    }
    acc += inner * du;
  }
  return -G * acc * dt;
}

// v_c^2 = R dPhi/dR, by central difference on the quadrature
export function vcircDiscNumeric(R, M, Rd, G = 1, h = 1e-3) {
  const dPhi = (phiNumeric(R + h, M, Rd, G) - phiNumeric(R - h, M, Rd, G)) / (2 * h);
  return Math.sqrt(Math.max(0, R * dPhi));
}
