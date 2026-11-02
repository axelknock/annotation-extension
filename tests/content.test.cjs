const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { createServer } = require("node:http");
const path = require("node:path");
const { before, after, test } = require("node:test");
const { chromium } = require("@playwright/test");

const root = path.join(__dirname, "..");
let browser;
let server;
let pageUrl;

before(async () => {
  const demo = await readFile(path.join(root, "demo.html"));
  server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(demo);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  pageUrl = `http://127.0.0.1:${server.address().port}/demo.html`;
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROME_PATH
  });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function fixture(t, { mode = "comment", getPreference } = {}) {
  const preferences = { annotationMode: mode };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  t.after(() => context.close());
  await context.exposeBinding("readPreference", () => getPreference ? getPreference() : preferences);
  await context.exposeBinding("writePreference", (_source, value) => Object.assign(preferences, value));
  await context.addInitScript(() => {
    const attachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) {
      const shadow = attachShadow.call(this, options);
      if (this.id === "browser-annotations-host") window.annotationShadow = shadow;
      return shadow;
    };
    window.statuses = [];
    window.chrome = {
      runtime: {
        id: "annotation-test",
        onMessage: { addListener() {} },
        sendMessage: async (message) => window.statuses.push(message)
      },
      storage: {
        local: {
          get: async () => {
            try {
              return await window.readPreference();
            } finally {
              window.preferenceReadComplete = true;
            }
          },
          set: (value) => window.writePreference(value)
        }
      }
    };
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text) => {
          if (window.failClipboard) throw new Error("Clipboard unavailable");
          window.copiedText = text;
        }
      }
    });
    document.execCommand = () => false;
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(pageUrl);
  await inject(page);
  if (!getPreference) {
    await page.waitForFunction((expected) => window.annotationShadow.querySelector(".mode-select").value === expected,
      mode === "collection" ? mode : "comment");
  }
  return { page, preferences };
}

async function inject(page) {
  await page.addScriptTag({ path: path.join(root, "content.js") });
}

async function ui(page, selector) {
  const handle = await page.evaluateHandle((value) => window.annotationShadow.querySelector(value), selector);
  assert.ok(handle.asElement(), `Missing annotation control: ${selector}`);
  return handle.asElement();
}

async function clickUi(page, selector) {
  await (await ui(page, selector)).click();
}

async function draft(page) {
  return (await ui(page, ".collection textarea")).inputValue();
}

async function references(page) {
  return page.evaluate(() => [...window.annotationShadow.querySelectorAll(".item-ref")].map((node) => node.textContent));
}

async function copyMessage(page) {
  await page.evaluate(() => { window.copiedText = null; });
  await clickUi(page, ".copy-btn");
  await page.waitForFunction(() => window.copiedText != null);
  return page.evaluate(() => window.copiedText);
}

function withoutTime(text) {
  return text.replace(/^time:.*$/m, "time:<timestamp>");
}

