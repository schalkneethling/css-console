import { expect, test } from "vite-plus/test";

test("browser lane provides window, document, and real getComputedStyle", () => {
  expect(typeof window).toBe("object");
  expect(document.documentElement).toBeTruthy();

  const element = document.createElement("div");
  element.style.inlineSize = "120px";
  document.body.append(element);

  const resolved = getComputedStyle(element).inlineSize;
  element.remove();

  expect(resolved).toBe("120px");
});
