import * as THREE from "three/webgpu";
import { Medusa } from "./medusa";
import { LionfishGeometry } from "./lionfishGeometry";
import { noise2D } from "./common/noise";

/**
 * Lionfish — Pez León
 *
 * Hereda de Medusa para reutilizar sin modificar:
 *   - Ciclo de vida: activate() / deactivate()
 *   - Estados:       isActive, isScattering, isCircling
 *   - Interacción:   charge, updatePointerInteraction()
 *   - Comportamiento:setTarget(), scatter(), startCircling(), stopCircling()
 *   - Bridge Verlet: registra con 0 vértices → updateMedusaById no-op (count=0)
 *
 * Sobreescribe:
 *   - createBellGeometry() — geometría orgánica propia
 *   - update()             — movimiento tipo pez (nado real)
 *   - setRenderOrder()     — render ordering propio
 *   - initStatic()         — materiales del lionfish
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MODELO DE MOVIMIENTO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * update() se llama desde VerletPhysics.update() a 360 pasos/segundo.
 * Cada llamada: delta = 1/360 ≈ 0.00278 seg, elapsed = tiempo físico acumulado.
 *
 * 1. TIEMPO PROPIO (this.time):
 *    Crece ~1.0 por segundo real.
 *    time += delta * (1 + noiseVariation + charge)
 *
 * 2. COLEO DE COLA (animación visual):
 *    tailWag = sin(time * TAIL_FREQ)
 *    TAIL_FREQ = 3Hz → 3*2π ≈ 18.85 rad/seg
 *    El pivot de la cola rota ±TAIL_AMP radianes.
 *
 * 3. ALETEO PECTORAL (animación visual):
 *    flutter = sin(time * 5.8) * 0.09
 *    Las aletas oscilan independientemente de la cola.
 *
 * 4. OSCILACIÓN CUERPO (efecto S-wave):
 *    bodyMesh.rotation.x = -tailWag * 0.07
 *    La cabeza se inclina opuesto a la cola.
 *
 * 5. ORIENTACIÓN SUAVE (dirección de nado):
 *    quaternion.slerp(targetQuat, delta * TURN_SPEED)
 *    TURN_SPEED = 0.45 < Medusa(0.8) → el pez gira con más inercia.
 *
 * 6. VELOCIDAD BASE CONSTANTE:
 *    speed = SWIM_SPEED * brakeFactor * delta + charge * 0.6 * delta
 *    No sinusoidal (al contrario de la medusa).
 *    brakeFactor = min(1, dist/2.5) → frena al acercarse al target.
 *
 * 7. OSCILACIÓN LATERAL DEL CUERPO (sway en posición):
 *    swayVelocity = sin(time * SWAY_FREQ) * SWAY_RATE * delta
 *    Se añade perpendicularmente al avance (cross(up, advance)).
 *    SWAY_FREQ = 2Hz → 2*2π ≈ 12.57 rad/seg
 *    SWAY_RATE = 0.22 u/seg (velocidad lateral pico)
 *
 * El eje de avance es +Y (igual que Medusa) para compatibilidad
 * con setFromUnitVectors y con el bridge Verlet.
 */
export class Lionfish extends Medusa {
    type = 'lionfish';

    // ── Constantes de movimiento ─────────────────────────────────────────────
    static SWIM_SPEED  = 1.45;   // u/seg base (constante, no pulsante)
    static TURN_SPEED  = 0.45;   // factor slerp × delta (< Medusa 0.8 → más inercia)
    static SWAY_FREQ   = 12.57;  // rad/seg (~2 Hz)  oscilación lateral de posición
    static SWAY_RATE   = 0.22;   // u/seg velocidad lateral pico
    static TAIL_FREQ   = 18.85;  // rad/seg (~3 Hz)  coleo de cola

