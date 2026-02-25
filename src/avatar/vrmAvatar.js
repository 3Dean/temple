import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';

// GLB-first avatar pipeline. If a loaded GLB contains VRM metadata, we use it.
let currentVrm = null;
let currentAvatarRoot = null;
let currentMixer = null;
let defaultAvatarYaw = 0;
let isSpeaking = false;
let speechTime = 0;
let mouthFallbackTargets = [];
let blinkFallbackTargets = [];
let hasEmbeddedAnimationClips = false;
let idleAction = null;
let talkAction = null;
let activeAction = null;
const SPEECH_MORPH_STRENGTH = 0.35;
const SPEECH_MORPH_MAX = 0.45;
const BLINK_CLOSED_DURATION = 0.09;
const BLINK_OPEN_DURATION = 0.12;
const ACTION_FADE_SECONDS = 0.22;

let blinkTimer = 0;
let nextBlinkDelay = 0;
let blinkState = 'idle';
let blinkAmount = 0;

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
const _avatarWorldPosition = new THREE.Vector3();

function _findClipByNames(clips, candidates) {
  if (!Array.isArray(clips) || clips.length === 0) return null;
  for (const candidate of candidates) {
    const match = THREE.AnimationClip.findByName(clips, candidate);
    if (match) return match;
  }
  return null;
}

function _prepareLoopAction(action) {
  if (!action) return;
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.clampWhenFinished = false;
  action.enabled = true;
}

function _switchActiveAction(nextAction) {
  if (!nextAction || activeAction === nextAction) return;

  _prepareLoopAction(nextAction);
  nextAction.reset();
  nextAction.fadeIn(ACTION_FADE_SECONDS).play();

  if (activeAction) {
    activeAction.fadeOut(ACTION_FADE_SECONDS);
  }
  activeAction = nextAction;
}

function _syncSpeechAnimationState() {
  if (!currentMixer) return;

  const next = isSpeaking ? (talkAction || idleAction) : (idleAction || talkAction);
  if (next) {
    _switchActiveAction(next);
  }
}

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

function _clearRightArmBones() {
  rightArm.upper = null;
  rightArm.lower = null;
  rightArm.hand = null;
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

function _cacheFallbackBlinkMorphTargets(root) {
  blinkFallbackTargets = [];
  const blinkNames = ['blink', 'eyeclose', 'eye_close', 'eyesclosed', 'closeeye'];

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.morphTargetDictionary || !obj.morphTargetInfluences) {
      return;
    }

    const dict = obj.morphTargetDictionary;
    const keys = Object.keys(dict);

    for (const key of keys) {
      const normalized = key.toLowerCase();
      if (blinkNames.some((name) => normalized.includes(name))) {
        const index = dict[key];
        blinkFallbackTargets.push({ mesh: obj, index });
      }
    }
  });
}

function _nextBlinkDelay() {
  return 2.2 + Math.random() * 3.0;
}

function _resetBlinkState() {
  blinkTimer = 0;
  blinkAmount = 0;
  blinkState = 'idle';
  nextBlinkDelay = _nextBlinkDelay();
}

function _setBlinkAmount(amount0to1) {
  const amount = THREE.MathUtils.clamp(amount0to1 || 0, 0, 1);
  const expressionManager = currentVrm?.expressionManager;

  if (expressionManager?.setValue) {
    expressionManager.setValue('blink', amount);
    expressionManager.setValue('blinkLeft', amount);
    expressionManager.setValue('blinkRight', amount);
    return;
  }

  const blendShapeProxy = currentVrm?.blendShapeProxy;
  if (blendShapeProxy?.setValue) {
    blendShapeProxy.setValue('Blink', amount);
    if (blendShapeProxy.update) blendShapeProxy.update();
    return;
  }

  blinkFallbackTargets.forEach(({ mesh, index }) => {
    if (mesh.morphTargetInfluences && mesh.morphTargetInfluences[index] !== undefined) {
      mesh.morphTargetInfluences[index] = amount;
    }
  });
}

