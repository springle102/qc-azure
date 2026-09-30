import jsQR from 'jsqr';

const QR_DETECTION_MAX_SIZE = 1600;
const QR_OUTPUT_SIZE = 900;
const QR_PADDING = 54;
const QR_THRESHOLD_ATTEMPTS = [96, 128, 160, 192, 224];

export async function extractQrImage(file) {
  const source = await loadImageSource(file);
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, QR_DETECTION_MAX_SIZE / Math.max(source.width, source.height));
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, canvas.width, canvas.height);

    const corners = await detectQrCorners(canvas);
    if (!corners) throw new Error('Không tìm thấy mã QR trong ảnh. Vui lòng chọn ảnh có mã QR rõ hơn.');
    return perspectiveCropToPng(canvas, corners);
  } finally {
    source.close?.();
  }
}

async function loadImageSource(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Không thể đọc ảnh mã QR.'));
      element.src = objectUrl;
    });
    image.close = () => URL.revokeObjectURL(objectUrl);
    return image;
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function detectQrCorners(canvas) {
  const BarcodeDetectorApi = globalThis.BarcodeDetector;
  if (!BarcodeDetectorApi) {
    return detectQrCornersWithJsQr(canvas);
  }

  try {
    const supportedFormats = await BarcodeDetectorApi.getSupportedFormats?.();
    if (Array.isArray(supportedFormats) && !supportedFormats.includes('qr_code')) {
      return detectQrCornersWithJsQr(canvas);
    }
    const detector = new BarcodeDetectorApi({ formats: ['qr_code'] });
    const detections = await detector.detect(canvas);
    const detection = detections.find((item) => item.format === 'qr_code') || detections[0];
    if (!detection) return detectQrCornersWithJsQr(canvas);

    const points = Array.isArray(detection.cornerPoints) && detection.cornerPoints.length >= 4
      ? detection.cornerPoints.slice(0, 4).map(({ x, y }) => ({ x: Number(x), y: Number(y) }))
      : null;
    if (points?.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return points;

    const box = detection.boundingBox;
    if (!box) return null;
    return [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height }
    ];
  } catch (error) {
    const fallbackCorners = detectQrCornersWithJsQr(canvas);
    if (fallbackCorners) return fallbackCorners;
    if (error instanceof Error && error.message.includes('chưa hỗ trợ')) return null;
    return null;
  }
}

function detectQrCornersWithJsQr(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const attempts = [image.data, ...QR_THRESHOLD_ATTEMPTS.map((threshold) => createThresholdedImage(image, threshold))];
  for (const data of attempts) {
    const detection = jsQR(data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
    if (!detection?.location) continue;
    const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = detection.location;
    return [topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner]
      .map(({ x, y }) => ({ x: Number(x), y: Number(y) }));
  }
  return detectQrCornersWithFinderPatterns(image);
}

function createThresholdedImage(image, threshold) {
  const data = new Uint8ClampedArray(image.data.length);
  for (let index = 0; index < image.data.length; index += 4) {
    const luminance = (image.data[index] * 0.299)
      + (image.data[index + 1] * 0.587)
      + (image.data[index + 2] * 0.114);
    const value = luminance < threshold ? 0 : 255;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = image.data[index + 3];
  }
  return data;
}

// jsQR needs to decode the payload before it returns a location. Branded
// VietQR/MoMo images can still have a perfectly valid QR geometry while the
// center logo or decorative dots prevent decoding. This fallback locates the
// three finder patterns directly, so cropping does not depend on payload
// decoding or on the QR being pure black and white.
function detectQrCornersWithFinderPatterns(image) {
  const detectionImage = downsampleImage(image, 900);
  for (const threshold of [128, 160, 192]) {
    const candidates = findFinderPatternCandidates(detectionImage, threshold);
    const triangle = selectFinderPatternTriangle(candidates);
    if (triangle) {
      const corners = finderTriangleToCorners(triangle);
      const scaleX = image.width / detectionImage.width;
      const scaleY = image.height / detectionImage.height;
      return corners.map(({ x, y }) => ({ x: x * scaleX, y: y * scaleY }));
    }
  }
  return null;
}

function downsampleImage(image, maximumSize) {
  const scale = Math.min(1, maximumSize / Math.max(image.width, image.height));
  if (scale === 1) return image;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.round(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.round(x / scale));
      const sourceIndex = ((sourceY * image.width) + sourceX) * 4;
      const targetIndex = ((y * width) + x) * 4;
      data[targetIndex] = image.data[sourceIndex];
      data[targetIndex + 1] = image.data[sourceIndex + 1];
      data[targetIndex + 2] = image.data[sourceIndex + 2];
      data[targetIndex + 3] = image.data[sourceIndex + 3];
    }
  }
  return { data, width, height };
}

