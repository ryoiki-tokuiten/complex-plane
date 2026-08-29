# Domain Glossary

One-line definitions of key architectural and mathematical domain nouns used throughout the Complex Function Analysis system.

- **z-Plane**: The primary input complex coordinate plane $\mathbb{C}$ representing domain points $z = x + iy$.
- **w-Plane**: The output complex coordinate plane $\mathbb{C}$ representing mapped values $w = u + iv = f(z)$.
- **Conformal Mapping**: A holomorphic transformation preserving local angles and infinitesimal shapes without distortion ($f'(z) \neq 0$).
- **Singularity**: A point $z_0$ where a complex function fails to be holomorphic (poles, essential singularities, branch points).
- **Pole**: An isolated singularity of order $m$ where $|f(z)| \to \infty$ as $z \to z_0$ with Laurent series principal part $\frac{b_m}{(z-z_0)^m}$.
- **Cauchy Residue**: The coefficient $b_{-1} = \text{Res}(f, z_0)$ in the Laurent expansion around an isolated singularity, governing contour integration $\oint_C f(z) dz = 2\pi i \sum \text{Res}$.
- **Winding Number ($Ind_\gamma(z)$)**: An integer counting how many times a closed curve $\gamma$ travels counterclockwise around a reference point $z_0$.
- **Branch Cut**: A curve of discontinuity introduced in the complex plane to define a single-valued analytic branch of a multi-valued function (e.g. $\log z, \sqrt{z}$).
- **Riemann Surface**: A 1D complex manifold (multi-sheeted geometric surface) allowing multi-valued functions to be treated as continuous single-valued mappings.
- **Riemann Sphere**: The compactification of the complex plane $\hat{\mathbb{C}} = \mathbb{C} \cup \{\infty\}$ mapped onto the surface of a unit sphere $S^2$ via stereographic projection.
- **Domain Coloring**: A visual technique mapping complex values $w = f(z)$ onto colors: hue encodes argument/phase $\arg(w)$, while lightness/saturation encodes magnitude $|w|$.
- **Tissot's Indicatrix**: An infinitesimal circle on the domain mapped to an ellipse on the codomain, visualizing local scaling, shearing, and rotation distortion.
- **Streamline**: A curve everywhere tangent to the complex velocity field $\vec{V} = (\text{Re}(f'), -\text{Im}(f'))$, representing physical fluid or electrostatic potential flow.
- **Laplace Surface**: A 3D terrain plot of magnitude $|F(s)|$ over the complex frequency s-plane $s = \sigma + i\omega$, indicating poles, zeros, and Region of Convergence (ROC).
- **3b1b Winding Visualization**: A rotational spectral animation wrapping a signal $f(t)$ around the origin at varying frequencies $\omega$ to visually locate Fourier/Laplace centroids.
- **Active Map**: The runtime dispatch pipeline that resolves and evaluates single, chained, or derivative complex functions.
- **Native WASM Engine**: The compiled C arithmetic core (`complex_engine.wasm`, ABI v3) providing vectorized SIMD numerical evaluations.
- **Redraw Scheduler**: The requestAnimationFrame batching controller that coalesces rapid parameter changes into stable 60fps render frames.
