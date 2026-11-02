const { test, expect } = require("@playwright/test");
const path = require("node:path");

const fixture = `<!doctype html>
  <style>
    body { margin: 0; min-height: 1800px; font: 16px sans-serif; }
    #area {
      position: absolute; left: 60px; top: 100px;
      width: 570px; height: 280px; background: #e2e8f0;
    }
    #area > * { position: absolute; box-sizing: border-box; }
    #first, #second, #partial { top: 30px; width: 100px; height: 70px; }
    #first { left: 20px; }
    #second { left: 160px; }
    #partial { left: 300px; width: 130px; }
    #hidden { left: 20px; top: 120px; width: 80px; height: 40px; visibility: hidden; }
    #gone { display: none; }
    #zero { left: 160px; top: 120px; width: 0; height: 40px; }
    #transparent { left: 260px; top: 120px; width: 40px; height: 40px; opacity: 0; }
    #invisible-parent { left: 20px; top: 180px; width: 500px; height: 30px; opacity: 0; }
    #invisible-parent span { display: block; width: 50px; height: 20px; }
  </style>
  <section id="area">
    <button id="first"><span>First</span></button>
    <button id="second">Second</button>
    <button id="partial">Partial</button>
    <div id="hidden">Hidden</div>
    <div id="gone">Gone</div>
    <div id="zero"></div>
    <div id="transparent">Transparent</div>
    <div id="invisible-parent"><span>Invisible child</span></div>
  </section>`;

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.testErrors = errors;
  await page.route("http://localhost/**", (route) => route.fulfill({
    contentType: "text/html", body: fixture
  }));
  await page.goto("http://localhost/");
  await page.evaluate(() => {
    // Keep the production root closed; retain a reference only in this fixture.
    const attachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) {
      const root = attachShadow.call(this, options);
      if (this.id === "browser-annotations-host") window.annotationRoot = root;
      return root;
    };
    window.annotationMessages = [];
    window.pageActions = [];
    document.addEventListener("pointerdown", () => window.pageActions.push("pointerdown"));
    document.addEventListener("click", () => window.pageActions.push("click"));
    window.chrome ||= {};
    window.chrome.runtime = {
      id: "selection-test",
      onMessage: { addListener() {} },
      async sendMessage(message) {
        window.annotationMessages.push(message);
        if (message.type === "BC_CAPTURE") {
          window.capturedOutline = window.annotationRoot.querySelector(".highlight")
            .getBoundingClientRect().toJSON();
          const canvas = document.createElement("canvas");
          canvas.width = innerWidth;
          canvas.height = innerHeight;
          return { ok: true, dataUrl: canvas.toDataURL() };
        }
        return { ok: true };
      }
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(text) { window.copiedText = text; },
        async write(items) { window.copiedImages = items; }
      }
    });
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    window.stampedNumbers = [];
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.stampedNumbers.push(text);
      return fillText.call(this, text, ...args);
    };
  });
  await page.addScriptTag({ path: path.join(__dirname, "..", "content.js") });
});

test.afterEach(async ({ page }) => {
  expect(page.testErrors).toEqual([]);
});

async function readUi(page) {
  return page.evaluate(() => {
    const root = window.annotationRoot;
    const visible = (selector) => !root.querySelector(selector).classList.contains("hidden");
    return {
      active: document.getElementById("browser-annotations-host") !== null,
      boxVisible: visible(".selection-box"),
      box: root.querySelector(".selection-box").getBoundingClientRect().toJSON(),
      label: root.querySelector(".hover-label").textContent,
      highlights: [...root.querySelectorAll(".selection-highlights .highlight")]
        .map((node) => node.getBoundingClientRect().toJSON()),
      composerVisible: visible(".composer"),
      meta: root.querySelector(".composer-meta").textContent,
      kicker: root.querySelector(".composer-kicker").textContent,
      items: root.querySelectorAll(".item").length,
      markers: [...root.querySelectorAll(".marker")].map((node) => node.textContent)
    };
  });
}