    constructor(renderer, physics, bridge) {
        super(renderer, physics, bridge);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GEOMETRÍA
    // ─────────────────────────────────────────────────────────────────────────

    createBellGeometry() {
        this.body = new LionfishGeometry();
        this.body.createGeometry();
        this.transformationObject.add(this.body.object);
        // Escala global: legible en el escenario, proporcional a las medusas
        // /CAMBIO/ Escala aumentada de 0.72 a 1.4
        this.transformationObject.scale.set(1.4, 1.4, 1.4);
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

        // Tiempo propio: ~1.0/seg real, con variación de ruido y charge
        this.time += delta * (1.0
            + noise2D(this.noiseSeed, elapsed * 0.06) * 0.10
            + this.charge * 0.25);

        // phase: requerido por el bridge Verlet (lee medusa.phase)
        this.phase = ((this.time * 0.15) % 1.0) * Math.PI * 2;

        // Señal principal de nado: sin a ~3Hz
        const tailWag = Math.sin(this.time * Lionfish.TAIL_FREQ);

        // Animación visual (cola, aletas, cuerpo)
        this.body.updateAnimation(this.time, tailWag);

        // Movimiento de posición/orientación en el mundo
        this._swimPosition(delta);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POSICIÓN — nado direccional con oscilación lateral
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
            // Umbral de llegada más amplio que la medusa (pez grande)
            if (this.transformationObject.position.distanceTo(this.scatterTarget) < 2.2) {
                this.isScattering = false;
            }

        } else {
            currentTarget = this.targetPosition;
        }

        // ── 2. Vector dirección al target (reutiliza buffer) ─────────────────
        const pos = this.transformationObject.position;
        _dirVec.subVectors(currentTarget, pos);
        const distToTarget = _dirVec.length();

        // ── 3. Orientación suave (slerp con inercia de pez grande) ───────────
        if (distToTarget > 0.9) {
            _dirVec.normalize();
            // +Y local = dirección de avance (compatibilidad con Medusa)
            _targetQuat.setFromUnitVectors(_upVec, _dirVec);
            // TURN_SPEED × delta: slerp correcto a 360 pasos/seg
            this.transformationObject.quaternion.slerp(
                _targetQuat,
                delta * Lionfish.TURN_SPEED
            );
        }

        // ── 4. Velocidad constante × delta ───────────────────────────────────
        // El pez no pulsa — mantiene velocidad uniforme.
        // Frenado suave al acercarse (evita sobrepasar el target en círculos).
        const brakeFactor = Math.min(1.0, distToTarget / 2.5);
        const speed = (Lionfish.SWIM_SPEED * brakeFactor + this.charge * 0.6) * delta;

        // Avance en la dirección local +Y del pez
        _fwdVec.set(0, speed, 0).applyQuaternion(this.transformationObject.quaternion);

        // ── 5. Sway lateral × delta ───────────────────────────────────────────
        // sway_velocity = SWAY_RATE × sin(time × SWAY_FREQ)
        // Se añade perpendicularmente al avance → crea la "S" del nado.
        // cross(up, forward) da el vector derecha del pez.
        _rightVec.crossVectors(_upVec, _fwdVec);
        if (_rightVec.lengthSq() > 1e-6) _rightVec.normalize();

        const swayV = Math.sin(this.time * Lionfish.SWAY_FREQ)
                    * Lionfish.SWAY_RATE * delta;
        _rightVec.multiplyScalar(swayV);

        // ── 6. Integrar posición ─────────────────────────────────────────────
        pos.add(_fwdVec).add(_rightVec);

        // ── 7. Wrap vertical (igual que Medusa) ──────────────────────────────
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

    static async initStatic() {
        LionfishGeometry.createMaterial();
    }

    static updateStatic() { }
}

// ── Buffers temporales de módulo — sin allocación por paso de física ─────────
const _targetQuat = new THREE.Quaternion();
const _upVec      = new THREE.Vector3(0, 1, 0);
const _dirVec     = new THREE.Vector3();
const _fwdVec     = new THREE.Vector3();
const _rightVec   = new THREE.Vector3();
