// Provides comparison mode behaviors, enabling dual-model visualization within the viewer.
import * as THREE from 'three';
import { extractMtllibReferences, parseMtl } from './materials.js';

export function applyComparisonMixin(viewerProto) {
  // Track comparison state and prepare default metadata structures.
  viewerProto.setupComparison = function setupComparison() {
    this.comparisonMode = false;
    this.comparisonModelA = null; // {group, metadata}
    this.comparisonModelB = null; // {group, metadata}
    this.modelLabels = [];
    this.modelLabelsEnabled = false;
    this.labelOverlay = null;
    this.normalizeComparisonScale = false;
    this._comparisonOriginalScales = { A: null, B: null };
  };

  // Comparison mode toggle helpers (getters and setters).
  viewerProto.isComparisonModeEnabled = function isComparisonModeEnabled() {
    return this.comparisonMode;
  };

  viewerProto.setComparisonModeEnabled = function setComparisonModeEnabled(enabled) {
    const next = Boolean(enabled);
    console.log('setComparisonModeEnabled called:', {
      enabled: next,
      currentMode: this.comparisonMode,
      hasCurrentModelGroup: !!this.currentModelGroup,
      currentModelMetadata: this.currentModelMetadata,
    });

    if (this.comparisonMode === next) {
      return this.comparisonMode;
    }
    this.comparisonMode = next;

    if (next) {
      if (this.currentModelGroup) {
        this.comparisonModelA = {
          group: this.currentModelGroup,
          metadata: { ...this.currentModelMetadata },
        };
        if (this.comparisonModelA.group) {
          const originalScale = this.comparisonModelA.group.scale.clone();
          this.comparisonModelA.originalScale = originalScale;
          this._comparisonOriginalScales.A = originalScale.clone();
        } else {
          this._comparisonOriginalScales.A = null;
        }
        console.log('Model A stored:', this.comparisonModelA);
      } else {
        console.warn('No currentModelGroup to store as model A!');
        this._comparisonOriginalScales.A = null;
      }
      this.setModelLabelsEnabled(true);
    } else {
      console.log('Exiting comparison mode - cleaning up comparison models');

      this.clearComparisonModelB();

      this.clearModelLabels();
      this.setModelLabelsEnabled(false);

      if (this.comparisonModelA && this.comparisonModelA.group) {
        console.log('Removing comparisonModelA from scene');
        this.scene.remove(this.comparisonModelA.group);
        this.disposeGroup(this.comparisonModelA.group);
        this.comparisonModelA = null;
      }
      if (this.normalizeComparisonScale) {
        this.setNormalizeComparisonScale(false);
      } else {
        this.emit('normalizationscale', { enabled: false });
      }
      this.normalizeComparisonScale = false;
      this._comparisonOriginalScales.A = null;
      this._comparisonOriginalScales.B = null;

      if (this.currentModelGroup) {
        console.log('Removing currentModelGroup from scene');
        this.scene.remove(this.currentModelGroup);
        this.disposeGroup(this.currentModelGroup);
        this.currentModelGroup = null;
      }

      this.currentModelMetadata = null;
      this.viewState = null;

      console.log('Comparison mode cleanup completed - ready for model reload');
    }
    this.updateScaleReference();

    this.emit('comparisonmode', { enabled: this.comparisonMode });
    return this.comparisonMode;
  };

  // Manage lifecycle for the secondary comparison model.
  viewerProto.hasComparisonModelB = function hasComparisonModelB() {
    return !!(this.comparisonModelB && this.comparisonModelB.group);
  };

  viewerProto.clearComparisonModelB = function clearComparisonModelB() {
    if (this.comparisonModelB && this.comparisonModelB.group) {
      this.scene.remove(this.comparisonModelB.group);
      this.disposeGroup(this.comparisonModelB.group);
      this.comparisonModelB = null;
      this._comparisonOriginalScales.B = null;
      this.updateScaleReference();
    }
  };

  viewerProto.loadComparisonModel = async function loadComparisonModel(source, metadata) {
    console.log('loadComparisonModel called with:', {
      comparisonMode: this.comparisonMode,
      hasSource: !!source,
      objUrl: source?.objUrl,
      metadata,
    });

    if (!this.comparisonMode) {
      const error = new Error('Comparison mode must be enabled before loading a comparison model');
      console.error(error);
      throw error;
    }

    if (!source || !source.objUrl) {
      const error = new Error('A model source with an objUrl is required');
      console.error('Source validation failed:', source);
      throw error;
    }

    this.clearComparisonModelB();

    const loadToken = Symbol('comparisonLoad');
    this.comparisonLoadToken = loadToken;
    this.emit('comparisonloadstart', { source, metadata });

    const progressState = {
      obj: 0,
      mtl: 0,
      textures: 0,
      final: 0,
    };
    const emitLoadProgress = () => {
      const percent = Math.round(
        progressState.obj * 50 + 
        progressState.mtl * 15 + 
        progressState.textures * 15 + 
        progressState.final * 20
      );
      this.emit('comparisonloadprogress', {
        loaded: percent,
        total: 100,
        percent,
      });
    };
    emitLoadProgress();

    try {
      console.log('Fetching OBJ from:', source.objUrl);
      const objText = await this._fetchTextWithProgress(source.objUrl, (ratio) => {
        progressState.obj = Math.min(Math.max(ratio, 0), 1);
        emitLoadProgress();
      });
      console.log('OBJ loaded, length:', objText?.length);

      if (this.comparisonLoadToken !== loadToken) {
        console.log('Load token invalidated, aborting');
        return;
      }

      const mtllibRefs = extractMtllibReferences(objText);
      let materialLibrary = null;

      if (!mtllibRefs.length) {
        progressState.mtl = 1;
        emitLoadProgress();
      }

      if (Array.isArray(mtllibRefs) && mtllibRefs.length && source.resolveMaterialLibrary) {
        for (const ref of mtllibRefs) {
          const resolved = source.resolveMaterialLibrary(ref, {
            objDirectory: source.objDirectory,
          });
          if (resolved) {
            materialLibrary = resolved;
            break;
          }
        }
      }

      if (!materialLibrary && source.defaultMaterialLibrary) {
        materialLibrary = source.defaultMaterialLibrary;
      }

      if (!materialLibrary?.url) {
        progressState.mtl = 1;
        emitLoadProgress();
      }

      let parsedMaterialDefs = new Map();
      let textures = new Map();

      if (materialLibrary?.url) {
        const mtlText = await this._fetchTextWithProgress(materialLibrary.url, (ratio) => {
          progressState.mtl = Math.min(Math.max(ratio, 0), 1);
          emitLoadProgress();
        });
        if (this.comparisonLoadToken !== loadToken) {
          return;
        }
        parsedMaterialDefs = parseMtl(mtlText);
        progressState.mtl = 1;
        emitLoadProgress();
      }

      const { materialDefs, texturesNeeded } = this.prepareMaterialDefinitions(parsedMaterialDefs, source, materialLibrary);

      if (texturesNeeded.size) {
        const textureCount = texturesNeeded.size;
        let loadedTextures = 0;
        textures = await this.loadTextures(texturesNeeded, () => {
          loadedTextures++;
          progressState.textures = Math.min(loadedTextures / textureCount, 1);
          emitLoadProgress();
        });
        if (this.comparisonLoadToken !== loadToken) {
          return;
        }
      } else {
        textures = new Map();
        progressState.textures = 1;
        emitLoadProgress();
      }

      progressState.final = 0.1;
      emitLoadProgress();
      
      console.log('Parsing OBJ...');
      const object = this.objLoader.parse(objText);
      console.log('OBJ parsed, object:', object);

      if (this.comparisonLoadToken !== loadToken) {
        console.log('Load token invalidated after parsing, aborting');
        return;
      }

      progressState.final = 0.3;
      emitLoadProgress();

      console.log('Applying materials...');
      const { materialInstances, defaultMaterial } = this.buildMaterialInstances(materialDefs, textures);
      this.applyMaterialsToObject(object, materialInstances, defaultMaterial);

      progressState.final = 0.5;
      emitLoadProgress();

      const originalScaleB = object.scale.clone();
      
      progressState.final = 0.7;
      emitLoadProgress();
      
      this._layoutComparisonModels({
        modelBOverride: object,
        originalScaleB,
      });
      
      progressState.final = 0.85;
      emitLoadProgress();
      console.log('Comparison layout applied for model B load', {
        normalization: this.normalizeComparisonScale,
        modelAPosition: this.comparisonModelA?.group?.position?.clone(),
        modelBPosition: object.position.clone(),
      });

      this.comparisonModelB = {
        group: object,
        metadata: { ...metadata },
        originalScale: originalScaleB.clone(),
      };
      this._comparisonOriginalScales.B = originalScaleB.clone();
      console.log('Model B stored');

      this.scene.add(object);
      console.log('Model B added to scene');
      
      progressState.final = 0.95;
      emitLoadProgress();
      
      this.updateScaleReference();
      
      progressState.final = 1;
      emitLoadProgress();

      console.log('Comparison model loaded successfully');
      this.emit('comparisonloadcomplete', { metadata });

      try {
        console.log('Creating comparison labels...');
        this.createComparisonLabels();
      } catch (error) {
        console.warn('Failed to create comparison labels (non-critical):', error);
      }

      try {
        console.log('Adjusting camera...');
        this.fitCameraToComparison();
      } catch (error) {
        console.warn('Failed to adjust camera (non-critical):', error);
      }
    } catch (error) {
      console.error('Failed to load comparison model - Full error:', error);
      console.error('Error stack:', error.stack);
      this.emit('comparisonloaderror', { error });
      throw error;
    }
  };

  // Camera framing helper ensures both models remain visible after adjustments.
  viewerProto.fitCameraToComparison = function fitCameraToComparison() {
    if (!this.comparisonModelA || !this.comparisonModelB) {
      return;
    }

    const combinedBox = new THREE.Box3();
    combinedBox.expandByObject(this.comparisonModelA.group);
    combinedBox.expandByObject(this.comparisonModelB.group);

    const center = combinedBox.getCenter(new THREE.Vector3());
    const size = combinedBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const radius = maxDim * 0.6;

    this.viewState = { center, radius };
    this.applyViewState();
  };
}
