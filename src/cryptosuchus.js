import * as THREE from "three/webgpu";
import { Medusa } from "./medusa";
import { CryptosuchusGeometry } from "./cryptosuchusGeometry";
import { noise2D } from "./common/noise";

/**
 * Cryptosuchus — Animal Jefe
 *
 * El animal más grande del acuario. Aparece después de 2 arctic_rays en la secuencia.
 *
 * Audio reactivity:
 *   - mixer.timeScale modulado por bassIntensity
 *   - emissiveNode verde bioluminiscente + mrtNode con el bloom más intenso
 *   - Micro-pulso de escala con el bajo
 *
 * Movimiento: muy lento y amenazante, con gran inercia y radio de frenado enorme.
 */
export class Cryptosuchus extends Medusa {

    type = 'cryptosuchus';

    // ── Constantes de movimiento ─────────────────────────────────────────────
    static SWIM_SPEED = 0.65;   // u/seg — el más lento, domina el espacio
    static TURN_SPEED = 0.12;   // factor slerp × delta — inercia máxima
    static SWAY_FREQ  = 3.14;   // rad/seg (~0.5 Hz) — ondulación muy lenta
    static SWAY_RATE  = 0.40;   // u/seg — amplitud lateral grande
    static BASE_SCALE = 12.0;    // escala base — el más grande del acuario

    constructor(renderer, physics, bridge) {
        super(renderer, physics, bridge);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GEOMETRÍA
    // ─────────────────────────────────────────────────────────────────────────

    createBellGeometry() {
        this.body = new CryptosuchusGeometry();
        this.body.createGeometry(Medusa.uniforms.bassIntensity);
        this.transformationObject.add(this.body.object);
        this.transformationObject.scale.setScalar(Cryptosuchus.BASE_SCALE);
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
    // UPDATE
    // ─────────────────────────────────────────────────────────────────────────

    async update(delta, elapsed) {
        if (!this.isActive) {
            if (this.needsPositionUpdate) this.needsPositionUpdate = false;
            return;
        }

        this.time += delta * (1.0
            + noise2D(this.noiseSeed, elapsed * 0.02) * 0.05
            + this.charge * 0.12);

        this.phase = ((this.time * 0.06) % 1.0) * Math.PI * 2;

        const bassIntensity = Medusa.uniforms.bassIntensity?.value ?? 0;

        this.body.updateAnimation(delta, bassIntensity);

        this._swimPosition(delta);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POSICIÓN
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
            if (this.transformationObject.position.distanceTo(this.scatterTarget) < 5.0) {
                this.isScattering = false;
            }

        } else {
            currentTarget = this.targetPosition;
        }

        const pos = this.transformationObject.position;
        _dirVec.subVectors(currentTarget, pos);
        const distToTarget = _dirVec.length();

        if (distToTarget > 2.0) {
            _dirVec.normalize();
            _targetQuat.setFromUnitVectors(_upVec, _dirVec);
            this.transformationObject.quaternion.slerp(
                _targetQuat,
                delta * Cryptosuchus.TURN_SPEED
            );
        }

        const brakeFactor = Math.min(1.0, distToTarget / 7.0);
        const speed = (Cryptosuchus.SWIM_SPEED * brakeFactor + this.charge * 0.25) * delta;

        _fwdVec.set(0, speed, 0).applyQuaternion(this.transformationObject.quaternion);

        _rightVec.crossVectors(_upVec, _fwdVec);
        if (_rightVec.lengthSq() > 1e-6) _rightVec.normalize();

        const swayV = Math.sin(this.time * Cryptosuchus.SWAY_FREQ) * Cryptosuchus.SWAY_RATE * delta;
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
        await CryptosuchusGeometry.loadStatic();
    }

    static updateStatic() { }
}

// ── Buffers temporales de módulo ─────────────────────────────────────────────
const _targetQuat = new THREE.Quaternion();
const _upVec      = new THREE.Vector3(0, 1, 0);
const _dirVec     = new THREE.Vector3();
const _fwdVec     = new THREE.Vector3();
const _rightVec   = new THREE.Vector3();
