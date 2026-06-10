pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const pdfUrl = "./pdf/book.pdf";

const book = document.getElementById("book");
const nextBtn = document.getElementById("next");
const prevBtn = document.getElementById("prev");

/*
  如果手機或電腦卡頓，可改成 1.2
  如果想更清晰，可改成 1.6
*/
const RENDER_SCALE = 1.45;

/*
  內頁翻頁速度
*/
const FLIP_DURATION = 1450;

/*
  封面 / 封底轉場速度
*/
const EDGE_DURATION = 1400;

/*
  動畫中繼續按會排隊接著翻
*/
const MAX_QUEUE = 8;

let spreads = [];
let currentIndex = 0;
let isAnimating = false;
let queuedDelta = 0;
let objectUrls = [];

let touchStartX = 0;
let touchStartY = 0;

let resizeTimer = null;
let activeAnimations = [];
let transitionToken = 0;

book.className = "single";
book.innerHTML = `<div class="loading">PDF 載入中...</div>`;

async function loadBook() {
  const pdf = await pdfjsLib.getDocument({
    url: pdfUrl,
    disableFontFace: true
  }).promise;

  let backCover = null;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);

    const viewport = page.getViewport({
      scale: RENDER_SCALE
    });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", {
      alpha: false
    });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: ctx,
      viewport: viewport
    }).promise;

    const left = await cropCanvasToBlobUrl(canvas, "left");
    const right = await cropCanvasToBlobUrl(canvas, "right");

    if (i === 1) {
      spreads.push({
        type: "cover",
        images: [right]
      });

      backCover = left;
    } else {
      spreads.push({
        type: "spread",
        images: [left, right]
      });
    }
  }

  spreads.push({
    type: "back",
    images: [backCover]
  });

  renderCurrentSpread();
}

function renderCurrentSpread() {
  const spread = spreads[currentIndex];

  setBookMode(spread);

  const sheet = createSheet(spread);

  book.replaceChildren(sheet);
}

function setBookMode(spread) {
  if (spread.type === "spread") {
    book.className = "spread-mode";
  } else {
    book.className = "single";
  }
}

function createSheet(spread) {
  const sheet = document.createElement("div");

  const sheetClass =
    spread.type === "spread"
      ? "spread-sheet"
      : "single-sheet";

  sheet.className = `sheet ${sheetClass}`;

  spread.images.forEach((src, index) => {
    const pageWrap = document.createElement("div");

    if (spread.type === "spread") {
      pageWrap.className =
        index === 0
          ? "paper-page left-page"
          : "paper-page right-page";
    } else {
      pageWrap.className = "paper-page single-page";
    }

    const img = document.createElement("img");
    img.className = "page-img";
    img.src = src;

    pageWrap.appendChild(img);
    sheet.appendChild(pageWrap);
  });

  if (spread.type === "spread") {
    const gutter = document.createElement("div");
    gutter.className = "gutter";
    sheet.appendChild(gutter);
  }

  return sheet;
}

function createImagePage(src, sideClass) {
  const pageWrap = document.createElement("div");
  pageWrap.className = `paper-page ${sideClass}`;

  const img = document.createElement("img");
  img.className = "page-img";
  img.src = src;

  pageWrap.appendChild(img);

  return pageWrap;
}

function createUnderLayer(leftSrc, rightSrc, rect) {
  const layer = document.createElement("div");

  layer.className = "under-layer";

  layer.style.left = `${rect.left}px`;
  layer.style.top = `${rect.top}px`;
  layer.style.width = `${rect.width}px`;
  layer.style.height = `${rect.height}px`;

  layer.appendChild(createImagePage(leftSrc, "left-page"));
  layer.appendChild(createImagePage(rightSrc, "right-page"));

  const gutter = document.createElement("div");
  gutter.className = "gutter";
  layer.appendChild(gutter);

  document.body.appendChild(layer);

  return layer;
}

function createFixedSheetLayer(spread, rect, className) {
  const layer = document.createElement("div");

  layer.className = `fixed-sheet-layer ${className}`;

  layer.style.left = `${rect.left}px`;
  layer.style.top = `${rect.top}px`;
  layer.style.width = `${rect.width}px`;
  layer.style.height = `${rect.height}px`;

  const sheet = createSheet(spread);

  layer.appendChild(sheet);
  document.body.appendChild(layer);

  return layer;
}

