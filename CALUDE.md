Aurelia — Interactive Reactive Aquarium (Three.js + WebGPU)
🧠 Overview

Aurelia is a real-time, interactive 3D aquarium experience rendered in the browser, where procedural marine entities (jellyfish, lionfish, and sharks) exhibit emergent behavior driven by user interaction and audio input.

The system blends procedural geometry, GPU-based physics, and audio-reactive shaders to create a living ecosystem where entities:

Follow cursor movement
React to bass frequencies from the microphone
Transition between behavioral states (following, scattering, circling)
Spawn dynamically based on user interaction patterns

The result is a biologically inspired, audio-reactive simulation with cinematic visual fidelity.

⚙️ Core Technologies
Three.js (v0.175) with WebGPU renderer (no WebGL fallback)
TSL (Three Shader Language) — node-based shader system (no GLSL)
Vite — build system and dev server
Web Audio API — real-time FFT analysis (bass detection)
GPU Compute Shaders — Verlet physics simulation at high frequency (360 Hz)
🧱 Architecture

The system follows a modular entity-driven architecture, where all creatures inherit from a shared base class:

🔹 Base Entity: Medusa
Procedural geometry generated via TSL
Tentacles and oral arms simulated using Verlet physics on GPU
Registers vertices into a shared physics bridge (MedusaVerletBridge)
🔹 Derived Entities
🪼 Jellyfish
Fully procedural
Physically simulated (GPU)
Highly audio-reactive (color, glow, motion)
🐠 Lionfish
Extends Medusa but overrides geometry and animation
Fully procedural geometry:
LatheGeometry (body)
CylinderGeometry (spines)
BufferGeometry (fins)
No physics simulation → purely kinematic animation
🦈 Shark
Uses external GLB model
Animation via AnimationMixer
Audio-reactive animation speed (timeScale modulation)
🔄 Entity Lifecycle

All entities share a unified lifecycle:

constructor()
  → register in physics bridge
  → create geometry

activate(position)
  → becomes visible and active

update(delta, elapsed)
  → animate + move + react to input/audio

deactivate()
  → hidden and moved offscreen
🧭 Behavior System (State Machine)

Each entity operates under three mutually exclusive states:

State	Trigger Condition	Behavior
Following	Default	Moves toward cursor
Scattering	New entity spawn	Flees to random position
Circling	Cursor idle > 3 seconds	Orbits last spawn position

Transitions are driven by cursor movement thresholds and interaction timing.

🎮 Main Loop

Runs at 60 FPS, while physics runs at 360 Hz internally.

1. Handle user input (cursor interaction)
2. Spawn logic (based on movement patterns)
3. Physics update (GPU Verlet)
4. Depth sorting
5. Audio analysis
6. Update global shader uniforms
7. Render (post-processing)
🧬 Physics System (GPU Verlet)
Implemented via compute shaders
Only jellyfish participate in physics simulation
Lionfish and shark bypass physics (kinematic update)
Key Concept:

A bridge layer (MedusaVerletBridge) synchronizes:

Entity transforms (JS side)
GPU particle buffers (physics side)
🎧 Audio Reactivity System

Uses real-time microphone input:

FFT size: 2048
Bass range: 20–250 Hz
Beat detection via dynamic threshold
Envelope shaping:
Attack: fast (0.75)
Release: slow (0.04)
Output:
bassIntensity (0 → 1)
Effects:
Jellyfish → color + bloom + glow
Shark → animation speed + scale pulse
Lionfish → minimal/static response
🎨 Shader System (TSL)

Shaders are written as JavaScript node graphs, not GLSL.

Example:

material.colorNode = Fn(() => {
  const bass = Medusa.uniforms.bassIntensity;
  return mix(colorBase, colorBass, bass);
})();

Supports MRT (Multiple Render Targets):

Color output
Bloom intensity (for post-processing)
🐟 Spawn System (AnimalFactory)

Controls the sequence of entity spawning:

sequence = [
  'jellyfish', 'jellyfish', 'jellyfish', 'lionfish',
  'jellyfish', 'jellyfish', 'jellyfish', 'shark',
];
Cycles infinitely
Controlled pacing and ecosystem balance
Capacity Limits:
Jellyfish: 22
Lionfish: 8
Sharks: 4
Total: 34 entities
🌐 Environment System
Procedural fog and volumetric lighting
Plankton particle system (instanced rendering)
God rays (volumetric light scattering)
📐 Coordinate System
+Y axis = forward direction (critical)
Ensures consistent:
Orientation
Animation
Physics alignment
➕ Extensibility

To add a new animal:

Extend Medusa
Implement custom geometry (procedural or GLB)
Register in AnimalFactory
Add pool + lifecycle handling in app.js
🚀 Key Differentiators
Full GPU-driven physics simulation
Node-based shader system (TSL) instead of GLSL
Hybrid system:
Procedural entities
Imported animated models
Real-time audio-driven visual behavior
Emergent interaction design (non-scripted feel)