async function clickOverlay(page, selector) {
  const point = await page.evaluate((selector) => {
    const rect = window.annotationRoot.querySelector(selector).getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, selector);
  await page.mouse.click(point.x, point.y);
}

async function beginDrag(page, from = [70, 120], to = [400, 280]) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 4 });
}

async function saveComment(page, comment = "Align these elements") {
  await page.keyboard.insertText(comment);
  await clickOverlay(page, ".composer button[type=submit]");
}

test("previews and commits all overlapped targets, including a partial overlap", async ({ page }, testInfo) => {
  await beginDrag(page);
  await expect.poll(() => readUi(page)).toMatchObject({
    boxVisible: true,
    composerVisible: false,
    label: "3 elements selected",
    box: { x: 70, y: 120, width: 330, height: 160 },
    highlights: [
      { x: 80, y: 130, width: 100, height: 70 },
      { x: 220, y: 130, width: 100, height: 70 },
      { x: 360, y: 130, width: 130, height: 70 }
    ]
  });
  await page.screenshot({ path: testInfo.outputPath("drag-selection.png") });
  await page.mouse.up();
  expect(await readUi(page)).toMatchObject({
    boxVisible: false,
    composerVisible: true,
    kicker: "Comment on these 3 elements",
    meta: "button#first\nbutton#second\nbutton#partial"
  });
  expect(await page.evaluate(() => window.pageActions)).toEqual([]);
});

for (const [name, from, to] of [
  ["up and left", [400, 280], [70, 120]],
  ["up and right", [70, 280], [400, 120]],
  ["down and left", [400, 120], [70, 280]]
]) {
  test(`selects while dragging ${name}`, async ({ page }) => {
    await beginDrag(page, from, to);
    await expect.poll(() => readUi(page)).toMatchObject({ label: "3 elements selected" });
    await page.mouse.up();
    expect(await readUi(page)).toMatchObject({
      composerVisible: true, meta: "button#first\nbutton#second\nbutton#partial"
    });
  });
}

for (const [edge, from, to] of [
  ["left", [350, 145], [365, 160]],
  ["right", [485, 145], [500, 160]],
  ["top", [400, 120], [420, 135]],
  ["bottom", [400, 195], [420, 210]],
  ["corner", [350, 120], [365, 135]],
  ["interior", [370, 140], [380, 150]]
]) {
  test(`selects an element overlapped only at its ${edge}`, async ({ page }) => {
    await beginDrag(page, from, to);
    await expect.poll(() => readUi(page)).toMatchObject({
      label: "1 element selected",
      highlights: [{ x: 360, y: 130, width: 130, height: 70 }]
    });
    await page.mouse.up();
    expect((await readUi(page)).meta).toBe("button#partial");
  });
}

test("does not select an element when the rectangle only touches its edge", async ({ page }) => {
  await beginDrag(page, [70, 120], [360, 280]);
  await expect.poll(() => readUi(page)).toMatchObject({ label: "2 elements selected" });
  await page.mouse.up();
  expect((await readUi(page)).meta).toBe("button#first\nbutton#second");
});

for (const [dimension, to] of [["width", [70, 280]], ["height", [400, 120]]]) {
  test(`does not select elements with a zero-${dimension} rectangle`, async ({ page }) => {
    await beginDrag(page, [70, 120], to);
    await expect.poll(() => readUi(page)).toMatchObject({ label: "0 elements selected" });
    await page.mouse.up();
    expect((await readUi(page)).composerVisible).toBe(false);
  });
}

test("updates targets when the rectangle shrinks or page elements move", async ({ page }) => {
  await beginDrag(page);
  await expect.poll(() => readUi(page)).toMatchObject({ label: "3 elements selected" });
  await page.mouse.move(200, 280);
  await expect.poll(() => readUi(page)).toMatchObject({ label: "1 element selected" });
  await page.evaluate(() => { document.getElementById("second").style.left = "40px"; });
  await page.mouse.move(201, 280);
  await expect.poll(() => readUi(page)).toMatchObject({ label: "2 elements selected" });
  await page.mouse.up();
  expect((await readUi(page)).meta).toBe("button#first\nbutton#second");
});

