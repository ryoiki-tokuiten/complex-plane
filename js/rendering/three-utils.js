export function disposeThreeObject(object) {
    if (!object) return;

    const geometries = new Set();
    const materials = new Set();
    object.traverse(child => {
        if (child.geometry) geometries.add(child.geometry);
        if (Array.isArray(child.material)) {
            child.material.forEach(material => materials.add(material));
        } else if (child.material) {
            materials.add(child.material);
        }
    });

    geometries.forEach(geometry => geometry.dispose?.());
    materials.forEach(material => {
        material.map?.dispose?.();
        material.dispose?.();
    });
}
