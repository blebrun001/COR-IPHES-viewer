// Utility helpers for parsing material definitions and managing texture state.
import * as THREE from 'three';

export function readCssColorVariable(variableName, fallback) {
  if (typeof window === 'undefined' || !window.getComputedStyle) {
    return fallback;
  }
  try {
    const styles = window.getComputedStyle(document.documentElement);
    if (!styles) {
      return fallback;
    }
    const value = styles.getPropertyValue(variableName);
    if (!value) {
      return fallback;
    }
    const trimmed = value.trim();
    return trimmed || fallback;
  } catch (error) {
    return fallback;
  }
}

export function extractMtllibReferences(objText) {
  return Array.from(objText.matchAll(/^[ \t]*mtllib\s+(.+?)\s*$/gim))
    .map((match) => match[1].trim())
    .filter(Boolean);
}

export function parseMapSpec(raw) {
  const result = {
    path: null,
    scale: [1, 1],
    offset: [0, 0],
    clamp: false,
  };

  if (!raw) return result;

  const tokens = raw.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    const lower = token.toLowerCase();

    const readVector = (length) => {
      const values = [];
      for (let j = 1; j <= length && i + j < tokens.length; j += 1) {
        values.push(Number(tokens[i + j]));
      }
      i += length;
      return values;
    };

    if (lower === '-s' || lower === '-scale') {
      const vec = readVector(3);
      result.scale = [vec[0] ?? 1, vec[1] ?? vec[0] ?? 1];
    } else if (lower === '-o' || lower === '-offset' || lower === '-t') {
      const vec = readVector(3);
      result.offset = [vec[0] ?? 0, vec[1] ?? 0];
    } else if (lower === '-clamp') {
      const value = tokens[i + 1] ? tokens[i + 1].toLowerCase() : '';
      result.clamp = value === 'on' || value === '1';
      i += 1;
    } else if (lower.startsWith('-')) {
      const maybeNumber = tokens[i + 1];
      if (maybeNumber && /^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(maybeNumber)) {
        i += 1;
      }
    } else {
      result.path = tokens.slice(i).join(' ');
      break;
    }

    i += 1;
  }

  if (!result.path && tokens.length) {
    result.path = tokens[tokens.length - 1];
  }

  return result;
}

export function parseMtl(content) {
  const materials = new Map();
  let current = null;

  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.split(/\s+/);
    const keyword = parts.shift();
    if (!keyword) return;
    const lower = keyword.toLowerCase();
    const value = parts.join(' ');

    switch (lower) {
      case 'newmtl': {
        const name = value.trim();
        if (!name) return;
        current = {
          name,
          kd: [1, 1, 1],
          mapKd: null,
          mapAo: null,
          mapRoughness: null,
          mapNormal: null,
        };
        materials.set(name, current);
        break;
      }
      case 'kd':
        if (current && parts.length >= 3) {
          current.kd = parts.slice(0, 3).map((n) => Number(n) || 1);
        }
        break;
      case 'map_kd':
        if (current) current.mapKd = parseMapSpec(value);
        break;
      case 'map_ao':
        if (current) current.mapAo = parseMapSpec(value);
        break;
      case 'map_roughness':
      case 'map_pr':
        if (current) current.mapRoughness = parseMapSpec(value);
        break;
      case 'map_tangentspacenormal':
      case 'map_normal':
      case 'map_bump':
      case 'bump':
      case 'norm':
        if (current) current.mapNormal = parseMapSpec(value);
        break;
      default:
        break;
    }
  });

  return materials;
}

export function cloneMaterial(source) {
  const clone = source.clone();
  clone.userData = Object.assign({}, source.userData || {});
  if (source.userData?.originalMaps) {
    clone.userData.originalMaps = Object.assign({}, source.userData.originalMaps);
  }
  if (source.userData?.baseColor) {
    clone.userData.baseColor = source.userData.baseColor.clone();
  }
  if (source.userData?.baseRoughness !== undefined) {
    clone.userData.baseRoughness = source.userData.baseRoughness;
  }
  return clone;
}

