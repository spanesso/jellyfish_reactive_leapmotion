import * as THREE from "three/webgpu";
import {pass, mrt, output, float, vec4, Fn, clamp, vec3} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls";
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

import { Lights } from "./lights";
import { conf } from "./conf";
import { Info } from "./info";
import { VerletPhysics } from "./physics/verletPhysics";
import { VertexVisualizer } from "./physics/vertexVisualizer";
import {SpringVisualizer} from "./physics/springVisualizer";
import {Medusa} from "./medusa";
import {Lionfish} from "./lionfish";
import {AnimalFactory} from "./animalFactory";
import {MedusaVerletBridge} from "./medusaVerletBridge";
import {Background} from "./background";
import {Plankton} from "./plankton";
import {Godrays} from "./godrays";
// [AUDIO REACTIVITY] Módulo de análisis de frecuencias graves en tiempo real.
import {AudioReactivity} from "./audioReactivity";

class App {
    renderer = null;
    camera = null;
    scene = null;
    controls = null;
    lights = null;
    stats = null;
    physics = null;
    vertexVisualizer = null;
    springVisualizer = null;
    frameNum = 0;

    MAX_JELLYFISH = 22;
    MAX_LIONFISH = 8;
    medusaPool = [];
    lionfishPool = [];

    timeNearCursor = 0;
    SPAWN_THRESHOLD_SECONDS = 3.0;
    NEARBY_DISTANCE = 2.5;
    isSpawning = false;

    /*CAMBIO*/
    // Variables para la nueva lógica de circling.
    lastSpawnPosition = new THREE.Vector3(Infinity, Infinity, Infinity); // Posición inicial lejana.
    cursorHasMoved = true; // Empezar asumiendo que el cursor se ha "movido".
    CURSOR_MOVE_THRESHOLD = 1.0; // Distancia para considerar que el cursor se movió.
    /*CAMBIO*/

    constructor(renderer){
        console.time("firstFrame");
        this.renderer = renderer;
        this.mouseWorldPosition = new THREE.Vector3();
        this.mousePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        // [AUDIO REACTIVITY] Instancia del analizador de bass.
        this.audioReactivity = new AudioReactivity();
    }