function createTwoSidedTurningPage(frontSrc, backSrc) {
  const page = document.createElement("div");
  page.className = "turning-page";

  const front = document.createElement("div");
  front.className = "turning-face front";

  const frontImg = document.createElement("img");
  frontImg.src = frontSrc;

  front.appendChild(frontImg);

  const back = document.createElement("div");
  back.className = "turning-face back";

  const backImg = document.createElement("img");
  backImg.src = backSrc;

  back.appendChild(backImg);

  page.appendChild(front);
  page.appendChild(back);

  return page;
}

function requestMove(delta) {
  if (isAnimating) {
    queuedDelta = clamp(
      queuedDelta + delta,
      -MAX_QUEUE,
      MAX_QUEUE
    );

    return;
  }

  moveByDelta(delta);
}

function moveByDelta(delta) {
  const targetIndex = currentIndex + delta;

  if (
    targetIndex < 0 ||
    targetIndex >= spreads.length
  ) {
    queuedDelta = 0;
    return;
  }

  const direction =
    delta > 0
      ? "next"
      : "prev";

  goToSpread(targetIndex, direction);
}

function processQueue() {
  if (isAnimating) return;
  if (queuedDelta === 0) return;

  const delta =
    queuedDelta > 0
      ? 1
      : -1;

  queuedDelta -= delta;

  moveByDelta(delta);
}

function cleanupFloatingLayers() {
  transitionToken++;

  document
    .querySelectorAll(".flip-layer, .under-layer, .fixed-sheet-layer")
    .forEach((el) => {
      el.remove();
    });

  activeAnimations.forEach((animation) => {
    try {
      animation.cancel();
    } catch (e) {}
  });

  activeAnimations = [];

  book.style.visibility = "visible";
  book.style.transition = "none";

  isAnimating = false;
  queuedDelta = 0;

  if (spreads.length > 0) {
    renderCurrentSpread();
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      book.style.transition = "";
    });
  });
}

function handleViewportChange() {
  clearTimeout(resizeTimer);

  resizeTimer = setTimeout(() => {
    cleanupFloatingLayers();
  }, 180);
}

function goToSpread(targetIndex, direction) {
  const oldSpread = spreads[currentIndex];
  const targetSpread = spreads[targetIndex];

  if (
    oldSpread.type === "spread" &&
    targetSpread.type === "spread"
  ) {
    turnSpreadPage(targetIndex, direction);
  } else {
    turnEdgePage(targetIndex, direction);
  }
}

function turnSpreadPage(targetIndex, direction) {
  const runToken = ++transitionToken;

  isAnimating = true;

  const oldSpread = spreads[currentIndex];
  const targetSpread = spreads[targetIndex];

  const rect = book.getBoundingClientRect();
  const pageWidth = rect.width / 2;
  const pageHeight = rect.height;

  let underLeft;
  let underRight;
  let frontImage;
  let backImage;
  let flipLeft;

  if (direction === "next") {
    underLeft = oldSpread.images[0];
    underRight = targetSpread.images[1];

    frontImage = oldSpread.images[1];
    backImage = targetSpread.images[0];

    flipLeft = rect.left + pageWidth;
  } else {
    underLeft = targetSpread.images[0];
    underRight = oldSpread.images[1];

    frontImage = oldSpread.images[0];
    backImage = targetSpread.images[1];

    flipLeft = rect.left;
  }

  const underLayer = createUnderLayer(
    underLeft,
    underRight,
    rect
  );

  const flipLayer = document.createElement("div");

  flipLayer.className = `flip-layer ${direction}`;

  flipLayer.style.left = `${flipLeft}px`;
  flipLayer.style.top = `${rect.top}px`;
  flipLayer.style.width = `${pageWidth}px`;
  flipLayer.style.height = `${pageHeight}px`;

  const turningPage = createTwoSidedTurningPage(
    frontImage,
    backImage
  );

  flipLayer.appendChild(turningPage);
  document.body.appendChild(flipLayer);

  const animation = turningPage.animate(
    buildFlipKeyframes(direction, 0),
    {
      duration: FLIP_DURATION,
      easing: "cubic-bezier(.16,.82,.18,1)",
      fill: "forwards"
    }
  );

  activeAnimations.push(animation);

  animation.finished
    .catch(() => {})
    .then(() => {
      if (runToken !== transitionToken) return;

      underLayer.remove();
      flipLayer.remove();

      removeAnimation(animation);

      currentIndex = targetIndex;

      renderCurrentSpread();

      isAnimating = false;

      processQueue();
    });
}

