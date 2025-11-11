/**
 * Application bootstrapper, responsible for wiring together the 3D viewer,
 * the Dataverse data client, and the user interface layer.
 */
import { createViewerApi } from './3d/viewerApi.js';
import { DataverseClient } from './data/dataverseClient.js';
import { initInterface } from './ui/interface.js';

/**
 * Initializes the main UI once all dependencies are available.
 * Creates the viewer and data client instances and handles fatal init errors.
 *
 * @returns {Promise<void>} Resolves when the interface has been fully set up.
 */
async function bootstrap() {
  const viewerApi = createViewerApi();
  if (typeof window !== 'undefined') {
    window.viewerApi = viewerApi;
  }
  const dataClient = new DataverseClient();
  try {
    await initInterface({ viewerApi, dataClient });
  } catch (error) {
    console.error('Failed to initialize interface', error);
  }
}

bootstrap();
