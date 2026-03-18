/**
 * AnimalFactory
 * Gestiona el ciclo de creación de animales.
 * Cada JELLYFISH_PER_CYCLE medusas creadas, la siguiente entidad es un lionfish.
 * Agregar nuevos tipos: añadir case al switch en getNextType() y ajustar el ciclo.
 */
export class AnimalFactory {
    static JELLYFISH_PER_CYCLE = 3;
    static _jellfishThisCycle = 0;

    /**
     * Retorna el tipo de la próxima entidad a crear.
     * @returns {'jellyfish' | 'lionfish'}
     */
    static getNextType() {
        if (AnimalFactory._jellfishThisCycle >= AnimalFactory.JELLYFISH_PER_CYCLE) {
            AnimalFactory._jellfishThisCycle = 0;
            return 'lionfish';
        }
        AnimalFactory._jellfishThisCycle++;
        return 'jellyfish';
    }

    static reset() {
        AnimalFactory._jellfishThisCycle = 0;
    }
}
