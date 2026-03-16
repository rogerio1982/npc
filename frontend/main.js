import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

let scene, camera, renderer;
let npc, npcMixer;
let npcActions = [];
let currentNpcAction = null;
const IDLE_ACTION_INDEX = 0; // animação de idle/movimento leve do modelo
const BASE_POSE_ACTION_INDEX = 2; // animação que você usa como "parado" (Ação 2)
let npcBaseY = 0;
let npcBaseRotY = Math.PI;
let clock = new THREE.Clock();
let isTalking = false;
let talkTime = 0;

// Camera control state
let camRadius = 10;
let camAngle = 0; // em radianos, 0 = olhando no -Z
let camHeight = 4;
let camTargetY = 4.2;

const sceneContainer = document.getElementById("scene-container");
const messagesEl = document.getElementById("messages");
const voiceToggleBtn = document.getElementById("voice-toggle");
const voiceStatusEl = document.getElementById("voice-status");
const camZoomInBtn = document.getElementById("cam-zoom-in");
const camZoomOutBtn = document.getElementById("cam-zoom-out");
const camRotateLeftBtn = document.getElementById("cam-rotate-left");
const camRotateRightBtn = document.getElementById("cam-rotate-right");
const actionIdleBtn = document.getElementById("action-idle");
const actionOneBtn = document.getElementById("action-action1");
const actionTwoBtn = document.getElementById("action-action2");

// Voice input (speech recognition)
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;
let listenRequested = false;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = true; // escuta contínua
  recognition.interimResults = false;
} else {
  console.warn("SpeechRecognition not supported in this browser.");
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050816);

  const width = sceneContainer.clientWidth || window.innerWidth;
  const height = sceneContainer.clientHeight || window.innerHeight * 0.6;

  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  // Posição inicial será derivada do estado de câmera
  updateCameraFromState();

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  sceneContainer.appendChild(renderer.domElement);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x111827, 0.9);
  hemiLight.position.set(0, 3, 0);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(3, 5, 4);
  dirLight.castShadow = true;
  scene.add(dirLight);

  const groundGeo = new THREE.CircleGeometry(3.5, 64);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x1f2933,
    roughness: 0.8,
    metalness: 0.1,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const loader = new GLTFLoader();
  // Load RobotExpressive model directly from the three.js examples repository
  loader.load(
    "https://raw.githubusercontent.com/mrdoob/three.js/master/examples/models/gltf/RobotExpressive/RobotExpressive.glb",
    (gltf) => {
      console.log("GLTF loaded:", gltf);

      npc = gltf.scene;
      npc.traverse((obj) => {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });

      // Configuração simples e estável específica para o RobotExpressive:
      // - levemente maior
      // - pés próximos do chão
      npc.scale.set(2.0, 2.0, 2.0);
      npc.position.set(0, 0.0, 0);
      npc.rotation.y = Math.PI;

      // Define o estado da câmera em torno do NPC
      camRadius = 20;
      camAngle = 160;
      camHeight = 4;
      camTargetY = 4.2;
      updateCameraFromState();

      

      npcBaseY = npc.position.y;
      npcBaseRotY = npc.rotation.y;

      scene.add(npc);

      // Configura o mixer e guarda as ações (animações) disponíveis
      if (gltf.animations && gltf.animations.length > 0) {
        npcMixer = new THREE.AnimationMixer(npc);
        npcActions = gltf.animations.map((clip) =>
          npcMixer.clipAction(clip)
        );

        // Inicia na animação "parado" (Ação 2), se existir; caso contrário, usa Idle (0)
        const startIndex = npcActions[BASE_POSE_ACTION_INDEX]
          ? BASE_POSE_ACTION_INDEX
          : IDLE_ACTION_INDEX;
        currentNpcAction = npcActions[startIndex];
        currentNpcAction.play();
      }
    },
    undefined,
    (error) => {
      console.warn("Failed to load npc.glb, using fallback cube.", error);
      const geo = new THREE.BoxGeometry(0.7, 1.6, 0.4);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x60a5fa,
        roughness: 0.4,
      });
      npc = new THREE.Mesh(geo, mat);
      npc.position.set(0, 0.8, 0);
      npcBaseY = npc.position.y;
      npcBaseRotY = npc.rotation.y;
      scene.add(npc);
    }
  );

  window.addEventListener("resize", onWindowResize);

  animate();
}

