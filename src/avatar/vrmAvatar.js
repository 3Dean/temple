import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';

let currentVrm = null;
let isSpeaking = false;
let speechTime = 0;
let mouthFallbackTargets = [];
let hasEmbeddedAnimationClips = false;

const rightArm = {
  upper: null,
  lower: null,
  hand: null,
  restUpper: new THREE.Quaternion(),
  restLower: new THREE.Quaternion(),
  restHand: new THREE.Quaternion(),
};

const _upperTarget = new THREE.Quaternion();
const _lowerTarget = new THREE.Quaternion();
const _handTarget = new THREE.Quaternion();
const _deltaQuat = new THREE.Quaternion();
const _deltaEuler = new THREE.Euler();

function _captureRightArmBones() {
  if (!currentVrm?.humanoid) return;

  const getBone = (name) =>
    currentVrm.humanoid.getNormalizedBoneNode?.(name) ||
    currentVrm.humanoid.getRawBoneNode?.(name) ||
    null;

  rightArm.upper = getBone('rightUpperArm');
  rightArm.lower = getBone('rightLowerArm');
  rightArm.hand = getBone('rightHand');

  if (rightArm.upper) rightArm.restUpper.copy(rightArm.upper.quaternion);
  if (rightArm.lower) rightArm.restLower.copy(rightArm.lower.quaternion);
  if (rightArm.hand) rightArm.restHand.copy(rightArm.hand.quaternion);
}

function _cacheFallbackMouthMorphTargets(root) {
  mouthFallbackTargets = [];
  const mouthNames = ['a', 'aa', 'mouthopen', 'mouth_open', 'vrc.v_aa'];

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.morphTargetDictionary || !obj.morphTargetInfluences) {
      return;
    }

    const dict = obj.morphTargetDictionary;
    const keys = Object.keys(dict);

    for (const key of keys) {
      const normalized = key.toLowerCase();
      if (mouthNames.some((name) => normalized.includes(name))) {
        const index = dict[key];
        mouthFallbackTargets.push({ mesh: obj, index });
      }
    }
  });
}

function _applyProceduralRightArmGesture(delta) {
  const blend = isSpeaking ? 1 : 0;
  const smooth = 1 - Math.exp(-8 * delta);

  speechTime += delta;

  if (rightArm.upper) {
    const wave = Math.sin(speechTime * 4.2) * 0.1;
    _upperTarget.copy(rightArm.restUpper);
    _deltaEuler.set(-0.35 * blend, 0.2 * blend + wave * blend, 0.1 * blend);
    _deltaQuat.setFromEuler(_deltaEuler);
    _upperTarget.multiply(_deltaQuat);
    rightArm.upper.quaternion.slerp(_upperTarget, smooth);
  }

  if (rightArm.lower) {
    const wave = Math.sin(speechTime * 6.0 + 0.8) * 0.08;
    _lowerTarget.copy(rightArm.restLower);
    _deltaEuler.set(-0.2 * blend - wave * blend, 0.1 * blend, 0.05 * blend);
    _deltaQuat.setFromEuler(_deltaEuler);
    _lowerTarget.multiply(_deltaQuat);
    rightArm.lower.quaternion.slerp(_lowerTarget, smooth);
  }

  if (rightArm.hand) {
    const wave = Math.sin(speechTime * 7.5 + 1.2) * 0.12;
    _handTarget.copy(rightArm.restHand);
    _deltaEuler.set(0.1 * blend + wave * blend, 0, 0.12 * blend);
    _deltaQuat.setFromEuler(_deltaEuler);
    _handTarget.multiply(_deltaQuat);
    rightArm.hand.quaternion.slerp(_handTarget, smooth);
  }
}

export async function loadVrmAvatar({ scene, url, position }) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const originalWarn = console.warn;
  console.warn = (...args) => {
    const first = args[0];
    if (
      typeof first === 'string' &&
      first.includes('VRMExpressionLoaderPlugin: An expression preset') &&
      first.includes('duplicated entries')
    ) {
      return;
    }
    originalWarn(...args);
  };

  let gltf;
  try {
    gltf = await loader.loadAsync(url);
  } finally {
    console.warn = originalWarn;
  }
  const vrm = gltf.userData?.vrm;
  hasEmbeddedAnimationClips = Array.isArray(gltf.animations) && gltf.animations.length > 0;

  if (!vrm) {
    throw new Error(`VRM data was not found in ${url}`);
  }

  currentVrm = vrm;
  vrm.scene.position.copy(position || new THREE.Vector3());

  // Conservative defaults. Adjust here if your specific avatar imports with different orientation.
  vrm.scene.rotation.set(0, 0, 0);
  vrm.scene.scale.setScalar(1);

  scene.add(vrm.scene);

  _captureRightArmBones();
  _cacheFallbackMouthMorphTargets(vrm.scene);

  return vrm;
}

export function updateVrm(delta) {
  if (!currentVrm) return;

  if (!hasEmbeddedAnimationClips) {
    _applyProceduralRightArmGesture(delta);
  }
  currentVrm.update(delta);
}

export function setSpeaking(nextSpeaking) {
  isSpeaking = Boolean(nextSpeaking);
}

export function setMouthOpen(amount0to1) {
  if (!currentVrm) return;

  const amount = THREE.MathUtils.clamp(amount0to1 || 0, 0, 1);
  const expressionManager = currentVrm.expressionManager;

  if (expressionManager?.setValue) {
    expressionManager.setValue('aa', amount);
    expressionManager.setValue('a', amount * 0.25);
    expressionManager.setValue('oh', amount * 0.2);
    return;
  }

  const blendShapeProxy = currentVrm.blendShapeProxy;
  if (blendShapeProxy?.setValue) {
    blendShapeProxy.setValue('A', amount);
    blendShapeProxy.setValue('I', amount * 0.1);
    if (blendShapeProxy.update) blendShapeProxy.update();
    return;
  }

  mouthFallbackTargets.forEach(({ mesh, index }) => {
    if (mesh.morphTargetInfluences && mesh.morphTargetInfluences[index] !== undefined) {
      mesh.morphTargetInfluences[index] = amount;
    }
  });
}
