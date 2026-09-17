import {
  isWorkshopMapId,
  getMapDisplayName
} from "../src/utility/mapPool.js";

describe("Map id / display name resolution (mapPool)", () => {
  it("recognizes a bare numeric Steam Workshop file id as a workshop map", () => {
    expect(isWorkshopMapId("3081538")).toBe(true);
    expect(isWorkshopMapId(" 3081538 ")).toBe(true);
  });

  it("does not treat classic map names as workshop ids", () => {
    expect(isWorkshopMapId("de_mirage")).toBe(false);
    expect(isWorkshopMapId("workshop/3081538/my_map")).toBe(false);
  });

  it("resolves a known classic map id to its configured display name", () => {
    expect(getMapDisplayName("de_mirage")).toEqual("Mirage");
  });

  it("never throws for an unknown map id - falls back to a prettified id", () => {
    expect(getMapDisplayName("some_totally_unknown_map")).toEqual(
      "Some Totally Unknown Map"
    );
  });

  it("shows an id as-is (never blank/an error) when it has no underscore to prettify", () => {
    expect(getMapDisplayName("aWeirdMapId")).toEqual("aWeirdMapId");
  });

  it("formats an unnamed workshop id as a fallback rather than erroring", () => {
    expect(getMapDisplayName("3081538")).toEqual("Workshop #3081538");
  });

  it("prefers a caller-supplied override (e.g. a season's custom map name) over the built-in catalog", () => {
    expect(
      getMapDisplayName("3081538", { "3081538": "My Custom Map" })
    ).toEqual("My Custom Map");
    expect(
      getMapDisplayName("de_mirage", { de_mirage: "Custom Mirage Name" })
    ).toEqual("Custom Mirage Name");
  });
});
