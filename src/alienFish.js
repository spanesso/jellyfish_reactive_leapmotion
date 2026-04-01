import * as THREE from "three/webgpu";
import { Medusa } from "./medusa";
import { AlienFishGeometry } from "./alienFishGeometry";
import { noise2D } from "./common/noise";

/**
 * AlienFish — Pez Alienígena
 *
 * Hereda de Medusa para reutilizar sin modificar:
 *   - Ciclo de vida: activate() / deactivate()
 *   - Estados:       isActive, isScattering, isCircling
 *   - Interacción:   charge, updatePointerInteraction()
 *   - Comportamiento:setTarget(), scatter(), startCircling(), stopCircling()
 *   - Bridge Verlet: registra con 0 vértices → updateMedusaById no-op (count=0)
 *
 * Sobreescribe:
 *   - createBellGeometry() — carga y usa el modelo GLB alien_fish_animated.glb
 *   - update()             — movimiento tipo pez con animación GLB
 *   - setRenderOrder()     — render ordering propio
 *   - initStatic()         — carga estática del modelo GLB (async)
 *
 * Audio reactivity:
 *   - mixer.timeScale modulado por bassIntensity → animación más rápida en graves
 *   - emissiveNode + mrtNode en materiales: brillo cian alienígena reactivo al bass
 *   - Micro-pulso de escala sincronizado con beats de bajo
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MODELO DE MOVIMIENTO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * update() se llama desde VerletPhysics.update() a 360 pasos/segundo.
 * Mismo patrón que Shark._swimPosition() con constantes propias.
 *
 * El eje de avance es +Y (igual que Medusa, Lionfish y Shark) para
 * compatibilidad con setFromUnitVectors y con el bridge Verlet.
 */
export class AlienFish extends Medusa {

    type = 'alien_fish';

    // ── Constantes de movimiento ─────────────────────────────────────────────
    static SWIM_SPEED = 1.40;   // u/seg base (más ágil que el tiburón)
    static TURN_SPEED = 0.38;   // factor slerp × delta
    static SWAY_FREQ  = 9.42;   // rad/seg (~1.5 Hz) oscilación lateral
    static SWAY_RATE  = 0.24;   // u/seg velocidad lateral pico
    static BASE_SCALE = 0.9;    // escala base del modelo en el acuario

    constructor(renderer, physics, bridge) {
        super(renderer, physics, bridge);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GEOMETRÍA
    // ─────────────────────────────────────────────────────────────────────────

    createBellGeometry() {
        this.body = new AlienFishGeometry();
        this.body.createGeometry(Medusa.uniforms.bassIntensity);
        this.transformationObject.add(this.body.object);
        this.transformationObject.scale.setScalar(AlienFish.BASE_SCALE);
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

        this.time += delta * (1.0
            + noise2D(this.noiseSeed, elapsed * 0.05) * 0.09
            + this.charge * 0.20);

        this.phase = ((this.time * 0.12) % 1.0) * Math.PI * 2;

        const bassIntensity = Medusa.uniforms.bassIntensity?.value ?? 0;

        this.body.updateAnimation(delta, bassIntensity);

        this._swimPosition(delta);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POSICIÓN — nado direccional con oscilación lateral
    // ─────────────────────────────────────────────────────────────────────────

    _swimPosition(delta) {

        let currentTarget;

        if (this.isCircling) {
            this.circlingAngle += this.circlingSpeed * delta;
            this.circleTargetPosition.set(
                this.circlingCenter.x + Math.cos(this.circlingAngle) * this.circlingRadius,
                this.circlingCenter.y,
                this.circlingCenter.z + Math.sin(this.circlingAngle) * this.circlingRadius
            );
            currentTarget = this.circleTargetPosition;

        } else if (this.isScattering) {
            currentTarget = this.scatterTarget;
            if (this.transformationObject.position.distanceTo(this.scatterTarget) < 2.4) {
                this.isScattering = false;
            }

        } else {
            currentTarget = this.targetPosition;
        }

        const pos = this.transformationObject.position;
        _dirVec.subVectors(currentTarget, pos);
        const distToTarget = _dirVec.length();

        if (distToTarget > 0.9) {
            _dirVec.normalize();
            _targetQuat.setFromUnitVectors(_upVec, _dirVec);
            this.transformationObject.quaternion.slerp(
                _targetQuat,
                delta * AlienFish.TURN_SPEED
            );
        }

        const brakeFactor = Math.min(1.0, distToTarget / 2.8);
        const speed = (AlienFish.SWIM_SPEED * brakeFactor + this.charge * 0.55) * delta;

        _fwdVec.set(0, speed, 0).applyQuaternion(this.transformationObject.quaternion);

        _rightVec.crossVectors(_upVec, _fwdVec);
        if (_rightVec.lengthSq() > 1e-6) _rightVec.normalize();

        const swayV = Math.sin(this.time * AlienFish.SWAY_FREQ) * AlienFish.SWAY_RATE * delta;
        _rightVec.multiplyScalar(swayV);

        pos.add(_fwdVec).add(_rightVec);

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
        await AlienFishGeometry.loadStatic();
    }

    static updateStatic() { }
}

// ── Buffers temporales de módulo — sin allocación por paso de física ─────────
const _targetQuat = new THREE.Quaternion();
const _upVec      = new THREE.Vector3(0, 1, 0);
const _dirVec     = new THREE.Vector3();
const _fwdVec     = new THREE.Vector3();
const _rightVec   = new THREE.Vector3();