export function applyMaterialTextures(material, texturesEnabled) {
  if (!material) return;
  const original = material.userData && material.userData.originalMaps;
  if (!original) return;

  if (texturesEnabled) {
    material.map = original.map || null;
    material.roughnessMap = original.roughnessMap || null;
    material.aoMap = original.aoMap || null;
    material.normalMap = original.normalMap || null;

    if (material.userData.baseColor) {
      material.color.set(0xffffff);
    }

    if (original.roughnessMap && material.userData.baseRoughness !== undefined) {
      material.roughness = material.userData.baseRoughness;
    }
  } else {
    material.map = null;
    material.roughnessMap = original.roughnessMap || null;
    material.aoMap = original.aoMap || null;
    material.normalMap = original.normalMap || null;

    if (material.userData.baseColor) {
      material.color.copy(material.userData.baseColor);
    } else {
      material.color.set(0xff9300);
    }

    if (material.userData.baseRoughness !== undefined) {
      material.roughness = material.userData.baseRoughness;
    }
  }

  material.needsUpdate = true;
}

export function ensureMaterialTextureState(material, texturesEnabled) {
  if (!material) return;
  material.userData = material.userData || {};
  if (!material.userData.originalMaps) {
    material.userData.originalMaps = {
      map: material.map || null,
      roughnessMap: material.roughnessMap || null,
      aoMap: material.aoMap || null,
      normalMap: material.normalMap || null,
    };
  }
  applyMaterialTextures(material, texturesEnabled);
}

