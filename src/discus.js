import * as THREE from "three/webgpu";
import { Medusa } from "./medusa";
import { DiscusGeometry } from "./discusGeometry";
import { noise2D } from "./common/noise";

/**
 * Discus — Pez Disco
 *
 * Hereda de Medusa para reutilizar sin modificar:
 *   - Ciclo de vida: activate() / deactivate()
 *   - Estados:       isActive, isScattering, isCircling
 *   - Interacción:   charge, updatePointerInteraction()
 *   - Comportamiento:setTarget(), scatter(), startCircling(), stopCircling()
 *   - Bridge Verlet: registra con 0 vértices → updateMedusaById no-op (count=0)
 *
 * Sobreescribe:
 *   - createBellGeometry() — carga y usa el modelo GLB discus_3.glb
 *   - update()             — movimiento tipo pez con animación GLB
 *   - setRenderOrder()     — render ordering propio
 *   - initStatic()         — carga estática del modelo GLB (async)
 *
 * Audio reactivity:
 *   - mixer.timeScale modulado por bassIntensity → animación más rápida en graves
 *   - emissiveNode + mrtNode: brillo dorado-cálido igual al de las medusas
 *   - Micro-pulso de escala sincronizado con beats de bajo
 */
export class Discus extends Medusa {

    type = 'discus';

    // ── Constantes de movimiento ─────────────────────────────────────────────
    static SWIM_SPEED = 1.20;   // u/seg base
    static TURN_SPEED = 0.42;   // factor slerp × delta
    static SWAY_FREQ  = 10.47;  // rad/seg (~1.67 Hz) oscilación lateral
    static SWAY_RATE  = 0.20;   // u/seg velocidad lateral pico
    static BASE_SCALE = 1.5;    // escala base del modelo en el acuario

    constructor(renderer, physics, bridge) {
        super(renderer, physics, bridge);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GEOMETRÍA
    // ─────────────────────────────────────────────────────────────────────────

    createBellGeometry() {
        this.body = new DiscusGeometry();
        this.body.createGeometry(Medusa.uniforms.bassIntensity);
        this.transformationObject.add(this.body.object);
        this.transformationObject.scale.setScalar(Discus.BASE_SCALE);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RENDER ORDER
    // ─────────────────────────────────────────────────────────────────────────

    setRenderOrder(z) {
        this.body.object.traverse(child => {
            if (child.isMesh) child.renderOrder = z;
        });
        return z + 1;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UPDATE — sobreescribe Medusa.update()
    // ─────────────────────────────────────────────────────────────────────────

    async update(delta, elapsed) {
        if (!this.isActive) {
            if (this.needsPositionUpdate) this.needsPositionUpdate = false;
            return;
        }

        this.time += delta * (1.0
            + noise2D(this.noiseSeed, elapsed * 0.05) * 0.09
            + this.charge * 0.20);

        this.phase = ((this.time * 0.13) % 1.0) * Math.PI * 2;

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
            if (this.transformationObject.position.distanceTo(this.scatterTarget) < 2.2) {
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
                delta * Discus.TURN_SPEED
            );
        }

        const brakeFactor = Math.min(1.0, distToTarget / 2.5);
        const speed = (Discus.SWIM_SPEED * brakeFactor + this.charge * 0.55) * delta;

        _fwdVec.set(0, speed, 0).applyQuaternion(this.transformationObject.quaternion);

        _rightVec.crossVectors(_upVec, _fwdVec);
        if (_rightVec.lengthSq() > 1e-6) _rightVec.normalize();

        const swayV = Math.sin(this.time * Discus.SWAY_FREQ) * Discus.SWAY_RATE * delta;
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
        await DiscusGeometry.loadStatic();
    }

    static updateStatic() { }
}

// ── Buffers temporales de módulo — sin allocación por paso de física ─────────
const _targetQuat = new THREE.Quaternion();
const _upVec      = new THREE.Vector3(0, 1, 0);
const _dirVec     = new THREE.Vector3();
const _fwdVec     = new THREE.Vector3();
const _rightVec   = new THREE.Vector3();
