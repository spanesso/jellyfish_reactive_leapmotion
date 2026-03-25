// /CAMBIO/ Nuevo archivo: entidad Tiburón que extiende Medusa.
import * as THREE from "three/webgpu";
import { Medusa } from "./medusa";
import { SharkGeometry } from "./sharkGeometry";
import { noise2D } from "./common/noise";

/**
 * Shark — Tiburón
 *
 * Hereda de Medusa para reutilizar sin modificar:
 *   - Ciclo de vida: activate() / deactivate()
 *   - Estados:       isActive, isScattering, isCircling
 *   - Interacción:   charge, updatePointerInteraction()
 *   - Comportamiento:setTarget(), scatter(), startCircling(), stopCircling()
 *   - Bridge Verlet: registra con 0 vértices → updateMedusaById no-op (count=0)
 *
 * Sobreescribe:
 *   - createBellGeometry() — carga y usa el modelo GLB shark.glb
 *   - update()             — movimiento tipo tiburón con animación GLB
 *   - setRenderOrder()     — render ordering propio
 *   - initStatic()         — carga estática del modelo GLB (async)
 *
 * Audio reactivity:
 *   - mixer.timeScale modulado por bassIntensity → nado más rápido en graves
 *   - mrtNode en materiales con referencia al uniform bassIntensity → bloom reactivo
 *   - Micro-pulso de escala en la geometría sincronizado con beats de bajo
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MODELO DE MOVIMIENTO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * update() se llama desde VerletPhysics.update() a 360 pasos/segundo.
 * Cada llamada: delta = 1/360 ≈ 0.00278 seg.
 *
 * El movimiento replica el patrón de Lionfish._swimPosition() con constantes
 * propias de tiburón:
 *   - SWIM_SPEED:  menor (depredador lento y calculado)
 *   - TURN_SPEED:  menor (mayor inercia por tamaño)
 *   - SWAY_FREQ:   menor frecuencia (ondulación lenta del cuerpo)
 *   - SWAY_RATE:   mayor amplitud (cuerpo más grande)
 *
 * El eje de avance es +Y (igual que Medusa y Lionfish) para compatibilidad
 * con setFromUnitVectors y con el bridge Verlet.
 */
export class Shark extends Medusa {

    type = 'shark';

    // ── Constantes de movimiento ─────────────────────────────────────────────
    static SWIM_SPEED = 1.10;   // u/seg base (más lento que el lionfish)
    static TURN_SPEED = 0.30;   // factor slerp × delta (mayor inercia)
    static SWAY_FREQ  = 6.28;   // rad/seg (~1 Hz) oscilación lateral
    static SWAY_RATE  = 0.28;   // u/seg velocidad lateral pico (cuerpo grande)
    // /CAMBIO/ Escala aumentada de 0.65 a 2.0
    static BASE_SCALE = 2.0;    // escala base del modelo en el acuario