export function applyTextureSpec(descriptor, texture, material) {
  if (!descriptor || !texture) return;

  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  if (texture.offset) {
    const [offsetX = 0, offsetY = 0] = descriptor.offset || [];
    if (Number.isFinite(offsetX) && Number.isFinite(offsetY)) {
      texture.offset.set(offsetX, offsetY);
    }
  }

  if (texture.repeat) {
    const [repeatX = 1, repeatY = 1] = descriptor.scale || [];
    if (Number.isFinite(repeatX) && Number.isFinite(repeatY)) {
      texture.repeat.set(repeatX, repeatY);
    }
  }

  if (descriptor.clamp) {
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  texture.needsUpdate = true;
  material.needsUpdate = true;
}

export function applyMaterialsMixin(viewerProto) {
  // Pure helpers: CSS colors, MTL parsing, texture descriptor parsing.

  // Manage texture cache entries and batch asynchronous loads.
  viewerProto.loadTextures = async function loadTextures(requestsMap, onProgress) {
    const result = new Map();
    const requests = Array.from(requestsMap.values());
    if (!requests.length) {
      return result;
    }

    await Promise.all(
      requests.map(async (request) => {
        const cacheKey = request.cacheKey;
        if (this.textureCache.has(cacheKey)) {
          const cached = this.textureCache.get(cacheKey);
          result.set(cacheKey, cached);
          if (typeof onProgress === 'function') {
            onProgress();
          }
          return;
        }
        try {
          const texture = await this.textureLoader.loadAsync(request.url);
          texture.colorSpace = request.colorSpace;
          texture.anisotropy = 8;
          this.textureCache.set(cacheKey, texture);
          result.set(cacheKey, texture);
          if (typeof onProgress === 'function') {
            onProgress();
          }
        } catch (error) {
          console.warn(`Failed to load texture ${request.url}`, error);
          if (typeof onProgress === 'function') {
            onProgress();
          }
        }
      })
    );

    return result;
  };

  // Apply texture enablement to materials within the active model.
  viewerProto.applyTexturesToCurrentModel = function applyTexturesToCurrentModel() {
    if (!this.currentModelGroup) return;
    this.currentModelGroup.traverse((child) => {
      if (!child.isMesh) return;
      const mats = child.material;
      if (Array.isArray(mats)) {
        mats.forEach((mat) => ensureMaterialTextureState(mat, this.texturesEnabled));
      } else {
        ensureMaterialTextureState(mats, this.texturesEnabled);
      }
    });
  };

  // Prepare material definitions and enumerate required textures for the current model.
  viewerProto.prepareMaterialDefinitions = function prepareMaterialDefinitions(materialDefs, source, materialLibrary) {
    const prepared = new Map();
    const texturesNeeded = new Map();
    if (!(materialDefs && materialDefs.size)) {
      return { materialDefs: prepared, texturesNeeded };
    }

    materialDefs.forEach((def, name) => {
      const descriptor = {};
      const maps = [
        ['diffuse', def.mapKd],
        ['normal', def.mapNormal],
        ['roughness', def.mapRoughness],
        ['ao', def.mapAo],
      ];

      maps.forEach(([kind, spec]) => {
        if (!spec || !spec.path) return;
        if (typeof source?.resolveTexturePath !== 'function') return;
        const resolved = source.resolveTexturePath(spec.path, {
          textureBaseDir: materialLibrary?.textureBaseDir,
        });
        if (!resolved) return;
        const cacheKey = resolved.cacheKey;
        descriptor[kind] = {
          cacheKey,
          scale: spec.scale,
          offset: spec.offset,
          clamp: spec.clamp,
        };
        if (!texturesNeeded.has(cacheKey)) {
          texturesNeeded.set(cacheKey, {
            cacheKey,
            url: resolved.url,
            kind,
            colorSpace:
              kind === 'diffuse' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace,
          });
        }
      });

      prepared.set(name, { ...def, descriptor });
    });

    return { materialDefs: prepared, texturesNeeded };
  };

  viewerProto.buildMaterialInstances = function buildMaterialInstances(materialDefs, textures) {
    const textureMap = textures || new Map();
    const materialInstances = new Map();

    const buildMaterial = (name, def) => {
      const baseColor = new THREE.Color(0xff9300);
      const descriptor = def?.descriptor || {};

      const material = new THREE.MeshStandardMaterial({
        color: baseColor.clone(),
        metalness: 0.0,
        roughness: 1.0,
      });

      material.userData = Object.assign({}, material.userData || {});
      material.userData.baseColor = baseColor.clone();
      material.userData.baseRoughness = material.roughness;

      const assignTexture = (kind, apply) => {
        const info = descriptor[kind];
        if (!info) return;
        const texture = textureMap.get(info.cacheKey);
        if (!texture) return;
        applyTextureSpec(info, texture, material);
        apply(texture);
      };

      assignTexture('diffuse', (texture) => {
        material.map = texture;
        material.color.set(0xffffff);
      });

      assignTexture('roughness', (texture) => {
        material.roughnessMap = texture;
      });

      assignTexture('ao', (texture) => {
        material.aoMap = texture;
        material.aoMapIntensity = 1.0;
      });

      assignTexture('normal', (texture) => {
        material.normalMap = texture;
        if (!material.normalScale) {
          material.normalScale = new THREE.Vector2(1, 1);
        }
      });

      material.userData.originalMaps = material.userData.originalMaps || {
        map: material.map || null,
        roughnessMap: material.roughnessMap || null,
        aoMap: material.aoMap || null,
        normalMap: material.normalMap || null,
      };

      material.name = name;
      ensureMaterialTextureState(material, this.texturesEnabled);
      return material;
    };

    if (materialDefs && materialDefs.size) {
      materialDefs.forEach((def, name) => {
        materialInstances.set(name, buildMaterial(name, def));
      });
    }

    const defaultMaterial = buildMaterial('default', {});
    return { materialInstances, defaultMaterial };
  };

  viewerProto.applyMaterialsToObject = function applyMaterialsToObject(object, materialInstances, defaultMaterial) {
    if (!object) return;
    const instances = materialInstances || new Map();
    const fallback = defaultMaterial || new THREE.MeshStandardMaterial({ color: 0xff9300 });

    const applyMaterial = (mat) => {
      if (!mat) return mat;
      ensureMaterialTextureState(mat, this.texturesEnabled);
      mat.wireframe = this.wireframeEnabled;
      mat.needsUpdate = true;
      return mat;
    };

    object.traverse((child) => {
      if (!child.isMesh) return;

      const originalMaterial = child.material;
      if (Array.isArray(originalMaterial)) {
        child.material = originalMaterial.map((mat) => {
          const name = mat?.name;
          if (name && instances.has(name)) {
            return applyMaterial(instances.get(name));
          }
          return applyMaterial(cloneMaterial(fallback));
        });
      } else {
        const name = originalMaterial?.name;
        if (name && instances.has(name)) {
          child.material = applyMaterial(instances.get(name));
        } else {
          child.material = applyMaterial(cloneMaterial(fallback));
        }
      }

      if (child.geometry && child.geometry.attributes?.uv && !child.geometry.attributes.uv2) {
        child.geometry.setAttribute('uv2', child.geometry.attributes.uv);
      }

      child.castShadow = true;
      child.receiveShadow = true;
    });
  };
}
