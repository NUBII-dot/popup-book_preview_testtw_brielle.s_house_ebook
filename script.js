pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const pdfUrl = "./pdf/book.pdf";

const book = document.getElementById("book");
const nextBtn = document.getElementById("next");
const prevBtn = document.getElementById("prev");

/*
  卡頓就改成 1.2
  想更清楚就改成 1.6
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
  允許動畫中繼續按按鈕。
  這裡不是同時重疊翻頁，而是排隊接著翻，動畫速度不變。
*/
const MAX_QUEUE = 8;

let spreads = [];
let currentIndex = 0;
let isAnimating = false;
let queuedDelta = 0;
let objectUrls = [];

let touchStartX = 0;
let touchStartY = 0;

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

/*
  內頁 → 內頁：
  保留雙面紙張翻頁效果。
*/
function turnSpreadPage(targetIndex, direction) {
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

  animation.finished
    .catch(() => {})
    .then(() => {
      underLayer.remove();
      flipLayer.remove();

      currentIndex = targetIndex;

      renderCurrentSpread();

      isAnimating = false;

      processQueue();
    });
}

/*
  封面 → 內頁、內頁 → 封底：
  修正重複封面 / 封底、錯位與結束後彈跳。
*/
function turnEdgePage(targetIndex, direction) {
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

  /*
    單頁 → 雙頁
    例如：封面翻開到第一個內頁。
  */
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

    animation.finished
      .catch(() => {})
      .then(() => {
        finishEdgeTransition(targetIndex, layers);
      });

    return;
  }

  /*
    雙頁 → 單頁
    例如：最後內頁翻到封底。
  */
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

    oldLayer.animate(
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

    animation.finished
      .catch(() => {})
      .then(() => {
        finishEdgeTransition(targetIndex, layers);
      });

    return;
  }

  finishEdgeTransition(targetIndex, layers);
}

/*
  封面 / 封底轉場結束時，暫時關閉 #book 的 transition，
  避免真正的 #book 回到畫面中央時又彈跳一次。
*/
function finishEdgeTransition(targetIndex, layers) {
  layers.forEach((layer) => {
    layer.remove();
  });

  book.style.transition = "none";

  currentIndex = targetIndex;

  renderCurrentSpread();

  book.style.visibility = "visible";

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
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

/* 手機滑動：左滑下一頁，右滑上一頁 */
book.addEventListener("touchstart", (e) => {
  const touch = e.touches[0];

  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
}, {
  passive: true
});

book.addEventListener("touchend", (e) => {
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
${err.stack || err.message}
    </pre>
  `;
});