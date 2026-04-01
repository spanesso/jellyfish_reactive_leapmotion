import * as THREE from "three/webgpu";
import { Fn, vec4, float, mrt } from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import discusModelUrl from "./animals_3d/discus_3.glb?url";

/**
 * DiscusGeometry
 *
 * Carga y gestiona el modelo GLB del pez disco (discus_3.glb).
 * Reutiliza la animación propia del modelo a través de THREE.AnimationMixer.
 *
 * Convención de ejes (compatible con Medusa / Shark / AlienFish):
 *   +Y = cabeza / dirección de avance
 *   -Y = cola
 *
 * Si el modelo GLB está orientado en una dirección distinta, ajustar
 * MODEL_ROTATION_X/Y/Z antes de crear instancias.
 *
 * Audio reactivity:
 *   - mixer.timeScale se modula con bassIntensity → animación más rápida en graves.
 *   - emissiveNode: brillo dorado-cálido reactivo al bass (igual que las medusas).
 *   - mrtNode: bloom reactivo al bass.
 *   - Micro-pulso de escala sincronizado con beats de bajo.
 */
export class DiscusGeometry {

    // ── Rotación de ajuste del modelo ─────────────────────────────────────────
    // Ajustar si el modelo específico requiere otra orientación.
    static MODEL_ROTATION_X = Math.PI / 2;
    static MODEL_ROTATION_Y = Math.PI;
    static MODEL_ROTATION_Z = 0;

    /** Datos GLTF cargados una vez; compartidos entre todas las instancias. */
    static _gltfData    = null;
    static _loadPromise = null;

    // ─────────────────────────────────────────────────────────────────────────
    // CARGA ESTÁTICA (singleton async)
    // ─────────────────────────────────────────────────────────────────────────

    static loadStatic() {
        if (DiscusGeometry._loadPromise) return DiscusGeometry._loadPromise;

        DiscusGeometry._loadPromise = new Promise((resolve, reject) => {
            const loader = new GLTFLoader();
            loader.load(
                discusModelUrl,
                (gltf) => {
                    DiscusGeometry._gltfData = gltf;
                    console.log(
                        `[DiscusGeometry] Modelo cargado. ` +
                        `Animaciones: ${gltf.animations.length}`
                    );
                    resolve(gltf);
                },
                undefined,
                (err) => {
                    console.error('[DiscusGeometry] Error al cargar discus_3.glb:', err);
                    reject(err);
                }
            );
        });

        return DiscusGeometry._loadPromise;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CONSTRUCTOR
    // ─────────────────────────────────────────────────────────────────────────

    constructor() {
        this.object       = new THREE.Object3D();
        this.mixer        = null;
        this._sceneClone  = null;
        this._actions     = [];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INSTANCIACIÓN DE GEOMETRÍA
    // ─────────────────────────────────────────────────────────────────────────

    createGeometry(bassIntensityUniform) {
        if (!DiscusGeometry._gltfData) {
            console.error(
                '[DiscusGeometry] loadStatic() debe completarse antes de createGeometry().'
            );
            return;
        }

        const clone = SkeletonUtils.clone(DiscusGeometry._gltfData.scene);

        clone.rotation.set(
            DiscusGeometry.MODEL_ROTATION_X,
            DiscusGeometry.MODEL_ROTATION_Y,
            DiscusGeometry.MODEL_ROTATION_Z
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
                    // Color dorado-cálido igual al de las medusas
                    cloned.emissiveNode = Fn(() =>
                        vec4(1.0, 0.85, 0.4, 1.0).rgb.mul(bassIntensityUniform).mul(float(3.5))
                    )();

                    cloned.mrtNode = mrt({
                        bloomIntensity: Fn(() =>
                            vec4(
                                float(0.05).add(bassIntensityUniform.mul(float(3.0))),
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

        const clips = DiscusGeometry._gltfData.animations;
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
            this.mixer.timeScale = 1.0 + bassIntensity * 2.0;
            this.mixer.update(delta);
        }

        if (this._sceneClone) {
            const pulse = 1.0 + bassIntensity * 0.11;
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
