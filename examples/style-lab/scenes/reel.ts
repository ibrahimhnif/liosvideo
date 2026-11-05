// The reel's scene list, shared by showcase.ts (9:16) and long.ts (16:9):
// the title card, then every style demo in catalog order, each fading in over 0.3 s.
import { transition, type SceneDef } from "liosvideo";
import title from "./title";
import pixelArt from "./pixel-art";
import chalkboard from "./chalkboard";
import glowSketch from "./glow-sketch";
import ps2Lowpoly from "./ps2-lowpoly";
import comic from "./comic";
import flatVector from "./flat-vector";
import minimalMono from "./minimal-mono";
import cgiMotion from "./cgi-motion";
import brick from "./brick";
import explainer3d from "./explainer-3d";

const demos = [pixelArt, chalkboard, glowSketch, ps2Lowpoly, comic, flatVector, minimalMono, cgiMotion, brick, explainer3d];

export const reel: SceneDef[] = [title, ...demos.map((d) => ({ ...d, transition: transition("fade", { duration: 0.3 }) }))];
