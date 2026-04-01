import * as THREE from "three/webgpu";
import { Fn, vec4, float, mrt } from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import glowWhaleModelUrl from "./animals_3d/arctic_ray.glb?url";

/**
 * GlowWhaleGeometry
 *
 * Carga y gestiona el modelo GLB de la ballena bioluminiscente (glow_whale.glb).
 * Reutiliza la animación propia del modelo a través de THREE.AnimationMixer.
 *
 * Audio reactivity:
 *   - mixer.timeScale se modula con bassIntensity → nado más lento/rápido con el bass.
 *   - emissiveNode: brillo azul bioluminiscente intenso reactivo al bass.
 *   - mrtNode: bloom reactivo al bass.
 *   - Micro-pulso de escala sincronizado con beats de bajo.
 */
export class GlowWhaleGeometry {

    static MODEL_ROTATION_X = Math.PI / 2;
    static MODEL_ROTATION_Y = Math.PI;
    static MODEL_ROTATION_Z = 0;

    static _gltfData    = null;
    static _loadPromise = null;

    // ─────────────────────────────────────────────────────────────────────────
    // CARGA ESTÁTICA (singleton async)
    // ─────────────────────────────────────────────────────────────────────────

    static loadStatic() {
        if (GlowWhaleGeometry._loadPromise) return GlowWhaleGeometry._loadPromise;

        GlowWhaleGeometry._loadPromise = new Promise((resolve, reject) => {
            const loader = new GLTFLoader();
            loader.load(
                glowWhaleModelUrl,
                (gltf) => {
                    GlowWhaleGeometry._gltfData = gltf;
                    console.log(
                        `[GlowWhaleGeometry] Modelo cargado (arctic_ray.glb). ` +
                        `Animaciones: ${gltf.animations.length}`
                    );
                    resolve(gltf);
                },
                undefined,
                (err) => {
                    console.error('[GlowWhaleGeometry] Error al cargar arctic_ray.glb:', err);
                    reject(err);
                }
            );
        });

        return GlowWhaleGeometry._loadPromise;
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
        if (!GlowWhaleGeometry._gltfData) {
            console.error(
                '[GlowWhaleGeometry] loadStatic() debe completarse antes de createGeometry().'
            );
            return;
        }

        const clone = SkeletonUtils.clone(GlowWhaleGeometry._gltfData.scene);

        clone.rotation.set(
            GlowWhaleGeometry.MODEL_ROTATION_X,
            GlowWhaleGeometry.MODEL_ROTATION_Y,
            GlowWhaleGeometry.MODEL_ROTATION_Z
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
                    // Azul bioluminiscente profundo — la ballena brilla desde adentro
                    cloned.emissiveNode = Fn(() =>
                        vec4(0.2, 0.6, 1.0, 1.0).rgb.mul(bassIntensityUniform).mul(float(5.0))
                    )();

                    cloned.mrtNode = mrt({
                        bloomIntensity: Fn(() =>
                            vec4(
                                float(0.08).add(bassIntensityUniform.mul(float(4.0))),
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

        const clips = GlowWhaleGeometry._gltfData.animations;
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
            this.mixer.timeScale = 1.0 + bassIntensity * 1.5;
            this.mixer.update(delta);
        }

        // Pulso de escala más pronunciado por el tamaño de la ballena
        if (this._sceneClone) {
            const pulse = 1.0 + bassIntensity * 0.08;
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
