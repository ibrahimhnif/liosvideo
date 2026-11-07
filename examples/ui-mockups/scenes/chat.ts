// chatThread(): messages appear one by one, with typing dots before each reply.
import { chatThread, layout, scene } from "liosvideo";

export default scene("chat", { duration: 7, background: "#0b0d12" }, ({ root, width, height }) => {
  const L = layout({ width, height });
  const box = width > height ? L.cell(4, 6, 1, 6) : L.slot("center");
  root.add(
    chatThread({
      ...box,
      title: "Claude",
      theme: "dark",
      reveal: { start: 0.4, gap: 1.2 },
      typing: 0.8,
      messages: [
        { from: "user", text: "Make a 30 second short about the CECOT prison." },
        { from: "assistant", text: "Here is a plan: a hook with the 40,000 capacity figure, three facts with archive photos, and a question to close. Shall I write the narration?" },
        { from: "user", text: "Yes, in Indonesian." },
        { from: "assistant", text: "Done. Five lines, about 75 words. Generating the voice now." },
      ],
    }),
  );
});
