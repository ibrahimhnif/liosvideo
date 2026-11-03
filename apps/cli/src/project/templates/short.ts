import { composition } from "liosvideo";
import intro from "./scenes/intro";

export default composition({
  width: 1080,
  height: 1920,
  fps: 30,
  background: "#0b0d12",
  scenes: [intro],
});
