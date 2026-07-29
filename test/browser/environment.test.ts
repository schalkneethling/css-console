import { expect, test } from "vite-plus/test";

test("the suite runs against a live window and document", () => {
  expect(typeof window).toBe("object");
  expect(document.body).toBeInstanceOf(HTMLBodyElement);
});

test("getComputedStyle returns real computed values", () => {
  expect(getComputedStyle(document.body).display).toBe("block");
});

test("getComputedStyle returns layout-resolved values, which a DOM emulation cannot produce", () => {
  // A percentage width only resolves to a pixel value when a real layout
  // engine has run. An emulated DOM such as jsdom performs no layout and
  // reports the authored percentage or an empty string instead.
  const host = document.createElement("div");
  host.style.width = "200px";

  const child = document.createElement("div");
  child.style.width = "25%";

  host.append(child);
  document.body.append(host);

  const resolved = getComputedStyle(child).width;

  host.remove();

  expect(resolved).toBe("50px");
});
