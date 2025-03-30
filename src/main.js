import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { ColorManagement, SRGBColorSpace, ACESFilmicToneMapping } from 'three';
import './style.css';

 // Wait for everything to load
 window.addEventListener("load", init);

 function init() {
   // Global variables
   let scene, camera, renderer;
   let player, navmesh;
   let audioContext, audioSource, gainNode;
   let audioBuffer,
     audioIsPlaying = false;
   let audioInitialized = false;

   const playerHeight = 3.1; // Height of player camera (eye level) - INCREASED FROM 1.7
   const playerRadius = 0.5;
   const moveSpeed = 0.1;
   let velocity = new THREE.Vector3();
   let verticalVelocity = 0;
   const gravity = 0.01;
   let isOnGround = false;
   const jumpForce = 0.25;

   // Object to store loaded models
   let models = {};

   // For flower animation
   const flowerParts = [];
   const windSettings = {
     strength: 0.1, // How much the flowers move
     speed: 1.5, // How fast the wind blows
     chaos: 0.2, // Randomness in the wind
     maxAngle: 0.15, // Maximum angle in radians
   };

   // Initialize audio system
   setupAudio();

   // Audio control elements
   const playPauseButton = document.getElementById("play-pause");
   const volumeSlider = document.getElementById("volume-slider");
   const volumeLabel = document.getElementById("volume-label");

   // Add event listeners for audio controls
   playPauseButton.addEventListener("click", toggleAudio);
   volumeSlider.addEventListener("input", updateVolume);

   // Setup audio system
   function setupAudio() {
     // Use click anywhere on the document to initialize audio (browser requirement)
     document.addEventListener("click", initializeAudioContext, {
       once: true,
     });

     // Pre-load the audio file
     const audioUrl = "/audio/innerpeace.mp3";
     console.log("Preloading audio from:", audioUrl);
     // Fetch the audio file and convert it to an ArrayBuffer
     // This is to ensure the audio file is loaded before we try to play it
     fetch(audioUrl)
       .then((response) => response.arrayBuffer())
       .then((arrayBuffer) => {
         // Store the audio buffer for later use when context is created
         audioBuffer = arrayBuffer;
         console.log("Audio file preloaded");
       })
       .catch((error) => {
         console.error("Error loading audio file:", error);
       });
   }

   // Initialize AudioContext on user interaction (required by browsers)
   function initializeAudioContext() {
     if (audioInitialized) return;

     try {
       // Create audio context
       audioContext = new (window.AudioContext ||
         window.webkitAudioContext)();

       // Create gain node for volume control
       gainNode = audioContext.createGain();
       gainNode.gain.value = volumeSlider.value / 100;
       gainNode.connect(audioContext.destination);

       // If we've already loaded the buffer, decode it now
       if (audioBuffer) {
         audioContext
           .decodeAudioData(audioBuffer)
           .then((decodedData) => {
             audioBuffer = decodedData;
             console.log("Audio ready to play");
           })
           .catch((err) =>
             console.error("Error decoding audio data", err)
           );
       }

       audioInitialized = true;
       console.log("Audio context initialized");
     } catch (e) {
       console.error("Web Audio API not supported in this browser:", e);
     }
   }

   // Toggle audio playback
   function toggleAudio() {
     if (!audioInitialized || !audioBuffer) {
       console.log("Audio not yet initialized or loaded");
       return;
     }

     if (audioIsPlaying) {
       // Stop audio
       if (audioSource) {
         audioSource.stop();
         audioSource = null;
       }
       audioIsPlaying = false;
       playPauseButton.textContent = "Play Music";
     } else {
       // Start audio
       audioSource = audioContext.createBufferSource();
       audioSource.buffer = audioBuffer;
       audioSource.loop = true;
       audioSource.connect(gainNode);
       audioSource.start(0);
       audioIsPlaying = true;
       playPauseButton.textContent = "Pause Music";
     }
   }

   // Update audio volume
   function updateVolume() {
     const volumeValue = volumeSlider.value;
     volumeLabel.textContent = `Volume: ${volumeValue}%`;

     if (gainNode) {
       gainNode.gain.value = volumeValue / 100;
     }
   }

   // Loading manager to track all model loading
   const loadingManager = new THREE.LoadingManager(
     // OnLoad - Called when all models are loaded
     function () {
       console.log("All models loaded successfully");
       document.getElementById("loading").style.display = "none";
     },
     // OnProgress - Called as loading progresses
     function (url, itemsLoaded, itemsTotal) {
       const progress = Math.round((itemsLoaded / itemsTotal) * 100);
       console.log(`Loading: ${progress}% (${itemsLoaded}/${itemsTotal})`);
       document.getElementById(
         "loading"
       ).textContent = `Loading... ${progress}%`;
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
     renderer.toneMappingExposure = 0.5; // Increased exposure for better brightness
     renderer.outputColorSpace = SRGBColorSpace;
     ColorManagement.enabled = true;
     document.body.appendChild(renderer.domElement);

     // Load environment map from EXR file
     loadEnvironmentMap();

     // Add lights - adjusted for better balance with environment lighting
     const ambientLight = new THREE.AmbientLight(0xe4e8ff, 0.4); // Increased ambient intensity
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

   // Load environment map from EXR file
   function loadEnvironmentMap() {
     // Create a basic sky color as a fallback
     scene.background = new THREE.Color(0x87ceeb);

     // Load the EXR file
     const exrLoader = new EXRLoader();
     const exrUrl = "/images/drackenstein_quarry_puresky_1k.exr";
     console.log("Loading EXR from:", exrUrl);

     exrLoader.load(
       exrUrl,
       function (texture) {
         console.log("EXR loaded successfully");

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
           "EXR loading: " + (xhr.loaded / xhr.total) * 100 + "%"
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
             placePlayerOnNavmesh(new THREE.Vector3(0, 10, 18));
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
       document.getElementById("loading").style.display = "none";

       // Suggest playing music once everything is loaded
       if (audioBuffer && !audioIsPlaying) {
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
     placePlayerOnNavmesh(new THREE.Vector3(0, 2, 0));
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
         placePlayerOnNavmesh(new THREE.Vector3(0, 10, 0));
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

     // Update player movement
     updatePlayerMovement();

     // Animate flowers if we have any
     animateFlowers(time);

     // Render
     renderer.render(scene, camera);
   }

   // Initialize
   function start() {
     setupScene();
     setupPlayer();
     loadEnvironmentMap();
     loadModels(); // Load all models at once

     // Fix any shadow issues after a short delay to ensure all models are loaded
     setTimeout(fixShadowArtifacts, 2000);

     // Start animation loop - pass in time
     requestAnimationFrame(animate);
   }

   // Start the application
   start();
 }