function onWindowResize() {
  if (!renderer || !camera) return;

  const width = sceneContainer.clientWidth || window.innerWidth;
  const height = sceneContainer.clientHeight || window.innerHeight * 0.6;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (npcMixer) {
    npcMixer.update(delta);
  }

  if (npc) {
    if (!isTalking) {
      // Quando não está falando, deixamos apenas a animação do próprio modelo (Idle)
    } else {
      // Falando: movimento bem mais visível
      talkTime += delta;
      npc.position.y = npcBaseY + 0.14 * Math.sin(talkTime * 6.0);
      npc.rotation.y = npcBaseRotY + 0.22 * Math.sin(talkTime * 8.0);
      npc.rotation.x = 0.10 * Math.sin(talkTime * 5.0);
    }
  }

  renderer.render(scene, camera);
}

function addMessage(text, sender) {
  const div = document.createElement("div");
  div.className = `message ${sender}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function speak(text) {
  if (!("speechSynthesis" in window)) {
    console.warn("SpeechSynthesis not supported in this browser.");
    return;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  const voices = window.speechSynthesis.getVoices();
  // Prefer an English voice that is not explicitly labeled as female
  const englishVoice =
    voices.find((v) => v.lang.startsWith("en") && !/female/i.test(v.name)) ||
    voices.find((v) => v.lang.startsWith("en")) ||
    null;
  if (englishVoice) {
    utterance.voice = englishVoice;
  }

  utterance.onstart = () => {
    isTalking = true;
    talkTime = 0;

    // Quando começar a falar: usar animação Idle (movimento)
    playNpcActionByIndex(IDLE_ACTION_INDEX);
  };

  utterance.onend = () => {
    isTalking = false;
    if (npc) {
      npc.rotation.y = npcBaseRotY;
      npc.rotation.x = 0;
      npc.position.y = npcBaseY;
    }

    // Depois de falar: voltar para a pose parada (Ação 2)
    playNpcActionByIndex(BASE_POSE_ACTION_INDEX);
  };

  window.speechSynthesis.speak(utterance);
}

// ---------------------------------------------------------------------------
// Session management — persists session_id in localStorage so the
// conversation survives a page refresh (history is stored server-side in SQLite)
// ---------------------------------------------------------------------------
let sessionId = localStorage.getItem("npc_session_id") || null;

async function ensureSession() {
  if (sessionId) return;
  try {
    const res = await fetch("/session/new", { method: "POST" });
    const data = await res.json();
    sessionId = data.session_id;
    localStorage.setItem("npc_session_id", sessionId);
  } catch (err) {
    console.error("Could not create session:", err);
  }
}

async function sendMessage(message) {
  await ensureSession();
  addMessage(message, "user");

  if (voiceStatusEl) {
    voiceStatusEl.textContent = "Thinking...";
  }

  try {
    const response = await fetch("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message, session_id: sessionId }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const data = await response.json();
    // Keep local session_id in sync (server may assign one on first message)
    if (data.session_id && data.session_id !== sessionId) {
      sessionId = data.session_id;
      localStorage.setItem("npc_session_id", sessionId);
    }
    const reply = data.reply || "I'm here to help you practice English.";
    addMessage(reply, "npc");
    speak(reply);
  } catch (err) {
    console.error(err);
    const fallback =
      "Sorry, I could not reach the tutor service. Please check that the backend server is running.";
    addMessage(fallback, "npc");
    speak(fallback);
  } finally {
    if (voiceStatusEl && !isListening) {
      voiceStatusEl.textContent = "Pronto para ouvir";
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  initScene();
  addMessage(
    "Hello! I'm your 3D English tutor. Type a sentence in English and press Send.",
    "npc"
  );
});

// --- Camera & action control helpers ---
function updateCameraFromState() {
  if (!camera) return;
  camera.position.x = camRadius * Math.sin(camAngle);
  camera.position.z = camRadius * Math.cos(camAngle);
  camera.position.y = camHeight;
  camera.lookAt(0, camTargetY, 0);
}

function playNpcActionByIndex(index) {
  if (!npcMixer || !npcActions[index]) return;
  const next = npcActions[index];
  if (currentNpcAction === next) return;

  next.reset().fadeIn(0.2).play();
  if (currentNpcAction) {
    currentNpcAction.fadeOut(0.2);
  }
  currentNpcAction = next;
}

if (camZoomInBtn && camZoomOutBtn && camRotateLeftBtn && camRotateRightBtn) {
  camZoomInBtn.addEventListener("click", () => {
    camRadius = Math.max(4, camRadius - 1);
    updateCameraFromState();
  });

  camZoomOutBtn.addEventListener("click", () => {
    camRadius = Math.min(20, camRadius + 1);
    updateCameraFromState();
  });

  camRotateLeftBtn.addEventListener("click", () => {
    camAngle -= Math.PI / 16;
    updateCameraFromState();
  });

  camRotateRightBtn.addEventListener("click", () => {
    camAngle += Math.PI / 16;
    updateCameraFromState();
  });
}

if (actionIdleBtn && actionOneBtn && actionTwoBtn) {
  actionIdleBtn.addEventListener("click", () => {
    playNpcActionByIndex(0); // Idle
  });
  actionOneBtn.addEventListener("click", () => {
    playNpcActionByIndex(1); // Ação 1 (por ex. andar)
  });
  actionTwoBtn.addEventListener("click", () => {
    playNpcActionByIndex(2); // Ação 2 (por ex. dançar)
  });
}

// Voice recognition wiring
if (recognition && voiceToggleBtn) {
  voiceToggleBtn.addEventListener("click", () => {
    if (isListening) {
      // Usuário clicou para parar
      listenRequested = false;
      recognition.stop();
    } else {
      try {
        listenRequested = true;
        recognition.start();
      } catch (e) {
        // start foi chamado enquanto já está ativo; ignorar
      }
    }
  });

  recognition.onstart = () => {
    isListening = true;
    if (voiceToggleBtn) voiceToggleBtn.textContent = "■ Parar";
    if (voiceToggleBtn) voiceToggleBtn.classList.add("listening");
    if (voiceStatusEl) voiceStatusEl.textContent = "Ouvindo... fale em inglês";
  };

  recognition.onend = () => {
    // Se ainda queremos continuar ouvindo, reinicia (para frases longas / pausas)
    if (listenRequested) {
      try {
        recognition.start();
        return;
      } catch (e) {
        console.error("Failed to restart recognition", e);
      }
    }

    // Caso contrário, para completamente
    isListening = false;
    if (voiceToggleBtn) {
      voiceToggleBtn.classList.remove("listening");
      voiceToggleBtn.textContent = "🎤 Falar";
    }
    if (voiceStatusEl) voiceStatusEl.textContent = "Pronto para ouvir";
  };

  recognition.onerror = (event) => {
    console.error("Speech recognition error", event);
    if (voiceStatusEl)
      voiceStatusEl.textContent = "Erro ao ouvir. Tente novamente.";
  };

  recognition.onresult = (event) => {
    const result = event.results[0][0];
    const transcript = result.transcript.trim();
    if (!transcript) return;
    sendMessage(transcript);
  };
} else if (voiceToggleBtn && voiceStatusEl) {
  voiceToggleBtn.disabled = true;
  voiceStatusEl.textContent =
    "Reconhecimento de voz não suportado neste navegador.";
}
