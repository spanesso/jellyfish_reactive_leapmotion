import * as THREE from "three/webgpu";
import {iridescenceIOR, uniform} from "three/tsl";
import {noise2D, noise3D} from "./common/noise";
import {MedusaTentacles} from "./medusaTentacles";
import {MedusaBell} from "./medusaBell";
import {conf} from "./conf";
import {MedusaOralArms} from "./medusaOralArms";
import {MedusaBellGeometry} from "./medusaBellGeometry";
import {MedusaBellPattern} from "./medusaBellPattern";

const targetQuaternion = new THREE.Quaternion();
const upVector = new THREE.Vector3(0, 1, 0);

export class Medusa {
    type = 'jellyfish';
    renderer = null;
    physics = null;
    object = null;
    bridge = null;
    medusaId = -1;
    noiseSeed = 0;
    time = 0;
    phase = 0;
    needsPositionUpdate = true;
    charge = 0;
    static uniforms = {};
    targetPosition = null;
    isScattering = false;
    scatterTarget = new THREE.Vector3();
    isActive = false;

    isCircling = false;
    circlingCenter = new THREE.Vector3();
    circlingRadius = 0;
    circlingAngle = 0;
    circlingSpeed = 0;
    circleTargetPosition = new THREE.Vector3(); 

    constructor(renderer, physics, bridge){
        this.renderer = renderer;
        this.physics = physics;
        this.object = new THREE.Object3D();
        this.transformationObject = new THREE.Object3D();
        this.object.add(this.transformationObject);
        this.time = Math.random() * 5;
        this.noiseSeed = Math.random() * 100.0;
        this.bridge = bridge;
        this.medusaId = this.bridge.registerMedusa(this);
        this.transformationObject.position.set(0, 0, 0);
        this.targetPosition = new THREE.Vector3();
        this.targetPosition.copy(this.transformationObject.position);
        this.createBellGeometry();
    }

    activate(spawnPosition) {
        this.isActive = true;
        this.object.visible = true;
        this.isScattering = false;
        this.isCircling = false;
        this.transformationObject.position.copy(spawnPosition || new THREE.Vector3(0, 0, 0));
        this.targetPosition.copy(this.transformationObject.position);
        this.needsPositionUpdate = true; 
    }

    deactivate() {
        this.isActive = false;
        this.object.visible = false;
        this.transformationObject.position.set(0, -1000, 0); 
        this.needsPositionUpdate = true;
    }

    createBellGeometry() {
        this.subdivisions = 40;
        this.bell = new MedusaBell(this);
        this.tentacles = new MedusaTentacles(this);
        this.arms = new MedusaOralArms(this);
        this.bell.createGeometry();
        this.tentacles.createGeometry();
        this.arms.createGeometry();
        this.object.add(this.bell.object);
        this.object.add(this.tentacles.object);
        this.object.add(this.arms.object);
    }

    async bake() { }

    /**
     * Polimorfismo para render ordering.
     * Llamado desde sortMedusae() en app.js.
     * @param {number} z - renderOrder de inicio
     * @returns {number} - siguiente z disponible
     */
    setRenderOrder(z) {
        this.bell.geometryInside.object.renderOrder = z++;
        this.arms.object.renderOrder = z++;
        this.tentacles.object.renderOrder = z++;
        this.bell.geometryOutside.object.renderOrder = z++;
        return z;
    }

    setTarget(target) {
        if (this.isScattering || this.isCircling || !target) {
            return;
        }
        this.targetPosition.copy(target);
    }

    scatter() {
        this.isScattering = true;
        this.isCircling = false;
        this.scatterTarget.set(
            (Math.random() - 0.5) * 20,
            (Math.random() * 15) - 20,
            (Math.random() - 0.5) * 15
        );
    }
    
