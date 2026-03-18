import { Medusa } from "./medusa";
import { LionfishGeometry } from "./lionfishGeometry";

/**
 * Lionfish
 * Extiende Medusa reutilizando TODO el sistema de movimiento, física,
 * estados (scatter, circling, charge) y el ciclo de vida (activate/deactivate).
 *
 * Solo sobreescribe:
 *  - createBellGeometry()  → geometría visual propia (no usa Verlet)
 *  - setRenderOrder(z)     → control de render order para sus propios meshes
 *  - initStatic()          → inicializa el material compartido de lionfish
 *  - updateStatic()        → no-op (no tiene props estáticas que actualizar)
 */
export class Lionfish extends Medusa {
    type = 'lionfish';

    constructor(renderer, physics, bridge) {
        super(renderer, physics, bridge);
    }

    /**
     * Sobreescribe la creación de geometría.
     * No registra vértices Verlet — el bridge maneja este caso (count = 0).
     * La geometría se añade a transformationObject para que Three.js
     * aplique la transformación automáticamente en cada frame.
     */
    createBellGeometry() {
        this.body = new LionfishGeometry();
        this.body.createGeometry();
        // Al añadir al transformationObject (no al object raíz),
        // la posición/rotación del lionfish mueve la geometría directamente.
        this.transformationObject.add(this.body.object);
        // Escala ligeramente reducida para verse proporcional al escenario
        this.transformationObject.scale.set(0.62, 0.62, 0.62);
    }

    /**
     * Polimorfismo para render ordering.
     * Se llama desde sortMedusae() en app.js.
     * @param {number} z - renderOrder de inicio
     * @returns {number} - siguiente z disponible
     */
    setRenderOrder(z) {
        this.body.object.children.forEach(child => {
            child.renderOrder = z;
        });
        return z + 1;
    }

    /**
     * Inicializa el material compartido de todos los lionfish.
     * Llamar una vez en app.init(), después de Medusa.initStatic().
     */
    static async initStatic() {
        LionfishGeometry.createMaterial();
    }

    /** No hay props estáticas que actualizar cada frame. */
    static updateStatic() { }
}
