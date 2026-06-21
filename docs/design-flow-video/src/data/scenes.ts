import { FPS } from "../theme";

export type SceneId =
  | "S01_Title"
  | "S02_ThreeLanes"
  | "S03_Components"
  | "S04_DataOwnership"
  | "S05_ApiSurface"
  | "S06_SessionLifecycle"
  | "S07_CatalogFlow"
  | "S08_SecurityReliability"
  | "S09_DeploymentTopology"
  | "S10_Outro";

export type SceneSpec = {
  id: SceneId;
  title: string;
  durationFrames: number;
};

const seconds = (s: number): number => Math.round(s * FPS);

export const SCENES: readonly SceneSpec[] = [
  { id: "S01_Title", title: "AbaYa Track", durationFrames: seconds(8) },
  { id: "S02_ThreeLanes", title: "Three Lanes", durationFrames: seconds(50) },
  { id: "S03_Components", title: "Components", durationFrames: seconds(55) },
  { id: "S04_DataOwnership", title: "Data Ownership", durationFrames: seconds(55) },
  { id: "S05_ApiSurface", title: "API Surface", durationFrames: seconds(50) },
  { id: "S06_SessionLifecycle", title: "Session Lifecycle", durationFrames: seconds(75) },
  { id: "S07_CatalogFlow", title: "Catalog Flow", durationFrames: seconds(50) },
  { id: "S08_SecurityReliability", title: "Security and Reliability", durationFrames: seconds(35) },
  { id: "S09_DeploymentTopology", title: "Deployment Topology", durationFrames: seconds(35) },
  { id: "S10_Outro", title: "End", durationFrames: seconds(7) },
] as const;

export const TOTAL_DURATION = SCENES.reduce(
  (sum, s) => sum + s.durationFrames,
  0,
);

export const sceneStartFrame = (id: SceneId): number => {
  let acc = 0;
  for (const s of SCENES) {
    if (s.id === id) return acc;
    acc += s.durationFrames;
  }
  return 0;
};