function findFinderPatternCandidates(image, threshold) {
  const candidates = [];
  for (let y = 0; y < image.height; y += 1) {
    let runLength = 0;
    let lastDark = false;
    const scans = [0, 0, 0, 0, 0];
    for (let x = -1; x <= image.width; x += 1) {
      const dark = x >= 0 && isDarkPixel(image, x, y, threshold);
      if (dark === lastDark) {
        runLength += 1;
        continue;
      }
      scans[0] = scans[1];
      scans[1] = scans[2];
      scans[2] = scans[3];
      scans[3] = scans[4];
      scans[4] = runLength;
      runLength = 1;
      lastDark = dark;

      // A finder pattern ends with a dark run followed by white space. Allow
      // both the classic 1:1:3:1:1 finder and round/logo-styled variants
      // whose center ring is closer to the other ring widths.
      if (!dark) {
        const horizontal = scoreFinderPatternRuns(scans);
        if (!horizontal) continue;
        const centerX = x - scans[3] - scans[4] - (scans[2] / 2);
        const centerY = y;
        const vertical = measureFinderPatternAt(image, Math.round(centerX), centerY, 0, 1, threshold);
        if (!vertical) continue;
        const verticalScore = scoreFinderPatternRuns(vertical.runs);
        if (!verticalScore) continue;
        const refinedY = centerY + ((vertical.positiveCenter - vertical.negativeCenter) / 2);
        candidates.push({
          x: centerX,
          y: refinedY,
          moduleSize: (horizontal.moduleSize + verticalScore.moduleSize) / 2,
          score: horizontal.score + verticalScore.score
        });
      }
    }
  }
  return clusterFinderPatternCandidates(candidates);
}

function scoreFinderPatternRuns(runs) {
  if (!Array.isArray(runs) || runs.length !== 5 || runs.some((run) => !Number.isFinite(run) || run < 1)) return null;
  const outsideAverage = (runs[0] + runs[1] + runs[3] + runs[4]) / 4;
  if (outsideAverage < 1.5) return null;
  const standardScore = scoreFinderPatternShape(runs, [1, 1, 3, 1, 1]);
  const roundScore = scoreFinderPatternShape(runs, [1, 1, 1, 1, 1]);
  const score = Math.min(standardScore, roundScore);
  const centerRatio = runs[2] / outsideAverage;
  if (centerRatio < 0.55 || centerRatio > 4.75 || score > 0.82) return null;
  return { score, moduleSize: runs.reduce((sum, value) => sum + value, 0) / 7 };
}

function scoreFinderPatternShape(runs, expected) {
  const unit = runs.reduce((sum, value) => sum + value, 0) / expected.reduce((sum, value) => sum + value, 0);
  return expected.reduce((score, ratio, index) => (
    score + Math.abs(runs[index] - (ratio * unit)) / Math.max(1, ratio * unit)
  ), 0) / expected.length;
}

function measureFinderPatternAt(image, x, y, dx, dy, threshold) {
  if (!isInsideImage(image, x, y) || !isDarkPixel(image, x, y, threshold)) return null;
  const positiveCenter = countPixels(image, x, y, dx, dy, threshold, true);
  const negativeCenter = countPixels(image, x, y, -dx, -dy, threshold, true);
  const centerRun = positiveCenter + negativeCenter - 1;
  const positiveWhite = countPixels(image, ...advancePoint(x, y, dx, dy, positiveCenter), dx, dy, threshold, false);
  const positiveBlack = countPixels(image, ...advancePoint(x, y, dx, dy, positiveCenter + positiveWhite), dx, dy, threshold, true);
  const negativeWhite = countPixels(image, ...advancePoint(x, y, -dx, -dy, negativeCenter), -dx, -dy, threshold, false);
  const negativeBlack = countPixels(image, ...advancePoint(x, y, -dx, -dy, negativeCenter + negativeWhite), -dx, -dy, threshold, true);
  const runs = [negativeBlack, negativeWhite, centerRun, positiveWhite, positiveBlack];
  if (runs.some((run) => run < 1)) return null;
  return { runs, positiveCenter, negativeCenter };
}

