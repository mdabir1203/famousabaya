import { useRef, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { cameraAtFrame, FPS } from "../chapters";

/**
 * 3D scene rendered every frame.
 *
 * The scene is the same factory floor + cloud + worker geometry from
 * the explainer HTML. The camera is moved frame-by-frame using the
 * per-chapter waypoints defined in `chapters.ts`.
 */
const WORKER_COLORS = [0xf87171, 0xfde68a, 0x4ade80, 0x60a5fa, 0xb39bff, 0x5eead4];
const RING_RADIUS = 11;
const FLOOR_RADIUS = 12;
const WORKER_RADIUS = 6.5;
const HUB_Y = -1.4;
const CLOUD_Y = 6;
const CLOUD_Z = -4;

export const ThreeScene: React.FC = () => {
  const workers = useRef<THREE.Group[]>([]);
  const packets = useRef<THREE.Mesh[]>([]);
  const cloudRef = useRef<THREE.Mesh>(null!);
  const cloudInnerRef = useRef<THREE.Mesh>(null!);
  const ringRef = useRef<THREE.Mesh>(null!);
  const floorRef = useRef<THREE.Mesh>(null!);
  const hubRef = useRef<THREE.Group>(null!);

  // Hoist useThree out of the per-frame callback — hooks must not be called inside loops.
  const { camera, gl } = useThree();

  // Memoize geometries/materials once
  const sceneParts = useMemo(() => {
    // hub (factory laptop)
    const hub = (
      <group ref={hubRef} position={[0, HUB_Y, 0]}>
        <mesh>
          <boxGeometry args={[1.6, 0.18, 1.0]} />
          <meshStandardMaterial
            color={0xb39bff}
            roughness={0.4}
            metalness={0.6}
            emissive={0x2a1f5a}
            emissiveIntensity={0.4}
          />
        </mesh>
        <mesh position={[0, 0.5, -0.45]} rotation={[-0.3, 0, 0]}>
          <planeGeometry args={[1.4, 0.85]} />
          <meshBasicMaterial color={0x5eead4} transparent opacity={0.7} />
        </mesh>
      </group>
    );

    // floor disc
    const floor = (
      <mesh ref={floorRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -2, 0]}>
        <circleGeometry args={[FLOOR_RADIUS, 64]} />
        <meshStandardMaterial color={0x14181f} roughness={0.9} metalness={0.1} transparent opacity={0.5} />
      </mesh>
    );

    // grid
    const grid = (
      <gridHelper args={[30, 30, 0x1d242e, 0x14181f]} position={[0, -1.99, 0]} />
    );

    // ring
    const ring = (
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]} position={[0, -1.95, 0]}>
        <torusGeometry args={[RING_RADIUS, 0.04, 8, 96]} />
        <meshBasicMaterial color={0xb39bff} transparent opacity={0.5} />
      </mesh>
    );

    // 6 worker nodes
    const workerNodes = WORKER_COLORS.map((c, i) => {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * WORKER_RADIUS;
      const z = Math.sin(a) * WORKER_RADIUS;
      return (
        <group
          key={i}
          ref={(el) => { if (el) workers.current[i] = el; }}
          position={[x, HUB_Y, z]}
        >
          <mesh position={[0, 0.45, 0]}>
            <boxGeometry args={[0.6, 0.9, 0.6]} />
            <meshStandardMaterial color={c} roughness={0.5} metalness={0.3} emissive={c} emissiveIntensity={0.15} />
          </mesh>
          <mesh position={[0, 1.15, 0]}>
            <sphereGeometry args={[0.22, 12, 12]} />
            <meshStandardMaterial color={0xe7eaef} roughness={0.5} />
          </mesh>
        </group>
      );
    });

    // cloud (icosahedron wireframe)
    const cloud = (
      <mesh ref={cloudRef} position={[0, CLOUD_Y, CLOUD_Z]}>
        <icosahedronGeometry args={[2.2, 1]} />
        <meshStandardMaterial
          color={0x5eead4}
          wireframe
          transparent
          opacity={0.55}
          emissive={0x0d3d35}
          emissiveIntensity={0.5}
        />
      </mesh>
    );
    const cloudInner = (
      <mesh ref={cloudInnerRef} position={[0, CLOUD_Y, CLOUD_Z]}>
        <icosahedronGeometry args={[1.4, 0]} />
        <meshStandardMaterial
          color={0x5eead4}
          transparent
          opacity={0.12}
          emissive={0x5eead4}
          emissiveIntensity={0.3}
        />
      </mesh>
    );

    // 12 data packets — distributed around the hub so they form a stream, not a column
    const packetNodes = Array.from({ length: 12 }, (_, i) => {
      const angle = (i / 12) * Math.PI * 2;
      return (
        <mesh
          key={i}
          ref={(el) => { if (el) packets.current[i] = el; }}
        >
          <boxGeometry args={[0.12, 0.12, 0.12]} />
          <meshBasicMaterial color={0xffffff} transparent opacity={0.95} />
        </mesh>
      );
    });

    return { hub, floor, grid, ring, workerNodes, cloud, cloudInner, packetNodes };
  }, []);

  // per-frame animation
  useFrame((_: unknown, deltaInSeconds: number) => {
    const dt = Math.min(deltaInSeconds, 0.1);
    const frame = gl.info.render.frame;
    const t = frame * (1 / FPS);

    // camera per chapter waypoint
    const camState = cameraAtFrame(frame);
    camera.position.set(camState.x, camState.y, camState.z);
    camera.lookAt(camState.look[0], camState.look[1], camState.look[2]);

    if (ringRef.current) ringRef.current.rotation.z += dt * 0.05;
    if (floorRef.current) floorRef.current.rotation.z -= dt * 0.02;

    if (hubRef.current) {
      hubRef.current.position.y = HUB_Y + Math.sin(t * 0.8) * 0.08;
      hubRef.current.rotation.y = Math.sin(t * 0.3) * 0.15;
    }

    // workers slow orbit
    workers.current.forEach((w, i) => {
      if (!w) return;
      const a = (i / 6) * Math.PI * 2 + t * 0.06 + i * 0.01;
      w.position.x = Math.cos(a) * WORKER_RADIUS;
      w.position.z = Math.sin(a) * WORKER_RADIUS;
      w.position.y = HUB_Y + Math.sin(t * 1.2 + i) * 0.18;
      w.rotation.y = -a + Math.PI;
    });

    // cloud
    if (cloudRef.current) {
      cloudRef.current.rotation.x += dt * 0.08;
      cloudRef.current.rotation.y += dt * 0.12;
      cloudRef.current.position.y = CLOUD_Y + Math.sin(t * 0.5) * 0.4;
    }
    if (cloudInnerRef.current) {
      cloudInnerRef.current.rotation.y -= dt * 0.05;
      cloudInnerRef.current.position.y = CLOUD_Y + Math.sin(t * 0.5) * 0.4;
    }

    // data packets — fly along hub→cloud or cloud→hub, spread on a circle so they form a real stream
    packets.current.forEach((p, i) => {
      if (!p) return;
      const dir = i % 2 === 0 ? 1 : -1;
      const speed = 0.0015 + ((i * 137) % 100) / 100 * 0.0025;
      // pseudo-random phase per packet
      const phase = (i * 73 + t * speed * 1000) % 1;
      const a = phase;
      // angle fixed per packet index so they orbit as a ring while flying up
      const angle = (i / 12) * Math.PI * 2;
      const ringR = 1.2 + Math.sin(a * Math.PI) * 0.8; // bulge in the middle of the flight
      const x = Math.cos(angle) * ringR;
      const z = Math.sin(angle) * ringR + CLOUD_Z * a;
      const y = HUB_Y + (CLOUD_Y - HUB_Y) * a + Math.sin(a * Math.PI) * 1.2;
      p.position.set(x, y, z);
      const mat = p.material as THREE.MeshBasicMaterial;
      const op = dir > 0 ? (a < 0.9 ? 1 : (1 - a) * 10) : (a > 0.1 ? 1 : a * 10);
      mat.opacity = Math.max(0, op);
    });
  });

  return (
    <>
      {sceneParts.floor}
      {sceneParts.grid}
      {sceneParts.ring}
      {sceneParts.hub}
      {sceneParts.workerNodes}
      {sceneParts.cloud}
      {sceneParts.cloudInner}
      {sceneParts.packetNodes}
    </>
  );
};