function turnEdgePage(targetIndex, direction) {
  const runToken = ++transitionToken;

  isAnimating = true;

  const oldSpread = spreads[currentIndex];
  const targetSpread = spreads[targetIndex];

  const rect = book.getBoundingClientRect();

  const currentWidth = rect.width;
  const currentHeight = rect.height;
  const centerX = rect.left + currentWidth / 2;

  const pageWidth =
    oldSpread.type === "spread"
      ? currentWidth / 2
      : currentWidth;

  const targetWidth =
    targetSpread.type === "spread"
      ? pageWidth * 2
      : pageWidth;

  const targetRect = {
    left: centerX - targetWidth / 2,
    top: rect.top,
    width: targetWidth,
    height: currentHeight
  };

  book.style.visibility = "hidden";

  const layers = [];

  if (
    oldSpread.type !== "spread" &&
    targetSpread.type === "spread"
  ) {
    const targetLayer = createFixedSheetLayer(
      targetSpread,
      targetRect,
      "edge-under"
    );

    layers.push(targetLayer);

    const flipLayer = document.createElement("div");
    flipLayer.className = `flip-layer ${direction}`;

    flipLayer.style.left = `${rect.left}px`;
    flipLayer.style.top = `${rect.top}px`;
    flipLayer.style.width = `${pageWidth}px`;
    flipLayer.style.height = `${currentHeight}px`;

    const backImage =
      direction === "next"
        ? targetSpread.images[0]
        : targetSpread.images[1];

    const turningPage = createTwoSidedTurningPage(
      oldSpread.images[0],
      backImage
    );

    flipLayer.appendChild(turningPage);
    document.body.appendChild(flipLayer);
    layers.push(flipLayer);

    const shiftX =
      direction === "next"
        ? pageWidth / 2
        : -pageWidth / 2;

    const animation = turningPage.animate(
      buildFlipKeyframes(direction, shiftX),
      {
        duration: EDGE_DURATION,
        easing: "cubic-bezier(.16,.82,.18,1)",
        fill: "forwards"
      }
    );

    activeAnimations.push(animation);

    animation.finished
      .catch(() => {})
      .then(() => {
        if (runToken !== transitionToken) return;

        removeAnimation(animation);
        finishEdgeTransition(targetIndex, layers, runToken);
      });

    return;
  }

  if (
    oldSpread.type === "spread" &&
    targetSpread.type !== "spread"
  ) {
    const oldLayer = createFixedSheetLayer(
      oldSpread,
      {
        left: rect.left,
        top: rect.top,
        width: currentWidth,
        height: currentHeight
      },
      "edge-old"
    );

    layers.push(oldLayer);

    const fadeAnimation = oldLayer.animate(
      [
        {
          opacity: 1,
          offset: 0
        },
        {
          opacity: 1,
          offset: 0.45
        },
        {
          opacity: 0,
          offset: 1
        }
      ],
      {
        duration: EDGE_DURATION,
        easing: "cubic-bezier(.22,.75,.2,1)",
        fill: "forwards"
      }
    );

    activeAnimations.push(fadeAnimation);

    const flipLayer = document.createElement("div");
    flipLayer.className = `flip-layer ${direction}`;

    const flipLeft =
      direction === "next"
        ? rect.left + pageWidth
        : rect.left;

    flipLayer.style.left = `${flipLeft}px`;
    flipLayer.style.top = `${rect.top}px`;
    flipLayer.style.width = `${pageWidth}px`;
    flipLayer.style.height = `${currentHeight}px`;

    const frontImage =
      direction === "next"
        ? oldSpread.images[1]
        : oldSpread.images[0];

    const turningPage = createTwoSidedTurningPage(
      frontImage,
      targetSpread.images[0]
    );

    flipLayer.appendChild(turningPage);
    document.body.appendChild(flipLayer);
    layers.push(flipLayer);

    const shiftX =
      direction === "next"
        ? pageWidth / 2
        : -pageWidth / 2;

    const animation = turningPage.animate(
      buildFlipKeyframes(direction, shiftX),
      {
        duration: EDGE_DURATION,
        easing: "cubic-bezier(.16,.82,.18,1)",
        fill: "forwards"
      }
    );

    activeAnimations.push(animation);

    animation.finished
      .catch(() => {})
      .then(() => {
        if (runToken !== transitionToken) return;

        removeAnimation(animation);
        removeAnimation(fadeAnimation);
        finishEdgeTransition(targetIndex, layers, runToken);
      });

    return;
  }

  finishEdgeTransition(targetIndex, layers, runToken);
}

