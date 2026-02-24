import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { ColorManagement, SRGBColorSpace, ACESFilmicToneMapping } from 'three';
import {
  loadVrmAvatar,
  updateVrm,
  setSpeaking,
  setMouthOpen,
  getAvatarWorldPosition,
} from './avatar/vrmAvatar.js';
import {
  initAudio as initSpeechAudio,
  playFromUrl,
  playTtsText,
  getMouthAmount,
  isPlaying as isSpeechPlaying,
  stopPlayback as stopSpeechPlayback,
} from './audio/speechPlayer.js';
import './style.css';

// Audio files expected in /public/audio:
// /audio/meditation_intro.mp3, /audio/q_mind_wandering.mp3, /audio/q_anxious.mp3, /audio/q_cant_focus.mp3

 // Wait for everything to load
 window.addEventListener("load", init);

  function init() {
    // Global variables
    let scene, camera, renderer;
    let player, navmesh;
    let musicElement = null;
    let audioIsPlaying = false;
    const SOMAFM_DRONEZONE_STREAM_URL = "https://ice5.somafm.com/dronezone-128-mp3";

   const playerHeight = 1.7; // Height of player camera (eye level) - INCREASED FROM 1.7
   const playerRadius = 0.5;
   const moveSpeed = 0.1;
   let velocity = new THREE.Vector3();
   let verticalVelocity = 0;
   const gravity = 0.01;
   let isOnGround = false;
   const jumpForce = 0.15;
   const clock = new THREE.Clock();
   let speechAudioInitialized = false;

   // Object to store loaded models
   let models = {};

   // For flower animation
   const flowerParts = [];
   const windSettings = {
     strength: 0.1, // How much the flowers move
     speed: 1.5, // How fast the wind blows
     chaos: 0.2, // Randomness in the wind
     maxAngle: 0.05, // Maximum angle in radians
   };

   // Audio control elements
   const playPauseButton = document.getElementById("play-pause");
   const volumeSlider = document.getElementById("volume-slider");
   const crosshairElement = document.getElementById("crosshair");
   const loadingElement = document.getElementById("loading");
   const loadingStatusElement = document.getElementById("loading-status");

   // Add event listeners for audio controls
   playPauseButton.addEventListener("click", toggleAudio);
   volumeSlider.addEventListener("input", updateVolume);
   // Initialize audio system
   setupAudio();

   const meditationUi = createMeditationUi();
   let meditationRunId = 0;
   let meditationUiVisible = false;
   const avatarShowDistanceMeters = 1.5;
   const avatarHideDistanceMeters = 1.55;
   const avatarWorldPosition = new THREE.Vector3();
   const playerWorldPosition = new THREE.Vector3();

   async function ensureSpeechAudioInitialized() {
     if (!speechAudioInitialized) {
       await initSpeechAudio();
       speechAudioInitialized = true;
     }
   }

   function stripSsml(ssml) {
    return ssml
      .replace(/<break\b[^>]*\/>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
   }

   async function playSpeech({ text, type = "text", caption, fallbackUrl } = {}) {
    const captionText =
      typeof caption === "string" && caption.trim()
        ? caption.trim()
        : type === "ssml"
          ? stripSsml(text || "")
          : (text || "");
    meditationUi.caption.textContent = captionText;
    await ensureSpeechAudioInitialized();
    const ttsStarted = await playTtsText(text, { type });
    if (ttsStarted) {
      await waitForSpeechToFinish();
      return true;
    }

    if (!fallbackUrl) {
      return false;
    }

    const fallbackStarted = await playFromUrl(fallbackUrl);
    if (!fallbackStarted) {
      console.warn(`Speech audio unavailable from API and fallback file: ${fallbackUrl}`);
      return false;
    }

    await waitForSpeechToFinish();
    return true;
   }

   async function waitForSpeechToFinish(timeoutMs = 240000) {
     const start = performance.now();
     let observedPlayback = false;

     while (performance.now() - start < timeoutMs) {
       const speaking = isSpeechPlaying();
       if (speaking) {
         observedPlayback = true;
       }
       if (observedPlayback && !speaking) {
         return;
       }
       await new Promise((resolve) => setTimeout(resolve, 80));
     }

     console.warn("Timed out while waiting for speech playback to finish");
   }

   async function waitWithRunGuard(ms, runId) {
     const startedAt = performance.now();
     while (performance.now() - startedAt < ms) {
       if (runId !== meditationRunId) {
         return false;
       }
       await new Promise((resolve) => setTimeout(resolve, 200));
     }
     return true;
   }

   async function runGuidedMeditation() {
     const runId = ++meditationRunId;
     const segments = [
       {
         text:
           "<speak>Welcome. <break time='400ms'/> Take a moment to settle into your space. <break time='600ms'/> Allow your body to be supported. <break time='500ms'/> Let your shoulders soften. <break time='500ms'/> Gently close your eyes, or lower your gaze. <break time='700ms'/> Begin by noticing your breath exactly as it is. <break time='500ms'/> No need to change it yet. <break time='500ms'/> Simply observe the inhale <break time='500ms'/> and the exhale. <break time='700ms'/> Feel the air entering through your nose <break time='400ms'/> and leaving your body again. <break time='700ms'/> There is nothing you need to do right now. <break time='500ms'/> Just arriving.</speak>",
         type: "ssml",
         caption:
           "Welcome. Take a moment to settle into your space. Allow your body to be supported. Let your shoulders soften. Gently close your eyes, or lower your gaze. Begin by noticing your breath exactly as it is. No need to change it yet. Simply observe the inhale and the exhale. Feel the air entering through your nose and leaving your body again. There is nothing you need to do right now. Just arriving.",
         pauseSeconds: 7,
       },
       {
         text:
           "<speak>Now we'll gently shape the breath. <break time='700ms'/> Inhale slowly for a count of four. <break time='300ms'/> One <break time='1000ms'/> two <break time='1000ms'/> three <break time='1000ms'/> four. <break time='1000ms'/> Hold the breath softly for two. <break time='1000ms'/> One <break time='1000ms'/> two. <break time='1000ms'/> Exhale slowly for six. <break time='300ms'/> One <break time='1000ms'/> two <break time='1000ms'/> three <break time='1000ms'/> four <break time='1000ms'/> five <break time='1000ms'/> six. <break time='400ms'/> Again. <break time='500ms'/> Inhale four. <break time='900ms'/> Hold two. <break time='700ms'/> Exhale six. <break time='1200ms'/> Let the exhale be smooth and unforced. <break time='600ms'/> With each breath, allow tension to drain downward.</speak>",
         type: "ssml",
         caption:
           "Now we'll gently shape the breath. Inhale slowly for a count of four. One two three four. Hold the breath softly for two. One two. Exhale slowly for six. One two three four five six. Again. Inhale four, hold two, exhale six. Let the exhale be smooth and unforced. With each breath, allow tension to drain downward.",
         pauseSeconds: 12,
       },
       {
         text:
           "<speak>Now allow your breathing to return to a natural rhythm. <break time='700ms'/> Bring awareness to the top of your head. <break time='500ms'/> Notice any sensations there. <break time='700ms'/> Gently scan down through your face, <break time='300ms'/> your jaw, <break time='300ms'/> your neck, <break time='300ms'/> your shoulders. <break time='800ms'/> If you find tension, acknowledge it kindly. <break time='500ms'/> And on the next exhale, invite it to soften. <break time='900ms'/> Continue scanning down the arms, <break time='300ms'/> the chest, <break time='300ms'/> the belly, <break time='300ms'/> the hips, <break time='300ms'/> the legs, <break time='400ms'/> all the way to the feet.</speak>",
         type: "ssml",
         caption:
           "Now allow your breathing to return to a natural rhythm. Bring awareness to the top of your head. Notice any sensations there. Gently scan down through your face, your jaw, your neck, your shoulders. If you find tension, acknowledge it kindly. And on the next exhale, invite it to soften. Continue scanning down the arms, the chest, the belly, the hips, the legs, all the way to the feet.",
         pauseSeconds: 18,
       },
       {
         text:
           "<speak>Now bring attention to the space of the mind. <break time='700ms'/> Thoughts may arise. <break time='500ms'/> That is natural. <break time='700ms'/> Rather than pushing them away, imagine watching them like clouds drifting across the sky. <break time='900ms'/> Notice them. <break time='400ms'/> Label them gently as thinking. <break time='700ms'/> And return to the breath. <break time='900ms'/> Each time you return, <break time='400ms'/> you are strengthening awareness.</speak>",
         type: "ssml",
         caption:
           "Now bring attention to the space of the mind. Thoughts may arise. That is natural. Rather than pushing them away, imagine watching them like clouds drifting across the sky. Notice them. Label them gently as thinking. And return to the breath. Each time you return, you are strengthening awareness.",
         pauseSeconds: 18,
       },
       {
         text:
           "<speak>Begin to deepen the breath slightly. <break time='700ms'/> Feel the surface beneath you. <break time='600ms'/> Notice the room around you. <break time='700ms'/> Bring small movement back into your fingers and toes. <break time='800ms'/> When you're ready, gently open your eyes. <break time='900ms'/> Carry this steadiness with you. <break time='600ms'/> You can return to this breath at any time.</speak>",
         type: "ssml",
         caption:
           "Begin to deepen the breath slightly. Feel the surface beneath you. Notice the room around you. Bring small movement back into your fingers and toes. When you're ready, gently open your eyes. Carry this steadiness with you. You can return to this breath at any time.",
       },
     ];

     for (let i = 0; i < segments.length; i += 1) {
       if (runId !== meditationRunId) {
         return;
       }

       const segment = segments[i];
       await playSpeech(segment);

       if (runId !== meditationRunId) {
         return;
       }

       if (typeof segment.pauseSeconds === "number" && segment.pauseSeconds > 0) {
         const pauseMs = Math.round(segment.pauseSeconds * 1000);
         const pauseSeconds = Math.round(segment.pauseSeconds * 10) / 10;
         meditationUi.caption.textContent = `Silence for ${pauseSeconds} seconds...`;
         const completedPause = await waitWithRunGuard(pauseMs, runId);
         if (!completedPause) {
           return;
         }
       }
     }

     if (runId === meditationRunId) {
       meditationUi.caption.textContent =
         "Meditation complete. Press Start Meditation to begin again.";
     }
   }

   function cancelMeditationRun() {
     meditationRunId += 1;
   }

   function setMeditationUiVisible(nextVisible) {
     if (meditationUiVisible === nextVisible) return;
     meditationUiVisible = nextVisible;
     meditationUi.root.classList.toggle("is-near-avatar", nextVisible);
     crosshairElement?.classList.toggle("is-hidden", nextVisible);

     if (!nextVisible) {
       cancelMeditationRun();
       stopSpeechPlayback();
       setSpeaking(false);
       setMouthOpen(0);
       meditationUi.caption.textContent = "Move closer to the guide to interact.";
     } else if (
       meditationUi.caption.textContent === "Move closer to the guide to interact."
     ) {
       meditationUi.caption.textContent =
         "Press the ESC key on your keyboard to show cursor. Click or tap Start Meditation to begin a guided reflection.";
     }
   }

   function updateMeditationUiProximity() {
     if (!player) {
       setMeditationUiVisible(false);
       return;
     }

     const avatarPosition = getAvatarWorldPosition(avatarWorldPosition);
     if (!avatarPosition) {
       setMeditationUiVisible(false);
       return;
     }

     player.getWorldPosition(playerWorldPosition);
     const dx = playerWorldPosition.x - avatarPosition.x;
     const dz = playerWorldPosition.z - avatarPosition.z;
     const horizontalDistance = Math.hypot(dx, dz);

     const threshold = meditationUiVisible
       ? avatarHideDistanceMeters
       : avatarShowDistanceMeters;
     setMeditationUiVisible(horizontalDistance <= threshold);
   }

   function createMeditationUi() {
     const root = document.createElement("div");
     root.id = "meditation-ui";

     const caption = document.createElement("div");
     caption.id = "meditation-caption";
     caption.textContent =
       "Press the ESC key on your keyboard to show cursor. Click or tap Start Meditation to begin a guided reflection.";

     const controls = document.createElement("div");
     controls.className = "meditation-buttons";

     const startButton = document.createElement("button");
     startButton.textContent = "Start Meditation";
     startButton.addEventListener("click", async () => {
       await runGuidedMeditation();
     });

     const q1 = document.createElement("button");
     q1.textContent = "My mind is wandering";
     q1.addEventListener("click", async () => {
       cancelMeditationRun();
       const text =
         "Noticing wandering is already awareness. Label the thought softly and return to your breath.";
       await playSpeech({ text, fallbackUrl: "/audio/q_mind_wandering.mp3" });
     });

     const q2 = document.createElement("button");
     q2.textContent = "I feel anxious";
     q2.addEventListener("click", async () => {
       cancelMeditationRun();
       const text =
         "Place one hand on your chest and lengthen your exhale. You are safe in this moment.";
       await playSpeech({ text, fallbackUrl: "/audio/q_anxious.mp3" });
     });

     const q3 = document.createElement("button");
     q3.textContent = "I cant focus";
     q3.addEventListener("click", async () => {
       cancelMeditationRun();
       const text =
         "Shrink your focus to one anchor: just the sensation of breathing at your nose for the next three breaths.";
       await playSpeech({ text, fallbackUrl: "/audio/q_cant_focus.mp3" });
     });

     controls.append(startButton, q1, q2, q3);
     root.append(caption, controls);
     document.body.appendChild(root);

     return { root, caption };
   }

   // Setup audio system
   function setupAudio() {
     musicElement = new Audio(SOMAFM_DRONEZONE_STREAM_URL);
     musicElement.preload = "none";
     musicElement.crossOrigin = "anonymous";
     musicElement.addEventListener("play", () => {
       audioIsPlaying = true;
       playPauseButton.textContent = "Pause Music";
     });
     musicElement.addEventListener("pause", () => {
       audioIsPlaying = false;
       playPauseButton.textContent = "Play Music";
     });
     musicElement.addEventListener("error", (error) => {
       console.error("Error loading SomaFM Drone Zone stream:", error);
     });
     updateVolume();
   }

   // Toggle audio playback
   async function toggleAudio() {
     if (!musicElement) {
       console.log("Audio stream is not initialized");
       return;
     }

     if (audioIsPlaying) {
       musicElement.pause();
     } else {
       try {
         await musicElement.play();
       } catch (error) {
         console.error("Could not start SomaFM Drone Zone stream:", error);
       }
     }
   }

   // Update audio volume
   function updateVolume() {
     const volumeValue = volumeSlider.value;

     if (musicElement) {
       musicElement.volume = volumeValue / 100;
     }
   }

   // Loading manager to track all model loading
   const loadingManager = new THREE.LoadingManager(
     // OnLoad - Called when all models are loaded
     function () {
       console.log("All models loaded successfully");
       loadingElement.style.display = "none";
     },
     // OnProgress - Called as loading progresses
     function (url, itemsLoaded, itemsTotal) {
       const progress = Math.round((itemsLoaded / itemsTotal) * 100);
       console.log(`Loading: ${progress}% (${itemsLoaded}/${itemsTotal})`);
       if (loadingStatusElement) {
         loadingStatusElement.textContent = `Loading... ${progress}%`;
       }
     },
     // OnError - Called when loading fails
     function (url) {
       console.error("Error loading:", url);
     }
   );

   // Player movement state
   const keys = {
     forward: false,
     backward: false,
     left: false,
     right: false,
     shift: false,
   };

   // Mouse controls
   let mouseEnabled = false;
   let mouseX = 0,
     mouseY = 0;
   let playerDirection = new THREE.Vector3(0, 0, -1);
   let euler = new THREE.Euler(0, 0, 0, "YXZ"); // YXZ order - yaw, pitch, then roll

   // Setup the scene
   function setupScene() {
     // Create scene
     scene = new THREE.Scene();

     // Create camera (first person)
     camera = new THREE.PerspectiveCamera(
       75,
       window.innerWidth / window.innerHeight,
       0.1,
       1000
     );
     camera.position.y = playerHeight;

     // Create renderer with HDR capabilities
     renderer = new THREE.WebGLRenderer({ antialias: true });
     renderer.setSize(window.innerWidth, window.innerHeight);
     renderer.shadowMap.enabled = true;
     renderer.toneMapping = ACESFilmicToneMapping;
     renderer.toneMappingExposure = 0.4; // Increased exposure for better brightness
     renderer.outputColorSpace = SRGBColorSpace;
     ColorManagement.enabled = true;
     document.body.appendChild(renderer.domElement);

     // Load environment map from EXR file
     loadEnvironmentMap();

     // Add lights - adjusted for better balance with environment lighting
     const ambientLight = new THREE.AmbientLight(0x92A0B5, 0.4); // Increased ambient intensity
     scene.add(ambientLight);

     // Directional light with improved shadow settings
     const directionalLight = new THREE.DirectionalLight(0xfff8e3, 0.6);
     directionalLight.position.set(15, 10, 7.5);

     // Shadow settings
     directionalLight.castShadow = true;

     // Adjust shadow camera to fix unwanted shadow artifacts
     directionalLight.shadow.mapSize.width = 2048;
     directionalLight.shadow.mapSize.height = 2048;

     // Increase shadow camera frustum to avoid shadow cutoff
     directionalLight.shadow.camera.left = -30;
     directionalLight.shadow.camera.right = 30;
     directionalLight.shadow.camera.top = 30;
     directionalLight.shadow.camera.bottom = -30;

     // Adjust shadow bias to fix shadow acne/artifacts
     directionalLight.shadow.bias = -0.001;

     // Increase shadow camera far plane
     directionalLight.shadow.camera.far = 50;

     // Set shadow camera near plane
     directionalLight.shadow.camera.near = 0.5;

     // Optional: Normalize shadow intensity
     directionalLight.shadow.normalBias = 0.02;

     scene.add(directionalLight);

     // Uncomment to debug shadow camera (shows the shadow camera frustum)
     // const shadowCameraHelper = new THREE.CameraHelper(directionalLight.shadow.camera);
     // scene.add(shadowCameraHelper);

     // Handle window resize
     window.addEventListener("resize", onWindowResize);
   }

   // Load environment map from HDR file
   function loadEnvironmentMap() {
     // Create a basic sky color as a fallback
     scene.background = new THREE.Color(0x87ceeb);

     // Load the HDR file
     const rgbeLoader = new RGBELoader();
     const hdrUrl = "/images/kloppenheim_06_puresky_2k.hdr";
     console.log("Loading HDR from:", hdrUrl);

     rgbeLoader.load(
       hdrUrl,
       function (texture) {
         console.log("HDR loaded successfully");

         // Setup proper texture mapping
         texture.mapping = THREE.EquirectangularReflectionMapping;

         // Using the built-in PMREMGenerator (no need for external script)
         const pmremGenerator = new THREE.PMREMGenerator(renderer);
         pmremGenerator.compileEquirectangularShader();

         // Process the environment map for proper PBR lighting
         const envMap =
           pmremGenerator.fromEquirectangular(texture).texture;

         // Apply to scene
         scene.environment = envMap;
         scene.background = envMap;

         // Clean up resources
         pmremGenerator.dispose();
         texture.dispose();

         console.log("Environment map processed and applied");
       },
        function (xhr) {
          console.log(
            "HDR loading: " + (xhr.loaded / xhr.total) * 100 + "%"
          );
        },
       function (error) {
         console.error("Error loading environment map:", error);
       }
     );
   }

   // Handle window resize
   function onWindowResize() {
     camera.aspect = window.innerWidth / window.innerHeight;
     camera.updateProjectionMatrix();
     renderer.setSize(window.innerWidth, window.innerHeight);
   }

   // Load multiple models
   function loadModels() {
     // Create a GLTFLoader that uses our loading manager
     const loader = new GLTFLoader(loadingManager);

     // Define all the models to load
     const modelsList = [
       {
         name: "terrain",
         url: "/models/terrain.glb",
         position: new THREE.Vector3(0, 0, 0),
         scale: new THREE.Vector3(1, 1, 1),
         rotation: new THREE.Euler(0, 0, 0),
       },
       {
         name: "navmesh",
         url: "/models/navmesh.glb",
         position: new THREE.Vector3(0, 0, 0),
         scale: new THREE.Vector3(1, 1, 1),
         rotation: new THREE.Euler(0, 0, 0),
       },
       {
         name: "stairs",
         url: "/models/stairs.glb",
         position: new THREE.Vector3(0, 0, 0),
         scale: new THREE.Vector3(1, 1, 1),
         rotation: new THREE.Euler(0, 0, 0),
       },
       {
         name: "temple",
         url: "/models/temple6.glb",
         position: new THREE.Vector3(0, 0, 0),
         scale: new THREE.Vector3(1, 1, 1),
         rotation: new THREE.Euler(0, 0, 0),
       },
       {
         name: "flowers",
         url: "/models/flowers.glb",
         position: new THREE.Vector3(0, 0, 0),
         scale: new THREE.Vector3(1, 1, 1),
         rotation: new THREE.Euler(0, 0, 0),
       },
       {
         name: "rocksmushrooms",
         url: "/models/rocksmushrooms.glb",
         position: new THREE.Vector3(0, 0, 0),
         scale: new THREE.Vector3(1, 1, 1),
         rotation: new THREE.Euler(0, 0, 0),
       },
     ];

     // Load each model
     modelsList.forEach((modelInfo) => {
       loader.load(
         modelInfo.url,
         function (gltf) {
           const model = gltf.scene;

           // Apply position, scale, and rotation
           model.position.copy(modelInfo.position);
           model.scale.copy(modelInfo.scale);
           model.rotation.copy(modelInfo.rotation);

           // Process materials based on model type
           if (modelInfo.name === "navmesh") {
             // Process navmesh materials
             const navmeshMaterial = new THREE.MeshBasicMaterial({
               color: 0x00ff00,
               wireframe: true,
               opacity: 0.3,
               transparent: true,
               visible: false, // Hide navmesh by default
             });

             model.traverse(function (node) {
               if (node.isMesh) {
                 node.material = navmeshMaterial;
                 node.castShadow = false;
                 node.receiveShadow = false;
               }
             });

             // Store reference to navmesh
             navmesh = model;
           }
           // Special handling for flowers to enable wind animation
           else if (modelInfo.name === "flowers") {
             // Process standard model materials
             model.traverse(function (node) {
               if (node.isMesh) {
                 node.castShadow = true;
                 node.receiveShadow = true;

                 // Store original positions and rotations for the animation
                 node.userData.originalPosition = node.position.clone();
                 node.userData.originalRotation = node.rotation.clone();

                 // Add some randomness to make the animation more natural
                 node.userData.windOffset = Math.random() * Math.PI * 2;
                 node.userData.windFactor = 0.8 + Math.random() * 0.4; // Between 0.8 and 1.2

                 // Add to flowerParts array for animation
                 flowerParts.push(node);

                 // Enhance materials to work with environment lighting
                 if (node.material) {
                   if (node.material.isMeshStandardMaterial) {
                     node.material.envMapIntensity = 0.7;
                     node.material.roughness = Math.max(
                       0.2,
                       node.material.roughness
                     );
                     node.material.metalness = Math.min(
                       0.8,
                       node.material.metalness
                     );
                   } else if (Array.isArray(node.material)) {
                     node.material.forEach((material) => {
                       if (material.isMeshStandardMaterial) {
                         material.envMapIntensity = 0.7;
                         material.roughness = Math.max(
                           0.2,
                           material.roughness
                         );
                         material.metalness = Math.min(
                           0.8,
                           material.metalness
                         );
                       }
                     });
                   }
                 }
               }
             });

             console.log(
               `Found ${flowerParts.length} meshes for flower animation`
             );
           } else {
             // Process standard model materials
             model.traverse(function (node) {
               if (node.isMesh) {
                 node.castShadow = true;
                 node.receiveShadow = true;

                 // Enhance materials to work with environment lighting
                 if (node.material) {
                   if (node.material.isMeshStandardMaterial) {
                     node.material.envMapIntensity = 0.7;
                     node.material.roughness = Math.max(
                       0.2,
                       node.material.roughness
                     );
                     node.material.metalness = Math.min(
                       0.8,
                       node.material.metalness
                     );
                   } else if (Array.isArray(node.material)) {
                     node.material.forEach((material) => {
                       if (material.isMeshStandardMaterial) {
                         material.envMapIntensity = 0.7;
                         material.roughness = Math.max(
                           0.2,
                           material.roughness
                         );
                         material.metalness = Math.min(
                           0.8,
                           material.metalness
                         );
                       }
                     });
                   }
                 }
               }
             });
           }

           // Store model in our models object for later access
           models[modelInfo.name] = model;

           // Add model to scene
           scene.add(model);

           console.log(`Model "${modelInfo.name}" loaded`);

           // Special case for navmesh: place player on it
            if (modelInfo.name === "navmesh" && player) {
              placePlayerOnNavmesh(new THREE.Vector3(0, 0, 7.5));
            }
         },
         function (xhr) {
           // Individual model loading progress
           console.log(
             `${modelInfo.name}: ${Math.round(
               (xhr.loaded / xhr.total) * 100
             )}% loaded`
           );
         },
         function (error) {
           console.error(`Error loading ${modelInfo.name}:`, error);

           // Handle fallbacks for critical models
           if (modelInfo.name === "temple") {
             createBackupTemple();
           } else if (modelInfo.name === "navmesh") {
             createBackupNavmesh();
           }
         }
       );
     });

     // Clean up roughness mipmapper after all models are loaded
     loadingManager.onLoad = function () {
       loadingElement.style.display = "none";

       // Suggest playing music once everything is loaded
        if (!audioIsPlaying) {
         // Show a hint that music is available
         playPauseButton.style.backgroundColor = "rgba(80, 200, 120, 0.3)";
         setTimeout(() => {
           playPauseButton.style.backgroundColor =
             "rgba(255, 255, 255, 0.2)";
         }, 2000);
       }
     };
   }

   // Create a simple backup temple if model fails to load
   function createBackupTemple() {
     // Floor
     const floorMaterial = new THREE.MeshStandardMaterial({
       color: 0x808080,
       roughness: 0.8,
       metalness: 0.2,
     });

     const floor = new THREE.Mesh(
       new THREE.BoxGeometry(50, 1, 50),
       floorMaterial
     );
     floor.position.y = -0.5;
     floor.receiveShadow = true;
     scene.add(floor);

     // Pillars
     const pillarMaterial = new THREE.MeshStandardMaterial({
       color: 0xcccccc,
       roughness: 0.7,
       metalness: 0.1,
     });

     for (let x = -15; x <= 15; x += 10) {
       for (let z = -15; z <= 15; z += 10) {
         const pillar = new THREE.Mesh(
           new THREE.BoxGeometry(2, 5, 2),
           pillarMaterial
         );
         pillar.position.set(x, 2.5, z);
         pillar.castShadow = true;
         pillar.receiveShadow = true;
         scene.add(pillar);
       }
     }

     // Central structure
     const centerMaterial = new THREE.MeshStandardMaterial({
       color: 0xaa8866,
       roughness: 0.5,
       metalness: 0.3,
     });

     const center = new THREE.Mesh(
       new THREE.BoxGeometry(8, 3, 8),
       centerMaterial
     );
     center.position.y = 1.5;
     center.castShadow = true;
     center.receiveShadow = true;
     scene.add(center);
   }

   // Create a simple backup navmesh
   function createBackupNavmesh() {
     const geometry = new THREE.BoxGeometry(50, 0.1, 50);
     const material = new THREE.MeshBasicMaterial({
       color: 0x00ff00,
       wireframe: true,
       opacity: 0.3,
       transparent: true,
       visible: false, // Hide navmesh by default
     });

     navmesh = new THREE.Mesh(geometry, material);
     navmesh.position.y = 0;
     scene.add(navmesh);

     // Place player on the backup navmesh
      placePlayerOnNavmesh(new THREE.Vector3(0, 0, 7.5));
   }

   // Initialize player
   function setupPlayer() {
     // Create a simple player representation (invisible in first person)
     const geometry = new THREE.CylinderGeometry(
       playerRadius,
       playerRadius,
       playerHeight,
       16
     );
     // Move the cylinder geometry so its bottom is at y=0 (feet level)
     geometry.translate(0, playerHeight / 2, 0);

     const material = new THREE.MeshPhongMaterial({
       color: 0xff0000,
       opacity: 0, // Invisible
       transparent: true,
     });

     player = new THREE.Mesh(geometry, material);
     player.position.y = 0; // Position at ground level
     player.castShadow = true;
     scene.add(player);

     // Add camera to player (at eye level)
     camera.position.set(0, playerHeight, 0);
     euler.y = 0; // Start facing 180 degrees from default forward
     camera.rotation.copy(euler);
     playerDirection.set(0, 0, -1).applyQuaternion(camera.quaternion);
     player.add(camera);

     // Setup listener for keyboard controls
     document.addEventListener("keydown", onKeyDown);
     document.addEventListener("keyup", onKeyUp);

     // Setup mouse controls
     renderer.domElement.addEventListener("click", function () {
       if (!mouseEnabled) {
         mouseEnabled = true;
         renderer.domElement.requestPointerLock();
       }
     });

     document.addEventListener("pointerlockchange", onPointerLockChange);
     document.addEventListener("mousemove", onMouseMove);

     // Add teleport click functionality
     setupTeleport();
   }

   // Key down handler
   function onKeyDown(event) {
     switch (event.code) {
       case "KeyW":
         keys.forward = true;
         break;
       case "KeyS":
         keys.backward = true;
         break;
       case "KeyA":
         keys.left = true;
         break;
       case "KeyD":
         keys.right = true;
         break;
       case "ShiftLeft":
       case "ShiftRight":
         keys.shift = true;
         break;
       case "Space":
         if (isOnGround) {
           verticalVelocity = jumpForce;
           isOnGround = false;
         }
         break;
       case "KeyT": // Toggle navmesh visibility
         toggleNavmeshVisibility();
         break;
       case "KeyM": // Toggle music with M key
         toggleAudio();
         break;
     }
   }

   // Key up handler
   function onKeyUp(event) {
     switch (event.code) {
       case "KeyW":
         keys.forward = false;
         break;
       case "KeyS":
         keys.backward = false;
         break;
       case "KeyA":
         keys.left = false;
         break;
       case "KeyD":
         keys.right = false;
         break;
       case "ShiftLeft":
       case "ShiftRight":
         keys.shift = false;
         break;
     }
   }

   // Pointer lock change handler
   function onPointerLockChange() {
     mouseEnabled = document.pointerLockElement === renderer.domElement;
   }

   // Mouse move handler
   function onMouseMove(event) {
     if (!mouseEnabled) return;

     // Calculate mouse movement delta
     const movementX = event.movementX || 0;
     const movementY = event.movementY || 0;

     // Update euler angles
     euler.y -= movementX * 0.002; // Yaw (left/right)
     euler.x -= movementY * 0.002; // Pitch (up/down)

     // Clamp vertical look
     euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));

     // Apply to camera
     camera.rotation.copy(euler);

     // Update player direction for movement
     playerDirection.set(0, 0, -1).applyQuaternion(camera.quaternion);
   }

   // Toggle navmesh visibility with T key
   function toggleNavmeshVisibility() {
     if (!navmesh) return;

     navmesh.traverse(function (node) {
       if (node.isMesh) {
         if (node.material.visible === true) {
           node.material.visible = false;
         } else {
           node.material.visible = true;
         }
       }
     });
   }

   // Fix shadow rendering issues
   function fixShadowArtifacts() {
     // Check for any objects that might be causing unwanted shadows
     scene.traverse(function (object) {
       // Look for any invisible objects that might be casting shadows
       if (object.isMesh && !object.visible) {
         object.castShadow = false;
       }

       // For navmesh objects, ensure they don't cast shadows
       if (
         object.isMesh &&
         object.material &&
         object.material.wireframe === true
       ) {
         object.castShadow = false;
       }
     });
   }

   // Setup teleport on navmesh click
   function setupTeleport() {
     const raycaster = new THREE.Raycaster();

     // Using mousedown instead of click for better responsiveness
     renderer.domElement.addEventListener("mousedown", function (event) {
       if (!mouseEnabled) return; // Only teleport when in pointer lock mode

       // Center screen raycast
       raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

       // Check for navmesh intersection
       const intersects = raycaster.intersectObject(navmesh, true);

       if (intersects.length > 0) {
         // Teleport player to clicked point
         const targetPosition = intersects[0].point.clone();
         player.position.x = targetPosition.x;
         player.position.z = targetPosition.z;
         player.position.y = targetPosition.y;

         // Reset vertical velocity after teleport
         verticalVelocity = 0;
       }
     });
   }

   // Place player on the navmesh at startup
   function placePlayerOnNavmesh(fallbackPosition) {
     if (!navmesh) {
       // Use fallback position if navmesh not loaded
       player.position.copy(fallbackPosition);
       return;
     }

     // Cast a ray down from above the specified position to find navmesh
     const raycaster = new THREE.Raycaster();
     const startPosition = new THREE.Vector3(
       fallbackPosition.x, // Use x coordinate from fallbackPosition
       100, // Start high up
       fallbackPosition.z // Use z coordinate from fallbackPosition
     );

     raycaster.set(startPosition, new THREE.Vector3(0, -1, 0));

     const intersects = raycaster.intersectObject(navmesh, true);

     if (intersects.length > 0) {
       // Place player directly on the navmesh surface (feet on ground)
       player.position.x = intersects[0].point.x;
       player.position.z = intersects[0].point.z;
       player.position.y = intersects[0].point.y;

       console.log("Player placed at position:", player.position);

       // Reset vertical velocity
       verticalVelocity = 0;
       isOnGround = true;
     } else {
       // Use fallback position if no intersection found
       console.log(
         "Navmesh intersection not found, using fallback position"
       );
       player.position.copy(fallbackPosition);
     }
   }

   // Check if a position is on the navmesh
   function checkIsOnNavmesh(x, z) {
     const raycaster = new THREE.Raycaster();
     const pos = new THREE.Vector3(x, 100, z); // Cast from high up
     raycaster.set(pos, new THREE.Vector3(0, -1, 0));

     const intersects = raycaster.intersectObject(navmesh, true);
     return intersects.length > 0;
   }

   // Update player movement
   function updatePlayerMovement() {
     // Skip if player or navmesh not loaded
     if (!player || !navmesh) return;

     // Calculate horizontal movement based on keys and direction
     velocity.set(0, 0, 0);

     // Get camera direction vectors
     const cameraDirection = new THREE.Vector3();
     camera.getWorldDirection(cameraDirection);
     cameraDirection.y = 0; // Keep movement on xz plane
     cameraDirection.normalize();

     // Calculate camera right vector
     const cameraRight = new THREE.Vector3(
       -cameraDirection.z,
       0,
       cameraDirection.x
     );

     // Calculate speed (faster with shift)
     const currentSpeed = keys.shift ? moveSpeed * 2 : moveSpeed;

     // Apply movement based on keys
     if (keys.forward) {
       velocity.add(cameraDirection.clone().multiplyScalar(currentSpeed));
     }
     if (keys.backward) {
       velocity.add(cameraDirection.clone().multiplyScalar(-currentSpeed));
     }
     if (keys.right) {
       velocity.add(cameraRight.clone().multiplyScalar(currentSpeed));
     }
     if (keys.left) {
       velocity.add(cameraRight.clone().multiplyScalar(-currentSpeed));
     }

     // If we have velocity, normalize for consistent speed in all directions
     if (velocity.lengthSq() > 0) {
       velocity.normalize().multiplyScalar(currentSpeed);
     }

     // Store current position for collision detection
     const oldPosition = player.position.clone();

     // Apply horizontal movement
     player.position.x += velocity.x;
     player.position.z += velocity.z;

     // Check if new horizontal position is on navmesh
     let isOnNavmesh = checkIsOnNavmesh(
       player.position.x,
       player.position.z
     );

     if (!isOnNavmesh) {
       // If not on navmesh, revert horizontal movement
       player.position.x = oldPosition.x;
       player.position.z = oldPosition.z;
     }

     // Apply gravity and vertical movement
     applyGravityAndVerticalMovement();
   }

   // Apply gravity and handle vertical movement
   function applyGravityAndVerticalMovement() {
     // Always apply gravity to vertical velocity
     verticalVelocity -= gravity;

     // Apply vertical velocity to position
     player.position.y += verticalVelocity;

     // Make sure we don't go below ground
     const raycaster = new THREE.Raycaster();
     const pos = new THREE.Vector3(
       player.position.x,
       player.position.y + 100, // Start from well above player
       player.position.z
     );
     raycaster.set(pos, new THREE.Vector3(0, -1, 0));

     const intersects = raycaster.intersectObject(navmesh, true);

     if (intersects.length > 0) {
       const groundY = intersects[0].point.y;

       // Check if we're at or below ground level
       if (player.position.y <= groundY) {
         // Place player directly on ground
         player.position.y = groundY;
         verticalVelocity = 0;
         isOnGround = true;
       } else {
         isOnGround = false;
       }
     } else {
       // No ground below us, keep falling
       isOnGround = false;

       // If we fall too far, reset position
       if (player.position.y < -50) {
         placePlayerOnNavmesh(new THREE.Vector3(0, 0, 8));
       }
     }
   }

   // Animate flowers to simulate wind blowing through them
   function animateFlowers(time) {
     // Skip if no flower parts to animate
     if (!flowerParts.length) return;

     // Animate each flower part
     flowerParts.forEach((flowerPart) => {
       // Skip if no userData is available
       if (!flowerPart.userData.originalRotation) return;

       // Calculate wind effect
       const windTime = time * windSettings.speed * 0.001;
       const windOffset = flowerPart.userData.windOffset || 0;
       const windFactor = flowerPart.userData.windFactor || 1;

       // Create a sine wave motion for natural swaying
       const windAmount =
         Math.sin(windTime + windOffset) *
         windSettings.strength *
         windFactor;

       // Add some chaos for more natural movement
       const chaosX =
         Math.sin(windTime * 1.3 + windOffset * 2) *
         windSettings.chaos *
         windFactor;
       const chaosZ =
         Math.cos(windTime * 0.7 + windOffset * 3) *
         windSettings.chaos *
         windFactor;

       // Apply rotation (clamped to maximum angle)
       const xAngle = Math.max(
         -windSettings.maxAngle,
         Math.min(windSettings.maxAngle, windAmount + chaosX)
       );
       const zAngle = Math.max(
         -windSettings.maxAngle,
         Math.min(windSettings.maxAngle, windAmount * 0.5 + chaosZ)
       );

       // Apply to model - add wind rotation to original rotation
       flowerPart.rotation.x =
         flowerPart.userData.originalRotation.x + xAngle;
       flowerPart.rotation.z =
         flowerPart.userData.originalRotation.z + zAngle;

       // Optional: slight position sway for added realism
       if (flowerPart.userData.originalPosition) {
         flowerPart.position.x =
           flowerPart.userData.originalPosition.x + chaosX * 0.02;
         flowerPart.position.z =
           flowerPart.userData.originalPosition.z + chaosZ * 0.02;
       }
     });
   }

   // Animation loop
   function animate(time) {
     requestAnimationFrame(animate);
     const delta = clock.getDelta();

     // Update player movement
     updatePlayerMovement();

     // Animate flowers if we have any
     animateFlowers(time);

     updateVrm(delta);
     updateMeditationUiProximity();

     const speaking = isSpeechPlaying();
     setSpeaking(speaking);
     if (speaking) {
       setMouthOpen(getMouthAmount());
     } else {
       setMouthOpen(0);
     }

     // Render
     renderer.render(scene, camera);
   }

   // Initialize
   function start() {
     setupScene();
     setupPlayer();
     loadEnvironmentMap();
     loadModels(); // Load all models at once
      loadVrmAvatar({
        scene,
        url: "/models/yogawoman_idle.glb",
        position: new THREE.Vector3(0, 0, 6.342),
        animationClipName: "clip_idle",
      }).catch((error) => {
        console.warn("Failed to load avatar /models/yogawoman_idle.glb", error);
      });

     // Fix any shadow issues after a short delay to ensure all models are loaded
     setTimeout(fixShadowArtifacts, 2000);

     // Start animation loop - pass in time
     requestAnimationFrame(animate);
   }

   // Start the application
   start();
 }
