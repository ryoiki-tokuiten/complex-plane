/**
 * Differential Geometry 3D Manifold Embedding & Morphing Registry
 * 
 * Decouples the 2D complex function transformation f: C -> C
 * from the 3D manifold embedding S: R^2 -> R^3.
 */

export class AbstractManifold {
    /**
     * @param {string} id Unique identifier
     * @param {string} name Display name
     * @param {string} title Detailed title
     * @param {string} formula Mathematical formula notation
     * @param {string} concept Differential geometry explanation
     */
    constructor(id, name, title, formula, concept) {
        this.id = id;
        this.name = name;
        this.title = title;
        this.formula = formula;
        this.concept = concept;
    }

    /**
     * Maps the 2D complex plane coordinate (u, v) onto the 3D surface at t = 1.
     * @param {number} u Real part of complex point
     * @param {number} v Imaginary part of complex point
     * @returns {{X: number, Y: number, Z: number}} 3D point
     */
    project(u, v) {
        throw new Error(`Manifold '${this.id}' must implement project(u, v)`);
    }

    /**
     * Handles continuous morphing from flat plane (u, 0, v) at t=0 to final 3D shape S(u, v) at t=1.
     * @param {number} u
     * @param {number} v
     * @param {number} t Time parameter in [0, 1]
     * @returns {{X: number, Y: number, Z: number}} Interpolated 3D point
     */
    morph(u, v, t) {
        throw new Error(`Manifold '${this.id}' must implement morph(u, v, t)`);
    }

    /**
     * Generates a representative domain sample point (u, v) for UV parameters in [0, 1] x [0, 1].
     * Used for canonical surface mesh generation.
     * @param {number} uNorm Normalized parameter in [0, 1]
     * @param {number} vNorm Normalized parameter in [0, 1]
     * @returns {{re: number, im: number}}
     */
    getDomainPoint(uNorm, vNorm) {
        return {
            re: (uNorm * 2 - 1) * 4.5,
            im: (vNorm * 2 - 1) * 4.5
        };
    }
}

// 1. Riemann Sphere (S²) - Conformal Stereographic Folding
export class SphereManifold extends AbstractManifold {
    constructor() {
        super(
            'sphere',
            'Riemann Sphere',
            'Riemann Sphere (S²)',
            'Stereographic: (2u, 2u²+2v², 2v) / (u²+v²+1)',
            'A true geometric conformal stereographic morph. The complex plane bends upwards into a sphere, mapping the unit circle to the equator and ∞ to the North Pole.'
        );
        this.radius = 5.0;
    }

    project(u, v) {
        const r2 = u * u + v * v;
        const denom = r2 + 1.0;
        return {
            X: (2.0 * this.radius * u) / denom,
            Y: (2.0 * this.radius * r2) / denom,
            Z: (2.0 * this.radius * v) / denom
        };
    }

    morph(u, v, t) {
        if (t <= 0.0001) {
            return { X: u, Y: 0, Z: v };
        }
        if (t >= 0.9999) {
            return this.project(u, v);
        }

        const t_e = (1 - Math.cos(Math.PI * t)) / 2;
        const r = Math.hypot(u, v);
        const theta = Math.atan2(v, u);

        const R_final = this.radius;
        const alpha = 2 * Math.atan(r);

        if (alpha < 0.0001) {
            return { X: u, Y: 0, Z: v };
        }

        const curAlpha = t_e * alpha;
        const R_t = (r / curAlpha) * (1 - t_e) + R_final * t_e;

        return {
            X: R_t * Math.sin(curAlpha) * Math.cos(theta),
            Y: R_t * (1 - Math.cos(curAlpha)),
            Z: R_t * Math.sin(curAlpha) * Math.sin(theta)
        };
    }

    getDomainPoint(uNorm, vNorm) {
        // Parametric stereographic domain sampling covering from South to North Pole
        const alpha = uNorm * Math.PI * 0.96;
        const r = Math.tan(alpha / 2);
        const theta = (vNorm * 2 - 1) * Math.PI;
        return { re: r * Math.cos(theta), im: r * Math.sin(theta) };
    }
}

