import { describe, expect, it } from "vitest";
import { splitSellerAddress, splitStreet } from "@/features/checkout/invoice-document";

describe("splitStreet (spec 0011 AC-4)", () => {
  it("splits a Swiss street from its building number", () => {
    expect(splitStreet("Bahnhofstrasse 1")).toEqual({
      street: "Bahnhofstrasse",
      buildingNumber: "1",
    });
    expect(splitStreet("Obermühle 5")).toEqual({ street: "Obermühle", buildingNumber: "5" });
  });

  it("keeps a number with a letter or a range, which Swiss addresses use", () => {
    expect(splitStreet("Musterweg 12a")).toEqual({ street: "Musterweg", buildingNumber: "12a" });
    expect(splitStreet("Musterweg 12-14")).toEqual({
      street: "Musterweg",
      buildingNumber: "12-14",
    });
  });

  it("keeps a multi word street name whole", () => {
    expect(splitStreet("Avenue de la Gare 7")).toEqual({
      street: "Avenue de la Gare",
      buildingNumber: "7",
    });
  });

  it("reports no number when the street has none, which the bill allows", () => {
    expect(splitStreet("Postfach")).toEqual({ street: "Postfach", buildingNumber: undefined });
    expect(splitStreet("")).toEqual({ street: "", buildingNumber: undefined });
  });
});

describe("splitSellerAddress (spec 0011 AC-4)", () => {
  it("splits the configured one line address into its four parts", () => {
    expect(splitSellerAddress("Obermühle 5, 6340 Baar")).toEqual({
      street: "Obermühle",
      buildingNumber: "5",
      postcode: "6340",
      town: "Baar",
    });
  });

  it("keeps a town of several words", () => {
    expect(splitSellerAddress("Rue du Marché 3, 1204 Genève Ville")).toEqual({
      street: "Rue du Marché",
      buildingNumber: "3",
      postcode: "1204",
      town: "Genève Ville",
    });
  });

  it("falls back to the street alone when the line does not parse, still making a valid bill", () => {
    expect(splitSellerAddress("Somewhere without a postcode")).toEqual({
      street: "Somewhere without a postcode",
      buildingNumber: undefined,
      postcode: "",
      town: "",
    });
  });
});