    startCircling(centerPoint) {
        if (this.isCircling) return;

        this.isCircling = true;
        this.isScattering = false;
        this.circlingCenter.copy(centerPoint);
        
        /*CAMBIO*/
        // Se aumentó el radio base y el aleatorio para una órbita más distante.
        // Antes: 3 + Math.random() * 4  (rango de 3 a 7)
        // Ahora: 6 + Math.random() * 6  (rango de 6 a 12)
        this.circlingRadius = 6 + Math.random() * 6;
        /*CAMBIO*/
        
        this.circlingAngle = Math.atan2(
            this.transformationObject.position.z - this.circlingCenter.z,
            this.transformationObject.position.x - this.circlingCenter.x
        );
        this.circlingSpeed = 0.2 + Math.random() * 0.3;
    }

    stopCircling() {
        this.isCircling = false;
    }

    updatePosition(delta, elapsed) {
        let currentTarget;
        
        if (this.isCircling) {
            this.circlingAngle += this.circlingSpeed * delta;
            const offsetX = Math.cos(this.circlingAngle) * this.circlingRadius;
            const offsetZ = Math.sin(this.circlingAngle) * this.circlingRadius;
            
            this.circleTargetPosition.set(
                this.circlingCenter.x + offsetX,
                this.circlingCenter.y,
                this.circlingCenter.z + offsetZ
            );
            currentTarget = this.circleTargetPosition;
        } else if (this.isScattering) {
            currentTarget = this.scatterTarget;
        } else {
            currentTarget = this.targetPosition;
        }

        const direction = new THREE.Vector3().subVectors(currentTarget, this.transformationObject.position);
        const distanceToTarget = direction.length();

        if (distanceToTarget > 0.5) {
            direction.normalize();
            targetQuaternion.setFromUnitVectors(upVector, direction);
            this.transformationObject.quaternion.slerp(targetQuaternion, delta * 0.8);
        }

        if (this.isScattering && distanceToTarget < 1.5) {
            this.isScattering = false;
        }

        const speed = (1.0 + Math.sin(this.phase + 4.4) * 0.35 + this.charge * 1.0) * delta;
        const offset = new THREE.Vector3(0,speed,0).applyQuaternion(this.transformationObject.quaternion);

        this.transformationObject.position.add(offset);
        if (this.transformationObject.position.y > 20) {
            this.transformationObject.position.set((Math.random() - 0.5) * 10, -25, (Math.random() - 0.5) * 10);
            this.needsPositionUpdate = true;
        }

        this.transformationObject.updateMatrix();
    }

    updatePointerInteraction(ray) {
        const dist = ray.distanceToPoint(this.transformationObject.position);
        this.charge += (1 - Math.min(Math.max(0, dist - 0.5), 1)) * 0.05;
        this.charge = Math.min(this.charge, 1.00);
        this.charge *= 0.95;
    }

    async update(delta, elapsed) {
        if (!this.isActive) {
            if(this.needsPositionUpdate) { this.needsPositionUpdate = false; }
            return;
        }
        this.time += delta * (1.0 + noise2D(this.noiseSeed, elapsed*0.1) * 0.1 + this.charge * 0.5);
        this.phase = ((this.time * 0.2) % 1.0) * Math.PI * 2;
        this.updatePosition(delta, elapsed);
    }
    
    static async initStatic(physics) {
        Medusa.uniforms.matrix = uniform(new THREE.Matrix4());
        Medusa.uniforms.phase = uniform(0);
        Medusa.uniforms.charge = uniform(0);
        // [AUDIO REACTIVITY] Intensidad del bass (0.0–1.0), actualizada por AudioReactivity cada frame.
        Medusa.uniforms.bassIntensity = uniform(0);
        MedusaBellPattern.createColorNode();
        MedusaBellGeometry.createMaterial(physics);
        MedusaTentacles.createMaterial(physics);
        MedusaOralArms.createMaterial(physics);
    }
    static setMouseRay(ray) { }
    static updateStatic() {
        const { roughness } = conf;
        MedusaBellGeometry.materialInner.roughness = roughness;
        MedusaBellGeometry.materialOuter.roughness = roughness;
    }
}