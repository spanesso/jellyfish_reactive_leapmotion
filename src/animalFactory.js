/**
 * AnimalFactory
 * Gestiona el patrón de creación de animales en el acuario.
 *
 * El orden de spawn se define en `AnimalFactory.sequence`: un array de strings
 * donde cada elemento es el `type` de la entidad que se creará en ese turno.
 * El índice cicla infinitamente sobre el array.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CÓMO AGREGAR UN NUEVO ANIMAL EN EL FUTURO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   1. Crear la clase del animal extendiendo Medusa (ver shark.js como ejemplo).
 *   2. Definir `type = 'nombre_del_animal'` en la nueva clase.
 *   3. Añadir `'nombre_del_animal'` en la posición deseada de `sequence`.
 *   4. En app.js:
 *        a. Importar la nueva clase.
 *        b. Añadir `MAX_NUEVOANIMAL` y `nuevoanimalPool = []`.
 *        c. Llamar `await NuevoAnimal.initStatic()` en init().
 *        d. Crear el pool (igual que sharkPool).
 *        e. Añadir el pool a `_getAllEntities()`.
 *        f. Manejar el nuevo tipo en `activateNextEntity()`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class AnimalFactory {

    // Número de medusas entre cada animal especial.
    // Cambiar este valor para ajustar la frecuencia de aparición de animales.
    static JELLYFISH_PER_ANIMAL = 1;

    // Número de tiburones que deben aparecer antes de que aparezca el arctic_ray.
    static SHARKS_PER_WHALE = 1;

    // Número de arctic_rays entre cada jefe de nivel 3.
    static WHALES_PER_BOSS = 1;

    // Secuencia construida dinámicamente con jerarquía de 3 niveles:
    //
    // Nivel 1 — ciclo de tiburón (× SHARKS_PER_WHALE → arctic_ray):
    //   N medusas → alien_fish → N medusas → shark
    //   N medusas → discus     → N medusas → shark
    //   arctic_ray
    //
    // Nivel 2 — ciclo de arctic_ray (× WHALES_PER_BOSS → jefe):
    //   [ciclo de tiburón] × WHALES_PER_BOSS → cryptosuchus
    //   [ciclo de tiburón] × WHALES_PER_BOSS → shadow_leviathan
    //   (reinicio)
    static sequence = (() => {
        const jf       = new Array(AnimalFactory.JELLYFISH_PER_ANIMAL).fill('jellyfish');
        const specials = ['alien_fish', 'discus'];
        const bosses   = ['cryptosuchus', 'shadow_leviathan'];

        // Un ciclo completo que termina en arctic_ray
        const whaleCycle = [];
        for (let i = 0; i < AnimalFactory.SHARKS_PER_WHALE; i++) {
            whaleCycle.push(...jf, specials[i % specials.length], ...jf, 'shark');
        }
        whaleCycle.push('whale');

        // Por cada jefe: WHALES_PER_BOSS ciclos de arctic_ray → jefe
        const seq = [];
        for (let b = 0; b < bosses.length; b++) {
            for (let w = 0; w < AnimalFactory.WHALES_PER_BOSS; w++) {
                seq.push(...whaleCycle);
            }
            seq.push(bosses[b]);
        }
        return seq;
    })();

    static _currentIndex = 0;

    /**
     * Retorna el tipo de la próxima entidad a crear y avanza el índice interno.
     * @returns {string} tipo de animal (e.g. 'jellyfish' | 'alien_fish' | 'shark')
     */
    static getNextType() {
        const type = AnimalFactory.sequence[AnimalFactory._currentIndex];
        AnimalFactory._currentIndex =
            (AnimalFactory._currentIndex + 1) % AnimalFactory.sequence.length;
        return type;
    }

    /**
     * Reinicia el ciclo al primer elemento de la secuencia.
     */
    static reset() {
        AnimalFactory._currentIndex = 0;
    }
}
