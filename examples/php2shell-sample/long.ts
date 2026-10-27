import { composition } from "liosvideo";
import focusDemo from "./scenes/focus-demo";
import intro from "./scenes/intro";
import outro from "./scenes/outro";

export default composition({
  width: 1920,
  height: 1080,
  fps: 30,
  background: "#0b0d12",
  scenes: [intro, focusDemo, outro],
});