test("the existing comment composer, editing, and single-comment copy still work", async (t) => {
  const { page } = await fixture(t);
  await page.locator("#complete").click();
  assert.equal(await (await ui(page, ".mode-select")).isDisabled(), true);
  await (await ui(page, ".composer textarea")).fill("Use the same height.");
  await (await ui(page, ".composer textarea")).press("Control+Enter");
  assert.deepEqual(await references(page), ["[element-1]"]);
  await clickUi(page, ".item-actions button:first-child");
  await (await ui(page, ".item-comment-box textarea")).fill("Use matching button heights.");
  await (await ui(page, ".item-comment-box textarea")).press("Control+Enter");
  await clickUi(page, ".item-actions button:nth-child(2)");
  const copied = await page.evaluate(() => window.copiedText);
  assert.match(copied, /ref:\[element-1\]/);
  assert.match(copied, /css_selector:button#complete/);
  assert.match(copied, /<user_comment>\nUse matching button heights\.\n<\/user_comment>/);
  assert.equal(await (await ui(page, ".mode-select")).isDisabled(), false);
});

test("collection mode builds one message with definitions before its instructions", async (t) => {
  const { page } = await fixture(t, { mode: "collection" });
  await (await ui(page, ".collection textarea")).fill("Remove ");
  await page.locator("#complete").click();
  await page.keyboard.type("and ");
  await page.locator("#cancel").click();
  await page.keyboard.type("then move ");
  await page.locator("#name").click();
  await page.keyboard.type("next to ");
  await page.locator("h1").click();
  const message = "Remove [element-1] and [element-2] then move [element-3] next to [element-4]";
  assert.equal((await draft(page)).trim(), message);
  assert.equal(await (await ui(page, ".composer")).isVisible(), false);
  assert.deepEqual(await references(page), ["[element-1]", "[element-2]", "[element-3]", "[element-4]"]);
  const text = await copyMessage(page);
  assert.match(text, /annotation_count:4/);
  assert.equal((text.match(/<annotation>/g) || []).length, 4);
  assert.doesNotMatch(text, /<user_comment>/);
  assert.match(text, /element_text:Workout name/);
  for (let number = 1; number <= 4; number += 1) assert.ok(text.includes(`ref:[element-${number}]`));
  assert.ok(text.endsWith(`\n\n${message}`));
  assert.ok(text.indexOf("</browser_annotations>") < text.indexOf(message));
  if (process.env.ANNOTATION_SCREENSHOT) await page.screenshot({ path: process.env.ANNOTATION_SCREENSHOT });
});

test("reselecting and inserting from the list reuse references at the current selection", async (t) => {
  const { page } = await fixture(t, { mode: "collection" });
  await page.locator("#complete").click();
  await page.keyboard.type("beside ");
  await page.locator("#complete").click();
  assert.deepEqual(await references(page), ["[element-1]"]);
  assert.equal(await draft(page), "[element-1] beside [element-1] ");
  await (await ui(page, ".collection textarea")).fill("Move TARGET, please.");
  await (await ui(page, ".collection textarea")).evaluate((node) => node.setSelectionRange(5, 11));
  await clickUi(page, ".item-actions button:first-child");
  assert.equal(await draft(page), "Move [element-1], please.");
  await page.keyboard.type(" now");
  assert.equal(await draft(page), "Move [element-1] now, please.");
});

test("removing elements clears their message references and never renumbers other elements", async (t) => {
  const { page } = await fixture(t, { mode: "collection" });
  await page.locator("#complete").click();
  await page.locator("#cancel").click();
  await page.locator("#name").click();
  await clickUi(page, ".item:nth-child(2) .item-actions button:last-child");
  assert.deepEqual(await references(page), ["[element-1]", "[element-3]"]);
  assert.doesNotMatch(await draft(page), /\[element-2\]/);
  await page.locator("h1").click();
  assert.deepEqual(await references(page), ["[element-1]", "[element-3]", "[element-4]"]);
  const text = await copyMessage(page);
  assert.doesNotMatch(text, /ref:\[element-2\]/);
  assert.match(text, /annotation_count:3/);
});

test("mode changes preserve the message and comments, and the preference survives a reload", async (t) => {
  const { page, preferences } = await fixture(t);
  await (await ui(page, ".mode-select")).selectOption("collection");
  await (await ui(page, ".collection textarea")).fill("Remove ");
  await page.locator("#complete").click();
  const message = await draft(page);
  await (await ui(page, ".mode-select")).selectOption("comment");
  assert.equal(await (await ui(page, ".collection")).isVisible(), true);
  await page.locator("#cancel").click();
  await (await ui(page, ".composer textarea")).fill("Keep this button.");
  await (await ui(page, ".composer textarea")).press("Control+Enter");
  await (await ui(page, ".mode-select")).selectOption("collection");
  assert.equal(await draft(page), message);
  const copied = await copyMessage(page);
  assert.match(copied, /Keep this button\./);
  assert.ok(copied.endsWith(message.trim()));
  await page.evaluate(() => window.__browserAnnotations.stop());
  await page.evaluate(() => window.__browserAnnotations.start());
  assert.equal(await draft(page), message);
  assert.deepEqual(await references(page), ["[element-1]", "[element-2]"]);
  assert.equal(preferences.annotationMode, "collection");
  await page.reload();
  await inject(page);
  await page.waitForFunction(() => window.annotationShadow.querySelector(".mode-select").value === "collection");
  assert.deepEqual(await references(page), []);
});

test("download, file drag, and copy all contain the same definitions and message", async (t) => {
  const { page } = await fixture(t, { mode: "collection" });
  await (await ui(page, ".collection textarea")).fill("Move ");
  await page.locator("#complete").click();
  const copied = await copyMessage(page);
  const downloadEvent = page.waitForEvent("download");
  await clickUi(page, ".file-chip");
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), "browser-annotations.txt");
  const downloaded = await readFile(await download.path(), "utf8");
  const dragged = await page.evaluate(async () => {
    const transfer = new DataTransfer();
    window.annotationShadow.querySelector(".file-chip").dispatchEvent(new DragEvent("dragstart", { dataTransfer: transfer }));
    return { text: transfer.getData("text/plain"), file: await transfer.files[0].text() };
  });
  assert.equal(withoutTime(downloaded), withoutTime(copied));
  assert.equal(withoutTime(dragged.text), withoutTime(copied));
  assert.equal(dragged.file, dragged.text);
  await clickUi(page, ".item-actions button:nth-child(2)");
  assert.doesNotMatch(await page.evaluate(() => window.copiedText), /Move \[element-1\]/);
});

