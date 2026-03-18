import * as THREE from "three/webgpu";
import {
    Fn, vec3, vec4, float,
    sin, atan, mix, smoothstep,
    positionLocal, mrt
} from "three/tsl";
import { Background } from "./background";

/**
 * LionfishGeometry
 * Cuerpo + espinas dorsales + aletas pectorales + cola.
 * Geometría estática Three.js (no usa Verlet physics).
 * Se añade a transformationObject para que Three.js gestione la transformación.
 */
export class LionfishGeometry {
    static material = null;

    static createMaterial() {
        const mat = new THREE.MeshPhysicalNodeMaterial({
            roughness: 0.45,
            metalness: 0.08,
            transparent: true,
            opacity: 0.93,
            side: THREE.DoubleSide,
        });

        // Color: rayas rojas y blancas basadas en ángulo + posición Y
        mat.colorNode = Fn(() => {
            const pos = positionLocal;
            // atan(x, y) en TSL equivale a atan2
            const angle = atan(pos.z, pos.x);
            const stripe = sin(angle.mul(9.0).add(pos.y.mul(7.0))).mul(0.5).add(0.5);
            const red   = vec3(0.85, 0.08, 0.04);
            const white = vec3(0.97, 0.92, 0.86);
            const orange = vec3(0.95, 0.45, 0.05);
            // Mezcla en dos pasos: rojo→naranja→blanco
            const midColor = mix(red, orange, smoothstep(0.3, 0.5, stripe));
            return mix(midColor, white, smoothstep(0.5, 0.7, stripe));
        })();

        // Bloom suave constante
        mat.mrtNode = mrt({
            bloomIntensity: Fn(() => vec4(float(0.12), float(0.0), float(0.0), float(1.0)))()
        });

        LionfishGeometry.material = mat;
    }

    constructor() {
        this.object = new THREE.Object3D();
    }

    createGeometry() {
        const mat = LionfishGeometry.material;

        // ── Cuerpo principal (elipsoide aplanado) ──────────────────────────
        const bodyGeo = new THREE.SphereGeometry(0.78, 18, 14);
        const bodyMesh = new THREE.Mesh(bodyGeo, mat);
        bodyMesh.scale.set(1.35, 0.88, 0.72);
        bodyMesh.frustumCulled = false;
        this.object.add(bodyMesh);

        // ── Espinas dorsales (12 conos sobre el lomo) ──────────────────────
        const SPINE_COUNT = 12;
        for (let i = 0; i < SPINE_COUNT; i++) {
            const t = i / (SPINE_COUNT - 1);
            const xPos = (t - 0.5) * 1.55;
            // Altura: pico en el centro, más bajas en los extremos
            const height = 0.55 + Math.sin(t * Math.PI) * 0.65;
            const spineGeo = new THREE.ConeGeometry(0.032, height, 4);
            const spineMesh = new THREE.Mesh(spineGeo, mat);
            // Base en el lomo, punta hacia arriba
            spineMesh.position.set(xPos * 0.85, 0.62 + height * 0.5, 0);
            // Inclinación leve hacia fuera desde el centro
            spineMesh.rotation.z = (t - 0.5) * 0.42;
            spineMesh.frustumCulled = false;
            this.object.add(spineMesh);
        }

        // ── Aletas pectorales (abanico de espinas a cada lado) ─────────────
        const FAN_COUNT = 7;
        for (const side of [-1, 1]) {
            for (let i = 0; i < FAN_COUNT; i++) {
                const t = i / (FAN_COUNT - 1);
                const fanAngle = (t * 0.75 + 0.12) * Math.PI;
                const len = 0.48 + Math.sin(t * Math.PI) * 0.38;
                const fanGeo = new THREE.ConeGeometry(0.026, len, 3);
                const fanMesh = new THREE.Mesh(fanGeo, mat);
                fanMesh.position.set(
                    Math.cos(fanAngle) * 0.45,
                    Math.sin(fanAngle) * 0.28 - 0.18,
                    side * 0.68
                );
                fanMesh.rotation.set(0, 0, -fanAngle + Math.PI * 0.5);
                fanMesh.frustumCulled = false;
                this.object.add(fanMesh);
            }
        }

        // ── Espinas ventrales (debajo del cuerpo) ─────────────────────────
        const VENTRAL_COUNT = 5;
        for (let i = 0; i < VENTRAL_COUNT; i++) {
            const t = i / (VENTRAL_COUNT - 1);
            const xPos = (t - 0.5) * 1.1;
            const vGeo = new THREE.ConeGeometry(0.025, 0.38, 4);
            const vMesh = new THREE.Mesh(vGeo, mat);
            vMesh.position.set(xPos * 0.7, -0.72, 0);
            vMesh.rotation.z = Math.PI; // punta hacia abajo
            vMesh.frustumCulled = false;
            this.object.add(vMesh);
        }

        // ── Cola (cono horizontal en la parte trasera) ────────────────────
        const tailGeo = new THREE.ConeGeometry(0.28, 0.48, 6);
        const tailMesh = new THREE.Mesh(tailGeo, mat);
        tailMesh.position.set(-0.98, 0, 0);
        tailMesh.rotation.z = Math.PI * 0.5; // rotar para que apunte en X
        tailMesh.frustumCulled = false;
        this.object.add(tailMesh);
    }
}
