import * as THREE from "three/webgpu";
import { Medusa } from "./medusa";
import { GlowWhaleGeometry } from "./glowWhaleGeometry";
import { noise2D } from "./common/noise";

/**
 * GlowWhale — Ballena Bioluminiscente
 *
 * Animal especial: aparece después de 3 tiburones en la secuencia de spawn.
 * Es el animal más grande del acuario.
 *
 * Hereda de Medusa para reutilizar ciclo de vida, estados, interacción y bridge Verlet.
 *
 * Audio reactivity:
 *   - mixer.timeScale modulado por bassIntensity → nado sincronizado con los graves
 *   - emissiveNode azul bioluminiscente + mrtNode con bloom reactivo al bass
 *   - Micro-pulso de escala sincronizado con beats de bajo
 *
 * Movimiento: más lento que el resto de animales por su tamaño, con mayor inercia
 * y radio de frenado amplio.
 */
export class GlowWhale extends Medusa {

    type = 'whale';

    // ── Constantes de movimiento ─────────────────────────────────────────────
    static SWIM_SPEED = 0.80;   // u/seg — lenta y majestuosa
    static TURN_SPEED = 0.18;   // factor slerp × delta — gran inercia por tamaño
    static SWAY_FREQ  = 4.71;   // rad/seg (~0.75 Hz) — ondulación muy lenta
    static SWAY_RATE  = 0.35;   // u/seg — amplitud lateral grande (cuerpo enorme)
    static BASE_SCALE = 12.5;    // escala base — notablemente más grande que el resto

    constructor(renderer, physics, bridge) {
        super(renderer, physics, bridge);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GEOMETRÍA
    // ─────────────────────────────────────────────────────────────────────────

    createBellGeometry() {
        this.body = new GlowWhaleGeometry();
        this.body.createGeometry(Medusa.uniforms.bassIntensity);
        this.transformationObject.add(this.body.object);
        this.transformationObject.scale.setScalar(GlowWhale.BASE_SCALE);
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

        // Tiempo propio con poca variación de ruido — la ballena es predecible
        this.time += delta * (1.0
            + noise2D(this.noiseSeed, elapsed * 0.03) * 0.06
            + this.charge * 0.15);

        this.phase = ((this.time * 0.08) % 1.0) * Math.PI * 2;

        const bassIntensity = Medusa.uniforms.bassIntensity?.value ?? 0;

        this.body.updateAnimation(delta, bassIntensity);

        this._swimPosition(delta);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POSICIÓN — nado lento y majestuoso
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
            // Radio de llegada grande — la ballena no gira bruscamente
            if (this.transformationObject.position.distanceTo(this.scatterTarget) < 4.0) {
                this.isScattering = false;
            }

        } else {
            currentTarget = this.targetPosition;
        }

        const pos = this.transformationObject.position;
        _dirVec.subVectors(currentTarget, pos);
        const distToTarget = _dirVec.length();

        if (distToTarget > 1.5) {
            _dirVec.normalize();
            _targetQuat.setFromUnitVectors(_upVec, _dirVec);
            this.transformationObject.quaternion.slerp(
                _targetQuat,
                delta * GlowWhale.TURN_SPEED
            );
        }

        // Radio de frenado amplio — la ballena comienza a frenar desde lejos
        const brakeFactor = Math.min(1.0, distToTarget / 5.0);
        const speed = (GlowWhale.SWIM_SPEED * brakeFactor + this.charge * 0.35) * delta;

        _fwdVec.set(0, speed, 0).applyQuaternion(this.transformationObject.quaternion);

        _rightVec.crossVectors(_upVec, _fwdVec);
        if (_rightVec.lengthSq() > 1e-6) _rightVec.normalize();

        const swayV = Math.sin(this.time * GlowWhale.SWAY_FREQ) * GlowWhale.SWAY_RATE * delta;
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
        await GlowWhaleGeometry.loadStatic();
    }

    static updateStatic() { }
}

// ── Buffers temporales de módulo — sin allocación por paso de física ─────────
const _targetQuat = new THREE.Quaternion();
const _upVec      = new THREE.Vector3(0, 1, 0);
const _dirVec     = new THREE.Vector3();
const _fwdVec     = new THREE.Vector3();
const _rightVec   = new THREE.Vector3();
