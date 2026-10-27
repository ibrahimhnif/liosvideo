import { describe, expect, it } from "vitest";
import { phone, PhoneNode } from "../../src/mockups/phone";
import { text } from "../../src/graph/kinds";

describe("PhoneNode mockup", () => {
  it("creates a phone device mockup with screen, bezel, dynamic island, and content area", () => {
    const device = phone({
      name: "mobilePreview",
      width: 420,
      height: 860,
      theme: "dark",
    });

    expect(device).toBeInstanceOf(PhoneNode);
    expect(device.name).toBe("mobilePreview");
    expect(device.width).toBe(420);
    expect(device.height).toBe(860);

    // Bezel & Screen
    expect(device.bezel).toBeDefined();
    expect(device.screen).toBeDefined();
    expect(device.contentArea).toBeDefined();

    // Dynamic island / notch
    expect(device.dynamicIsland).toBeDefined();

    // Home indicator
    expect(device.homeIndicator).toBeDefined();

    // Content area accepts children
    const child = device.contentArea.add(text({ text: "Hello mobile" }));
    expect(device.contentArea.children).toContain(child);
  });
});
