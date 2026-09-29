const QR_DETECTION_MAX_SIZE = 1600;
const QR_OUTPUT_SIZE = 900;
const QR_PADDING = 54;

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
    throw new Error('Trình duyệt hiện tại chưa hỗ trợ tự nhận diện QR. Hãy dùng Chrome hoặc Edge bản mới nhất.');
  }

  try {
    const supportedFormats = await BarcodeDetectorApi.getSupportedFormats?.();
    if (Array.isArray(supportedFormats) && !supportedFormats.includes('qr_code')) {
      throw new Error('Trình duyệt hiện tại chưa hỗ trợ tự nhận diện QR. Hãy dùng Chrome hoặc Edge bản mới nhất.');
    }
    const detector = new BarcodeDetectorApi({ formats: ['qr_code'] });
    const detections = await detector.detect(canvas);
    const detection = detections.find((item) => item.format === 'qr_code') || detections[0];
    if (!detection) return null;

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
    if (error instanceof Error && error.message.includes('chưa hỗ trợ')) throw error;
    throw new Error('Không thể nhận diện mã QR. Vui lòng chọn ảnh có mã QR rõ hơn.');
  }
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