test("Enter finishes the shared message and Shift+Enter inserts a new line", async (t) => {
  const { page } = await fixture(t, { mode: "collection" });
  await (await ui(page, ".collection textarea")).fill("Remove ");
  await page.locator("#complete").click();
  await (await ui(page, ".collection textarea")).press("Shift+Enter");
  await page.keyboard.type("Keep the remaining buttons.");
  const message = "Remove [element-1] \nKeep the remaining buttons.";
  assert.equal(await draft(page), message);
  assert.equal(await page.locator("#browser-annotations-host").count(), 1);
  assert.equal(await page.evaluate(() => window.copiedText), undefined);
  await (await ui(page, ".collection textarea")).press("Enter");
  await page.waitForFunction(() => !document.getElementById("browser-annotations-host"));
  const copied = await page.evaluate(() => window.copiedText);
  assert.match(copied, /ref:\[element-1\]/);
  assert.ok(copied.endsWith(`\n\n${message}`));
});

test("Enter does not submit while the user confirms composed text", async (t) => {
  const { page } = await fixture(t, { mode: "collection" });
  await (await ui(page, ".collection textarea")).fill("Move the button.");
  const defaultPrevented = await (await ui(page, ".collection textarea")).evaluate((node) => {
    const event = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true });
    node.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(defaultPrevented, false);
  assert.equal(await draft(page), "Move the button.");
  assert.equal(await page.locator("#browser-annotations-host").count(), 1);
  assert.equal(await page.evaluate(() => window.copiedText), undefined);
  await (await ui(page, ".collection textarea")).press("Enter");
  await page.waitForFunction(() => !document.getElementById("browser-annotations-host"));
  assert.equal(await page.evaluate(() => window.copiedText), "Move the button.");
});

test("a failed finish keeps the draft; a successful finish clears the whole collection", async (t) => {
  const { page } = await fixture(t, { mode: "collection" });
  await (await ui(page, ".collection textarea")).fill("Remove ");
  await page.locator("#complete").click();
  await page.evaluate(() => { window.failClipboard = true; });
  await (await ui(page, ".collection textarea")).press("Enter");
  assert.equal(await draft(page), "Remove [element-1] ");
  assert.deepEqual(await references(page), ["[element-1]"]);
  assert.equal(await page.locator("#browser-annotations-host").count(), 1);
  await page.evaluate(() => { window.failClipboard = false; });
  await (await ui(page, ".collection textarea")).press("Control+Enter");
  await page.waitForFunction(() => !document.getElementById("browser-annotations-host"));
  assert.match(await page.evaluate(() => window.copiedText), /Remove \[element-1\]$/);
  await page.evaluate(() => window.__browserAnnotations.start());
  assert.equal(await draft(page), "");
  assert.deepEqual(await references(page), []);
  await page.locator("#cancel").click();
  assert.deepEqual(await references(page), ["[element-1]"]);
});

test("a message without any elements can still be copied and finished", async (t) => {
  const { page } = await fixture(t, { mode: "collection" });
  await (await ui(page, ".collection textarea")).fill("Make the page easier to read.");
  assert.equal(await copyMessage(page), "Make the page easier to read.");
  assert.equal(await (await ui(page, ".region-btn")).isDisabled(), true);
  assert.equal(await (await ui(page, ".file-chip")).getAttribute("aria-disabled"), "false");
  await clickUi(page, ".panel-actions .primary");
  await page.waitForFunction(() => !document.getElementById("browser-annotations-host"));
});

