/**
 * Unit tests for collapseCaretToEnd — the page-context half of browser_type's
 * append mode. The function must park the caret at the very end of the
 * existing content for both classic form fields and contenteditable roots,
 * because the focus click lands at a randomised point inside the element and
 * appended text would otherwise splice into the middle.
 *
 * DOM objects are faked with plain objects implementing only the APIs the
 * function touches (the test env is node, not jsdom). The live-composer
 * behaviour (LinkedIn reply box with a prefilled @mention) is smoke-tested
 * against a real CDP endpoint separately, like the rest of the human path.
 */

import { describe, it, expect } from "vitest";
import { collapseCaretToEnd } from "../src/browser/human/index.js";

type Call = { method: string; args: unknown[] };

function fakeContentEditable(recorded: Call[]) {
  const range = {
    selectNodeContents: (...args: unknown[]) =>
      recorded.push({ method: "selectNodeContents", args }),
    collapse: (...args: unknown[]) => recorded.push({ method: "collapse", args }),
  };
  const selection = {
    removeAllRanges: (...args: unknown[]) =>
      recorded.push({ method: "removeAllRanges", args }),
    addRange: (...args: unknown[]) => recorded.push({ method: "addRange", args }),
  };
  const el: Record<string, unknown> = {
    ownerDocument: {
      createRange: () => range,
      defaultView: { getSelection: () => selection },
    },
  };
  // ownerDocument.defaultView is read off the document in the implementation.
  (el.ownerDocument as Record<string, unknown>).defaultView = {
    getSelection: () => selection,
  };
  return { el: el as unknown as Element, range, selection };
}

describe("collapseCaretToEnd — input/textarea path", () => {
  it("collapses the selection to the end of the value", () => {
    const calls: Call[] = [];
    const el = {
      value: "hello world",
      setSelectionRange: (...args: unknown[]) =>
        calls.push({ method: "setSelectionRange", args }),
    } as unknown as Element;

    collapseCaretToEnd(el);

    expect(calls).toEqual([{ method: "setSelectionRange", args: [11, 11] }]);
  });

  it("handles an empty value", () => {
    const calls: Call[] = [];
    const el = {
      value: "",
      setSelectionRange: (...args: unknown[]) =>
        calls.push({ method: "setSelectionRange", args }),
    } as unknown as Element;

    collapseCaretToEnd(el);

    expect(calls).toEqual([{ method: "setSelectionRange", args: [0, 0] }]);
  });

  it("falls through to the selection path when setSelectionRange throws (number/email inputs)", () => {
    const recorded: Call[] = [];
    const { el } = fakeContentEditable(recorded);
    (el as unknown as Record<string, unknown>).value = "42";
    (el as unknown as Record<string, unknown>).setSelectionRange = () => {
      throw new Error("InvalidStateError");
    };

    collapseCaretToEnd(el);

    expect(recorded.map((c) => c.method)).toEqual([
      "selectNodeContents",
      "collapse",
      "removeAllRanges",
      "addRange",
    ]);
  });
});

describe("collapseCaretToEnd — contenteditable path", () => {
  it("selects the content, collapses to the end, and installs the range", () => {
    const recorded: Call[] = [];
    const { el, range } = fakeContentEditable(recorded);

    collapseCaretToEnd(el);

    expect(recorded[0]).toEqual({ method: "selectNodeContents", args: [el] });
    // collapse(false) = collapse to the END — the whole point of append mode.
    expect(recorded[1]).toEqual({ method: "collapse", args: [false] });
    expect(recorded[2].method).toBe("removeAllRanges");
    expect(recorded[3]).toEqual({ method: "addRange", args: [range] });
  });

  it("does not throw when the element has no ownerDocument", () => {
    expect(() =>
      collapseCaretToEnd({} as unknown as Element)
    ).not.toThrow();
  });

  it("does not throw when getSelection returns null", () => {
    const el = {
      ownerDocument: {
        createRange: () => ({
          selectNodeContents: () => {},
          collapse: () => {},
        }),
        defaultView: { getSelection: () => null },
      },
    } as unknown as Element;

    expect(() => collapseCaretToEnd(el)).not.toThrow();
  });
});
