import React from "react";
import { Series } from "remotion";
import { SCENES } from "./data/scenes";
import { S01_Title } from "./scenes/S01_Title";
import { S02_ThreeLanes } from "./scenes/S02_ThreeLanes";
import { S03_Components } from "./scenes/S03_Components";
import { S04_DataOwnership } from "./scenes/S04_DataOwnership";
import { S05_ApiSurface } from "./scenes/S05_ApiSurface";
import { S06_SessionLifecycle } from "./scenes/S06_SessionLifecycle";
import { S07_CatalogFlow } from "./scenes/S07_CatalogFlow";
import { S08_SecurityReliability } from "./scenes/S08_SecurityReliability";
import { S09_DeploymentTopology } from "./scenes/S09_DeploymentTopology";
import { S10_Outro } from "./scenes/S10_Outro";
import type { SceneId } from "./data/scenes";

const SCENE_COMPONENTS: Record<SceneId, React.FC> = {
  S01_Title,
  S02_ThreeLanes,
  S03_Components,
  S04_DataOwnership,
  S05_ApiSurface,
  S06_SessionLifecycle,
  S07_CatalogFlow,
  S08_SecurityReliability,
  S09_DeploymentTopology,
  S10_Outro,
};

export const AbaYaDesignFlow: React.FC = () => {
  return (
    <Series>
      {SCENES.map((scene) => {
        const Component = SCENE_COMPONENTS[scene.id];
        return (
          <Series.Sequence
            key={scene.id}
            durationInFrames={scene.durationFrames}
            layout="none"
          >
            <Component />
          </Series.Sequence>
        );
      })}
    </Series>
  );
};
