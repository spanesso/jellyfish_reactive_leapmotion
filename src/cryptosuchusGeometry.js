import * as THREE from "three/webgpu";
import { Fn, vec4, float, mrt } from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import cryptosuchusModelUrl from "./animals_3d/cryptosuchus.glb?url";

/**
 * CryptosuchusGeometry
 *
 * Carga y gestiona el modelo GLB del cryptosuchus (cryptosuchus.glb).
 * Animal jefe: el más grande del acuario, aparece después de 2 arctic_rays.
 *
 * Audio reactivity:
 *   - mixer.timeScale modulado por bassIntensity → movimiento sincronizado con graves.
 *   - emissiveNode: brillo verde-bioluminiscente profundo reactivo al bass.
 *   - mrtNode: bloom reactivo al bass, el más intenso de todos.
 *   - Micro-pulso de escala sincronizado con beats de bajo.
 */
export class CryptosuchusGeometry {

    static MODEL_ROTATION_X = Math.PI / 2;
    static MODEL_ROTATION_Y = Math.PI;
    static MODEL_ROTATION_Z = 0;

    static _gltfData    = null;
    static _loadPromise = null;

    // ─────────────────────────────────────────────────────────────────────────
    // CARGA ESTÁTICA (singleton async)
    // ─────────────────────────────────────────────────────────────────────────

    static loadStatic() {
        if (CryptosuchusGeometry._loadPromise) return CryptosuchusGeometry._loadPromise;

        CryptosuchusGeometry._loadPromise = new Promise((resolve, reject) => {
            const loader = new GLTFLoader();
            loader.load(
                cryptosuchusModelUrl,
                (gltf) => {
                    CryptosuchusGeometry._gltfData = gltf;
                    console.log(
                        `[CryptosuchusGeometry] Modelo cargado (cryptosuchus.glb). ` +
                        `Animaciones: ${gltf.animations.length}`
                    );
                    resolve(gltf);
                },
                undefined,
                (err) => {
                    console.error('[CryptosuchusGeometry] Error al cargar cryptosuchus.glb:', err);
                    reject(err);
                }
            );
        });

        return CryptosuchusGeometry._loadPromise;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CONSTRUCTOR
    // ─────────────────────────────────────────────────────────────────────────

    constructor() {
        this.object      = new THREE.Object3D();
        this.mixer       = null;
        this._sceneClone = null;
        this._actions    = [];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INSTANCIACIÓN DE GEOMETRÍA
    // ─────────────────────────────────────────────────────────────────────────

    createGeometry(bassIntensityUniform) {
        if (!CryptosuchusGeometry._gltfData) {
            console.error(
                '[CryptosuchusGeometry] loadStatic() debe completarse antes de createGeometry().'
            );
            return;
        }

        const clone = SkeletonUtils.clone(CryptosuchusGeometry._gltfData.scene);

        clone.rotation.set(
            CryptosuchusGeometry.MODEL_ROTATION_X,
            CryptosuchusGeometry.MODEL_ROTATION_Y,
            CryptosuchusGeometry.MODEL_ROTATION_Z
        );

        const clonedMaterialsMap = new Map();

        clone.traverse(child => {
            if (!child.isMesh) return;

            child.frustumCulled = false;

            if (!child.material) return;

            const origUUID = child.material.uuid;
            if (!clonedMaterialsMap.has(origUUID)) {
                const cloned = child.material.clone();

                if (cloned.isNodeMaterial) {
                    // Verde bioluminiscente profundo — presencia imponente
                    cloned.emissiveNode = Fn(() =>
                        vec4(0.1, 1.0, 0.5, 1.0).rgb.mul(bassIntensityUniform).mul(float(6.0))
                    )();

                    cloned.mrtNode = mrt({
                        bloomIntensity: Fn(() =>
                            vec4(
                                float(0.10).add(bassIntensityUniform.mul(float(5.0))),
                                float(0.0),
                                float(0.0),
                                float(1.0)
                            )
                        )()
                    });
                }

                clonedMaterialsMap.set(origUUID, cloned);
            }
            child.material = clonedMaterialsMap.get(origUUID);
        });

        this.object.add(clone);
        this._sceneClone = clone;

        const clips = CryptosuchusGeometry._gltfData.animations;
        if (clips && clips.length > 0) {
            this.mixer = new THREE.AnimationMixer(clone);
            clips.forEach(clip => {
                const action = this.mixer.clipAction(clip);
                action.play();
                this._actions.push(action);
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ANIMACIÓN
    // ─────────────────────────────────────────────────────────────────────────

    updateAnimation(delta, bassIntensity) {
        if (this.mixer) {
            this.mixer.timeScale = 1.0 + bassIntensity * 1.2;
            this.mixer.update(delta);
        }

        if (this._sceneClone) {
            const pulse = 1.0 + bassIntensity * 0.07;
            this._sceneClone.scale.setScalar(pulse);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LIMPIEZA
    // ─────────────────────────────────────────────────────────────────────────

    dispose() {
        if (this.mixer) {
            this.mixer.stopAllAction();
            if (this._sceneClone) {
                this.mixer.uncacheRoot(this._sceneClone);
            }
        }
        this._actions = [];
    }
}