test("selects a contained parent once instead of duplicating descendants", async ({ page }) => {
  await beginDrag(page, [50, 90], [640, 390]);
  await expect.poll(() => readUi(page)).toMatchObject({ label: "1 element selected" });
  await page.mouse.up();
  expect((await readUi(page)).meta).toBe("section#area");
});

test("allows a selection to start in empty space outside the body", async ({ page }) => {
  await page.evaluate(() => { document.body.style.minHeight = "0"; });
  await beginDrag(page, [50, 90], [400, 280]);
  await expect.poll(() => readUi(page)).toMatchObject({ label: "3 elements selected" });
  await page.mouse.up();
  expect((await readUi(page)).meta).toBe("button#first\nbutton#second\nbutton#partial");
});

test("finishes a selection released over the panel", async ({ page }) => {
  const panel = await page.evaluate(() => window.annotationRoot.querySelector(".panel").getBoundingClientRect().toJSON());
  await beginDrag(page, [50, 390], [panel.x + 30, panel.y + 16]);
  await expect.poll(() => readUi(page)).toMatchObject({ label: "1 element selected" });
  await page.mouse.up();
  expect((await readUi(page)).meta).toBe("section#area");
  const after = await page.evaluate(() => window.annotationRoot.querySelector(".panel").getBoundingClientRect().toJSON());
  expect(after).toEqual(panel);
});

test("does not open a composer for a right click", async ({ page }) => {
  await page.mouse.click(90, 140, { button: "right" });
  expect(await readUi(page)).toMatchObject({ composerVisible: false, boxVisible: false });
});

test("keeps clicks and small pointer movement as single-element selection", async ({ page }) => {
  await page.mouse.move(90, 140);
  await page.mouse.down();
  expect((await readUi(page)).composerVisible).toBe(false);
  await page.mouse.move(92, 142);
  await page.mouse.up();
  expect(await readUi(page)).toMatchObject({
    composerVisible: true, meta: "button#first", highlights: []
  });
  await saveComment(page, "Change one button");
  await clickOverlay(page, ".item .link:nth-of-type(2)");
  const text = await page.evaluate(() => window.copiedText);
  expect(text).toContain("index:1\ncss_selector:button#first\ndom_path:");
  expect(text).not.toContain("<selected_elements>");
});

test("saves, edits, and copies a group with all its targets", async ({ page }) => {
  await beginDrag(page);
  await page.mouse.up();
  await saveComment(page);
  expect(await readUi(page)).toMatchObject({ items: 1, markers: ["1", "1", "1"] });
  await clickOverlay(page, ".item .link:first-of-type");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("Use the same height");
  await clickOverlay(page, ".item .primary");
  await clickOverlay(page, ".item .link:nth-of-type(2)");
  const text = await page.evaluate(() => window.copiedText);
  expect(text).toContain("annotation_count:1");
  expect(text).toContain("<selected_elements>\n<element>\ncss_selector:button#first");
  expect(text).toContain("<element>\ncss_selector:button#second");
  expect(text).not.toContain("css_selector:section#area");
  expect(text).toContain("css_selector:button#partial");
  expect(text).toContain("<user_comment>\nUse the same height\n</user_comment>");
});

test("Escape cancels a drag without stopping annotation mode", async ({ page }) => {
  await beginDrag(page);
  await expect.poll(() => readUi(page)).toMatchObject({ boxVisible: true });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await readUi(page)).toMatchObject({
    active: true, boxVisible: false, composerVisible: false, highlights: [], items: 0
  });
  await page.mouse.click(90, 140);
  expect((await readUi(page)).composerVisible).toBe(true);
  await page.keyboard.press("Escape");
  expect(await readUi(page)).toMatchObject({
    active: true, composerVisible: false, highlights: []
  });
});