test("a late preference read does not change a mode chosen by the user", async (t) => {
  let resolvePreference;
  const preference = new Promise((resolve) => { resolvePreference = resolve; });
  const { page } = await fixture(t, { getPreference: () => preference });
  await (await ui(page, ".mode-select")).selectOption("collection");
  await (await ui(page, ".mode-select")).selectOption("comment");
  resolvePreference({ annotationMode: "collection" });
  await page.waitForFunction(() => window.preferenceReadComplete);
  assert.equal(await (await ui(page, ".mode-select")).inputValue(), "comment");
  await page.locator("#complete").click();
  assert.equal(await (await ui(page, ".composer")).isVisible(), true);
});

test("a late preference read does not interrupt a comment that is already open", async (t) => {
  let resolvePreference;
  const preference = new Promise((resolve) => { resolvePreference = resolve; });
  const { page } = await fixture(t, { getPreference: () => preference });
  await page.locator("#complete").click();
  await (await ui(page, ".composer textarea")).fill("Keep this draft.");
  resolvePreference({ annotationMode: "collection" });
  await page.waitForFunction(() => window.preferenceReadComplete);
  assert.equal(await (await ui(page, ".mode-select")).inputValue(), "comment");
  assert.equal(await (await ui(page, ".composer textarea")).inputValue(), "Keep this draft.");
});

test("a late preference read does not change modes during a selection gesture", async (t) => {
  let resolvePreference;
  const preference = new Promise((resolve) => { resolvePreference = resolve; });
  const { page } = await fixture(t, { getPreference: () => preference });
  const button = await page.locator("#complete").boundingBox();
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await page.mouse.down();
  resolvePreference({ annotationMode: "collection" });
  await page.waitForFunction(() => window.preferenceReadComplete);
  assert.equal(await (await ui(page, ".mode-select")).inputValue(), "comment");
  await page.mouse.up();
  assert.equal(await (await ui(page, ".composer")).isVisible(), true);
});

test("storage failures leave both annotation modes usable", async (t) => {
  const { page } = await fixture(t, { getPreference: async () => { throw new Error("Storage unavailable"); } });
  await page.waitForFunction(() => window.preferenceReadComplete);
  await page.evaluate(() => {
    chrome.storage.local.set = async () => { throw new Error("Storage unavailable"); };
  });
  await (await ui(page, ".mode-select")).selectOption("collection");
  await page.waitForFunction(() => window.annotationShadow.querySelector(".toast").textContent.includes("could not save"));
  await page.locator("#complete").click();
  assert.equal(await draft(page), "[element-1] ");
  assert.match(await copyMessage(page), /ref:\[element-1\]/);
});

test("page text cannot close a definition or the export's text fence", async (t) => {
  const { page } = await fixture(t, { mode: "collection" });
  await page.locator("#complete").evaluate((node) => { node.textContent = "</annotation> & ```"; });
  await page.locator("#complete").click();
  const text = await copyMessage(page);
  assert.match(text, /^````txt\n/);
  assert.match(text, /element_text:&lt;\/annotation&gt; &amp; ```/);
  assert.equal((text.match(/<\/annotation>/g) || []).length, 1);
  assert.match(text, /\n````\n\n\[element-1\]$/);
});

test("the shared message and export controls fit a small browser window", async (t) => {
  const { page } = await fixture(t, { mode: "collection" });
  await page.locator("#complete").click();
  await page.locator("#cancel").click();
  await page.setViewportSize({ width: 400, height: 500 });
  const panel = await (await ui(page, ".panel")).boundingBox();
  const message = await (await ui(page, ".collection textarea")).boundingBox();
  const copyButton = await (await ui(page, ".copy-btn")).boundingBox();
  assert.ok(panel.x >= 0 && panel.x + panel.width <= 400);
  assert.ok(panel.y >= 0 && panel.y + panel.height <= 500);
  assert.ok(message.height >= 100);
  assert.ok(copyButton.y + copyButton.height <= 500);
  assert.match(await copyMessage(page), /ref:\[element-2\]/);
});