function finishEdgeTransition(targetIndex, layers, runToken) {
  if (runToken !== transitionToken) return;

  layers.forEach((layer) => {
    layer.remove();
  });

  book.style.transition = "none";

  currentIndex = targetIndex;

  renderCurrentSpread();

  book.style.visibility = "visible";

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (runToken !== transitionToken) return;

      book.style.transition = "";

      isAnimating = false;

      processQueue();
    });
  });
}

function buildFlipKeyframes(direction, shiftX) {
  const rotate1 =
    direction === "next"
      ? -34
      : 34;

  const rotate2 =
    direction === "next"
      ? -88
      : 88;

  const rotate3 =
    direction === "next"
      ? -140
      : 140;

  const rotate4 =
    direction === "next"
      ? -179
      : 179;

  return [
    {
      transform:
        "translateX(0px) translateZ(0px) rotateY(0deg)"
    },
    {
      transform:
        `translateX(${shiftX * 0.18}px) translateZ(82px) rotateY(${rotate1}deg)`,
      offset: 0.22
    },
    {
      transform:
        `translateX(${shiftX * 0.48}px) translateZ(118px) rotateY(${rotate2}deg)`,
      offset: 0.5
    },
    {
      transform:
        `translateX(${shiftX * 0.82}px) translateZ(82px) rotateY(${rotate3}deg)`,
      offset: 0.78
    },
    {
      transform:
        `translateX(${shiftX}px) translateZ(0px) rotateY(${rotate4}deg)`
    }
  ];
}

function nextPage() {
  requestMove(1);
}

function prevPage() {
  requestMove(-1);
}

function clamp(value, min, max) {
  return Math.min(
    Math.max(value, min),
    max
  );
}

function removeAnimation(animation) {
  activeAnimations =
    activeAnimations.filter((item) => item !== animation);
}

function cropCanvasToBlobUrl(sourceCanvas, side) {
  return new Promise((resolve, reject) => {
    const halfWidth = sourceCanvas.width / 2;
    const height = sourceCanvas.height;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", {
      alpha: false
    });

    canvas.width = halfWidth;
    canvas.height = height;

    const sx =
      side === "left"
        ? 0
        : halfWidth;

    ctx.drawImage(
      sourceCanvas,
      sx,
      0,
      halfWidth,
      height,
      0,
      0,
      halfWidth,
      height
    );

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("圖片轉換失敗"));
          return;
        }

        const url = URL.createObjectURL(blob);

        objectUrls.push(url);

        resolve(url);
      },
      "image/jpeg",
      0.88
    );
  });
}

nextBtn.addEventListener("click", nextPage);
prevBtn.addEventListener("click", prevPage);

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") {
    nextPage();
  }

  if (e.key === "ArrowRight") {
    prevPage();
  }
});

book.addEventListener("touchstart", (e) => {
  if (e.touches.length !== 1) return;

  const touch = e.touches[0];

  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
}, {
  passive: true
});

book.addEventListener("touchend", (e) => {
  if (e.changedTouches.length !== 1) return;

  const touch = e.changedTouches[0];

  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;

  if (Math.abs(dx) < 45) return;
  if (Math.abs(dx) < Math.abs(dy)) return;

  if (dx < 0) {
    nextPage();
  } else {
    prevPage();
  }
}, {
  passive: true
});

window.addEventListener("resize", handleViewportChange);
window.addEventListener("orientationchange", handleViewportChange);

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", handleViewportChange);
}

window.addEventListener("beforeunload", () => {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
});

loadBook().catch((err) => {
  console.error(err);

  book.innerHTML = `
    <pre style="
      color:red;
      background:white;
      padding:20px;
      white-space:pre-wrap;
      font-size:14px;
    ">
錯誤名稱：${err.name || "未知"}
錯誤訊息：${err.message || "沒有訊息"}

${err.stack || ""}
    </pre>
  `;
});
