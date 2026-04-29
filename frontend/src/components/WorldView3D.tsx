import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { WorldSnapshot } from "../types";

type Props = {
  world: WorldSnapshot;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
};

export function WorldView3D({ world, selectedAgentId, onSelectAgent }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const clickTargetsRef = useRef<THREE.Object3D[]>([]);
  const selectRef = useRef(onSelectAgent);
  selectRef.current = onSelectAgent;

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const container = containerRef.current;
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0xf8fafc);
    const camera = new THREE.PerspectiveCamera(48, container.clientWidth / container.clientHeight, 1, 5000);
    camera.position.set(0, 780, 980);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.72);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(300, 800, 400);
    scene.add(sun);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const resize = () => {
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    const onPointerDown = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(clickTargetsRef.current, false)[0];
      const agentId = hit?.object.userData.agentId;
      if (agentId) {
        selectRef.current(agentId);
      }
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.dispose();
      container.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) {
      return;
    }
    scene.clear();
    scene.background = new THREE.Color(0xf8fafc);
    clickTargetsRef.current = [];

    const ambient = new THREE.AmbientLight(0xffffff, 0.72);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(300, 800, 400);
    scene.add(sun);
    buildScene(scene, clickTargetsRef.current, world, selectedAgentId);
  }, [world, selectedAgentId]);

  return <div className="world-surface" data-testid="world-3d" ref={containerRef} />;
}

function buildScene(
  scene: THREE.Scene,
  clickTargets: THREE.Object3D[],
  world: WorldSnapshot,
  selectedAgentId: string | null
) {
  const map = world.map;
  const originX = map.width / 2;
  const originY = map.height / 2;

  const floorGeometry = new THREE.PlaneGeometry(map.width, map.height);
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.02
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  world.map.walkable_areas.forEach((area) => {
    const mesh = shapeMesh(area.points, originX, originY, 0x86efac, 0.18, 2);
    scene.add(mesh);
  });
  world.map.interaction_zones.forEach((area) => {
    const mesh = shapeMesh(area.points, originX, originY, 0x38bdf8, 0.26, 4);
    scene.add(mesh);
  });
  world.map.obstacles.forEach((area) => {
    const mesh = shapeMesh(area.points, originX, originY, 0xef4444, 0.58, 44);
    scene.add(mesh);
  });

  world.map.items.forEach((item) => {
    const geometry = new THREE.CylinderGeometry(item.radius, item.radius, 42, 24);
    const material = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.55 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(item.position.x - originX, 22, item.position.y - originY);
    scene.add(mesh);
  });

  Object.values(world.agent_profiles).forEach((profile) => {
    const state = world.agent_states[profile.id];
    if (!state) {
      return;
    }
    const group = new THREE.Group();
    group.userData.agentId = profile.id;
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(18, 42, 8, 16),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(profile.color),
        roughness: 0.42
      })
    );
    body.userData.agentId = profile.id;
    group.add(body);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(24, selectedAgentId === profile.id ? 3.5 : 1.5, 8, 40),
      new THREE.MeshBasicMaterial({ color: selectedAgentId === profile.id ? 0x111827 : 0xffffff })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -18;
    group.add(ring);
    group.position.set(state.position.x - originX, 48, state.position.y - originY);
    scene.add(group);
    clickTargets.push(body);
  });
}

function shapeMesh(points: { x: number; y: number }[], originX: number, originY: number, color: number, opacity: number, height: number) {
  const shape = new THREE.Shape();
  points.forEach((point, index) => {
    const x = point.x - originX;
    const y = point.y - originY;
    if (index === 0) {
      shape.moveTo(x, y);
    } else {
      shape.lineTo(x, y);
    }
  });
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, height / 2, 0);
  const material = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity,
    roughness: 0.78,
    side: THREE.DoubleSide
  });
  return new THREE.Mesh(geometry, material);
}
