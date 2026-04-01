import * as THREE from "three/webgpu";
import { Fn, vec4, float, mrt } from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import alienFishModelUrl from "./animals_3d/alien_fish_animated.glb?url";

/**
 * AlienFishGeometry
 *
 * Carga y gestiona el modelo GLB del pez alienígena (alien_fish_animated.glb).
 * Reutiliza la animación propia del modelo a través de THREE.AnimationMixer.
 *
 * Convención de ejes (compatible con Medusa / Shark):
 *   +Y = cabeza / dirección de avance
 *   -Y = cola
 *
 * Si el modelo GLB está orientado en una dirección distinta, ajustar
 * MODEL_ROTATION_X/Y/Z antes de crear instancias.
 *
 * Audio reactivity:
 *   - mixer.timeScale se modula con bassIntensity → el pez nada más rápido en graves.
 *   - emissiveNode en materiales: brillo cian/alienígena reactivo al bass.
 *   - mrtNode: bloom reactivo al bass.
 *   - Micro-pulso de escala sincronizado con beats de bajo.
 *
 * Patrón de uso:
 *   1. await AlienFishGeometry.loadStatic();   // una vez al inicio de la app
 *   2. const geo = new AlienFishGeometry();
 *      geo.createGeometry(Medusa.uniforms.bassIntensity);
 *   3. En cada frame: geo.updateAnimation(delta, bassIntensity);
 */
export class AlienFishGeometry {

    // ── Rotación de ajuste del modelo ─────────────────────────────────────────
    // Los modelos GLB típicamente apuntan en -Z. Rotamos π/2 en X para que
    // la cabeza apunte en +Y (eje de avance de Medusa/Shark).
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

    /**
     * Carga el modelo GLB una única vez.
     * Llamar con `await` en AlienFish.initStatic() antes de crear instancias.
     * Llamadas posteriores retornan la misma Promise ya resuelta.
     * @returns {Promise<GLTF>}
     */
    static loadStatic() {
        if (AlienFishGeometry._loadPromise) return AlienFishGeometry._loadPromise;

        AlienFishGeometry._loadPromise = new Promise((resolve, reject) => {
            const loader = new GLTFLoader();
            loader.load(
                alienFishModelUrl,
                (gltf) => {
                    AlienFishGeometry._gltfData = gltf;
                    console.log(
                        `[AlienFishGeometry] Modelo cargado. ` +
                        `Animaciones: ${gltf.animations.length}`
                    );
                    resolve(gltf);
                },
                undefined,
                (err) => {
                    console.error('[AlienFishGeometry] Error al cargar alien_fish_animated.glb:', err);
                    reject(err);
                }
            );
        });

        return AlienFishGeometry._loadPromise;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CONSTRUCTOR
    // ─────────────────────────────────────────────────────────────────────────

    constructor() {
        /** Raíz de la jerarquía; se añade a transformationObject en AlienFish. */
        this.object       = new THREE.Object3D();
        this.mixer        = null;
        this._sceneClone  = null;   // clon de gltf.scene para esta instancia
        this._actions     = [];     // AnimationActions activas
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INSTANCIACIÓN DE GEOMETRÍA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Clona la escena del GLB y configura el AnimationMixer para esta instancia.
     * Debe llamarse DESPUÉS de que AlienFishGeometry.loadStatic() haya resuelto.
     *
     * @param {THREE.UniformNode} bassIntensityUniform
     *   Uniform TSL compartido con las medusas (Medusa.uniforms.bassIntensity).
     *   Se usa en emissiveNode y mrtNode para bloom audio-reactivo.
     */
    createGeometry(bassIntensityUniform) {
        if (!AlienFishGeometry._gltfData) {
            console.error(
                '[AlienFishGeometry] loadStatic() debe completarse antes de createGeometry().'
            );
            return;
        }

        // SkeletonUtils.clone maneja correctamente skinning y jerarquías de huesos.
        const clone = SkeletonUtils.clone(AlienFishGeometry._gltfData.scene);

        // Orientar el modelo para que su dirección de avance sea +Y
        clone.rotation.set(
            AlienFishGeometry.MODEL_ROTATION_X,
            AlienFishGeometry.MODEL_ROTATION_Y,
            AlienFishGeometry.MODEL_ROTATION_Z
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
                    // Color cian-alienígena que pulsa con el bass
                    cloned.emissiveNode = Fn(() =>
                        vec4(0.4, 1.0, 0.9, 1.0).rgb.mul(bassIntensityUniform).mul(float(4.0))
                    )();

                    cloned.mrtNode = mrt({
                        bloomIntensity: Fn(() =>
                            vec4(
                                float(0.06).add(bassIntensityUniform.mul(float(3.5))),
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

        // ── Configurar AnimationMixer ────────────────────────────────────────
        const clips = AlienFishGeometry._gltfData.animations;
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
    // ANIMACIÓN — llamar cada paso de física desde AlienFish.update()
    //
    // delta         : duración del paso en segundos (≈ 1/360)
    // bassIntensity : 0.0–1.0, intensidad del bajo leída del uniform compartido
    // ─────────────────────────────────────────────────────────────────────────

    updateAnimation(delta, bassIntensity) {
        // Audio reactivity 1: aceleración del ciclo de animación en beats de grave
        if (this.mixer) {
            this.mixer.timeScale = 1.0 + bassIntensity * 2.2;
            this.mixer.update(delta);
        }

        // Audio reactivity 2: micro-pulso de escala sincronizado con el bajo
        if (this._sceneClone) {
            const pulse = 1.0 + bassIntensity * 0.12;
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