function _updateBlink(delta) {
  if (!currentAvatarRoot) return;

  blinkTimer += delta;

  if (blinkState === 'idle') {
    if (blinkTimer >= nextBlinkDelay) {
      blinkState = 'closing';
      blinkTimer = 0;
    }
  } else if (blinkState === 'closing') {
    blinkAmount = Math.min(1, blinkTimer / BLINK_CLOSED_DURATION);
    if (blinkTimer >= BLINK_CLOSED_DURATION) {
      blinkState = 'opening';
      blinkTimer = 0;
      blinkAmount = 1;
    }
  } else if (blinkState === 'opening') {
    blinkAmount = Math.max(0, 1 - blinkTimer / BLINK_OPEN_DURATION);
    if (blinkTimer >= BLINK_OPEN_DURATION) {
      blinkState = 'idle';
      blinkTimer = 0;
      blinkAmount = 0;
      nextBlinkDelay = _nextBlinkDelay();
    }
  }

  _setBlinkAmount(blinkAmount);
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

export async function loadAvatarGlb({ scene, url, position, animationClipName }) {
  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('/draco/');
  loader.setDRACOLoader(dracoLoader);
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
  const avatarRoot = vrm?.scene || gltf.scene;
  hasEmbeddedAnimationClips = Array.isArray(gltf.animations) && gltf.animations.length > 0;
  currentVrm = vrm || null;
  currentAvatarRoot = avatarRoot;
  currentMixer = null;
  idleAction = null;
  talkAction = null;
  activeAction = null;
  avatarRoot.position.copy(position || new THREE.Vector3());

  // Conservative defaults. Adjust here if your specific avatar imports with different orientation.
  avatarRoot.rotation.set(0, 0, 0);
  defaultAvatarYaw = avatarRoot.rotation.y;
  avatarRoot.scale.setScalar(1.1);

  scene.add(avatarRoot);

  if (vrm) {
    _captureRightArmBones();
  } else {
    _clearRightArmBones();
  }
  _cacheFallbackMouthMorphTargets(avatarRoot);
  _cacheFallbackBlinkMorphTargets(avatarRoot);
  _resetBlinkState();

  if (Array.isArray(gltf.animations) && gltf.animations.length > 0) {
    currentMixer = new THREE.AnimationMixer(avatarRoot);

    const idleClip =
      _findClipByNames(gltf.animations, [animationClipName || '', 'clip_idle', 'idle']) ||
      gltf.animations[0];
    const talkClip = _findClipByNames(gltf.animations, ['clip_talk', 'talk']);

    idleAction = currentMixer.clipAction(idleClip);
    _prepareLoopAction(idleAction);

    if (talkClip) {
      talkAction = currentMixer.clipAction(talkClip);
      _prepareLoopAction(talkAction);
    }

    if (animationClipName && idleClip.name !== animationClipName) {
      console.warn(
        `Requested animation clip "${animationClipName}" not found in ${url}. Using "${idleClip.name}" instead.`
      );
    }

    if (!talkClip) {
      console.warn(`No talk animation clip found in ${url}. Falling back to idle while speaking.`);
    }

    _syncSpeechAnimationState();
  }

  return vrm || gltf;
}

export function updateAvatar(delta) {
  if (!currentAvatarRoot) return;

  if (!hasEmbeddedAnimationClips) {
    _applyProceduralRightArmGesture(delta);
  }
  if (currentVrm?.update) {
    currentVrm.update(delta);
  }
  if (currentMixer) {
    currentMixer.update(delta);
  }
  _updateBlink(delta);
}

// Backward-compatible aliases for older imports.
export const loadVrmAvatar = loadAvatarGlb;
export const updateVrm = updateAvatar;

export function setSpeaking(nextSpeaking) {
  const normalized = Boolean(nextSpeaking);
  if (isSpeaking === normalized) return;
  isSpeaking = normalized;
  _syncSpeechAnimationState();
}

export function setMouthOpen(amount0to1) {
  const baseAmount = THREE.MathUtils.clamp(amount0to1 || 0, 0, 1);
  const amount = Math.min(baseAmount * SPEECH_MORPH_STRENGTH, SPEECH_MORPH_MAX);
  const expressionManager = currentVrm?.expressionManager;

  if (expressionManager?.setValue) {
    expressionManager.setValue('aa', amount);
    expressionManager.setValue('a', amount * 0.25);
    expressionManager.setValue('oh', amount * 0.2);
    return;
  }

  const blendShapeProxy = currentVrm?.blendShapeProxy;
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

export function getAvatarWorldPosition(target = new THREE.Vector3()) {
  if (!currentAvatarRoot) return null;
  currentAvatarRoot.getWorldPosition(target);
  return target;
}

function _shortestAngleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function updateAvatarFacing({
  targetWorldPosition = null,
  delta = 0,
  enabled = false,
  turnSpeed = 3.2,
  deadZone = 0.01,
  maxOffsetFromDefault = Math.PI * 0.85,
} = {}) {
  if (!currentAvatarRoot) return;

  let desiredYaw = defaultAvatarYaw;
  if (enabled && targetWorldPosition) {
    currentAvatarRoot.getWorldPosition(_avatarWorldPosition);
    const dx = targetWorldPosition.x - _avatarWorldPosition.x;
    const dz = targetWorldPosition.z - _avatarWorldPosition.z;
    const planarLengthSq = dx * dx + dz * dz;
    if (planarLengthSq > 0.000001) {
      const unclampedYaw = Math.atan2(dx, dz);
      const offsetFromDefault = _shortestAngleDelta(defaultAvatarYaw, unclampedYaw);
      const clampedOffset = THREE.MathUtils.clamp(
        offsetFromDefault,
        -maxOffsetFromDefault,
        maxOffsetFromDefault
      );
      desiredYaw = defaultAvatarYaw + clampedOffset;
    }
  }

  const currentYaw = currentAvatarRoot.rotation.y;
  const deltaYaw = _shortestAngleDelta(currentYaw, desiredYaw);
  if (Math.abs(deltaYaw) < deadZone) return;

  const maxStep = Math.max(0, turnSpeed * Math.max(0, delta));
  const step = THREE.MathUtils.clamp(deltaYaw, -maxStep, maxStep);
  currentAvatarRoot.rotation.y = currentYaw + step;
}