// 2. Log-Cylinder - Cylindrical Axis Rolling
export class CylinderManifold extends AbstractManifold {
    constructor() {
        super(
            'cylinder',
            'Log-Cylinder',
            'Logarithmic Cylinder',
            '(u, R(1 - cos(v/R)), R sin(v/R))',
            'The plane is physically rolled into a cylinder along the imaginary axis, wrapping periodic periods into closed orbits.'
        );
        this.radius = 2.8;
    }

    project(u, v) {
        return {
            X: u,
            Y: this.radius * (1 - Math.cos(v / this.radius)),
            Z: this.radius * Math.sin(v / this.radius)
        };
    }

    morph(u, v, t) {
        if (t <= 0.0001) {
            return { X: u, Y: 0, Z: v };
        }
        if (t >= 0.9999) {
            return this.project(u, v);
        }

        const t_e = (1 - Math.cos(Math.PI * t)) / 2;
        const R_roll = this.radius / t_e;
        const angle = v / R_roll;

        return {
            X: u,
            Y: R_roll * (1 - Math.cos(angle)),
            Z: R_roll * Math.sin(angle)
        };
    }

    getDomainPoint(uNorm, vNorm) {
        const x = (uNorm * 2 - 1) * 14.0;
        const y = (vNorm * 2 - 1) * Math.PI * this.radius;
        return { re: x, im: y };
    }
}

// 3. Complex Torus (T²) - Two-Stage Double Periodic Lattice Rolling
export class TorusManifold extends AbstractManifold {
    constructor() {
        super(
            'torus',
            'Complex Torus',
            'Complex Torus (T²)',
            '((R + r cos θ) cos φ, r sin θ, (R + r cos θ) sin φ)',
            'Double-periodic lattice folding. The plane is rolled horizontally into a tube, then curled vertically to close into a doughnut.'
        );
        this.R_major = 4.5;
        this.r_minor = 1.8;
    }

    project(u, v) {
        const theta = u / this.r_minor;
        const phi = v / this.R_major;
        return {
            X: (this.R_major + this.r_minor * Math.cos(theta)) * Math.cos(phi),
            Y: this.r_minor * Math.sin(theta),
            Z: (this.R_major + this.r_minor * Math.cos(theta)) * Math.sin(phi)
        };
    }

    morph(u, v, t) {
        if (t <= 0.0001) {
            return { X: u, Y: 0, Z: v };
        }
        if (t >= 0.9999) {
            return this.project(u, v);
        }

        const t_e = (1 - Math.cos(Math.PI * t)) / 2;
        const roll1 = Math.min(t_e * 1.8, 1.0);
        const roll2 = Math.max((t_e - 0.4) / 0.6, 0.0);

        const R1 = this.r_minor / Math.max(0.001, roll1);
        const angle1 = u / R1;
        const X1 = R1 * Math.sin(angle1);
        const Y1 = R1 * (1 - Math.cos(angle1));
        const Z1 = v;

        if (roll2 <= 0.0001) {
            return { X: X1, Y: Y1, Z: Z1 };
        }

        const target = this.project(u, v);
        return {
            X: (1 - roll2) * X1 + roll2 * target.X,
            Y: (1 - roll2) * Y1 + roll2 * target.Y,
            Z: (1 - roll2) * Z1 + roll2 * target.Z
        };
    }

    getDomainPoint(uNorm, vNorm) {
        const x = (uNorm * 2 - 1) * Math.PI * this.r_minor;
        const y = (vNorm * 2 - 1) * Math.PI * this.R_major;
        return { re: x, im: y };
    }
}

// 4. Riemann Helicoid - Vertical Branch Screw Unrolling
export class HelicoidManifold extends AbstractManifold {
    constructor() {
        super(
            'helicoid',
            'Riemann Helicoid',
            'Riemann Helicoid',
            '(u, c · arg(w), v)',
            'Unrolling multi-valued branch cuts vertically into an infinite minimal screw-surface where sheets seamlessly connect.'
        );
        this.pitch = 1.3;
    }

    project(u, v) {
        const theta = Math.atan2(v, u);
        return {
            X: u,
            Y: this.pitch * theta,
            Z: v
        };
    }

    morph(u, v, t) {
        if (t <= 0.0001) {
            return { X: u, Y: 0, Z: v };
        }
        if (t >= 0.9999) {
            return this.project(u, v);
        }

        const t_e = (1 - Math.cos(Math.PI * t)) / 2;
        const theta = Math.atan2(v, u);

        return {
            X: u,
            Y: t_e * this.pitch * theta,
            Z: v
        };
    }

