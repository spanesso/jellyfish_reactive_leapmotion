// /CAMBIO/ Nuevo archivo: gestiona la carga del GLB del tiburón y su animación.
import * as THREE from "three/webgpu";
import { Fn, vec4, float, mrt } from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import sharkModelUrl from "./animals_3d/shark.glb?url";

/**
 * SharkGeometry
 *
 * Carga y gestiona el modelo GLB del tiburón (shark.glb).
 * Reutiliza la animación propia del modelo (swimming cycle) a través de
 * THREE.AnimationMixer.
 *
 * Convención de ejes (compatible con Medusa / Lionfish):
 *   +Y = cabeza / dirección de avance
 *   -Y = cola
 *
 * Si el modelo GLB está orientado en una dirección distinta, ajustar
 * SharkGeometry.MODEL_ROTATION_X/Y/Z antes de crear instancias.
 *
 * Audio reactivity:
 *   - mixer.timeScale se modula con bassIntensity → el tiburón nada más rápido
 *     en los graves.
 *   - mrtNode en los materiales: contribución al bloom reactiva al bass.
 *   - Micro-pulso de escala en la geometría sincronizado con beats de bajo.
 *
 * Patrón de uso:
 *   1. await SharkGeometry.loadStatic();   // una vez al inicio de la app
 *   2. const geo = new SharkGeometry();
 *      geo.createGeometry(Medusa.uniforms.bassIntensity);
 *   3. En cada frame: geo.updateAnimation(delta, bassIntensity);
 */
export class SharkGeometry {

    // ── Rotación de ajuste del modelo ─────────────────────────────────────────
    // Los modelos GLB típicamente apuntan en -Z.  Rotamos π/2 en X para que
    // la cabeza apunte en +Y (eje de avance de Medusa/Lionfish).
    // Ajustar si el modelo específico requiere otra orientación.
    // /CAMBIO/ Cola hacia adelante → añadir π en Y invierte la dirección cabeza/cola.
    // El tiburón apuntaba en +Z con la cola al frente; al rotar π en Y queda la
    // cabeza en +Y (eje de avance del sistema Medusa/Lionfish).
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
     * Llamar con `await` en Shark.initStatic() antes de crear instancias.
     * Llamadas posteriores retornan la misma Promise ya resuelta.
     * @returns {Promise<GLTF>}
     */
    static loadStatic() {
        if (SharkGeometry._loadPromise) return SharkGeometry._loadPromise;

        SharkGeometry._loadPromise = new Promise((resolve, reject) => {
            const loader = new GLTFLoader();
            loader.load(
                sharkModelUrl,
                (gltf) => {
                    SharkGeometry._gltfData = gltf;
                    console.log(
                        `[SharkGeometry] Modelo cargado. ` +
                        `Animaciones: ${gltf.animations.length}`
                    );
                    resolve(gltf);
                },
                undefined,
                (err) => {
                    console.error('[SharkGeometry] Error al cargar shark.glb:', err);
                    reject(err);
                }
            );
        });

        return SharkGeometry._loadPromise;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CONSTRUCTOR
    // ─────────────────────────────────────────────────────────────────────────

    constructor() {
        /** Raíz de la jerarquía; se añade a transformationObject en Shark. */
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
     * Debe llamarse DESPUÉS de que SharkGeometry.loadStatic() haya resuelto.
     *
     * @param {THREE.UniformNode} bassIntensityUniform
     *   Uniform TSL compartido con las medusas (Medusa.uniforms.bassIntensity).
     *   Se usa en el mrtNode de cada material para bloom audio-reactivo.
     */
    createGeometry(bassIntensityUniform) {
        if (!SharkGeometry._gltfData) {
            console.error(
                '[SharkGeometry] loadStatic() debe completarse antes de createGeometry().'
            );
            return;
        }

        // SkeletonUtils.clone maneja correctamente skinning y jerarquías de huesos.
        const clone = SkeletonUtils.clone(SharkGeometry._gltfData.scene);

        // Orientar el modelo para que su dirección de avance sea +Y
        clone.rotation.set(
            SharkGeometry.MODEL_ROTATION_X,
            SharkGeometry.MODEL_ROTATION_Y,
            SharkGeometry.MODEL_ROTATION_Z
        );

        // Recorrer todos los meshes: deshabilitar frustum culling y configurar materiales
        const clonedMaterialsMap = new Map(); // uuid original → material clonado

        clone.traverse(child => {
            if (!child.isMesh) return;

            // Evitar que el frustum culling oculte el modelo cuando la cámara rota
            child.frustumCulled = false;

            if (!child.material) return;

            // Clonar el material una única vez por UUID para no modificar el original
            // ni crear duplicados innecesarios entre meshes que comparten material.
            const origUUID = child.material.uuid;
            if (!clonedMaterialsMap.has(origUUID)) {
                const cloned = child.material.clone();

                // Añadir mrtNode solo si el material es un NodeMaterial
                // (Three.js WebGPU con GLTFLoader usa MeshStandardNodeMaterial / MeshPhysicalNodeMaterial).
                if (cloned.isNodeMaterial) {
                    // /CAMBIO/ emissiveNode: el tiburón emite luz propia al detectar bass,
                    // igual que las medusas. Sin esto el objeto no brilla visualmente.
                    cloned.emissiveNode = Fn(() =>
                        vec4(1.0, 0.95, 0.85, 1.0).rgb.mul(bassIntensityUniform).mul(float(3.0))
                    )();

                    cloned.mrtNode = mrt({
                        // bloomIntensity reactiva al bass: halo de bloom exterior
                        bloomIntensity: Fn(() =>
                            vec4(
                                float(0.04).add(bassIntensityUniform.mul(float(3.0))),
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
        const clips = SharkGeometry._gltfData.animations;
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
    // ANIMACIÓN — llamar cada paso de física desde Shark.update()
    //
    // delta         : duración del paso en segundos (≈ 1/360)
    // bassIntensity : 0.0–1.0, intensidad del bajo leída del uniform compartido
    // ─────────────────────────────────────────────────────────────────────────

    updateAnimation(delta, bassIntensity) {
        // Audio reactivity 1: aceleración del ciclo de nado en beats de grave
        if (this.mixer) {
            this.mixer.timeScale = 1.0 + bassIntensity * 1.8;
            this.mixer.update(delta);
        }

        // Audio reactivity 2: micro-pulso de escala de la geometría
        // Se aplica sobre _sceneClone para no interferir con la escala del
        // transformationObject (que controla el tamaño global en la escena).
        if (this._sceneClone) {
            const pulse = 1.0 + bassIntensity * 0.10;
            this._sceneClone.scale.setScalar(pulse);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LIMPIEZA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Liberar recursos del AnimationMixer.
     * Llamar si la instancia se destruye en runtime.
     */
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