for (const event of ["pointercancel", "lostpointercapture", "blur"]) {
  test(`${event} clears the drag without opening a comment`, async ({ page }) => {
    await beginDrag(page);
    await expect.poll(() => readUi(page)).toMatchObject({ boxVisible: true });
    await page.evaluate((type) => {
      if (type === "blur") window.dispatchEvent(new Event(type));
      else document.documentElement.dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true }));
    }, event);
    await page.mouse.up();
    expect(await readUi(page)).toMatchObject({
      active: true, boxVisible: false, composerVisible: false, highlights: []
    });
  });
}

test("an empty drag does not open a comment", async ({ page }) => {
  await beginDrag(page, [650, 320], [655, 325]);
  await expect.poll(() => readUi(page)).toMatchObject({ label: "0 elements selected" });
  await page.mouse.up();
  expect(await readUi(page)).toMatchObject({ composerVisible: false, items: 0, boxVisible: false });
  await page.mouse.click(90, 140);
  expect((await readUi(page)).composerVisible).toBe(true);
});

test("tracks document coordinates when the page scrolls during a drag", async ({ page }) => {
  await page.evaluate(() => { document.getElementById("area").style.top = "400px"; });
  await beginDrag(page, [70, 420], [400, 580]);
  await expect.poll(() => readUi(page)).toMatchObject({ label: "3 elements selected" });
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.mouse.move(400, 280);
  await expect.poll(() => readUi(page)).toMatchObject({
    box: { x: 70, y: 120, width: 330, height: 160 },
    label: "3 elements selected"
  });
  await page.mouse.up();
  expect((await readUi(page)).meta).toBe("button#first\nbutton#second\nbutton#partial");
});

test("captures a group using every target and stamps each marker", async ({ page }) => {
  await beginDrag(page);
  await page.mouse.up();
  await saveComment(page);
  await clickOverlay(page, ".region-btn");
  await expect.poll(() => page.evaluate(() => window.copiedImages?.length)).toBe(1);
  expect(await page.evaluate(() => window.capturedOutline)).toMatchObject({
    x: 60, y: 100, width: 570, height: 280
  });
  expect(await page.evaluate(() => window.stampedNumbers)).toEqual(["1", "1", "1"]);
});

test("ignores removed targets and recovers when the whole selection disappears", async ({ page }) => {
  await beginDrag(page);
  await page.mouse.up();
  await page.evaluate(() => document.getElementById("first").remove());
  await saveComment(page);
  expect(await readUi(page)).toMatchObject({ items: 1, markers: ["1", "1"] });
  await page.mouse.click(240, 140);
  await page.evaluate(() => document.getElementById("second").remove());
  await saveComment(page);
  expect(await readUi(page)).toMatchObject({ items: 1, composerVisible: false });
  await page.mouse.click(390, 140);
  expect((await readUi(page)).meta).toBe("button#partial");
});

test("panel dragging and stopping keep working during annotation mode", async ({ page }) => {
  const original = await page.evaluate(() => window.annotationRoot.querySelector(".panel").getBoundingClientRect().toJSON());
  await page.mouse.move(original.x + 30, original.y + 16);
  await page.mouse.down();
  await page.mouse.move(original.x - 70, original.y + 90, { steps: 3 });
  await page.mouse.up();
  expect((await readUi(page)).boxVisible).toBe(false);
  const moved = await page.evaluate(() => window.annotationRoot.querySelector(".panel").getBoundingClientRect().toJSON());
  expect(moved.x).toBeLessThan(original.x);
  await beginDrag(page);
  await expect.poll(() => readUi(page)).toMatchObject({ boxVisible: true });
  await page.evaluate(() => window.__browserAnnotations.stop());
  await page.mouse.up();
  expect((await readUi(page)).active).toBe(false);
  expect(await page.evaluate(() => document.getElementById("browser-annotations-cursor"))).toBeNull();
});