    getDomainPoint(uNorm, vNorm) {
        const r = uNorm * 5.5;
        const theta = (vNorm * 2 - 1) * Math.PI * 2.0;
        return { re: r * Math.cos(theta), im: r * Math.sin(theta) };
    }
}

// 5. Catenoid Minimal Surface
export class CatenoidManifold extends AbstractManifold {
    constructor() {
        super(
            'catenoid',
            'Catenoid Minimal',
            'Catenoid Minimal Surface',
            '(c cosh(v/c) cos(u/c), v, c cosh(v/c) sin(u/c))',
            'The only minimal surface of revolution. Holomorphically conjugate to the Helicoid under the Weierstrass representation.'
        );
        this.c = 2.0;
    }

    project(u, v) {
        const vClamped = Math.max(-3.5, Math.min(3.5, v / this.c));
        const uAngle = u / this.c;
        const coshV = Math.cosh(vClamped);
        return {
            X: this.c * coshV * Math.cos(uAngle),
            Y: vClamped * this.c,
            Z: this.c * coshV * Math.sin(uAngle)
        };
    }

    morph(u, v, t) {
        if (t <= 0.0001) {
            return { X: u, Y: 0, Z: v };
        }
        if (t >= 0.9999) {
            return this.project(u, v);
        }

        const t_e = (1 - Math.cos(Math.PI * t)) / 2;
        const target = this.project(u, v);

        return {
            X: (1 - t_e) * u + t_e * target.X,
            Y: t_e * target.Y,
            Z: (1 - t_e) * v + t_e * target.Z
        };
    }

    getDomainPoint(uNorm, vNorm) {
        const x = (uNorm * 2 - 1) * Math.PI * this.c;
        const y = (vNorm * 2 - 1) * 3.0 * this.c;
        return { re: x, im: y };
    }
}

// 6. Enneper Minimal Surface
export class EnneperManifold extends AbstractManifold {
    constructor() {
        super(
            'enneper',
            'Enneper Minimal',
            'Enneper Minimal Surface',
            'Weierstrass-Enneper (f=1, g=z)',
            'Self-intersecting minimal surface with zero mean curvature, generated by Weierstrass representation with algebraic growth.'
        );
        this.scaleFactor = 2.0;
    }

    project(u, v) {
        const u_s = u * 0.32;
        const v_s = v * 0.32;
        const X_end = u_s - Math.pow(u_s, 3) / 3 + u_s * v_s * v_s;
        const Z_end = v_s - Math.pow(v_s, 3) / 3 + u_s * u_s * v_s;
        const Y_end = u_s * u_s - v_s * v_s;

        return {
            X: X_end * this.scaleFactor,
            Y: Y_end * this.scaleFactor,
            Z: Z_end * this.scaleFactor
        };
    }

    morph(u, v, t) {
        if (t <= 0.0001) {
            return { X: u, Y: 0, Z: v };
        }
        if (t >= 0.9999) {
            return this.project(u, v);
        }

        const t_e = (1 - Math.cos(Math.PI * t)) / 2;
        const target = this.project(u, v);

        return {
            X: (1 - t_e) * u + t_e * target.X,
            Y: t_e * target.Y,
            Z: (1 - t_e) * v + t_e * target.Z
        };
    }

    getDomainPoint(uNorm, vNorm) {
        const x = (uNorm * 2 - 1) * 3.5;
        const y = (vNorm * 2 - 1) * 3.5;
        return { re: x, im: y };
    }
}

// 7. Bonnet Isometric Family
export class BonnetManifold extends AbstractManifold {
    constructor() {
        super(
            'bonnet',
            'Bonnet Family',
            'Bonnet Isometric Family',
            'cos(θ_B) · Helicoid + sin(θ_B) · Catenoid',
            'A 1-parameter continuous isometric deformation family connecting Helicoid and Catenoid with invariant Riemannian metric.'
        );
        this.scale = 2.4;
    }

