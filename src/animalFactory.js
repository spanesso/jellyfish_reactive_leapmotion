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

    // /CAMBIO/ Reemplaza el contador JELLYFISH_PER_CYCLE por una secuencia
    // extensible. Para añadir un nuevo animal, simplemente insertar su type
    // en el array en la posición deseada.
    //
    // Patrón actual: 3 medusas → 1 lionfish → 3 medusas → 1 tiburón → (ciclo)
    static sequence = [
        'jellyfish', 'jellyfish', 'jellyfish', 'lionfish',
        'jellyfish', 'jellyfish', 'jellyfish', 'shark',
    ];

    static _currentIndex = 0;

    /**
     * Retorna el tipo de la próxima entidad a crear y avanza el índice interno.
     * @returns {string} tipo de animal (e.g. 'jellyfish' | 'lionfish' | 'shark')
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