    async init(progressCallback) {
        // ... (resto del init sin cambios)
        conf.init();
        this.info = new Info();
        this.renderer.init();
        this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.01, 30);
        this.camera.position.set(0, 0, 15);
        this.camera.lookAt(0, 0, 0);
        this.camera.updateProjectionMatrix();
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.minPolarAngle = Math.PI * 0.25;
        this.controls.maxPolarAngle = Math.PI * 0.75;
        this.controls.minDistance = 8;
        this.controls.maxDistance = 25;
        this.controls.enablePan = false;
        await progressCallback(0.1);
        this.physics = new VerletPhysics(this.renderer);
        await progressCallback(0.3);
        this.lights = new Lights();
        this.scene.add(this.lights.object);
        this.background = new Background(this.renderer);
        this.scene.environmentNode = Background.envFunction;
        this.scene.environmentIntensity = 0.3;
        this.scene.backgroundNode = Background.fogFunction;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        await progressCallback(0.4);
        await Medusa.initStatic(this.physics);
        await Lionfish.initStatic();
        await progressCallback(0.5);
        this.bridge = new MedusaVerletBridge(this.physics);
        // Registrar PRIMERO todas las medusas para que sus IDs en el bridge
        // sean contiguos y el bake de vértices Verlet funcione correctamente.
        for (let i = 0; i < this.MAX_JELLYFISH; i++) {
            const medusa = new Medusa(this.renderer, this.physics, this.bridge);
            this.scene.add(medusa.object);
            this.physics.addObject(medusa);
            this.medusaPool.push(medusa);
        }
        // Registrar lionfish DESPUÉS — 0 vértices Verlet, el bridge lo maneja.
        for (let i = 0; i < this.MAX_LIONFISH; i++) {
            const lf = new Lionfish(this.renderer, this.physics, this.bridge);
            this.scene.add(lf.object);
            this.physics.addObject(lf);
            this.lionfishPool.push(lf);
        }
        this.physics.addObject(this.bridge);
        await progressCallback(0.6);
        await this.physics.bake();
        await progressCallback(0.7);
        this.medusaPool.forEach((medusa, index) => {
            if (index < 2) {
                medusa.activate(new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, 0));
            } else {
                medusa.deactivate();
            }
        });
        this.lionfishPool.forEach(lf => lf.deactivate());
        this.vertexVisualizer = new VertexVisualizer(this.physics);
        this.springVisualizer = new SpringVisualizer(this.physics);
        this.scene.add(this.springVisualizer.object);
        await progressCallback(0.8);
        this.plankton = new Plankton();
        this.scene.add(this.plankton.object);
        await progressCallback(0.9);
        this.godrays = new Godrays(this.bridge);
        this.scene.add(this.godrays.object);
        const scenePass = pass(this.scene, this.camera);
        scenePass.setMRT(mrt({ output, bloomIntensity: float(0) }));
        const outputPass = scenePass.getTextureNode();
        const bloomIntensityPass = scenePass.getTextureNode('bloomIntensity');
        const bloomPass = bloom(Fn(() => {
            const bloomIntensity = bloomIntensityPass.r;
            const charge = bloomIntensityPass.g;
            const colorMask = vec3(1.0 - charge * 0.5, 1.0 - charge, 1.0);
            return vec4(outputPass.rgb.mul(bloomIntensity).mul(colorMask), 1);
        })());
        const postProcessing = new THREE.PostProcessing(this.renderer);
        postProcessing.outputColorTransform = false;
        postProcessing.outputNode = Fn(() => {
            const bloomIntensity = bloomIntensityPass.r;
            const charge = bloomIntensityPass.g;
            const bloomMask = (1.0 - clamp(bloomIntensity, 0, 1)).add(charge);
            const finalBloom = bloomPass.rgb.mul(clamp(bloomMask, 0, 1));
            return vec4(outputPass.rgb.add(finalBloom.rgb), 1.0).renderOutput();
        })();
        this.postProcessing = postProcessing;
        this.bloomPass = bloomPass;
        this.bloomPass.threshold.value = 0.001;
        this.bloomPass.strength.value = 0.4;
        this.bloomPass.radius.value = 0.8;
        this.raycaster = new THREE.Raycaster();
        this.renderer.domElement.addEventListener("mousemove", (event) => { this.onMouseMove(event); });

        // [AUDIO REACTIVITY] Registra el listener de primera interacción para solicitar
        // el micrófono en cuanto el usuario haga click o toque la pantalla.
        // No bloquea la carga — el permiso se pide de forma asíncrona.
        this.audioReactivity.initOnInteraction();

        await progressCallback(1.0, 100);
    }
    
    /**
     * Activa la primera entidad inactiva del tipo indicado.
     * @param {'jellyfish'|'lionfish'} type
     * @param {THREE.Vector3} spawnPosition
     */
    activateNextEntity(type, spawnPosition) {
        const pool = type === 'lionfish' ? this.lionfishPool : this.medusaPool;
        for (const entity of pool) {
            if (!entity.isActive) {
                entity.activate(spawnPosition);
                return;
            }
        }
    }

    scatterAllActiveEntities() {
        this.medusaPool.concat(this.lionfishPool).forEach(entity => {
            if (entity.isActive) entity.scatter();
        });
    }

    onMouseMove(event) {
        const pointer = new THREE.Vector2();
        pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(pointer, this.camera);
        this.physics.setMouseRay(this.raycaster.ray.origin, this.raycaster.ray.direction);
        this.raycaster.ray.intersectPlane(this.mousePlane, this.mouseWorldPosition);

        /*CAMBIO*/
        // Comprobar si el cursor se ha movido de la última posición de spawn.
        if (!this.cursorHasMoved && this.mouseWorldPosition.distanceTo(this.lastSpawnPosition) > this.CURSOR_MOVE_THRESHOLD) {
            this.cursorHasMoved = true;
            // Si se mueve, ordenar a todas las entidades que dejen de rodear y vuelvan a seguir.
            this.medusaPool.concat(this.lionfishPool).forEach(entity => {
                if (entity.isActive) entity.stopCircling();
            });
        }
        /*CAMBIO*/
    }

    resize(width, height) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }
    
    updateMouseInteractions() {
        this.medusaPool.concat(this.lionfishPool).forEach(entity => {
            if (entity.isActive) {
                entity.updatePointerInteraction(this.raycaster.ray);
                entity.setTarget(this.mouseWorldPosition);
            }
        });
    }

    sortMedusae() {
        this.bridge.medusae.forEach(entity => {
            entity.distance = entity.isActive
                ? this.camera.position.distanceTo(entity.transformationObject.position)
                : Infinity;
        });
        const sorted = [...this.bridge.medusae].sort((a, b) => a.distance - b.distance);
        let z = 10;
        for (const entity of sorted) {
            if (!entity.isActive) continue;
            z = entity.setRenderOrder(z);
        }
    }

    async update(delta, elapsed) {
        conf.begin();
        // ... (código de update sin cambios hasta la lógica de spawn)
        const { runSimulation, showVerletSprings } = conf;
        this.springVisualizer.object.visible = showVerletSprings;
        conf.update();
        this.controls.update(delta);
        Medusa.updateStatic();
        this.background.update(elapsed);
        this.lights.update(elapsed);
        this.updateMouseInteractions();

        const activeEntities = this.medusaPool.concat(this.lionfishPool).filter(e => e.isActive);
        const totalMax = this.MAX_JELLYFISH + this.MAX_LIONFISH;
        if (activeEntities.length > 0 && activeEntities.length < totalMax) {
            const averagePosition = new THREE.Vector3();
            activeEntities.forEach(e => averagePosition.add(e.transformationObject.position));
            averagePosition.divideScalar(activeEntities.length);
            const dist = averagePosition.distanceTo(this.mouseWorldPosition);

            if (dist < this.NEARBY_DISTANCE) {
                this.timeNearCursor += delta;
            } else {
                this.timeNearCursor = 0;
            }

            if (!this.isSpawning && this.timeNearCursor > this.SPAWN_THRESHOLD_SECONDS) {
                if (this.cursorHasMoved) {
                    // --- CASO 1: El cursor se ha movido -> Crear nueva entidad.
                    this.isSpawning = true;
                    this.timeNearCursor = 0;

                    // AnimalFactory decide si la siguiente es medusa o lionfish.
                    const nextType = AnimalFactory.getNextType();
                    this.activateNextEntity(nextType, averagePosition);
                    this.scatterAllActiveEntities();

                    this.lastSpawnPosition.copy(this.mouseWorldPosition);
                    this.cursorHasMoved = false;

                    setTimeout(() => { this.isSpawning = false; }, 1000);
                } else {
                    // --- CASO 2: El cursor NO se ha movido -> Iniciar circling.
                    activeEntities.forEach(e => e.startCircling(this.lastSpawnPosition));
                }
            }
        }

        if (runSimulation) {
            await this.physics.update(delta, elapsed);
        }
        this.sortMedusae();

        // [AUDIO REACTIVITY] Actualizar el análisis de bass y propagar la
        // intensidad al uniform TSL compartido por todos los materiales de medusa.
        this.audioReactivity.update();
        Medusa.uniforms.bassIntensity.value = this.audioReactivity.bassIntensity;

        await this.postProcessing.renderAsync();

        if (this.frameNum === 0) {
            console.timeEnd("firstFrame");
        }
        this.frameNum++;
        conf.end();
    }
}
export default App;