    project(u, v) {
        const u_s = u * 0.35;
        const v_s = Math.max(-3, Math.min(3, v * 0.35));
        const theta_b = Math.PI / 2;

        const X_end = Math.cos(theta_b) * Math.sinh(v_s) * Math.sin(u_s) + Math.sin(theta_b) * Math.cosh(v_s) * Math.cos(u_s);
        const Z_end = -Math.cos(theta_b) * Math.sinh(v_s) * Math.cos(u_s) + Math.sin(theta_b) * Math.cosh(v_s) * Math.sin(u_s);
        const Y_end = u_s * Math.cos(theta_b) + v_s * Math.sin(theta_b);

        return {
            X: X_end * this.scale,
            Y: Y_end * this.scale,
            Z: Z_end * this.scale
        };
    }

    morph(u, v, t) {
        if (t <= 0.0001) {
            return { X: u, Y: 0, Z: v };
        }
        if (t >= 0.9999) {
            return this.project(u, v);
        }

        const t_e = (1 - Math.cos(Math.PI * t)) / 2;
        const theta_b = t_e * (Math.PI / 2);
        const u_s = u * 0.35;
        const v_s = Math.max(-3, Math.min(3, v * 0.35));

        const X_end = Math.cos(theta_b) * Math.sinh(v_s) * Math.sin(u_s) + Math.sin(theta_b) * Math.cosh(v_s) * Math.cos(u_s);
        const Z_end = -Math.cos(theta_b) * Math.sinh(v_s) * Math.cos(u_s) + Math.sin(theta_b) * Math.cosh(v_s) * Math.sin(u_s);
        const Y_end = u_s * Math.cos(theta_b) + v_s * Math.sin(theta_b);

        return {
            X: (1 - t_e) * u + t_e * X_end * this.scale,
            Y: t_e * Y_end * this.scale,
            Z: (1 - t_e) * v + t_e * Z_end * this.scale
        };
    }

    getDomainPoint(uNorm, vNorm) {
        const x = (uNorm * 2 - 1) * 4.0;
        const y = (vNorm * 2 - 1) * 2.2;
        return { re: x, im: y };
    }
}

// 8. Klein Bottle (Figure-8 Immersion)
export class KleinBottleManifold extends AbstractManifold {
    constructor() {
        super(
            'klein_bottle',
            'Klein Bottle',
            'Klein Bottle Immersion',
            'Figure-8 Immersion in R³',
            'Non-orientable closed 2D manifold immersed in 3D. Features one continuous boundaryless surface with self-intersection.'
        );
        this.a = 4.0;
        this.b = 1.6;
    }

    project(u, v) {
        const theta = u;
        const phi = v;
        const halfTheta = theta * 0.5;

        const r = this.a + this.b * Math.cos(halfTheta) * Math.sin(phi) - this.b * Math.sin(halfTheta) * Math.sin(2 * phi);
        const X = r * Math.cos(theta);
        const Z = r * Math.sin(theta);
        const Y = this.b * Math.sin(halfTheta) * Math.sin(phi) + this.b * Math.cos(halfTheta) * Math.sin(2 * phi);

        return { X, Y, Z };
    }

    morph(u, v, t) {
        if (t <= 0.0001) {
            return { X: u, Y: 0, Z: v };
        }
        if (t >= 0.9999) {
            return this.project(u, v);
        }

        const t_e = (1 - Math.cos(Math.PI * t)) / 2;
        const target = this.project(u, v);

        return {
            X: (1 - t_e) * u + t_e * target.X,
            Y: t_e * target.Y,
            Z: (1 - t_e) * v + t_e * target.Z
        };
    }

    getDomainPoint(uNorm, vNorm) {
        const x = (uNorm * 2 - 1) * Math.PI;
        const y = (vNorm * 2 - 1) * Math.PI;
        return { re: x, im: y };
    }
}

// 9. Beltrami Pseudosphere (Hyperbolic Geometry H²)
export class PseudosphereManifold extends AbstractManifold {
    constructor() {
        super(
            'pseudosphere',
            'Beltrami Pseudosphere',
            'Beltrami Pseudosphere (H²)',
            '(a sech(v) cos(u), a(v - tanh(v)), a sech(v) sin(u))',
            'Surface of constant negative Gaussian curvature -1/a², providing a local isometric embedding of the hyperbolic plane H².'
        );
        this.a = 3.0;
    }

    project(u, v) {
        const vClamped = Math.max(-3.5, Math.min(3.5, v * 0.6));
        const sech = 1.0 / Math.cosh(vClamped);
        const tanh = Math.tanh(vClamped);

        return {
            X: this.a * sech * Math.cos(u),
            Y: this.a * (vClamped - tanh),
            Z: this.a * sech * Math.sin(u)
        };
    }