function countPixels(image, x, y, dx, dy, threshold, darkExpected) {
  let count = 0;
  let currentX = x;
  let currentY = y;
  while (isInsideImage(image, currentX, currentY) && isDarkPixel(image, currentX, currentY, threshold) === darkExpected) {
    count += 1;
    currentX += dx;
    currentY += dy;
  }
  return count;
}

function advancePoint(x, y, dx, dy, distance) {
  return [x + (dx * distance), y + (dy * distance)];
}

function isInsideImage(image, x, y) {
  return x >= 0 && y >= 0 && x < image.width && y < image.height;
}

function isDarkPixel(image, x, y, threshold) {
  const index = ((Math.round(y) * image.width) + Math.round(x)) * 4;
  const luminance = (image.data[index] * 0.299)
    + (image.data[index + 1] * 0.587)
    + (image.data[index + 2] * 0.114);
  return image.data[index + 3] > 20 && luminance < threshold;
}

function clusterFinderPatternCandidates(candidates) {
  const clusters = [];
  candidates.sort((left, right) => left.score - right.score).forEach((candidate) => {
    const cluster = clusters.find((item) => {
      const distance = Math.hypot(item.x - candidate.x, item.y - candidate.y);
      const size = Math.max(item.moduleSize, candidate.moduleSize);
      return distance <= Math.max(8, size * 2.5) && Math.abs(item.moduleSize - candidate.moduleSize) <= size * 0.65;
    });
    if (!cluster) {
      clusters.push({ ...candidate, count: 1 });
      return;
    }
    cluster.x = ((cluster.x * cluster.count) + candidate.x) / (cluster.count + 1);
    cluster.y = ((cluster.y * cluster.count) + candidate.y) / (cluster.count + 1);
    cluster.moduleSize = ((cluster.moduleSize * cluster.count) + candidate.moduleSize) / (cluster.count + 1);
    cluster.score = Math.min(cluster.score, candidate.score);
    cluster.count += 1;
  });
  return clusters
    .filter((cluster) => cluster.count >= 1)
    .sort((left, right) => left.score - right.score)
    .slice(0, 100);
}

function selectFinderPatternTriangle(candidates) {
  let best = null;
  for (let first = 0; first < candidates.length; first += 1) {
    for (let second = first + 1; second < candidates.length; second += 1) {
      for (let third = second + 1; third < candidates.length; third += 1) {
        const points = [candidates[first], candidates[second], candidates[third]];
        const size = Math.max(...points.map((point) => point.moduleSize));
        const minimumDistance = Math.max(12, size * 8);
        if (Math.min(
          Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
          Math.hypot(points[0].x - points[2].x, points[0].y - points[2].y),
          Math.hypot(points[1].x - points[2].x, points[1].y - points[2].y)
        ) < minimumDistance) continue;
        const sizeSpread = (Math.max(...points.map((point) => point.moduleSize)) - Math.min(...points.map((point) => point.moduleSize))) / size;
        if (sizeSpread > 0.65) continue;

        let rightAngle = null;
        points.forEach((point, index) => {
          const firstLeg = points[(index + 1) % 3];
          const secondLeg = points[(index + 2) % 3];
          const ax = firstLeg.x - point.x;
          const ay = firstLeg.y - point.y;
          const bx = secondLeg.x - point.x;
          const by = secondLeg.y - point.y;
          const firstLength = Math.hypot(ax, ay);
          const secondLength = Math.hypot(bx, by);
          const cosine = Math.abs((ax * bx) + (ay * by)) / Math.max(1, firstLength * secondLength);
          const legSpread = Math.abs(firstLength - secondLength) / Math.max(firstLength, secondLength);
          const candidate = { point, firstLeg, secondLeg, score: cosine + (legSpread * 0.25) };
          if (!rightAngle || candidate.score < rightAngle.score) rightAngle = candidate;
        });
        if (!rightAngle || rightAngle.score > 0.65) continue;
        const triangleScore = points.reduce((sum, point) => sum + point.score, 0) + rightAngle.score + sizeSpread;
        if (!best || triangleScore < best.score) {
          best = { ...rightAngle, score: triangleScore };
        }
      }
    }
  }
  if (!best) return null;
  const cross = ((best.firstLeg.x - best.point.x) * (best.secondLeg.y - best.point.y))
    - ((best.firstLeg.y - best.point.y) * (best.secondLeg.x - best.point.x));
  return {
    topLeft: best.point,
    topRight: cross >= 0 ? best.firstLeg : best.secondLeg,
    bottomLeft: cross >= 0 ? best.secondLeg : best.firstLeg,
    moduleSize: (best.point.moduleSize + best.firstLeg.moduleSize + best.secondLeg.moduleSize) / 3
  };
}

