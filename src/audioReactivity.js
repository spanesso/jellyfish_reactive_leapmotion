/**
 * AudioReactivity
 * ---------------
 * Captura el micrófono del usuario, analiza las frecuencias graves (bass 20–250 Hz)
 * en tiempo real mediante Web Audio API y expone una métrica suave (0.0 – 1.0)
 * para disparar reacciones visuales sincronizadas con el bajo.
 *
 * Uso:
 *   const audio = new AudioReactivity();
 *   audio.initOnInteraction();    // Escucha click/touch para pedir permiso
 *   // En el loop de animación:
 *   audio.update();
 *   someUniform.value = audio.bassIntensity;
 */
export class AudioReactivity {
    isInitialized = false;
    isEnabled = false;

    /** Intensidad de bass normalizada (0.0 = silencio, 1.0 = golpe máximo). */
    bassIntensity = 0;

    // --- Internos ---
    _audioContext = null;
    _analyser = null;
    _dataArray = null;
    _bassStartBin = 0;
    _bassEndBin = 0;
    _bassHistory = [];
    _smoothedBass = 0;

    // --- Configuración de análisis ---
    FFT_SIZE = 2048;

    /**
     * Historial para calcular el promedio local (base dinámica).
     * 60 muestras ≈ 1 segundo a 60fps.
     */
    HISTORY_SIZE = 60;

    /**
     * El bass actual debe superar BEAT_THRESHOLD × el promedio local para considerarse beat.
     * 1.4 = el bass debe ser un 40% más alto que el ruido ambiente.
     */
    BEAT_THRESHOLD = 1.4;

    /**
     * Energía mínima absoluta para ignorar el ruido de fondo del micrófono.
     */
    MIN_BASS_ENERGY = 0.05;

    /**
     * Velocidad de subida del envelope (0–1, más alto = respuesta más rápida al beat).
     */
    ATTACK = 0.75;

    /**
     * Velocidad de bajada del envelope (0–1, más bajo = decaimiento más lento y orgánico).
     */
    RELEASE = 0.04;

    // -------------------------------------------------------------------------

    /**
     * Registra listeners de primera interacción (click o touchstart) para
     * solicitar el micrófono tras un gesto del usuario — requerido por algunos
     * navegadores para crear/activar el AudioContext.
     */
    initOnInteraction() {
        const handler = () => {
            this._init();
        };
        window.addEventListener('click', handler, { once: true });
        window.addEventListener('touchstart', handler, { once: true });
    }

    // -------------------------------------------------------------------------

    async _init() {
        try {
            // Solicitar acceso al micrófono
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                },
                video: false,
            });

            this._audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // Asegurarse de que el contexto esté activo (puede quedar en suspended
            // si el navegador lo crea en un contexto sin gesto activo).
            if (this._audioContext.state === 'suspended') {
                await this._audioContext.resume();
            }

            const source = this._audioContext.createMediaStreamSource(stream);

            this._analyser = this._audioContext.createAnalyser();
            this._analyser.fftSize = this.FFT_SIZE;

            /**
             * smoothingTimeConstant suaviza la FFT frame a frame internamente.
             * 0.8 = buena respuesta sin jitter excesivo.
             */
            this._analyser.smoothingTimeConstant = 0.8;

            source.connect(this._analyser);
            this._dataArray = new Uint8Array(this._analyser.frequencyBinCount);

            // --- Calcular bins de frecuencias graves ---
            // Con fftSize=2048, frequencyBinCount=1024.
            // hzPerBin = (sampleRate/2) / frequencyBinCount
            // Ejemplo a 44100 Hz: hzPerBin ≈ 21.5 Hz → bins 1–11 ≈ 21–236 Hz
            const nyquist = this._audioContext.sampleRate / 2;
            const hzPerBin = nyquist / this._analyser.frequencyBinCount;
            this._bassStartBin = Math.max(1, Math.floor(20 / hzPerBin));
            this._bassEndBin   = Math.floor(250 / hzPerBin);

            this.isInitialized = true;
            this.isEnabled = true;

            console.log(
                `[AudioReactivity] Micrófono activo — ` +
                `Bass bins: ${this._bassStartBin}–${this._bassEndBin} ` +
                `(${(this._bassStartBin * hzPerBin).toFixed(0)} Hz – ` +
                `${(this._bassEndBin * hzPerBin).toFixed(0)} Hz)`
            );

        } catch (err) {
            console.warn('[AudioReactivity] No se pudo acceder al micrófono:', err.message);
            this.isEnabled = false;
        }
    }

    // -------------------------------------------------------------------------

    /**
     * Debe llamarse una vez por frame en el loop de animación.
     * Actualiza `this.bassIntensity` (0.0 – 1.0).
     */
    update() {
        // Si no hay audio disponible, dejar decaer suavemente
        if (!this.isInitialized || !this.isEnabled) {
            this._smoothedBass *= (1.0 - this.RELEASE);
            this.bassIntensity = this._smoothedBass;
            return;
        }

        // Obtener snapshot de datos de frecuencia (byte, 0–255)
        this._analyser.getByteFrequencyData(this._dataArray);

        // --- Energía promedio del rango de bajos ---
        let sum = 0;
        const binCount = this._bassEndBin - this._bassStartBin;
        for (let i = this._bassStartBin; i < this._bassEndBin; i++) {
            sum += this._dataArray[i];
        }
        // Normalizar a 0.0–1.0
        const bassEnergy = sum / (binCount * 255);

        // --- Rolling average para auto-normalización dinámica ---
        this._bassHistory.push(bassEnergy);
        if (this._bassHistory.length > this.HISTORY_SIZE) {
            this._bassHistory.shift();
        }
        const avgBass = this._bassHistory.reduce((a, b) => a + b, 0) / this._bassHistory.length;

        // --- Detección de beat ---
        // El golpe de bajo debe superar el umbral relativo Y el mínimo absoluto.
        const isBeat = bassEnergy > avgBass * this.BEAT_THRESHOLD
                    && bassEnergy > this.MIN_BASS_ENERGY;

        // --- Target de intensidad proporcional al exceso sobre el promedio ---
        let target = 0;
        if (isBeat && avgBass > 0.001) {
            const ratio = bassEnergy / avgBass;
            // Mapear: BEAT_THRESHOLD → 0.0, BEAT_THRESHOLD*2 → 1.0
            target = Math.min(1.0, (ratio - this.BEAT_THRESHOLD) / this.BEAT_THRESHOLD);
        }

        // --- Envelope attack / release para transición suave y orgánica ---
        if (target > this._smoothedBass) {
            // Subida rápida: la medusa reacciona inmediatamente al golpe de bajo
            this._smoothedBass += (target - this._smoothedBass) * this.ATTACK;
        } else {
            // Bajada lenta: el color se desvanece gradualmente, como bioluminiscencia
            this._smoothedBass += (target - this._smoothedBass) * this.RELEASE;
        }

        this.bassIntensity = Math.max(0, Math.min(1, this._smoothedBass));
    }
}