    constructor(renderer, physics, bridge) {
        super(renderer, physics, bridge);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GEOMETRÍA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Sobreescribe Medusa.createBellGeometry().
     * Instancia SharkGeometry con el modelo GLB y lo agrega al transformationObject.
     * Se pasa Medusa.uniforms.bassIntensity para que el mrtNode sea audio-reactivo.
     */
    createBellGeometry() {
        this.body = new SharkGeometry();
        // bassIntensity ya está inicializado en Medusa.initStatic(), que se llama
        // antes de crear el pool de tiburones en app.js.
        this.body.createGeometry(Medusa.uniforms.bassIntensity);
        this.transformationObject.add(this.body.object);
        // Escala global: el tiburón ocupa más espacio que el lionfish
        this.transformationObject.scale.setScalar(Shark.BASE_SCALE);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RENDER ORDER — polimorfismo con Medusa.setRenderOrder()
    // ─────────────────────────────────────────────────────────────────────────

    setRenderOrder(z) {
        this.body.object.traverse(child => {
            if (child.isMesh) child.renderOrder = z;
        });
        return z + 1;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UPDATE — sobreescribe Medusa.update()
    // Llamado 360 veces/seg por VerletPhysics con delta ≈ 1/360
    // ─────────────────────────────────────────────────────────────────────────

    async update(delta, elapsed) {
        if (!this.isActive) {
            if (this.needsPositionUpdate) this.needsPositionUpdate = false;
            return;
        }

        // Tiempo propio: ~1.0/seg real, con pequeña variación de ruido y charge
        this.time += delta * (1.0
            + noise2D(this.noiseSeed, elapsed * 0.04) * 0.08
            + this.charge * 0.18);

        // phase: requerido por el bridge Verlet (lee medusa.phase para la GPU)
        this.phase = ((this.time * 0.10) % 1.0) * Math.PI * 2;

        // Leer bassIntensity del uniform compartido (actualizado por app.js cada frame)
        const bassIntensity = Medusa.uniforms.bassIntensity?.value ?? 0;

        // Animar el modelo GLB: ciclo de nado + audio reactivity
        this.body.updateAnimation(delta, bassIntensity);

        // Movimiento de posición y orientación en el mundo
        this._swimPosition(delta);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POSICIÓN — nado direccional con oscilación lateral
    // Mismo patrón que Lionfish._swimPosition() con constantes de tiburón.
    // ─────────────────────────────────────────────────────────────────────────

    _swimPosition(delta) {

        // ── 1. Seleccionar target según estado de comportamiento ─────────────
        let currentTarget;

        if (this.isCircling) {
            // Orbitar alrededor del último punto de spawn
            this.circlingAngle += this.circlingSpeed * delta;
            this.circleTargetPosition.set(
                this.circlingCenter.x + Math.cos(this.circlingAngle) * this.circlingRadius,
                this.circlingCenter.y,
                this.circlingCenter.z + Math.sin(this.circlingAngle) * this.circlingRadius
            );
            currentTarget = this.circleTargetPosition;

        } else if (this.isScattering) {
            currentTarget = this.scatterTarget;
            // Umbral de llegada más amplio: el tiburón es más grande que el lionfish
            if (this.transformationObject.position.distanceTo(this.scatterTarget) < 2.8) {
                this.isScattering = false;
            }

        } else {
            currentTarget = this.targetPosition;
        }

        // ── 2. Vector dirección al target (reutiliza buffers de módulo) ──────
        const pos = this.transformationObject.position;
        _dirVec.subVectors(currentTarget, pos);
        const distToTarget = _dirVec.length();

        // ── 3. Orientación suave (slerp con inercia de animal grande) ────────
        if (distToTarget > 1.0) {
            _dirVec.normalize();
            // +Y local = dirección de avance (compatibilidad con Medusa y Lionfish)
            _targetQuat.setFromUnitVectors(_upVec, _dirVec);
            this.transformationObject.quaternion.slerp(
                _targetQuat,
                delta * Shark.TURN_SPEED
            );
        }

        // ── 4. Velocidad constante × delta ───────────────────────────────────
        // El tiburón mantiene velocidad uniforme (no pulsante como la medusa).
        // Frenado suave al acercarse al target para evitar sobrepasar.
        const brakeFactor = Math.min(1.0, distToTarget / 3.0);
        const speed = (Shark.SWIM_SPEED * brakeFactor + this.charge * 0.50) * delta;

        // Avance en la dirección local +Y del tiburón
        _fwdVec.set(0, speed, 0).applyQuaternion(this.transformationObject.quaternion);

        // ── 5. Sway lateral × delta ───────────────────────────────────────────
        // Ondulación lateral característica del movimiento de tiburón.
        // cross(up, forward) da el vector "derecha" del tiburón.
        _rightVec.crossVectors(_upVec, _fwdVec);
        if (_rightVec.lengthSq() > 1e-6) _rightVec.normalize();

        const swayV = Math.sin(this.time * Shark.SWAY_FREQ) * Shark.SWAY_RATE * delta;
        _rightVec.multiplyScalar(swayV);

        // ── 6. Integrar posición ─────────────────────────────────────────────
        pos.add(_fwdVec).add(_rightVec);

        // ── 7. Wrap vertical (igual que Medusa y Lionfish) ───────────────────
        if (pos.y > 20) {
            pos.set(
                (Math.random() - 0.5) * 10,
                -25,
                (Math.random() - 0.5) * 10
            );
            this.needsPositionUpdate = true;
        }

        this.transformationObject.updateMatrix();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ESTÁTICOS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Carga el modelo GLB una sola vez durante la inicialización de la app.
     * Debe ser await-eado en app.js antes de crear el pool de tiburones.
     */
    static async initStatic() {
        await SharkGeometry.loadStatic();
    }

    static updateStatic() { }
}

// ── Buffers temporales de módulo — sin allocación por paso de física ─────────
const _targetQuat = new THREE.Quaternion();
const _upVec      = new THREE.Vector3(0, 1, 0);
const _dirVec     = new THREE.Vector3();
const _fwdVec     = new THREE.Vector3();
const _rightVec   = new THREE.Vector3();
