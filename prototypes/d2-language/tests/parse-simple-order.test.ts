import { describe, expect, it } from "vitest";
import { parseSimpleOrder } from "../src/core/parse-simple-order";

const catalog = [
  {
    name: "Coke 200 mL",
    aliases: ["Coke maliit"],
  },
  {
    name: "Coke 1.5 L",
    aliases: ["Coke malaki"],
  },
  {
    name: "Lucky Me chicken",
    aliases: [],
  },
];

describe("simple order parsing", () => {
  it.each([
    ["Pabili ng dalawang Coke maliit", 2],
    ["Pabili ng tatlong Coke maliit", 3],
    ["Pabili ng apat na Coke malaki", 4],
    ["Pabili ng 5 Coke maliit", 5],
  ])("parses %s", (text, quantity) => {
    const result = parseSimpleOrder(text, catalog);

    expect(result?.intent).toBe("sale");
    expect(result?.items[0].quantity).toBe(quantity);
  });

  it("preserves a missing quantity", () => {
    expect(parseSimpleOrder("Pabili ng Coke maliit", catalog)).toEqual({
      intent: "sale",
      items: [{ query: "coke maliit", quantity: null }],
    });
  });

  it("does not interpret product size as quantity", () => {
    expect(parseSimpleOrder("Pabili ng Coke 1.5 L", catalog)).toEqual({
      intent: "sale",
      items: [{ query: "coke 1.5 l", quantity: null }],
    });
  });

  it("parses multiple-item orders", () => {
    expect(
      parseSimpleOrder(
        "Isang Coke maliit at dalawang Lucky Me chicken",
        catalog,
      ),
    ).toEqual({
      intent: "sale",
      items: [
        { query: "coke maliit", quantity: 1 },
        { query: "lucky me chicken", quantity: 2 },
      ],
    });
  });

  it("leaves contextual corrections for another handler", () => {
    expect(parseSimpleOrder("isa lang pala", catalog)).toBeNull();
  });

  it("rejects zero quantity", () => {
    expect(parseSimpleOrder("0 Coke maliit", catalog)).toEqual({
      intent: "clarify",
      items: [],
    });
  });
});