    morph(u, v, t) {
        if (t <= 0.0001) {
            return { X: u, Y: 0, Z: v };
        }
        if (t >= 0.9999) {
            return this.project(u, v);
        }

        const t_e = (1 - Math.cos(Math.PI * t)) / 2;
        const target = this.project(u, v);

        return {
            X: (1 - t_e) * u + t_e * target.X,
            Y: t_e * target.Y,
            Z: (1 - t_e) * v + t_e * target.Z
        };
    }

    getDomainPoint(uNorm, vNorm) {
        const x = (uNorm * 2 - 1) * Math.PI;
        const y = (vNorm * 2 - 1) * 3.5;
        return { re: x, im: y };
    }
}

// 10. Scherk Minimal Surface
export class ScherkManifold extends AbstractManifold {
    constructor() {
        super(
            'scherk',
            'Scherk Minimal',
            'Scherk Minimal Surface',
            'Y = ln(cos(a u) / cos(a v)) / a',
            'Doubly periodic minimal surface discovered by Heinrich Scherk in 1834, forming an infinite checkerboard of saddle towers.'
        );
        this.a = 0.5;
    }

    project(u, v) {
        const cu = Math.cos(this.a * u);
        const cv = Math.cos(this.a * v);
        const safeRatio = Math.max(1e-4, Math.abs(cu)) / Math.max(1e-4, Math.abs(cv));
        const Y = Math.max(-6.5, Math.min(6.5, (1.0 / this.a) * Math.log(safeRatio)));

        return {
            X: u,
            Y: Y,
            Z: v
        };
    }

    morph(u, v, t) {
        if (t <= 0.0001) {
            return { X: u, Y: 0, Z: v };
        }
        if (t >= 0.9999) {
            return this.project(u, v);
        }

        const t_e = (1 - Math.cos(Math.PI * t)) / 2;
        const target = this.project(u, v);

        return {
            X: u,
            Y: t_e * target.Y,
            Z: v
        };
    }

    getDomainPoint(uNorm, vNorm) {
        const x = (uNorm * 2 - 1) * 3.5;
        const y = (vNorm * 2 - 1) * 3.5;
        return { re: x, im: y };
    }
}

// Manifold Registry Table
const MANIFOLD_INSTANCES = new Map([
    ['sphere', new SphereManifold()],
    ['cylinder', new CylinderManifold()],
    ['torus', new TorusManifold()],
    ['helicoid', new HelicoidManifold()],
    ['catenoid', new CatenoidManifold()],
    ['enneper', new EnneperManifold()],
    ['bonnet', new BonnetManifold()],
    ['klein_bottle', new KleinBottleManifold()],
    ['pseudosphere', new PseudosphereManifold()],
    ['scherk', new ScherkManifold()]
]);

export const DEFAULT_MANIFOLD_ID = 'sphere';

/**
 * Retrieve a manifold by its ID, defaulting to Riemann Sphere.
 * @param {string} id
 * @returns {AbstractManifold}
 */
export function getManifold(id) {
    return MANIFOLD_INSTANCES.get(id) || MANIFOLD_INSTANCES.get(DEFAULT_MANIFOLD_ID);
}

/**
 * Retrieve all registered manifolds in display order.
 * @returns {AbstractManifold[]}
 */
export function getAllManifolds() {
    return Array.from(MANIFOLD_INSTANCES.values());
}

const DOTS_DEFAULT_MANIFOLDS = new Set([
    'enneper',
    'klein_bottle',
    'bonnet',
    'pseudosphere',
    'scherk'
]);

/**
 * Returns the recommended default input grid shape for a given manifold.
 * For Enneper, Klein Bottle, Bonnet, Pseudosphere, and Scherk: 'grid_dots'.
 * For others (Sphere, Cylinder, Torus, Helicoid, Catenoid): 'grid_logcartesian'.
 * @param {string} manifoldId
 * @returns {string} Input shape key
 */
export function getDefaultInputShapeForManifold(manifoldId) {
    return DOTS_DEFAULT_MANIFOLDS.has(manifoldId) ? 'grid_dots' : 'grid_logcartesian';
}