function finderTriangleToCorners(triangle) {
  const inset = triangle.moduleSize * 3.5;
  const rightVector = normalizeVector(triangle.topRight.x - triangle.topLeft.x, triangle.topRight.y - triangle.topLeft.y);
  const downVector = normalizeVector(triangle.bottomLeft.x - triangle.topLeft.x, triangle.bottomLeft.y - triangle.topLeft.y);
  const topLeft = {
    x: triangle.topLeft.x - ((rightVector.x + downVector.x) * inset),
    y: triangle.topLeft.y - ((rightVector.y + downVector.y) * inset)
  };
  const topRight = {
    x: triangle.topRight.x + (rightVector.x * inset) - (downVector.x * inset),
    y: triangle.topRight.y + (rightVector.y * inset) - (downVector.y * inset)
  };
  const bottomLeft = {
    x: triangle.bottomLeft.x - (rightVector.x * inset) + (downVector.x * inset),
    y: triangle.bottomLeft.y - (rightVector.y * inset) + (downVector.y * inset)
  };
  return [topLeft, topRight, {
    x: topRight.x + bottomLeft.x - topLeft.x,
    y: topRight.y + bottomLeft.y - topLeft.y
  }, bottomLeft];
}

function normalizeVector(x, y) {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function perspectiveCropToPng(sourceCanvas, corners) {
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = QR_OUTPUT_SIZE;
  outputCanvas.height = QR_OUTPUT_SIZE;
  const outputContext = outputCanvas.getContext('2d', { willReadFrequently: true });
  const output = outputContext.createImageData(QR_OUTPUT_SIZE, QR_OUTPUT_SIZE);

  for (let index = 0; index < output.data.length; index += 4) {
    output.data[index] = 255;
    output.data[index + 1] = 255;
    output.data[index + 2] = 255;
    output.data[index + 3] = 255;
  }

  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const source = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const qrSize = QR_OUTPUT_SIZE - (QR_PADDING * 2);
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;

  for (let y = 0; y < qrSize; y += 1) {
    const v = qrSize === 1 ? 0 : y / (qrSize - 1);
    for (let x = 0; x < qrSize; x += 1) {
      const u = qrSize === 1 ? 0 : x / (qrSize - 1);
      const topX = topLeft.x + ((topRight.x - topLeft.x) * u);
      const topY = topLeft.y + ((topRight.y - topLeft.y) * u);
      const bottomX = bottomLeft.x + ((bottomRight.x - bottomLeft.x) * u);
      const bottomY = bottomLeft.y + ((bottomRight.y - bottomLeft.y) * u);
      const sourceX = clamp(Math.round(topX + ((bottomX - topX) * v)), 0, source.width - 1);
      const sourceY = clamp(Math.round(topY + ((bottomY - topY) * v)), 0, source.height - 1);
      const sourceIndex = ((sourceY * source.width) + sourceX) * 4;
      const outputIndex = (((y + QR_PADDING) * QR_OUTPUT_SIZE) + x + QR_PADDING) * 4;
      output.data[outputIndex] = source.data[sourceIndex];
      output.data[outputIndex + 1] = source.data[sourceIndex + 1];
      output.data[outputIndex + 2] = source.data[sourceIndex + 2];
      output.data[outputIndex + 3] = source.data[sourceIndex + 3];
    }
  }

  outputContext.putImageData(output, 0, 0);
  return outputCanvas.toDataURL('image/png');
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
