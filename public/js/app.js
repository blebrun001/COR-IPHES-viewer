/**
 * Application bootstrapper, responsible for wiring together the 3D viewer,
 * the Dataverse data client, and the user interface layer.
 */
import { Viewer3D } from './3d/viewer3d.js';
import { DataverseClient } from './data/dataverseClient.js';
import { initInterface } from './ui/interface.js';

/**
 * Initializes the main UI once all dependencies are available.
 * Creates the viewer and data client instances and handles fatal init errors.
 *
 * @returns {Promise<void>} Resolves when the interface has been fully set up.
 */
async function bootstrap() {
  const viewer = new Viewer3D({});
  const dataClient = new DataverseClient();
  try {
    await initInterface({ viewer, dataClient });
  } catch (error) {
    console.error('Failed to initialize interface', error);
  }
}

bootstrap();
